import * as THREE from 'three';
import { BLACKHOLE } from './constants';

interface ParticleData {
    angle: number;
    radius: number;
    speed: number;
    color: THREE.Color;
    y: number;
}

export class AccretionParticles {
    public root = new THREE.Group();
    private particles!: THREE.Points;
    private particleData: ParticleData[] = [];
    private blackHoleRadius = BLACKHOLE.coreRadiusInitial;
    private baseSpawnRadius = BLACKHOLE.particleSpawnRadiusBase;
    private baseSpawnRange = BLACKHOLE.particleSpawnRadiusRange;
    private insideBlackholeProgress = 0; // 0-1 progress for inside effects

    constructor() {
        this.createParticles();
    }

    private createParticles() {
        const particleCount = 700;
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);

        // Initialize particles at various distances and angles
        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = this.baseSpawnRadius + Math.random() * this.baseSpawnRange;
            const y = (Math.random() - 0.5) * 200; // Slight vertical spread

            positions[i * 3 + 0] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = Math.sin(angle) * radius;

            // Random color between pink and cyan
            const colorMix = Math.random();
            const color = new THREE.Color();
            if (colorMix < 0.5) {
                color.setHex(0xff2bd6); // Pink
            } else {
                color.setHex(0x53d7ff); // Cyan
            }
            // Fade based on distance (further = brighter)
            const brightness = 0.4 + (radius - this.baseSpawnRadius) / this.baseSpawnRange * 0.6;
            color.multiplyScalar(brightness);

            colors[i * 3 + 0] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;

            // Store particle data for animation - moderate speeds
            this.particleData.push({
                angle: angle,
                radius: radius,
                speed: 25 + Math.random() * 30, // 25-55 range
                color: color.clone(),
                y: y
            });
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 2.5,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
            depthWrite: false,
            toneMapped: false
        });

        this.particles = new THREE.Points(geometry, material);
        this.root.add(this.particles);
    }

    update(dt: number) {
        if (!this.particles || this.particleData.length === 0) return;

        const positions = this.particles.geometry.attributes.position.array as Float32Array;
        const colors = this.particles.geometry.attributes.color.array as Float32Array;

        // Enhanced effects when inside blackhole
        const spiralIntensity = 1.0 + this.insideBlackholeProgress * 2.0; // Up to 3x spiral intensity
        const pullIntensity = 1.0 + this.insideBlackholeProgress * 1.5; // Up to 2.5x pull strength
        const brightnessBoost = 1.0 + this.insideBlackholeProgress * 1.5; // Up to 2.5x brightness

        // Calculate max spawn radius once
        const maxSpawnRadius = this.baseSpawnRadius + this.baseSpawnRange;

        for (let i = 0; i < this.particleData.length; i++) {
            const particle = this.particleData[i];

            // Calculate spiral motion - particles spiral inward while rotating
            // Enhanced spiral when inside (vortex effect)
            const spiralFactor = (1.0 + (maxSpawnRadius - particle.radius) / maxSpawnRadius * 0.6) * spiralIntensity;
            particle.angle += dt * 0.04 * spiralFactor;

            // Radial velocity increases as particle gets closer (gravitational pull)
            // Enhanced pull when inside blackhole (spacetime warping)
            const basePull = Math.pow((maxSpawnRadius - particle.radius) / this.baseSpawnRange, 1.8) + 0.7;
            const pullStrength = basePull * pullIntensity;
            particle.radius -= dt * particle.speed * pullStrength;

            // If particle gets too close to black hole, respawn it at outer edge
            if (particle.radius < this.blackHoleRadius) {
                particle.angle = Math.random() * Math.PI * 2;
                particle.radius = this.baseSpawnRadius + Math.random() * this.baseSpawnRange;
                particle.speed = 25 + Math.random() * 30;
                particle.y = (Math.random() - 0.5) * 200;

                // Randomize color
                const colorMix = Math.random();
                if (colorMix < 0.5) {
                    particle.color.setHex(0xff2bd6);
                } else {
                    particle.color.setHex(0x53d7ff);
                }
            }

            // Update position
            positions[i * 3 + 0] = Math.cos(particle.angle) * particle.radius;
            positions[i * 3 + 1] = particle.y;
            positions[i * 3 + 2] = Math.sin(particle.angle) * particle.radius;

            // Update color brightness based on distance
            // Enhanced brightness when inside blackhole
            const baseBrightness = Math.max(0.3, Math.min(1.0, (particle.radius - this.blackHoleRadius) / (maxSpawnRadius - this.blackHoleRadius)));
            const brightness = Math.min(1.0, baseBrightness * brightnessBoost);
            colors[i * 3 + 0] = particle.color.r * brightness;
            colors[i * 3 + 1] = particle.color.g * brightness;
            colors[i * 3 + 2] = particle.color.b * brightness;
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.color.needsUpdate = true;
    }

    // Update blackhole radius (affects particle respawn threshold)
    setBlackholeRadius(radius: number) {
        this.blackHoleRadius = radius;
        // Update spawn radius to scale with blackhole (keep proportional)
        const scaleFactor = radius / BLACKHOLE.coreRadiusInitial;
        this.baseSpawnRadius = BLACKHOLE.particleSpawnRadiusBase * scaleFactor;
        this.baseSpawnRange = BLACKHOLE.particleSpawnRadiusRange * scaleFactor;
    }

    // Set inside blackhole progress for enhanced effects
    setInsideProgress(progress: number) {
        this.insideBlackholeProgress = progress;
    }
}
