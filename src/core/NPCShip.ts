import * as THREE from 'three';
import { COLORS, PHYSICS, BOOST_PAD, TUNNEL } from './constants';
import { Track } from './Track';
import type { ShipState, RacePosition } from './types';

export class NPCShip {
    public root = new THREE.Group();
    public state: ShipState;
    public racerId: string;
    public color: THREE.Color;
    public finished = false;
    public finishTime?: number;

    private track: Track;
    private aiBehavior: 'aggressive' | 'conservative';
    private lateralTarget = 0;
    private lateralVelocity = 0;
    private speedMultiplier = 1.0;
    private aiUpdateTimer = 0;
    private aiUpdateInterval = 0.1; // Update AI every 100ms

    // AI state
    private targetLateralOffset = 0;
    private lateralSwayTimer = 0;
    private speedVariation = 0;

    // Stuck detection
    private stuckDetectionTimer = 0;
    private lastPositionT = 0;
    private stuckThreshold = 3.0; // seconds
    private positionChangeThreshold = 0.001; // minimum track distance change

    // NPC boost system
    private boostEnergy = 1.0; // 0-1 boost resource like player
    private boostCooldown = 0; // time until next boost can be used
    private boostDuration = 0; // remaining boost time
    private isBoosting = false;

    // Tunnel boost system (like player ship)
    private tunnelBoostAccumulator = 1.0; // tracks current tunnel boost multiplier

    // Rocket tail effect (like player ship)
    private rocketTail!: THREE.Group;
    private rocketTailMaterials: THREE.MeshBasicMaterial[] = [];
    private rocketTailBaseOpacities: number[] = [];

    constructor(track: Track, racerId: string, color: THREE.Color, behavior: 'aggressive' | 'conservative' = 'conservative', lateralOffset: number = 0) {
        this.track = track;
        this.racerId = racerId;
        this.color = color;
        this.aiBehavior = behavior;

        this.state = {
            t: -0.011, // Start behind the start line (staggered grid)
            speedKmh: 0,
            lateralOffset: lateralOffset, // Position NPCs at different lateral positions
            pitch: 0,
            flow: 0,
            boosting: false,
            lapCurrent: 0, // Start at lap 0 (pre-race)
            lapTotal: 3,
            boostLevel: 1,
            inTunnel: false,
            tunnelCenterBoost: 1.0,
        };

        this.createShipModel();
        this.setupAIBehavior();

        // Don't update position immediately - wait for first update call
        console.log(`NPC ${this.racerId} created at lateral offset ${this.state.lateralOffset}`);
    }

    private createShipModel() {
        // Create ship geometry exactly like player ship but with NPC color
        const body = new THREE.Group();
        const geo = new THREE.ConeGeometry(0.45, 1.2, 16); // Same size as player ship
        const shipMaterial = new THREE.MeshStandardMaterial({
            color: this.color,
            metalness: 0.3,
            roughness: 0.2,
            emissive: this.color.clone().multiplyScalar(0.8) // Same emissive as player
        });
        const mesh = new THREE.Mesh(geo, shipMaterial);
        mesh.rotation.x = Math.PI / 2;
        body.add(mesh);

        // Add glow effect exactly like player ship
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: this.color,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), glowMaterial); // Same size as player
        glow.position.set(0, -0.15, -0.3);
        body.add(glow);

        this.root.add(body);

        // Create rocket tail boost effect (initially hidden) - exactly like player
        this.rocketTail = new THREE.Group();
        this.createRocketTail();
        this.root.add(this.rocketTail);
        this.rocketTail.visible = false;

        console.log(`NPC ${this.racerId} ship model created with color:`, this.color);
    }

    private createRocketTail() {
        // Create a glowing rocket tail effect with multiple cone segments (exactly like player)
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

    private setupAIBehavior() {
        // Set up AI behavior parameters based on type
        if (this.aiBehavior === 'aggressive') {
            this.speedVariation = 0.1;
        } else {
            this.speedVariation = 0.05;
        }
    }

    public update(dt: number, playerPosition: number, playerLap: number, playerSpeed: number, allNPCs: NPCShip[] = []) {
        this.aiUpdateTimer += dt;

        // Check for stuck condition and reset if needed
        if (this.checkIfStuck(dt)) {
            this.resetIfStuck();
        }

        // Update AI behavior periodically
        if (this.aiUpdateTimer >= this.aiUpdateInterval) {
            this.updateAI(playerPosition, playerLap, playerSpeed);
            this.updateCollisionAvoidance(allNPCs);
            this.updateBoostBehavior(dt);
            this.updateTunnelBoost(dt);
            this.aiUpdateTimer = 0;
        }

        // Update ship physics
        this.updatePhysics(dt);
        this.updatePosition(dt);

        // Debug: log NPC position occasionally
        if (Math.random() < 0.01) { // 1% chance per frame
            console.log(`NPC ${this.racerId} at t=${this.state.t.toFixed(3)}, lateral=${this.state.lateralOffset.toFixed(2)}`);
        }
    }

    private updateAI(playerPosition: number, playerLap: number, playerSpeed: number) {
        // Calculate our position relative to player
        const ourPosition = this.getTrackPosition();
        const positionDiff = ourPosition - playerPosition;

        // AI lateral movement - follow track center with slight variation
        this.lateralSwayTimer += this.aiUpdateInterval;
        const swayAmount = Math.sin(this.lateralSwayTimer * 0.5) * 0.3; // Gentle sway
        const trackCenterOffset = (Math.random() - 0.5) * 0.2; // Small random variation

        this.targetLateralOffset = swayAmount + trackCenterOffset;

        // Adjust target based on behavior
        if (this.aiBehavior === 'aggressive') {
            // More erratic movement
            this.targetLateralOffset += (Math.random() - 0.5) * 0.4;
        }
    }

    private updateBoostBehavior(dt: number) {
        // Update boost cooldown and duration
        this.boostCooldown = Math.max(0, this.boostCooldown - dt);
        this.boostDuration = Math.max(0, this.boostDuration - dt);

        // Regenerate boost energy when not boosting
        if (!this.isBoosting) {
            this.boostEnergy = Math.min(1, this.boostEnergy + PHYSICS.boostRegenPerSec * dt);
        }

        // Decide whether to boost based on AI behavior and conditions
        const shouldBoost = this.shouldUseBoost();

        if (shouldBoost && this.boostCooldown <= 0 && this.boostEnergy > 0.3) {
            this.activateBoost();
        }

        // Update boost state
        this.isBoosting = this.boostDuration > 0;
        this.state.boosting = this.isBoosting;

        // Update rocket tail effect based on boost state
        this.rocketTail.visible = this.isBoosting;

        if (this.rocketTail.visible) {
            // Animate tail intensity based on boost state
            const tailIntensity = Math.min(1, this.boostDuration / (PHYSICS.boostDurationSec * 0.8));
            const pulseEffect = 0.9 + 0.1 * Math.sin(Date.now() * 0.015); // fast pulse

            for (let i = 0; i < this.rocketTailMaterials.length; i++) {
                const baseOpacity = this.rocketTailBaseOpacities[i];
                this.rocketTailMaterials[i].opacity = baseOpacity * tailIntensity * pulseEffect * BOOST_PAD.tailIntensity;
            }
        }
    }

    private shouldUseBoost(): boolean {
        // Random chance to boost based on behavior
        const baseChance = this.aiBehavior === 'aggressive' ? 0.3 : 0.15;
        const randomChance = Math.random();

        // Boost more often when behind or in competitive situations
        const boostChance = baseChance + (Math.random() * 0.2); // 0.15-0.5 for aggressive, 0.15-0.35 for conservative

        return randomChance < boostChance;
    }

    private activateBoost() {
        this.isBoosting = true;
        this.boostDuration = PHYSICS.boostDurationSec * 0.8; // NPCs boost for 80% of player duration
        this.boostEnergy = Math.max(0, this.boostEnergy - 0.4); // Use 40% of boost energy
        this.boostCooldown = 2.0; // 2 second cooldown between boosts
        console.log(`NPC ${this.racerId} activated boost!`);
    }

    private updateTunnelBoost(dt: number) {
        // Tunnel boost logic: progressive boost based on center alignment (like player ship)
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
    }

    private updatePhysics(dt: number) {
        // Calculate base speed with natural variation
        const baseSpeed = PHYSICS.baseSpeed;

        // Apply boost multiplier if boosting
        const boostMultiplier = this.isBoosting ? PHYSICS.boostMultiplier : 1.0;

        // Apply tunnel boost multiplier
        const tunnelMultiplier = this.tunnelBoostAccumulator;

        // Add natural speed variation for racing unpredictability
        const variation = 1 + (Math.random() - 0.5) * this.speedVariation;
        const targetSpeed = baseSpeed * boostMultiplier * tunnelMultiplier * variation;

        // Smooth speed transitions
        const speedLerp = 1 - Math.pow(0.01, dt);
        this.state.speedKmh = THREE.MathUtils.lerp(this.state.speedKmh, targetSpeed, speedLerp);

        // Update lateral movement
        const lateralAccel = PHYSICS.lateralAccel * 0.8; // Slightly slower than player
        const lateralDamping = PHYSICS.lateralDamping * 0.9;

        const targetLateralVel = (this.targetLateralOffset - this.state.lateralOffset) * 2;
        this.lateralVelocity = THREE.MathUtils.damp(this.lateralVelocity, targetLateralVel, lateralDamping, dt);

        // Apply lateral movement
        const half = this.track.width * 0.5;
        const lateralLimit = half * 0.95;
        this.state.lateralOffset = THREE.MathUtils.clamp(
            this.state.lateralOffset + this.lateralVelocity * dt,
            -lateralLimit,
            lateralLimit
        );
    }

    private updatePosition(dt: number) {
        // Move along track
        const mps = (this.state.speedKmh / 3.6);
        this.state.t += (mps * dt) / this.track.length;
        if (this.state.t > 1) this.state.t -= 1;
        if (this.state.t < 0) this.state.t += 1;

        // Update lap tracking
        this.updateLapTracking();

        // Update visual position
        this.updateVisualPosition();
    }

    private updateLapTracking() {
        // Simple lap detection - crossing t=0
        const prevT = this.state.t - 0.001; // Approximate previous position
        const crossedStartLine = (prevT < 0 && this.state.t >= 0) || (prevT > 0.9 && this.state.t < 0.1);

        if (crossedStartLine && this.state.lapCurrent < this.state.lapTotal) {
            this.state.lapCurrent++;
            console.log(`NPC ${this.racerId} completed lap ${this.state.lapCurrent}`);
        }
    }

    private updateVisualPosition() {
        try {
            const { pos, tangent, normal, binormal } = this.getFrenetFrame();

            // Apply lateral offset and hover height
            const hoverHeight = 0.3;
            pos.addScaledVector(binormal, this.state.lateralOffset);
            pos.addScaledVector(normal, hoverHeight);

            this.root.position.copy(pos);

            // Debug: log position occasionally
            if (Math.random() < 0.01) {
                console.log(`NPC ${this.racerId} positioned at:`, pos, 'lateral offset:', this.state.lateralOffset);
            }

            // Orient ship along track
            const forward = tangent.clone().normalize();
            const right = binormal.clone().normalize();
            const up = normal.clone().normalize();

            const m = new THREE.Matrix4();
            const z = forward.clone().normalize();
            const x = new THREE.Vector3().crossVectors(up, z).normalize();
            const y = new THREE.Vector3().crossVectors(z, x).normalize();
            m.makeBasis(x, y, z);
            const q = new THREE.Quaternion().setFromRotationMatrix(m);

            this.root.quaternion.copy(q);
        } catch (error) {
            console.warn(`NPC ${this.racerId} visual position update failed:`, error);
        }
    }

    private getFrenetFrame() {
        const pos = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const binormal = new THREE.Vector3();

        this.track.getPointAtT(this.state.t, pos);
        this.track.getFrenetFrame(this.state.t, normal, binormal, tangent);

        return { pos, tangent, normal, binormal };
    }

    private getTrackPosition(): number {
        return this.state.t;
    }

    public getPosition(): RacePosition {
        return {
            racerId: this.racerId,
            position: 0, // Will be calculated by RaceManager
            lapCurrent: this.state.lapCurrent,
            lapTotal: this.state.lapTotal,
            finished: this.finished,
            finishTime: this.finishTime
        };
    }

    public finish(finishTime: number) {
        this.finished = true;
        this.finishTime = finishTime;
        console.log(`NPC ${this.racerId} finished at ${finishTime.toFixed(2)}s`);
    }

    public startRace() {
        // Transition from pre-race (lap 0) to race start (lap 1)
        this.state.lapCurrent = 1;
    }

    public reset() {
        this.state.t = -0.011; // Reset to pre-race staging position
        this.state.speedKmh = 0;
        this.state.lateralOffset = 0;
        this.state.lapCurrent = 0; // Reset to pre-race
        this.finished = false;
        this.finishTime = undefined;
        this.lateralVelocity = 0;
        this.speedMultiplier = 1.0;
        this.stuckDetectionTimer = 0;
        this.lastPositionT = this.state.t;

        // Reset boost system
        this.boostEnergy = 1.0;
        this.boostCooldown = 0;
        this.boostDuration = 0;
        this.isBoosting = false;
        this.state.boosting = false;

        // Reset tunnel boost
        this.tunnelBoostAccumulator = 1.0;
        this.state.tunnelCenterBoost = 1.0;

        // Hide rocket tail
        this.rocketTail.visible = false;
    }

    private updateCollisionAvoidance(allNPCs: NPCShip[]) {
        const minLateralDistance = 3.0; // minimum units apart
        const trackDistanceThreshold = 0.05; // within 5% of track distance

        for (const otherNPC of allNPCs) {
            if (otherNPC === this) continue;

            const ourT = this.state.t;
            const theirT = otherNPC.state.t;

            // Check if we're close on the track
            const trackDistance = Math.abs(ourT - theirT);
            const wrappedDistance = Math.min(trackDistance, 1 - trackDistance);

            if (wrappedDistance < trackDistanceThreshold) {
                // We're close on track, check lateral distance
                const lateralDistance = Math.abs(this.state.lateralOffset - otherNPC.state.lateralOffset);

                if (lateralDistance < minLateralDistance) {
                    // Too close laterally, adjust our target
                    const avoidDirection = this.state.lateralOffset > otherNPC.state.lateralOffset ? 1 : -1;
                    this.targetLateralOffset += avoidDirection * (minLateralDistance - lateralDistance) * 0.5;

                    // Clamp to track bounds
                    const half = this.track.width * 0.5;
                    const lateralLimit = half * 0.95;
                    this.targetLateralOffset = THREE.MathUtils.clamp(this.targetLateralOffset, -lateralLimit, lateralLimit);
                }
            }
        }
    }

    private checkIfStuck(dt: number): boolean {
        const currentT = this.state.t;
        const positionChange = Math.abs(currentT - this.lastPositionT);

        if (positionChange < this.positionChangeThreshold) {
            this.stuckDetectionTimer += dt;
        } else {
            this.stuckDetectionTimer = 0;
            this.lastPositionT = currentT;
        }

        return this.stuckDetectionTimer >= this.stuckThreshold;
    }

    private resetIfStuck() {
        console.log(`NPC ${this.racerId} was stuck, resetting position`);

        // Teleport forward by a small amount
        this.state.t += 0.02;
        if (this.state.t > 1) this.state.t -= 1;

        // Reset velocity to prevent immediate re-sticking
        this.lateralVelocity = 0;
        this.speedMultiplier = 1.2; // Give a small speed boost

        // Reset stuck detection
        this.stuckDetectionTimer = 0;
        this.lastPositionT = this.state.t;
    }
}
