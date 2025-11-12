import * as THREE from 'three';
import { Track } from './Track';
import { START_LINE_SPARKS } from './constants';

interface Particle {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    age: number;
    maxAge: number;
    opacity: number;
    scale: number;
    color: THREE.Color;
    bounceCount: number; // Track number of bounces
}

export class StartLineSparks {
    public root = new THREE.Group();
    private track: Track;
    private particles: Particle[] = [];
    private imesh: THREE.InstancedMesh;
    private tmpObj = new THREE.Object3D();
    private colors: THREE.Color[] = [];
    private maxParticles: number;
    private spawnAccumulator = 0;

    // Cached start line frame for spawn calculations
    private startLineCenter = new THREE.Vector3();
    private startLineUp = new THREE.Vector3();
    private startLineBin = new THREE.Vector3();
    private startLineTan = new THREE.Vector3();
    private crossbarLeftEdge = new THREE.Vector3();
    private crossbarRightEdge = new THREE.Vector3();
    private crossbarLength = 0;
    private gateHeight = 12;

    constructor(track: Track) {
        this.track = track;
        this.maxParticles = START_LINE_SPARKS.maxParticles;

        // Calculate start line frame (same logic as Track.buildStartLine)
        this.updateStartLineFrame();

        // Create particle geometry (small spheres for many visible spark dots)
        const geometry = new THREE.SphereGeometry(0.25, 8, 6);

        // Create material with additive blending for intense glow
        // Note: instanceColor works with InstancedMesh without vertexColors
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff, // Will be overridden by instance colors
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false, // Disable depth test to ensure visibility
            toneMapped: false
        });

        // Create instanced mesh for efficient rendering
        this.imesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
        this.imesh.frustumCulled = false;

        this.imesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxParticles * 3), 3);
        this.imesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.root.add(this.imesh);

        // Initialize colors array
        for (let i = 0; i < this.maxParticles; i++) {
            this.colors[i] = new THREE.Color();
        }

        // Verify initialization
        if (this.crossbarLength === 0) {
            console.warn('StartLineSparks: crossbarLength is 0, frame may not be initialized correctly');
        } else {
            console.log('StartLineSparks initialized:', {
                maxParticles: this.maxParticles,
                spawnRate: START_LINE_SPARKS.spawnRate,
                crossbarLength: this.crossbarLength.toFixed(2),
                center: `${this.startLineCenter.x.toFixed(1)}, ${this.startLineCenter.y.toFixed(1)}, ${this.startLineCenter.z.toFixed(1)}`
            });
        }
    }

    private updateStartLineFrame() {
        // Get start line frame (same as Track.buildStartLine)
        const startT = 0.0;
        const idx = Math.floor(startT * this.track.samples) % this.track.samples;

        // Verify cached arrays are populated
        if (!this.track.cachedPositions || !this.track.cachedPositions[idx]) {
            console.error('StartLineSparks: Track cached positions not ready');
            return;
        }

        this.startLineCenter.copy(this.track.cachedPositions[idx]);
        this.startLineUp.copy(this.track.cachedNormals[idx]).normalize();
        this.startLineBin.copy(this.track.cachedBinormals[idx]).normalize();
        this.startLineTan.copy(this.track.cachedTangents[idx]).normalize();

        // Calculate crossbar edges (same as Track.buildStartLine)
        const postRadius = 0.4;
        this.crossbarLeftEdge.copy(this.startLineCenter)
            .addScaledVector(this.startLineBin, -this.track.width * 0.5 - 0.1 - postRadius)
            .addScaledVector(this.startLineUp, this.gateHeight);
        this.crossbarRightEdge.copy(this.startLineCenter)
            .addScaledVector(this.startLineBin, this.track.width * 0.5 + 0.1 + postRadius)
            .addScaledVector(this.startLineUp, this.gateHeight);

        this.crossbarLength = this.crossbarLeftEdge.distanceTo(this.crossbarRightEdge);
    }

    private spawn() {
        if (this.particles.length >= this.maxParticles) return;

        // Random position along crossbar
        const t = Math.random(); // 0 to 1 along crossbar
        const spawnPos = new THREE.Vector3()
            .copy(this.crossbarLeftEdge)
            .lerp(this.crossbarRightEdge, t);

        // Add small random offset along crossbar for more natural distribution
        const forwardOffset = (Math.random() - 0.5) * 0.3; // Along tangent (forward/back)
        spawnPos.addScaledVector(this.startLineTan, forwardOffset);

        // Random color from palette
        const colorIndex = Math.floor(Math.random() * START_LINE_SPARKS.colors.length);
        const baseColor = START_LINE_SPARKS.colors[colorIndex];

        // Initial velocity: downward with gravity, plus some lateral spread
        const downVel = START_LINE_SPARKS.initialVelocityMin +
            Math.random() * (START_LINE_SPARKS.initialVelocityMax - START_LINE_SPARKS.initialVelocityMin);

        const lateralVel = (Math.random() - 0.5) * START_LINE_SPARKS.lateralSpread;
        const forwardVel = (Math.random() - 0.5) * START_LINE_SPARKS.lateralSpread;

        const velocity = new THREE.Vector3()
            .addScaledVector(this.startLineTan, forwardVel)
            .addScaledVector(this.startLineBin, lateralVel)
            .addScaledVector(this.startLineUp, downVel); // Negative up = downward

        const particle: Particle = {
            position: spawnPos,
            velocity: velocity,
            age: 0,
            maxAge: START_LINE_SPARKS.lifetimeMin +
                Math.random() * (START_LINE_SPARKS.lifetimeMax - START_LINE_SPARKS.lifetimeMin),
            opacity: START_LINE_SPARKS.opacityBase,
            scale: START_LINE_SPARKS.particleSizeMin +
                Math.random() * (START_LINE_SPARKS.particleSizeMax - START_LINE_SPARKS.particleSizeMin),
            color: baseColor.clone(),
            bounceCount: 0
        };

        this.particles.push(particle);
    }

    private getTrackFrameAtPosition(worldPos: THREE.Vector3): { center: THREE.Vector3, up: THREE.Vector3, tan: THREE.Vector3, bin: THREE.Vector3 } | null {
        // Find closest track sample point using approximate t value based on distance from start
        // This is much faster than searching all positions
        const distFromStart = worldPos.distanceTo(this.startLineCenter);
        const approximateT = Math.max(0, Math.min(1, distFromStart / (this.track.length * 0.1))); // Rough estimate
        const idx = Math.floor(approximateT * this.track.samples) % this.track.samples;

        // Verify we're still on track (check nearby samples)
        let closestIdx = idx;
        let minDist = worldPos.distanceToSquared(this.track.cachedPositions[idx]);

        // Check a small range around the estimated index
        const searchRange = 50;
        for (let i = Math.max(0, idx - searchRange); i < Math.min(this.track.cachedPositions.length, idx + searchRange); i++) {
            const dist = worldPos.distanceToSquared(this.track.cachedPositions[i]);
            if (dist < minDist) {
                minDist = dist;
                closestIdx = i;
            }
        }

        if (closestIdx >= this.track.cachedPositions.length) return null;

        return {
            center: this.track.cachedPositions[closestIdx],
            up: this.track.cachedNormals[closestIdx].clone().normalize(),
            tan: this.track.cachedTangents[closestIdx].clone().normalize(),
            bin: this.track.cachedBinormals[closestIdx].clone().normalize()
        };
    }

    update(dt: number) {
        // Continuous spawning - spawn multiple particles per frame if needed
        this.spawnAccumulator += dt * START_LINE_SPARKS.spawnRate;
        const spawnCount = Math.floor(this.spawnAccumulator);
        for (let i = 0; i < spawnCount && this.particles.length < this.maxParticles; i++) {
            this.spawn();
        }
        this.spawnAccumulator -= spawnCount;

        // Update existing particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];

            // Age particle
            particle.age += dt;

            // Get track frame at current position for accurate gravity direction
            const trackFrame = this.getTrackFrameAtPosition(particle.position);
            if (!trackFrame) {
                // Fallback to start line frame if track frame unavailable
                particle.velocity.addScaledVector(this.startLineUp, -START_LINE_SPARKS.gravity * dt);
                particle.position.addScaledVector(particle.velocity, dt);
                continue;
            }

            // Apply gravity (downward acceleration) using track's local up vector
            particle.velocity.addScaledVector(trackFrame.up, -START_LINE_SPARKS.gravity * dt);

            // Move particle
            const oldPosition = particle.position.clone();
            particle.position.addScaledVector(particle.velocity, dt);

            // Check for collision with track surface (reuse trackFrame)
            if (trackFrame && particle.bounceCount < START_LINE_SPARKS.maxBounces) {
                // Calculate distance from track surface
                const toParticle = new THREE.Vector3().subVectors(particle.position, trackFrame.center);
                const distanceAboveTrack = toParticle.dot(trackFrame.up);

                // If particle is below or very close to track surface, bounce it
                if (distanceAboveTrack < START_LINE_SPARKS.trackSurfaceOffset) {
                    // Reflect velocity off track normal
                    const normal = trackFrame.up.clone();
                    const velocityDotNormal = particle.velocity.dot(normal);

                    // Only bounce if moving toward the track (downward)
                    if (velocityDotNormal < 0) {
                        // Reflect velocity: v' = v - 2(v·n)n
                        const reflection = normal.clone().multiplyScalar(2 * velocityDotNormal);
                        particle.velocity.sub(reflection);

                        // Apply damping to reduce energy after bounce
                        particle.velocity.multiplyScalar(START_LINE_SPARKS.bounceDamping);

                        // Move particle back above track surface
                        particle.position.copy(trackFrame.center);
                        particle.position.addScaledVector(normal, START_LINE_SPARKS.trackSurfaceOffset);

                        particle.bounceCount++;

                        // Add slight random scatter after bounce for more natural effect
                        const scatterStrength = 0.3 * (1.0 - particle.bounceCount / START_LINE_SPARKS.maxBounces);
                        const randomScatter = new THREE.Vector3(
                            (Math.random() - 0.5) * scatterStrength,
                            (Math.random() - 0.5) * scatterStrength,
                            (Math.random() - 0.5) * scatterStrength
                        );
                        particle.velocity.add(randomScatter);
                    }
                }
            }

            // Update opacity with fade out
            const lifeProgress = particle.age / particle.maxAge;
            if (lifeProgress >= 1.0 - START_LINE_SPARKS.fadeOutRatio) {
                // Fade out in the last portion of lifetime
                const fadeProgress = (lifeProgress - (1.0 - START_LINE_SPARKS.fadeOutRatio)) / START_LINE_SPARKS.fadeOutRatio;
                particle.opacity = START_LINE_SPARKS.opacityBase * (1.0 - fadeProgress);
            } else {
                particle.opacity = START_LINE_SPARKS.opacityBase;
            }

            // Ensure opacity doesn't go negative
            particle.opacity = Math.max(0, particle.opacity);

            // Remove dead particles or particles that fell too far
            const distanceFromStart = particle.position.distanceTo(this.startLineCenter);
            // Allow particles to travel further after bouncing - they might bounce down track
            const maxDistance = particle.bounceCount > 0 ? 50 : 30;
            if (particle.age >= particle.maxAge ||
                particle.opacity <= 0 ||
                distanceFromStart > maxDistance) {
                this.particles.splice(i, 1);
                continue;
            }

            // Update instance matrix
            this.tmpObj.position.copy(particle.position);
            // Scale based on particle size - particles should stay visible even when fading
            // Keep scale constant for visibility, opacity fade handles the fade effect
            this.tmpObj.scale.setScalar(particle.scale);
            this.tmpObj.updateMatrix();
            this.imesh.setMatrixAt(i, this.tmpObj.matrix);

            // Update color - for additive blending, keep colors very bright
            const color = this.colors[i];
            color.copy(particle.color);
            // For additive blending, multiply color by opacity to create intense glow
            // Higher opacity values create brighter glow effect
            color.multiplyScalar(particle.opacity);
            this.imesh.setColorAt(i, color);
        }

        // Update instanced mesh
        this.imesh.count = this.particles.length;
        if (this.particles.length > 0) {
            this.imesh.instanceMatrix.needsUpdate = true;
            if (this.imesh.instanceColor) {
                this.imesh.instanceColor.needsUpdate = true;
            }
        }
    }

    public dispose() {
        this.imesh.geometry.dispose();
        (this.imesh.material as THREE.Material).dispose();
        this.root.remove(this.imesh);
    }
}

