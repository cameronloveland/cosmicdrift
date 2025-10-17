import * as THREE from 'three';
import { CAMERA, COLORS, LAPS_TOTAL, PHYSICS, TUNNEL } from './constants';
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
        boosting: false,
        lapCurrent: 1,
        lapTotal: LAPS_TOTAL,
        boostLevel: 1,
        currentColor: 'default' as 'cyan' | 'magenta' | 'default',
        inTunnel: false,
        tunnelCenterBoost: 1.0 // multiplier from tunnel center alignment
    };

    private track: Track;
    private camera: THREE.PerspectiveCamera;
    private velocitySide = 0;
    private velocityPitch = 0;
    private boostTimer = 0; // visual intensity for camera/shake
    private boostEnergy = 1; // 0..1 manual boost resource
    private boosterExpiry: number[] = [];
    private now = 0;
    // lap detection helpers
    private prevT = 0;
    private checkpointT = 0.0; // could move later; start line

    private mouseYawTarget = 0;
    private mousePitchTarget = 0;
    private mouseYaw = 0;
    private mousePitch = 0;
    private mouseActive = false;

    private tunnelBoostAccumulator = 1.0; // tracks current tunnel boost multiplier
    private baseFov = CAMERA.fov;
    private currentFov = CAMERA.fov;

    private shipMaterial!: THREE.MeshStandardMaterial;
    private glowMaterial!: THREE.MeshBasicMaterial;

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
        this.shipMaterial = new THREE.MeshStandardMaterial({ color: 0x99ddff, metalness: 0.3, roughness: 0.2, emissive: new THREE.Color(0x53d7ff) });
        const mesh = new THREE.Mesh(geo, this.shipMaterial);
        mesh.rotation.x = Math.PI / 2;
        body.add(mesh);

        this.glowMaterial = new THREE.MeshBasicMaterial({
            color: 0x53d7ff,
            toneMapped: false,
            transparent: false,
            opacity: 1.0
        });
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), this.glowMaterial);
        glow.position.set(0, -0.15, -0.3);
        body.add(glow);

        this.root.add(body);

        window.addEventListener('keydown', (e) => this.onKey(e, true));
        window.addEventListener('keyup', (e) => this.onKey(e, false));
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mousedown', () => this.onMouseDown());
        window.addEventListener('mouseup', () => this.onMouseUp());

        // Start a short distance behind the start line at t=0
        const behindMeters = 30;
        this.state.t = THREE.MathUtils.euclideanModulo(1 - behindMeters / this.track.length, 1);
    }

    private input = { left: false, right: false, up: false, down: false, boost: false };

    private onKey(e: KeyboardEvent, down: boolean) {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.input.left = down;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') this.input.right = down;
        if (e.code === 'ArrowUp' || e.code === 'KeyW') this.input.up = down;
        if (e.code === 'ArrowDown' || e.code === 'KeyS') this.input.down = down;
        if (e.code === 'Space') this.input.boost = down;
    }

    private onMouseMove(e: MouseEvent) {
        if (!this.mouseActive) return;
        // Only steer when mouse is active (mouse down). Invert controls per request
        const dx = e.movementX;
        const dy = e.movementY;
        if (dx === 0 && dy === 0) return;
        this.mouseYawTarget = THREE.MathUtils.clamp(this.mouseYawTarget - dx * 0.002, -0.6, 0.6);
        this.mousePitchTarget = THREE.MathUtils.clamp(this.mousePitchTarget + dy * 0.0015, -0.35, 0.35);
    }

    private onMouseDown() {
        this.mouseActive = true;
        // Try to capture pointer for a smoother feel
        (document.body as any).requestPointerLock?.();
    }

    private onMouseUp() {
        this.mouseActive = false;
        document.exitPointerLock?.();
    }

    update(dt: number) {
        this.now += dt;
        // speed and boost
        // Booster stacking: multiplicative with manual boost, capped at maxSpeed
        // Count active stacks
        let stacks = 0;
        for (let i = this.boosterExpiry.length - 1; i >= 0; i--) {
            if (this.boosterExpiry[i] <= this.now) this.boosterExpiry.splice(i, 1);
        }
        stacks = this.boosterExpiry.length;

        // Manual boost resource: drains while active, regens when not held
        let isBoosting = false;
        if (this.input.boost && this.boostEnergy > 0) {
            isBoosting = true;
            this.boostEnergy = Math.max(0, this.boostEnergy - dt / PHYSICS.boostDurationSec);
        } else if (!this.input.boost) {
            this.boostEnergy = Math.min(1, this.boostEnergy + PHYSICS.boostRegenPerSec * dt);
        }

        const manual = isBoosting ? PHYSICS.boostMultiplier : 1;
        const boosterMul = Math.pow(PHYSICS.trackBoosterMultiplier, stacks);
        
        // Tunnel boost logic: progressive boost based on center alignment
        const tunnelInfo = this.track.getTunnelAtT(this.state.t, this.state.lateralOffset);
        this.state.inTunnel = tunnelInfo.inTunnel;
        
        if (tunnelInfo.inTunnel && tunnelInfo.centerAlignment >= TUNNEL.centerThreshold) {
            // Accumulate boost when well-centered in tunnel
            const targetBoost = 1 + (TUNNEL.centerBoostMultiplier - 1) * tunnelInfo.centerAlignment;
            this.tunnelBoostAccumulator = THREE.MathUtils.lerp(
                this.tunnelBoostAccumulator,
                targetBoost,
                TUNNEL.boostAccumulationSpeed * dt
            );
        } else {
            // Decay boost when not in tunnel or not centered
            this.tunnelBoostAccumulator = THREE.MathUtils.lerp(
                this.tunnelBoostAccumulator,
                1.0,
                TUNNEL.boostDecaySpeed * dt
            );
        }
        this.state.tunnelCenterBoost = this.tunnelBoostAccumulator;
        
        const targetSpeed = Math.min(PHYSICS.maxSpeed, PHYSICS.baseSpeed * manual * boosterMul * this.tunnelBoostAccumulator);
        const speedLerp = 1 - Math.pow(0.001, dt); // smooth
        // Maintain consistent speed across track width for uniform turning feel
        this.state.speedKmh = THREE.MathUtils.lerp(this.state.speedKmh, targetSpeed, speedLerp);
        this.state.boosting = isBoosting;
        if (isBoosting) this.boostTimer = Math.min(this.boostTimer + dt, 1); else this.boostTimer = Math.max(this.boostTimer - dt * 2, 0);
        this.state.boostLevel = this.boostEnergy;

        // advance along curve
        const mps = kmhToMps(this.state.speedKmh);
        this.prevT = this.state.t;
        this.state.t += (mps * dt) / this.track.length; // normalize by length
        if (this.state.t > 1) this.state.t -= 1; if (this.state.t < 0) this.state.t += 1;

        // Booster pickup detection: if crossing a booster T and near center lane
        const boosterTs = this.track.getBoosterTs?.() ?? [];
        if (boosterTs.length > 0) {
            const minT = this.prevT;
            const maxT = this.state.t;
            const crossed = (t: number) => {
                if (maxT >= minT) return t >= minT && t < maxT;
                // wrap around
                return t >= minT || t < maxT;
            };
            const lateralLimit = this.track.width * PHYSICS.boosterLateralRatio;
            if (Math.abs(this.state.lateralOffset) <= lateralLimit) {
                for (let i = 0; i < boosterTs.length; i++) {
                    const bt = boosterTs[i];
                    if (crossed(bt)) {
                        this.boosterExpiry.push(this.now + PHYSICS.trackBoosterDuration);
                    }
                }
            }
        }

        // lap detection: crossing checkpoint at t=0
        const crossedCheckpoint = (a: number, b: number, tCheck: number) => {
            if (a <= b) return a < tCheck && b >= tCheck; // inclusive on b end
            return a < tCheck || b >= tCheck; // wrapped around
        };
        if (crossedCheckpoint(this.prevT, this.state.t, 0.0)) {
            this.state.lapCurrent = this.state.lapCurrent % this.state.lapTotal + 1;
        }

        // lateral control
        const sideInput = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
        const targetSideVel = sideInput * PHYSICS.lateralAccel;
        this.velocitySide = THREE.MathUtils.damp(this.velocitySide, targetSideVel, PHYSICS.lateralDamping, dt);
        const half = this.track.width * 0.5;
        const lateralLimit = half * 0.95;
        this.state.lateralOffset = THREE.MathUtils.clamp(this.state.lateralOffset + this.velocitySide * dt, -lateralLimit, lateralLimit);

        // Rail collision detection and color change
        // Ship hits the rails when at the lateral limit (fully touching)
        const collisionThreshold = lateralLimit * 0.98; // trigger when 98% to the edge (almost fully touching)

        // Check collision with cyan rail (right side)
        if (this.state.lateralOffset >= collisionThreshold && this.state.currentColor !== 'cyan') {
            this.state.currentColor = 'cyan';
            this.shipMaterial.color.copy(COLORS.neonCyan);
            this.shipMaterial.emissive.copy(COLORS.neonCyan).multiplyScalar(0.5);
            this.shipMaterial.needsUpdate = true;

            // Force glow material update
            this.glowMaterial.color.copy(COLORS.neonCyan);
            this.glowMaterial.needsUpdate = true;
            console.log('Ship changed to cyan, glow color set to:', this.glowMaterial.color.getHexString());
        }
        // Check collision with magenta rail (left side)
        else if (this.state.lateralOffset <= -collisionThreshold && this.state.currentColor !== 'magenta') {
            this.state.currentColor = 'magenta';
            this.shipMaterial.color.copy(COLORS.neonMagenta);
            this.shipMaterial.emissive.copy(COLORS.neonMagenta).multiplyScalar(0.5);
            this.shipMaterial.needsUpdate = true;

            // Force glow material update
            this.glowMaterial.color.copy(COLORS.neonMagenta);
            this.glowMaterial.needsUpdate = true;
            console.log('Ship changed to magenta, glow color set to:', this.glowMaterial.color.getHexString());
        }
        // Reset to default when in center
        else if (Math.abs(this.state.lateralOffset) < collisionThreshold * 0.5 && this.state.currentColor !== 'default') {
            this.state.currentColor = 'default';
            this.shipMaterial.color.setHex(0x99ddff);
            this.shipMaterial.emissive.copy(COLORS.neonCyan);
            this.shipMaterial.needsUpdate = true;

            // Reset glow to cyan
            this.glowMaterial.color.copy(COLORS.neonCyan);
            this.glowMaterial.needsUpdate = true;
            console.log('Ship reset to default cyan, glow color set to:', this.glowMaterial.color.getHexString());
        }

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

        // position and orientation from banked Frenet frame
        const { pos, tangent, normal, binormal, right, up, forward } = this.tmp;
        this.track.getPointAtT(this.state.t, pos);
        this.track.getFrenetFrame(this.state.t, normal, binormal, tangent);

        // Construct frame directly from cached normals/binormals for banking
        forward.copy(tangent).normalize();
        right.copy(binormal).normalize();
        up.copy(normal).normalize();

        // apply lateral offset (side to side across the ribbon) and hover height
        const hoverHeight = 0.3;
        pos.addScaledVector(right, this.state.lateralOffset);
        pos.addScaledVector(up, hoverHeight);

        // compute quaternion from basis vectors (forward, up)
        const m = new THREE.Matrix4();
        const z = forward.clone().normalize();
        const x = new THREE.Vector3().crossVectors(up, z).normalize();
        const y = new THREE.Vector3().crossVectors(z, x).normalize();
        m.makeBasis(x, y, z);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        const pitchQ = new THREE.Quaternion().setFromAxisAngle(x, this.state.pitch);
        // Bank visually with sideways velocity
        const bankAngle = THREE.MathUtils.degToRad(12) * THREE.MathUtils.clamp(this.velocitySide / PHYSICS.lateralAccel, -1, 1);
        const bankQ = new THREE.Quaternion().setFromAxisAngle(z, -bankAngle);
        q.multiply(pitchQ).multiply(bankQ);
        this.root.position.copy(pos);
        this.root.quaternion.copy(q);

        // chase camera anchored to track Frenet frame (keeps camera perpendicular to spline)
        const camDistance = CAMERA.chaseDistance * (1 + this.boostTimer * 0.6);
        const camPos = new THREE.Vector3()
            .copy(pos)
            .addScaledVector(right, this.state.lateralOffset * 0.6)
            .addScaledVector(up, CAMERA.chaseHeight)
            .addScaledVector(forward, -camDistance);
        this.camera.position.lerp(camPos, 1 - Math.pow(0.001, dt));

        // Look ahead down the track in Frenet frame, then apply smoothed mouse look deltas
        const lookAhead = CAMERA.lookAheadDistance;
        const baseLookPoint = new THREE.Vector3()
            .copy(pos)
            .addScaledVector(forward, lookAhead)
            .addScaledVector(up, 0.2);

        // Align camera up with track normal so roll matches banking
        this.camera.up.copy(up);

        // Smooth mouse deltas
        this.mouseYaw = THREE.MathUtils.damp(this.mouseYaw, this.mouseYawTarget, 6, dt);
        this.mousePitch = THREE.MathUtils.damp(this.mousePitch, this.mousePitchTarget, 6, dt);

        // Build direction from camera to target and rotate by yaw/pitch around track up/right axes
        const toTarget = new THREE.Vector3().subVectors(baseLookPoint, this.camera.position);
        const qYaw = new THREE.Quaternion().setFromAxisAngle(up, this.mouseYaw);
        const qPitch = new THREE.Quaternion().setFromAxisAngle(right, -this.mousePitch);
        toTarget.applyQuaternion(qYaw).applyQuaternion(qPitch);
        const finalLook = new THREE.Vector3().addVectors(this.camera.position, toTarget);
        this.camera.lookAt(finalLook);

        // Dynamic FOV in tunnels
        const targetFov = this.state.inTunnel ? this.baseFov + TUNNEL.fovBoost : this.baseFov;
        this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, 1 - Math.pow(0.01, dt));
        this.camera.fov = this.currentFov;
        this.camera.updateProjectionMatrix();

        // subtle speed shake
        const shake = CAMERA.shakeMax * (this.state.speedKmh / PHYSICS.maxSpeed) * (0.4 + 0.6 * this.boostTimer);
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
    }
}


