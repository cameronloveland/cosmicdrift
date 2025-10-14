import * as THREE from 'three';
import { CAMERA, PHYSICS } from './constants';
import { Track } from './Track';

function kmhToMps(kmh: number) { return kmh / 3.6; }

export class Ship {
    public root = new THREE.Group();
    public state = {
        t: 0,
        speedKmh: PHYSICS.baseSpeed,
        lateralOffset: 0,
        pitch: 0,
        flow: 0,
        boosting: false
    };

    private track: Track;
    private camera: THREE.PerspectiveCamera;
    private velocitySide = 0;
    private velocityPitch = 0;
    private boostTimer = 0;

    private tmp = {
        pos: new THREE.Vector3(),
        tangent: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        binormal: new THREE.Vector3(),
        right: new THREE.Vector3(),
        up: new THREE.Vector3(),
        forward: new THREE.Vector3()
    };

    constructor(track: Track, camera: THREE.PerspectiveCamera) {
        this.track = track;
        this.camera = camera;

        // simple hover-ship mesh
        const body = new THREE.Group();
        const geo = new THREE.ConeGeometry(0.45, 1.2, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0x99ddff, metalness: 0.3, roughness: 0.2, emissive: new THREE.Color(0x53d7ff) });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = Math.PI / 2;
        body.add(mesh);

        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false }));
        glow.position.set(0, -0.15, -0.3);
        body.add(glow);

        this.root.add(body);

        window.addEventListener('keydown', (e) => this.onKey(e, true));
        window.addEventListener('keyup', (e) => this.onKey(e, false));
    }

    private input = { left: false, right: false, up: false, down: false, boost: false };

    private onKey(e: KeyboardEvent, down: boolean) {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.input.left = down;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') this.input.right = down;
        if (e.code === 'ArrowUp' || e.code === 'KeyW') this.input.up = down;
        if (e.code === 'ArrowDown' || e.code === 'KeyS') this.input.down = down;
        if (e.code === 'Space') this.input.boost = down;
    }

    update(dt: number) {
        // speed and boost
        const targetSpeed = this.input.boost ? Math.min(PHYSICS.maxSpeed, PHYSICS.baseSpeed * PHYSICS.boostMultiplier) : PHYSICS.baseSpeed;
        const speedLerp = 1 - Math.pow(0.001, dt); // smooth
        this.state.speedKmh = THREE.MathUtils.lerp(this.state.speedKmh, targetSpeed, speedLerp);
        this.state.boosting = this.input.boost;
        if (this.input.boost) this.boostTimer = Math.min(this.boostTimer + dt, 1); else this.boostTimer = Math.max(this.boostTimer - dt * 2, 0);

        // advance along curve
        const mps = kmhToMps(this.state.speedKmh);
        this.state.t += (mps * dt) / this.track.length; // normalize by length
        if (this.state.t > 1) this.state.t -= 1; if (this.state.t < 0) this.state.t += 1;

        // lateral control
        const sideInput = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
        const targetSideVel = sideInput * PHYSICS.lateralAccel;
        this.velocitySide = THREE.MathUtils.damp(this.velocitySide, targetSideVel, PHYSICS.lateralDamping, dt);
        this.state.lateralOffset = THREE.MathUtils.clamp(this.state.lateralOffset + this.velocitySide * dt, -PHYSICS.lateralMax, PHYSICS.lateralMax);

        // pitch control
        const pitchInput = (this.input.up ? 1 : 0) - (this.input.down ? 1 : 0);
        const targetPitchVel = pitchInput * PHYSICS.pitchAccel;
        this.velocityPitch = THREE.MathUtils.damp(this.velocityPitch, targetPitchVel, PHYSICS.pitchDamping, dt);
        this.state.pitch = THREE.MathUtils.clamp(this.state.pitch + this.velocityPitch * dt, -PHYSICS.pitchMax, PHYSICS.pitchMax);

        // flow meter logic
        const fast = this.state.speedKmh >= PHYSICS.highSpeedThreshold;
        const stable = Math.abs(sideInput) === 0 && Math.abs(pitchInput) === 0;
        const df = (fast && stable ? PHYSICS.flowFillSpeed : -PHYSICS.flowDrainSpeed) * dt;
        this.state.flow = THREE.MathUtils.clamp(this.state.flow + df, 0, 1);

        // position and orientation from Frenet frames
        const { pos, tangent, normal, binormal, right, up, forward } = this.tmp;
        this.track.getPointAtT(this.state.t, pos);
        this.track.getFrenetFrame(this.state.t, normal, binormal, tangent);
        forward.copy(tangent);
        // Build a horizon-aligned frame so left/right is sideways, not vertical
        const worldUp = new THREE.Vector3(0, 1, 0);
        right.copy(worldUp).cross(forward).normalize();
        up.copy(forward).cross(right).normalize();

        // apply lateral offset and pitch
        pos.addScaledVector(right, this.state.lateralOffset);

        // compute quaternion from basis vectors (forward, up)
        const m = new THREE.Matrix4();
        const z = forward.clone().normalize();
        const x = new THREE.Vector3().crossVectors(up, z).normalize();
        const y = new THREE.Vector3().crossVectors(z, x).normalize();
        m.makeBasis(x, y, z);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        const pitchQ = new THREE.Quaternion().setFromAxisAngle(x, this.state.pitch);
        // Bank visually with sideways velocity
        const bankAngle = THREE.MathUtils.degToRad(15) * THREE.MathUtils.clamp(this.velocitySide / PHYSICS.lateralAccel, -1, 1);
        const bankQ = new THREE.Quaternion().setFromAxisAngle(z, -bankAngle);
        q.multiply(pitchQ).multiply(bankQ);
        this.root.position.copy(pos);
        this.root.quaternion.copy(q);

        // chase camera spring (place directly behind the ship in local space)
        const localCamOffset = new THREE.Vector3(0, CAMERA.chaseHeight, -CAMERA.chaseDistance * (1 + this.boostTimer * 0.6));
        const worldCamTarget = this.root.localToWorld(localCamOffset.clone());
        this.camera.position.lerp(worldCamTarget, 1 - Math.pow(0.001, dt));
        const worldLookAt = this.root.localToWorld(new THREE.Vector3(0, 0.5, 2.0));
        this.camera.lookAt(worldLookAt);

        // subtle speed shake
        const shake = CAMERA.shakeMax * (this.state.speedKmh / PHYSICS.maxSpeed) * (0.4 + 0.6 * this.boostTimer);
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
    }
}


