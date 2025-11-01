import * as THREE from 'three';
import { CAMERA, COLORS, LAPS_TOTAL, PHYSICS, TUNNEL, BOOST_PAD, FOCUS_REFILL } from './constants';
import { Track } from './Track';

function kmhToMps(kmh: number) { return kmh / 3.6; }

export class Ship {
    public root = new THREE.Group();
    public state = {
        t: 0,
        speedKmh: 0, // Start completely stationary
        lateralOffset: 0,
        pitch: 0,
        flow: 0,
        boosting: false,
        lapCurrent: 0, // Start at lap 0 (pre-race)
        lapTotal: LAPS_TOTAL,
        boostLevel: 1,
        inTunnel: false,
        tunnelCenterBoost: 1.0, // multiplier from tunnel center alignment
    };

    private track: Track;
    private camera: THREE.PerspectiveCamera;
    private cameraControlEnabled = true; // can be disabled for free fly mode
    private inputEnabled = false; // disabled during countdown
    private velocitySide = 0;
    private velocityPitch = 0;
    private boostTimer = 0; // visual intensity for camera/shake
    private boostEnergy = 1; // 0..1 manual boost resource
    private now = 0;
    // lap detection helpers
    private prevT = 0;
    private checkpointT = 0.0; // could move later; start line
    private hasCrossedCheckpointThisFrame = false;

    private mouseYawTarget = 0;
    private mousePitchTarget = 0;
    private mouseYaw = 0;
    private mousePitch = 0;
    private mouseButtonDown = false;

    // Mario Kart-style camera tracking
    private cameraYaw = 0;
    private cameraYawVelocity = 0;
    private targetCameraYaw = 0;

    private tunnelBoostAccumulator = 1.0; // tracks current tunnel boost multiplier
    private boostPadMultiplier = 1.0; // tracks current boost pad multiplier
    private boostPadTimer = 0; // remaining boost pad duration
    private baseFov = CAMERA.fov;
    private currentFov = CAMERA.fov;

    // Focus refill state
    private focusRefillActive = false;
    private focusRefillProgress = 0;
    private focusRefillDuration = FOCUS_REFILL.duration;

    private shipMaterial!: THREE.MeshStandardMaterial;
    private glowMaterial!: THREE.MeshBasicMaterial;
    private rocketTail!: THREE.Group;
    private rocketTailMaterials: THREE.MeshBasicMaterial[] = [];
    private rocketTailBaseOpacities: number[] = [];

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

        // single hover-ship mesh that changes color
        const body = new THREE.Group();
        const geo = new THREE.ConeGeometry(0.45, 1.2, 16);
        this.shipMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.neonCyan,
            metalness: 0.3,
            roughness: 0.2,
            emissive: COLORS.neonCyan.clone().multiplyScalar(0.8)
        });
        const mesh = new THREE.Mesh(geo, this.shipMaterial);
        mesh.rotation.x = Math.PI / 2;
        body.add(mesh);

        this.glowMaterial = new THREE.MeshBasicMaterial({
            color: COLORS.neonCyan,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), this.glowMaterial);
        glow.position.set(0, -0.15, -0.3);
        body.add(glow);

        this.root.add(body);

        // Create rocket tail boost effect (initially hidden)
        this.rocketTail = new THREE.Group();
        this.createRocketTail();
        this.root.add(this.rocketTail);
        this.rocketTail.visible = false;

        window.addEventListener('keydown', (e) => this.onKey(e, true));
        window.addEventListener('keyup', (e) => this.onKey(e, false));
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mousedown', (e) => this.onMouseButton(e, true));
        window.addEventListener('mouseup', (e) => this.onMouseButton(e, false));
        window.addEventListener('contextmenu', (e) => e.preventDefault());

        // Start 12 meters behind the starting line
        this.state.t = -12 / this.track.length // Start 12 meters behind start line

        // Initially disable camera control (will be enabled after splash transition)
        this.cameraControlEnabled = false;
    }

    public input = { left: false, right: false, up: false, down: false, boost: false };

    private onKey(e: KeyboardEvent, down: boolean) {
        // Only process input if input is enabled (not during countdown)
        if (!this.inputEnabled) return;

        if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.input.left = down;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') this.input.right = down;
        if (e.code === 'ArrowUp' || e.code === 'KeyW') this.input.up = down;
        if (e.code === 'ArrowDown' || e.code === 'KeyS') this.input.down = down;
        if (e.code === 'Space') this.input.boost = down;

        // Focus refill key (F key)
        if (e.code === 'KeyF' && down) {
            this.triggerFocusRefill();
        }
    }

    private onMouseMove(e: MouseEvent) {
        // Click-to-look: only update camera when mouse button is held
        if (!this.mouseButtonDown) return;
        const dx = e.movementX;
        const dy = e.movementY;
        if (dx === 0 && dy === 0) return;
        this.mouseYawTarget = THREE.MathUtils.clamp(this.mouseYawTarget - dx * 0.002, -0.6, 0.6);
        this.mousePitchTarget = THREE.MathUtils.clamp(this.mousePitchTarget + dy * 0.0015, -0.35, 0.35);
    }

    private onMouseButton(e: MouseEvent, down: boolean) {
        // Temporarily disable all mouse handling to test UI
        return; // Disable all mouse handling for now

        // Check if the click is on a UI element
        const target = e.target as HTMLElement;
        const isUIElement = target.closest('.planet-fx, .radio, .hud .control, input, button, label');


        // Only prevent default for non-UI elements
        if (!isUIElement && (e.button === 0 || e.button === 1 || e.button === 2)) {
            e.preventDefault();
            this.mouseButtonDown = down;
        } else if (isUIElement) {
        }
    }

    clearInput() {
        this.input.left = false;
        this.input.right = false;
        this.input.up = false;
        this.input.down = false;
        this.input.boost = false;
    }

    setCameraControl(enabled: boolean) {
        this.cameraControlEnabled = enabled;
    }

    enableInput() {
        this.inputEnabled = true;
    }

    disableInput() {
        this.inputEnabled = false;
    }

    private triggerFocusRefill() {
        // Check if flow is nearly full and not already refilling
        if (this.state.flow >= FOCUS_REFILL.minFlowRequired && !this.focusRefillActive) {
            this.focusRefillActive = true;
            this.focusRefillProgress = 0;
        }
    }

    startRace() {
        // Keep lap at 0 - we start before the start line
        // Lap will increment to 1 when crossing the start line for the first time
        // Reset checkpoint flag to ensure clean detection
        this.hasCrossedCheckpointThisFrame = false;
        // Ensure prevT is set correctly
        this.prevT = this.state.t;
    }

    reset() {
        // Reset ship to starting position and state
        this.state.t = -0.01; // Start further back for pre-race staging
        this.state.speedKmh = 0;
        this.state.lateralOffset = 0;
        this.state.pitch = 0;
        this.state.flow = 0;
        this.state.boosting = false;
        this.state.lapCurrent = 0; // Reset to pre-race
        this.state.boostLevel = 1;
        this.state.inTunnel = false;
        this.state.tunnelCenterBoost = 1.0;

        // Reset internal state
        this.velocitySide = 0;
        this.velocityPitch = 0;
        this.boostTimer = 0;
        this.boostEnergy = 1;
        this.now = 0;
        this.prevT = this.state.t; // Initialize to match starting position
        this.checkpointT = 0.0;
        this.hasCrossedCheckpointThisFrame = false;
        this.mouseYawTarget = 0;
        this.mousePitchTarget = 0;
        this.mouseYaw = 0;
        this.mousePitch = 0;
        this.mouseButtonDown = false;
        this.cameraYaw = 0;
        this.cameraYawVelocity = 0;
        this.targetCameraYaw = 0;
        this.tunnelBoostAccumulator = 1.0;
        this.boostPadMultiplier = 1.0;
        this.boostPadTimer = 0;
        this.currentFov = this.baseFov;

        // Reset focus refill state
        this.focusRefillActive = false;
        this.focusRefillProgress = 0;

        // Clear input
        this.clearInput();

        // Reset camera FOV
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
    }

    private createRocketTail() {
        // Create a glowing rocket tail effect with multiple cone segments
        const particleCount = BOOST_PAD.tailParticleCount;
        const tailLength = BOOST_PAD.tailLength;

        for (let i = 0; i < particleCount; i++) {
            const progress = i / particleCount;
            const size = 0.4 * (1 - progress); // taper from wide to narrow
            const length = tailLength / particleCount;

            // Create cone geometry for each particle
            const geometry = new THREE.ConeGeometry(size, length, 8);
            const baseOpacity = 0.8 * (1 - progress * 0.5); // fade toward the back
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color().lerpColors(BOOST_PAD.colorStart, BOOST_PAD.colorEnd, progress),
                transparent: true,
                opacity: baseOpacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });

            const cone = new THREE.Mesh(geometry, material);
            // Position along the tail, pointing backward
            cone.position.set(0, 0, -(progress * tailLength + length * 0.5));
            cone.rotation.x = Math.PI * 0.5; // point backward

            this.rocketTail.add(cone);
            this.rocketTailMaterials.push(material);
            this.rocketTailBaseOpacities.push(baseOpacity);
        }

        // Add central glow core
        const coreGeometry = new THREE.CylinderGeometry(0.15, 0.05, tailLength, 8);
        const coreOpacity = 0.9;
        const coreMaterial = new THREE.MeshBasicMaterial({
            color: BOOST_PAD.colorStart,
            transparent: true,
            opacity: coreOpacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const core = new THREE.Mesh(coreGeometry, coreMaterial);
        core.position.set(0, 0, -tailLength * 0.5);
        core.rotation.x = Math.PI * 0.5;
        this.rocketTail.add(core);
        this.rocketTailMaterials.push(coreMaterial);
        this.rocketTailBaseOpacities.push(coreOpacity);
    }

    update(dt: number) {
        this.now += dt;

        // Don't move during countdown (when input is disabled)
        if (!this.inputEnabled) {
            this.state.speedKmh = 0;
            // Still update ship position and camera even when input is disabled
            this.updatePositionAndCamera(dt);
            return;
        }

        // speed and boost
        // Manual boost resource: drains while active, regens when not held
        let isBoosting = false;
        if (this.input.boost && this.boostEnergy > 0) {
            isBoosting = true;
            this.boostEnergy = Math.max(0, this.boostEnergy - dt / PHYSICS.boostDurationSec);
        }

        // Always regenerate boost energy when not actively boosting
        if (!isBoosting) {
            this.boostEnergy = Math.min(1, this.boostEnergy + PHYSICS.boostRegenPerSec * dt);
        }

        const manual = isBoosting ? PHYSICS.boostMultiplier : 1;

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

        // Boost pad logic: temporary speed boost when driving over pads
        const boostPadInfo = this.track.getBoostPadAtT(this.state.t);
        if (boostPadInfo.onPad) {
            // On a boost pad - activate boost and reset timer
            this.boostPadTimer = BOOST_PAD.boostDuration;
            this.boostPadMultiplier = BOOST_PAD.boostMultiplier;
        } else if (this.boostPadTimer > 0) {
            // Boost pad effect is still active after leaving pad
            this.boostPadTimer = Math.max(0, this.boostPadTimer - dt);
            // Maintain boost multiplier while timer is active
            if (this.boostPadTimer <= 0) {
                this.boostPadMultiplier = 1.0;
            }
        } else {
            // No boost pad effect - decay multiplier smoothly
            this.boostPadMultiplier = THREE.MathUtils.lerp(
                this.boostPadMultiplier,
                1.0,
                BOOST_PAD.boostDecaySpeed * dt
            );
        }

        // Auto-cruise: always move forward at base speed with all active multipliers
        const targetSpeed = PHYSICS.baseSpeed * manual * this.tunnelBoostAccumulator * this.boostPadMultiplier;

        const speedLerp = 1 - Math.pow(0.001, dt); // smooth
        // Maintain consistent speed across track width for uniform turning feel
        this.state.speedKmh = THREE.MathUtils.lerp(this.state.speedKmh, targetSpeed, speedLerp);
        this.state.boosting = isBoosting;
        if (isBoosting) this.boostTimer = Math.min(this.boostTimer + dt, 1); else this.boostTimer = Math.max(this.boostTimer - dt * 2, 0);
        this.state.boostLevel = this.boostEnergy;


        // advance along curve
        const mps = kmhToMps(this.state.speedKmh);
        const prevTBeforeUpdate = this.state.t;
        this.state.t += (mps * dt) / this.track.length; // normalize by length

        // lap detection: crossing checkpoint at t=0
        // Count laps from the start (lapCurrent >= 0)
        if (this.state.lapCurrent >= 0 && !this.hasCrossedCheckpointThisFrame) {
            const prevT = prevTBeforeUpdate;
            let newT = this.state.t;

            // Check if we'll wrap
            const willWrapForward = newT > 1;
            const willWrapBackward = newT < 0;

            // Normal case: crossed from negative to positive (without wrapping)
            const normalCrossing = prevT < 0 && newT >= 0 && !willWrapForward && !willWrapBackward;

            // Wrapping case: detect if we're about to wrap or just wrapped
            let wrappingCrossing = false;
            if (willWrapForward) {
                // We're about to wrap forward: prevT was > 0.5 means we crossed 0
                wrappingCrossing = prevT > 0.5;
                // Wrap now for detection
                newT = newT - 1;
            } else if (willWrapBackward) {
                // Wrapping backward shouldn't happen, but handle it
                wrappingCrossing = false;
            } else {
                // Check if we already wrapped (prevT high, newT low after wrap)
                // This handles the case where wrapping happened in a previous step
                // But since we wrap after detection, we can check: prevT > 0.9 and newT < 0.1
                wrappingCrossing = prevT > 0.9 && newT < 0.1;
            }

            if (normalCrossing || wrappingCrossing) {
                // Increment lap count (0 -> 1, 1 -> 2, 2 -> 3)
                // Race finishes when crossing at lap 3 (lapCurrent >= lapTotal after increment)
                this.state.lapCurrent++;
                this.hasCrossedCheckpointThisFrame = true;
            }
        }

        // Wrap t after checkpoint detection
        if (this.state.t > 1) this.state.t -= 1;
        if (this.state.t < 0) this.state.t += 1;

        // Update prevT for next frame (after all checks)
        this.prevT = this.state.t;

        // Reset checkpoint flag for next frame
        this.hasCrossedCheckpointThisFrame = false;

        // lateral control
        const sideInput = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
        const targetSideVel = sideInput * PHYSICS.lateralAccel;
        this.velocitySide = THREE.MathUtils.damp(this.velocitySide, targetSideVel, PHYSICS.lateralDamping, dt);
        const half = this.track.width * 0.5;
        const lateralLimit = half * 0.95;
        this.state.lateralOffset = THREE.MathUtils.clamp(this.state.lateralOffset + this.velocitySide * dt, -lateralLimit, lateralLimit);


        // pitch control
        const pitchInput = (this.input.up ? 1 : 0) - (this.input.down ? 1 : 0);
        const targetPitchVel = pitchInput * PHYSICS.pitchAccel;
        this.velocityPitch = THREE.MathUtils.damp(this.velocityPitch, targetPitchVel, PHYSICS.pitchDamping, dt);
        this.state.pitch = THREE.MathUtils.clamp(this.state.pitch + this.velocityPitch * dt, -PHYSICS.pitchMax, PHYSICS.pitchMax);

        // Focus refill logic
        if (this.focusRefillActive) {
            this.focusRefillProgress += dt / this.focusRefillDuration;

            if (this.focusRefillProgress >= 1) {
                // Complete the refill
                this.focusRefillActive = false;
                this.focusRefillProgress = 1;
                this.state.flow = 0;
                this.boostEnergy = 1;
            } else {
                // Progress the refill: drain flow and fill boost proportionally
                const startFlow = 1; // flow starts at 1 when refill begins
                const startBoost = this.boostEnergy; // boost starts at current level

                this.state.flow = THREE.MathUtils.lerp(startFlow, 0, this.focusRefillProgress);
                this.boostEnergy = THREE.MathUtils.lerp(startBoost, 1, this.focusRefillProgress);
            }
        } else {
            // Normal flow meter logic (only when not refilling)
            const fast = this.state.speedKmh >= PHYSICS.highSpeedThreshold;
            const stable = Math.abs(sideInput) === 0 && Math.abs(pitchInput) === 0;
            const df = (fast && stable ? PHYSICS.flowFillSpeed : -PHYSICS.flowDrainSpeed) * dt;
            this.state.flow = THREE.MathUtils.clamp(this.state.flow + df, 0, 1);
        }

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

        // Add yaw rotation based on lateral input for Mario Kart-style turning
        const shipYaw = -sideInput * CAMERA.shipYawFromInput;
        const yawQ = new THREE.Quaternion().setFromAxisAngle(y, shipYaw);

        const pitchQ = new THREE.Quaternion().setFromAxisAngle(x, this.state.pitch);
        // Bank visually with sideways velocity
        const bankAngle = THREE.MathUtils.degToRad(22) * THREE.MathUtils.clamp(this.velocitySide / PHYSICS.lateralAccel, -1, 1);
        const bankQ = new THREE.Quaternion().setFromAxisAngle(z, -bankAngle);

        q.multiply(yawQ).multiply(pitchQ).multiply(bankQ);
        this.root.position.copy(pos);
        this.root.quaternion.copy(q);

        // Update target camera yaw based on ship's yaw rotation
        this.targetCameraYaw = -shipYaw * CAMERA.cameraYawScale;

        // Update camera position
        this.updateCamera(dt);

        // Update rocket tail effect based on boost pad state only
        const hasBoostPadEffect = this.boostPadTimer > 0;
        this.rocketTail.visible = hasBoostPadEffect;

        if (this.rocketTail.visible) {
            // Animate tail intensity based on boost pad effect
            const tailIntensity = Math.min(1, this.boostPadTimer / BOOST_PAD.boostDuration);
            const pulseEffect = 0.9 + 0.1 * Math.sin(this.now * 15); // fast pulse

            for (let i = 0; i < this.rocketTailMaterials.length; i++) {
                const baseOpacity = this.rocketTailBaseOpacities[i];
                this.rocketTailMaterials[i].opacity = baseOpacity * tailIntensity * pulseEffect * BOOST_PAD.tailIntensity;
            }
        }
    }

    public updatePositionAndCamera(dt: number) {
        // Update ship position and orientation without input processing
        this.updateShipPosition();
        this.updateCamera(dt);
    }

    private updateShipPosition() {
        // Check if track is ready
        if (!this.track.curve || !this.track.curve.points || this.track.curve.points.length === 0) {
            console.warn('Track not ready, skipping ship position update');
            return;
        }

        // position and orientation from banked Frenet frame
        const { pos, tangent, normal, binormal, right, up, forward } = this.tmp;

        // Ensure tmp vectors are properly initialized
        if (!pos || !tangent || !normal || !binormal || !right || !up || !forward) {
            console.error('Ship tmp vectors not properly initialized');
            return;
        }

        this.track.getPointAtT(this.state.t, pos);
        this.track.getFrenetFrame(this.state.t, normal, binormal, tangent);

        // Construct frame directly from cached normals/binormals for banking
        forward.copy(tangent).normalize();
        right.copy(binormal).normalize();
        up.copy(normal).normalize();

        // apply lateral offset (side to side across the ribbon) and hover height
        const hoverHeight = 1.5; // Increased from 0.3 for better visual clearance
        pos.addScaledVector(binormal, this.state.lateralOffset);
        pos.addScaledVector(up, hoverHeight);

        // compute quaternion from basis vectors (forward, up)
        const m = new THREE.Matrix4();
        const z = forward.clone().normalize(); // Remove .negate() - ship should face forward
        const x = new THREE.Vector3().crossVectors(up, z).normalize();
        const y = new THREE.Vector3().crossVectors(z, x).normalize();

        m.makeBasis(x, y, z);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);

        // No input-based rotation during countdown
        this.root.position.copy(pos);
        this.root.quaternion.copy(q);
    }

    private updateCamera(dt: number) {
        // Only update camera if camera control is enabled (disabled in free fly mode)
        if (!this.cameraControlEnabled) return;

        // Check if track is ready
        if (!this.track.curve) {
            console.warn('Track not ready, skipping camera update');
            return;
        }

        // Get current ship position and orientation
        const { pos, tangent, normal, binormal, right, up, forward } = this.tmp;
        this.track.getPointAtT(this.state.t, pos);
        this.track.getFrenetFrame(this.state.t, normal, binormal, tangent);

        // Construct frame directly from cached normals/binormals for banking
        forward.copy(tangent).normalize();
        right.copy(binormal).normalize();
        up.copy(normal).normalize();

        // Create a local copy of position for camera calculations
        const camPos = pos.clone();
        const hoverHeight = 0.3;
        camPos.addScaledVector(right, this.state.lateralOffset);
        camPos.addScaledVector(up, hoverHeight);

        // Mario Kart-style camera: independent smoothed yaw with heavy damping
        this.cameraYawVelocity = THREE.MathUtils.damp(this.cameraYawVelocity, this.targetCameraYaw - this.cameraYaw, CAMERA.cameraYawDamping, dt);
        this.cameraYaw += this.cameraYawVelocity * dt;

        // chase camera locked directly behind ship (racing game style)
        const camDistance = CAMERA.chaseDistance * (1 + this.boostTimer * 0.6);
        const cameraPosition = new THREE.Vector3()
            .copy(camPos)
            .addScaledVector(up, CAMERA.chaseHeight)
            .addScaledVector(forward, -camDistance);
        this.camera.position.lerp(cameraPosition, 1 - Math.pow(0.0001, dt));

        // Look ahead down the track in Frenet frame, then apply Mario Kart-style camera yaw
        const lookAhead = CAMERA.lookAheadDistance;
        const baseLookPoint = new THREE.Vector3()
            .copy(camPos)
            .addScaledVector(forward, lookAhead)
            .addScaledVector(up, 0.2);

        // Align camera up with track normal so roll matches banking
        this.camera.up.copy(up);

        // Reset mouse look targets when button is not held
        if (!this.mouseButtonDown) {
            this.mouseYawTarget = 0;
            this.mousePitchTarget = 0;
        }

        // Smooth mouse deltas
        this.mouseYaw = THREE.MathUtils.damp(this.mouseYaw, this.mouseYawTarget, 6, dt);
        this.mousePitch = THREE.MathUtils.damp(this.mousePitch, this.mousePitchTarget, 6, dt);

        // Build direction from camera to target and rotate by Mario Kart camera yaw + mouse deltas
        const toTarget = new THREE.Vector3().subVectors(baseLookPoint, this.camera.position);
        const qCameraYaw = new THREE.Quaternion().setFromAxisAngle(up, this.cameraYaw);
        const qYaw = new THREE.Quaternion().setFromAxisAngle(up, this.mouseYaw);
        const qPitch = new THREE.Quaternion().setFromAxisAngle(right, -this.mousePitch);
        toTarget.applyQuaternion(qCameraYaw).applyQuaternion(qYaw).applyQuaternion(qPitch);
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

    // Getters for focus refill state
    public getFocusRefillActive(): boolean {
        return this.focusRefillActive;
    }

    public getFocusRefillProgress(): number {
        return this.focusRefillProgress;
    }
}


