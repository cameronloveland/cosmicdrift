import * as THREE from 'three';
import { Track } from './Track';
import { NPCShip } from './NPCShip';
import { ATTRACT_CAMERA } from './constants';

export type Shot = 'standard' | 'heli' | 'close' | 'trackside' | 'first';

type Pose = { position: THREE.Vector3; quaternion: THREE.Quaternion; up: THREE.Vector3 };

export class CameraDirector {
    private track: Track;
    private camera: THREE.PerspectiveCamera;
    private npcs: NPCShip[] = [];

    private current: Shot = 'standard';
    private timeInShot = 0;
    private nextCutTime = 6;
    private shotOrder: Shot[] = ['standard', 'heli', 'close', 'trackside', 'first'];
    private shotIndex = 0;

    private blending = false;
    private blendT = 0;
    private readonly blendDuration = ATTRACT_CAMERA.blendDurationSec;
    private fromPose: Pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0) };
    private toPose: Pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0) };

    // Trackside pass-by bookkeeping
    private tracksideCamT = 0; // camera position on track
    private wasBehind: boolean[] = [];
    private passedCount = 0;

    // temp reuse
    private tmpVec = new THREE.Vector3();
    private tmpVec2 = new THREE.Vector3();
    private tmpQuat = new THREE.Quaternion();
    private zoom = 1; // 1 = default
    private leadIndex = 0; // which NPC we're following for shots that need a target
    private heliOnly = true; // temporary: focus on helicopter camera only for tuning

    constructor(track: Track, camera: THREE.PerspectiveCamera) {
        this.track = track;
        this.camera = camera;
        // seed a first cut time
        this.scheduleNextCut();
    }

    setNPCs(npcs: NPCShip[]) { this.npcs = npcs; }

    adjustZoom(delta: number) {
        const z = this.zoom + delta;
        const { min, max } = ATTRACT_CAMERA.zoom as { min: number; max: number };
        this.zoom = Math.min(max, Math.max(min, z));
    }

    update(dt: number) {
        if (this.npcs.length === 0) return;

        this.timeInShot += dt;

        // If we're focusing on heli only, skip cut logic entirely
        const target = this.heliOnly
            ? this.poseHeli()
            : this.computeShotPose(this.current);

        if (this.blending) {
            this.blendT = Math.min(1, this.blendT + dt / this.blendDuration);
            // Smooth ease
            const t = this.blendT < 0.5 ? 2 * this.blendT * this.blendT : 1 - Math.pow(-2 * this.blendT + 2, 2) / 2;
            const pos = this.tmpVec.copy(this.fromPose.position).lerp(target.position, t);
            this.camera.position.copy(pos);
            this.tmpQuat.copy(this.fromPose.quaternion).slerp(target.quaternion, t);
            this.camera.quaternion.copy(this.tmpQuat);
            if (this.blendT >= 1) this.blending = false;
        } else {
            // Soft follow even within a shot for smoother motion
            this.camera.position.lerp(target.position, 1 - Math.pow(0.0001, dt));
            this.camera.quaternion.slerp(target.quaternion, 1 - Math.pow(0.0001, dt));
        }
        // Always update camera up to the shot's up vector
        this.camera.up.copy(target.up);
    }

    private cutTo(next: Shot) {
        // Prepare blend
        this.fromPose.position.copy(this.camera.position);
        this.fromPose.quaternion.copy(this.camera.quaternion);

        // Initialize trackside state upon entry
        if (next === 'trackside') this.initTrackside();
        // Rotate the lead every cut for variety
        this.leadIndex = (this.leadIndex + 1) % this.npcs.length;

        const target = this.computeShotPose(next);
        this.toPose.position.copy(target.position);
        this.toPose.quaternion.copy(target.quaternion);

        this.current = next;
        this.timeInShot = 0;
        this.scheduleNextCut();

        this.blending = true;
        this.blendT = 0;
    }

    private scheduleNextCut() {
        // 5-9 seconds random window for standard/heli; trackside uses pass-by logic
        this.nextCutTime = ATTRACT_CAMERA.cutMinSec + Math.random() * (ATTRACT_CAMERA.cutMaxSec - ATTRACT_CAMERA.cutMinSec);
    }

    private computeShotPose(shot: Shot): Pose {
        if (shot === 'standard') return this.poseStandard();
        if (shot === 'heli') return this.poseHeli();
        if (shot === 'close') return this.poseClose();
        if (shot === 'first') return this.poseFirst();
        return this.poseTrackside();
    }

    private poseStandard(): Pose {
        const lead = this.npcs[this.leadIndex] ?? this.npcs[0];
        const tw = this.wrap01(lead.state.t);
        const pos = new THREE.Vector3();
        const n = new THREE.Vector3();
        const b = new THREE.Vector3();
        const t = new THREE.Vector3();
        this.track.getPointAtT(tw, pos);
        this.track.getFrenetFrame(tw, n, b, t);
        const up = n.clone().normalize();
        const forward = t.clone().normalize();
        const cameraPos = new THREE.Vector3()
            .copy(pos)
            .addScaledVector(b, lead.state.lateralOffset)
            .addScaledVector(up, ATTRACT_CAMERA.standard.height * (0.85 + 0.25 * this.zoom))
            .addScaledVector(forward, -ATTRACT_CAMERA.standard.back * this.zoom);
        const lookAt = new THREE.Vector3().copy(pos)
            .addScaledVector(b, lead.state.lateralOffset)
            .addScaledVector(forward, 8)
            .addScaledVector(up, 0.2);
        const q = this.lookAtQuaternion(cameraPos, lookAt, up);
        return { position: cameraPos, quaternion: q, up };
    }

    private poseHeli(): Pose {
        // Centroid of NPCs
        const center = new THREE.Vector3();
        const n = new THREE.Vector3();
        const b = new THREE.Vector3();
        const t = new THREE.Vector3();
        // Use circular-mean t for frame so direction matches the pack
        const tAvg = this.averageT();
        this.track.getPointAtT(tAvg, new THREE.Vector3());
        this.track.getFrenetFrame(tAvg, n, b, t);
        for (const npc of this.npcs) {
            const p = new THREE.Vector3();
            const tw = this.wrap01(npc.state.t);
            this.track.getPointAtT(tw, p);
            // include lateral offset so the centroid matches ships' on-track placement
            const bb = new THREE.Vector3();
            this.track.getFrenetFrame(tw, new THREE.Vector3(), bb, new THREE.Vector3());
            p.addScaledVector(bb, npc.state.lateralOffset);
            center.add(p);
        }
        center.multiplyScalar(1 / this.npcs.length);

        const up = n.clone().normalize();
        const forward = t.clone().normalize();
        // Back and high like a helicopter
        const back = (ATTRACT_CAMERA.heli.backBase * this.zoom) + Math.sin(this.timeInShot * 0.7) * ATTRACT_CAMERA.heli.backSway; // gentle sway
        const height = (ATTRACT_CAMERA.heli.heightBase * (0.85 + 0.25 * this.zoom)) + Math.cos(this.timeInShot * 0.5) * ATTRACT_CAMERA.heli.heightSway;
        const rightSway = Math.sin(this.timeInShot * 0.4) * ATTRACT_CAMERA.heli.rightSway;
        // Position camera behind ships using forward tangent directly
        const cameraPos = new THREE.Vector3()
            .copy(center)
            .addScaledVector(up, height)
            .addScaledVector(forward, -back) // Behind ships (negative forward)
            .addScaledVector(b, rightSway);
        // Look ahead along track direction (same direction ships are facing)
        const lookAt = this.tmpVec.copy(center).addScaledVector(forward, 8);
        const q = this.lookAtQuaternion(cameraPos, lookAt, up);
        return { position: cameraPos, quaternion: q, up };
    }

    private initTrackside() {
        const lead = this.npcs[this.leadIndex] ?? this.npcs[0];
        // Place camera some distance ahead along the track
        const aheadT = lead.state.t + ATTRACT_CAMERA.trackside.aheadT; // ~ ahead portion of track
        this.tracksideCamT = this.wrap01(aheadT);
        // Determine who is behind the camera at start
        this.wasBehind = this.npcs.map(npc => this.deltaT(npc.state.t, this.tracksideCamT) < 0);
        this.passedCount = 0;
    }

    private allNPCsPassed(): boolean {
        let passed = 0;
        for (let i = 0; i < this.npcs.length; i++) {
            const npc = this.npcs[i];
            const d = this.deltaT(npc.state.t, this.tracksideCamT);
            const isBehind = d < 0;
            // detect crossing from behind->ahead
            if (this.wasBehind[i] && !isBehind) {
                this.wasBehind[i] = false;
                passed++;
            } else if (!this.wasBehind[i]) {
                passed++;
            }
        }
        return passed >= this.npcs.length;
    }

    private poseTrackside(): Pose {
        const pos = new THREE.Vector3();
        const n = new THREE.Vector3();
        const b = new THREE.Vector3();
        const t = new THREE.Vector3();
        this.track.getPointAtT(this.tracksideCamT, pos);
        this.track.getFrenetFrame(this.tracksideCamT, n, b, t);
        const up = n.clone().normalize();
        const forward = t.clone().normalize();
        const cameraPos = new THREE.Vector3()
            .copy(pos)
            .addScaledVector(n, ATTRACT_CAMERA.trackside.up * (0.9 + 0.2 * this.zoom))
            .addScaledVector(b, ATTRACT_CAMERA.trackside.side * this.zoom);
        // Aim at the racers (centroid), so the camera tracks action at all times
        const centroid = new THREE.Vector3();
        for (const npc of this.npcs) {
            const p = new THREE.Vector3();
            this.track.getPointAtT(npc.state.t, p);
            centroid.add(p);
        }
        centroid.multiplyScalar(1 / this.npcs.length);
        const lookAt = centroid.lengthSq() > 0 ? centroid : this.tmpVec.copy(pos).addScaledVector(forward, -ATTRACT_CAMERA.trackside.lookBack);
        const q = this.lookAtQuaternion(cameraPos, lookAt, up);
        return { position: cameraPos, quaternion: q, up };
    }

    // Third-person close chase (tighter, lower)
    private poseClose(): Pose {
        const lead = this.npcs[this.leadIndex] ?? this.npcs[0];
        const tw = this.wrap01(lead.state.t);
        const pos = new THREE.Vector3();
        const n = new THREE.Vector3();
        const b = new THREE.Vector3();
        const t = new THREE.Vector3();
        this.track.getPointAtT(tw, pos);
        this.track.getFrenetFrame(tw, n, b, t);
        const up = n.clone().normalize();
        const forward = t.clone().normalize();
        const lookAheadT2 = this.wrap01(tw + (ATTRACT_CAMERA.heli.lookAheadMeters / this.track.length));
        const lookAheadPoint2 = new THREE.Vector3();
        this.track.getPointAtT(lookAheadT2, lookAheadPoint2);
        const targetPos2 = new THREE.Vector3().copy(pos).addScaledVector(b, lead.state.lateralOffset);
        const dir2 = new THREE.Vector3().subVectors(lookAheadPoint2, targetPos2).normalize();
        const cameraPos = new THREE.Vector3()
            .copy(targetPos2)
            .addScaledVector(up, 2.2 * (0.85 + 0.25 * this.zoom))
            .addScaledVector(dir2, -6.5 * this.zoom);
        const lookAt = new THREE.Vector3().copy(targetPos2).addScaledVector(dir2, 6).addScaledVector(up, 0.2);
        const q = this.lookAtQuaternion(cameraPos, lookAt, up);
        return { position: cameraPos, quaternion: q, up };
    }

    // First-person from the nose of the lead ship
    private poseFirst(): Pose {
        const lead = this.npcs[this.leadIndex] ?? this.npcs[0];
        const tw = this.wrap01(lead.state.t);
        const pos = new THREE.Vector3();
        const n = new THREE.Vector3();
        const b = new THREE.Vector3();
        const t = new THREE.Vector3();
        this.track.getPointAtT(tw, pos);
        this.track.getFrenetFrame(tw, n, b, t);
        const up = n.clone().normalize();
        const forward = t.clone().normalize();
        const fpPos = new THREE.Vector3()
            .copy(pos)
            .addScaledVector(b, lead.state.lateralOffset)
            .addScaledVector(up, 1.2)
            .addScaledVector(forward, 0.8); // slightly forward from ship center
        const lookAt = new THREE.Vector3().copy(fpPos).addScaledVector(forward, 8);
        const q = this.lookAtQuaternion(fpPos, lookAt, up);
        return { position: fpPos, quaternion: q, up };
    }

    private lookAtQuaternion(from: THREE.Vector3, to: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
        // Use THREE.js's lookAt logic exactly as the normal camera does
        // Create direction vector from camera to target (this becomes -Z in camera space)
        const direction = this.tmpVec.copy(to).sub(from).normalize();

        // If direction is zero, fall back
        if (direction.lengthSq() < 0.0001) {
            return new THREE.Quaternion();
        }

        // Ensure up vector is perpendicular to direction (Gram-Schmidt)
        const right = this.tmpVec2.copy(direction).cross(up).normalize();
        if (right.lengthSq() < 0.0001) {
            // Fallback if up and direction are parallel
            right.set(1, 0, 0);
        }
        const correctedUp = new THREE.Vector3().copy(right).cross(direction).normalize();

        // Build rotation matrix: columns are right, up, -forward (direction)
        // THREE.js cameras look down -Z, so Z should point opposite to direction
        const negatedDirection = new THREE.Vector3().copy(direction).negate();
        const m = new THREE.Matrix4();
        m.makeBasis(right, correctedUp, negatedDirection);
        return new THREE.Quaternion().setFromRotationMatrix(m);
    }

    // Compute mean t on the unit circle to avoid wrap-around artifacts
    private averageT(): number {
        let sx = 0, sy = 0;
        for (const npc of this.npcs) {
            const ang = this.wrap01(npc.state.t) * Math.PI * 2;
            sx += Math.cos(ang);
            sy += Math.sin(ang);
        }
        const angMean = Math.atan2(sy, sx);
        let t = angMean / (Math.PI * 2);
        if (t < 0) t += 1;
        return t;
    }

    private wrap01(t: number) {
        if (t >= 1) return t - 1;
        if (t < 0) return t + 1;
        return t;
    }

    // delta in range (-0.5,0.5]: positive means npc ahead of camera point along the track
    private deltaT(npcT: number, camT: number) {
        let d = npcT - camT;
        if (d > 0.5) d -= 1;
        if (d <= -0.5) d += 1;
        return d;
    }

    private nextShot(): Shot {
        this.shotIndex = (this.shotIndex + 1) % this.shotOrder.length;
        return this.shotOrder[this.shotIndex];
    }
}

