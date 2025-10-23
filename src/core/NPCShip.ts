import * as THREE from 'three';
import { COLORS, PHYSICS } from './constants';
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
    private rubberbandStrength = 0.3; // How much to adjust speed based on position
    private aiUpdateTimer = 0;
    private aiUpdateInterval = 0.1; // Update AI every 100ms

    // AI state
    private targetLateralOffset = 0;
    private lateralSwayTimer = 0;
    private speedVariation = 0;

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
        // Create ship geometry similar to player ship but with NPC color
        const body = new THREE.Group();
        const geo = new THREE.ConeGeometry(1.0, 2.0, 16); // Make NPCs much larger for visibility
        const shipMaterial = new THREE.MeshStandardMaterial({
            color: this.color,
            metalness: 0.1,
            roughness: 0.1,
            emissive: this.color.clone().multiplyScalar(1.5) // Brighter emissive
        });
        const mesh = new THREE.Mesh(geo, shipMaterial);
        mesh.rotation.x = Math.PI / 2;
        body.add(mesh);

        // Add bright glow effect for maximum visibility
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: this.color,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 16), glowMaterial); // Much larger glow
        glow.position.set(0, -0.15, -0.3);
        body.add(glow);

        // Add a bright box for extra visibility
        const boxGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const boxMat = new THREE.MeshBasicMaterial({
            color: this.color,
            transparent: true,
            opacity: 0.8
        });
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.set(0, 0, 0);
        body.add(box);

        this.root.add(body);
        console.log(`NPC ${this.racerId} ship model created with color:`, this.color);
    }

    private setupAIBehavior() {
        // Set up AI behavior parameters based on type
        if (this.aiBehavior === 'aggressive') {
            this.rubberbandStrength = 0.4;
            this.speedVariation = 0.1;
        } else {
            this.rubberbandStrength = 0.2;
            this.speedVariation = 0.05;
        }
    }

    public update(dt: number, playerPosition: number, playerLap: number, playerSpeed: number) {
        this.aiUpdateTimer += dt;

        // Update AI behavior periodically
        if (this.aiUpdateTimer >= this.aiUpdateInterval) {
            this.updateAI(playerPosition, playerLap, playerSpeed);
            this.aiUpdateTimer = 0;
        }

        // Apply rubberbanding based on position relative to player
        this.applyRubberbanding(playerPosition, playerLap, playerSpeed);

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

    private applyRubberbanding(playerPosition: number, playerLap: number, playerSpeed: number) {
        const ourPosition = this.getTrackPosition();
        const positionDiff = ourPosition - playerPosition;
        const lapDiff = this.state.lapCurrent - playerLap;

        // Calculate rubberband multiplier
        let rubberbandMultiplier = 1.0;

        // If we're behind (position > player position or lap behind)
        if (positionDiff > 0 || lapDiff < 0) {
            // Speed up when behind
            const behindAmount = Math.min(1, Math.abs(positionDiff) / 0.1); // Normalize to 0-1
            rubberbandMultiplier = 1 + (this.rubberbandStrength * behindAmount);
        } else if (positionDiff < -0.05 || lapDiff > 0) {
            // Slow down when ahead
            const aheadAmount = Math.min(1, Math.abs(positionDiff) / 0.1);
            rubberbandMultiplier = 1 - (this.rubberbandStrength * 0.5 * aheadAmount);
        }

        // Apply speed variation for more interesting racing
        const variation = (Math.random() - 0.5) * this.speedVariation;
        this.speedMultiplier = Math.max(0.7, Math.min(1.3, rubberbandMultiplier + variation));
    }

    private updatePhysics(dt: number) {
        // Calculate target speed with AI multiplier
        const baseSpeed = PHYSICS.baseSpeed * this.speedMultiplier;

        // Smooth speed transitions
        const speedLerp = 1 - Math.pow(0.01, dt);
        this.state.speedKmh = THREE.MathUtils.lerp(this.state.speedKmh, baseSpeed, speedLerp);

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
    }
}
