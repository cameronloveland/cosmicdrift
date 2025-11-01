import * as THREE from 'three';

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
            const radius = 700 + Math.random() * 300; // Start between 700-1000
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
            const brightness = 0.4 + (radius - 700) / 300 * 0.6;
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

        for (let i = 0; i < this.particleData.length; i++) {
            const particle = this.particleData[i];

            // Calculate spiral motion - particles spiral inward while rotating
            const spiralFactor = 1.0 + (1000 - particle.radius) / 1000 * 0.6; // Moderate spiral near center
            particle.angle += dt * 0.04 * spiralFactor;

            // Radial velocity increases as particle gets closer (gravitational pull) - moderate
            const pullStrength = Math.pow((1000 - particle.radius) / 300, 1.8) + 0.7; // Reduced pull strength
            particle.radius -= dt * particle.speed * pullStrength;

            // If particle gets too close to black hole, respawn it at outer edge
            if (particle.radius < 480) {
                particle.angle = Math.random() * Math.PI * 2;
                particle.radius = 700 + Math.random() * 300;
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
            const brightness = Math.max(0.3, Math.min(1.0, (particle.radius - 480) / 400));
            colors[i * 3 + 0] = particle.color.r * brightness;
            colors[i * 3 + 1] = particle.color.g * brightness;
            colors[i * 3 + 2] = particle.color.b * brightness;
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.color.needsUpdate = true;
    }
}

