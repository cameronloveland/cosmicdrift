import * as THREE from 'three';
import { STARFIELD_MIN_RADIUS } from './constants';

export class Environment {
    public root = new THREE.Group();
    private stars = new THREE.Group();
    private starfieldRadius = STARFIELD_MIN_RADIUS;
    private planets = new THREE.Group();
    private blackHole = new THREE.Group();
    private eventHorizonGlow!: THREE.Mesh;
    private vortexLayers: THREE.Points[] = [];
    private jupiterRings: THREE.Points[] = [];
    private diskLights: THREE.PointLight[] = [];
    private time = 0;

    constructor() {
        this.addStars();
        this.addBlackHole();
        this.addPlanets();
        this.root.add(this.planets);
        this.root.add(this.blackHole);
    }

    private addStars() {
        // remove previous stars group if attached
        if (this.stars.parent) this.root.remove(this.stars);
        this.stars = new THREE.Group();

        // Near shell — bright, closer, not affected by fog
        const nearCount = 4000;
        const nearGeom = new THREE.BufferGeometry();
        const nearPos = new Float32Array(nearCount * 3);
        const nearMin = 800;
        const nearMax = 1400;
        for (let i = 0; i < nearCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = nearMin + Math.random() * (nearMax - nearMin);
            nearPos[i * 3 + 0] = radius * Math.sin(phi) * Math.cos(theta);
            nearPos[i * 3 + 1] = radius * Math.cos(phi) * 0.85;
            nearPos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
        }
        nearGeom.setAttribute('position', new THREE.BufferAttribute(nearPos, 3));
        const nearMat = new THREE.PointsMaterial({ color: 0xcfe9ff, size: 1.6, sizeAttenuation: true, fog: false });
        const nearPoints = new THREE.Points(nearGeom, nearMat);
        this.stars.add(nearPoints);

        // Far shell — very large enclosure with fog disabled
        const farCount = 6000;
        const farGeom = new THREE.BufferGeometry();
        const farPos = new Float32Array(farCount * 3);
        const r = this.starfieldRadius;
        const farMin = Math.max(nearMax * 1.5, r * 0.6);
        const farMax = r * 1.05;
        for (let i = 0; i < farCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = farMin + Math.random() * (farMax - farMin);
            farPos[i * 3 + 0] = radius * Math.sin(phi) * Math.cos(theta);
            farPos[i * 3 + 1] = radius * Math.cos(phi) * 0.9;
            farPos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
        }
        farGeom.setAttribute('position', new THREE.BufferAttribute(farPos, 3));
        const farMat = new THREE.PointsMaterial({ color: 0xbfe0ff, size: 1.8, sizeAttenuation: false, fog: false });
        const farPoints = new THREE.Points(farGeom, farMat);
        this.stars.add(farPoints);

        this.root.add(this.stars);
    }

    private addBlackHole() {
        // Position at center of world
        this.blackHole.position.set(0, 0, 0);

        // 1. Black hole core - dark void sphere
        const coreGeometry = new THREE.SphereGeometry(480, 64, 64);
        const coreMaterial = new THREE.MeshBasicMaterial({
            color: 0x0a0015,
            transparent: true,
            opacity: 0.95,
            toneMapped: false
        });
        const core = new THREE.Mesh(coreGeometry, coreMaterial);
        this.blackHole.add(core);

        // 2. Event horizon glow ring - subtle
        const horizonGeometry = new THREE.SphereGeometry(500, 64, 64);
        const horizonMaterial = new THREE.MeshBasicMaterial({
            color: 0x8844ff,
            transparent: true,
            opacity: 0.05,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            depthWrite: false,
            toneMapped: false
        });
        this.eventHorizonGlow = new THREE.Mesh(horizonGeometry, horizonMaterial);
        this.blackHole.add(this.eventHorizonGlow);

        // 3. Create flattened vortex layers (event horizon simulation)
        this.createVortexLayer(0, 1000, 600, 600, 1.5, 2.5, 0.5, 20); // Outer cloud - star-sized particles
        this.createVortexLayer(1, 600, 500, 400, 1.2, 2, 0.7, 15);  // Mid vortex - smaller particles
        this.createVortexLayer(2, 500, 480, 250, 1, 1.8, 0.9, 10);   // Inner accretion - smallest particles

        // 4. Create glowing rings in event horizon plane (like track rings)
        this.createGlowingRing(550, 200, 0x53d7ff, 0.8); // Inner ring - intense cyan glow
        this.createGlowingRing(650, 180, 0xff2bd6, 0.7); // Middle ring - intense pink glow
        this.createGlowingRing(750, 160, 0xff44aa, 0.6); // Outer ring - intense purple glow

        // 5. Add two-tone glow rings around the vortex
        this.createGlowRing(550, 0x53d7ff, 0.3); // Cyan glow ring
        this.createGlowRing(600, 0xff2bd6, 0.25); // Pink glow ring

        // 5. Add rotating point lights around vortex
        this.addVortexLights();
    }

    private createVortexLayer(layerIndex: number, maxRadius: number, minRadius: number, particleCount: number, minSize: number, maxSize: number, opacity: number, maxHeight: number = 80) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const velocities = new Float32Array(particleCount * 3); // Store velocity for animation

        for (let i = 0; i < particleCount; i++) {
            // Distribute particles in spiral pattern
            const angle = (i / particleCount) * Math.PI * 12; // Multiple spirals
            const radius = minRadius + Math.random() * (maxRadius - minRadius);
            const height = (Math.random() - 0.5) * maxHeight; // Flattened vertical spread

            positions[i * 3 + 0] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = height;
            positions[i * 3 + 2] = Math.sin(angle) * radius;

            // Color based on layer and position
            let colorR, colorG, colorB;
            if (layerIndex === 0) {
                // Outer: mix of pink/cyan/purple
                const colorChoice = Math.random();
                if (colorChoice < 0.33) {
                    colorR = 1.0; colorG = 0.17; colorB = 0.84; // Pink
                } else if (colorChoice < 0.66) {
                    colorR = 0.33; colorG = 0.84; colorB = 1.0; // Cyan
                } else {
                    colorR = 1.0; colorG = 0.27; colorB = 0.67; // Purple
                }
            } else if (layerIndex === 1) {
                // Mid: brighter pink/cyan
                const isPink = Math.random() > 0.5;
                colorR = isPink ? 1.0 : 0.5;
                colorG = isPink ? 0.2 : 0.8;
                colorB = isPink ? 0.8 : 1.0;
            } else {
                // Inner: bright white/pink
                colorR = 1.0;
                colorG = 0.8;
                colorB = 1.0;
            }

            colors[i * 3 + 0] = colorR;
            colors[i * 3 + 1] = colorG;
            colors[i * 3 + 2] = colorB;

            sizes[i] = minSize + Math.random() * (maxSize - minSize);

            // Store initial velocity for spiral motion
            velocities[i * 3 + 0] = 0;
            velocities[i * 3 + 1] = 0;
            velocities[i * 3 + 2] = 0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

        const material = new THREE.PointsMaterial({
            size: maxSize * 1.2, // Star-sized particles with subtle glow
            transparent: true,
            opacity: opacity,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
            sizeAttenuation: true,
            depthWrite: false,
            toneMapped: false
        });

        const vortexLayer = new THREE.Points(geometry, material);
        vortexLayer.userData = {
            layerIndex,
            maxRadius,
            minRadius,
            particleCount,
            spiralSpeed: 0.1 + layerIndex * 0.05,
            inwardSpeed: 15 + layerIndex * 10
        };

        this.blackHole.add(vortexLayer);
        this.vortexLayers.push(vortexLayer);
    }

    private createGlowingRing(radius: number, particleCount: number, color: number, opacity: number) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const ringRadius = radius + (Math.random() - 0.5) * 15; // Small radius variation
            const height = (Math.random() - 0.5) * 5; // Extremely flat ring - event horizon plane

            positions[i * 3 + 0] = Math.cos(angle) * ringRadius;
            positions[i * 3 + 1] = height;
            positions[i * 3 + 2] = Math.sin(angle) * ringRadius;

            // Convert hex color to RGB
            colors[i * 3 + 0] = ((color >> 16) & 255) / 255;
            colors[i * 3 + 1] = ((color >> 8) & 255) / 255;
            colors[i * 3 + 2] = (color & 255) / 255;

            sizes[i] = 2.5 + Math.random() * 1.5; // Larger particles for track-like glow
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // Enhanced glowing material to match track intensity
        const material = new THREE.PointsMaterial({
            size: 3.5, // Larger for more volumetric glow
            transparent: true,
            opacity: opacity * 1.5, // Boost opacity for track-like intensity
            blending: THREE.AdditiveBlending,
            vertexColors: true,
            sizeAttenuation: true,
            depthWrite: false,
            toneMapped: false
        });

        const ring = new THREE.Points(geometry, material);
        ring.userData = {
            radius,
            rotationSpeed: 0.05 + Math.random() * 0.03,
            precessionSpeed: 0.01 + Math.random() * 0.01
        };

        this.blackHole.add(ring);
        this.jupiterRings.push(ring);
    }

    private createGlowRing(radius: number, color: number, opacity: number) {
        const geometry = new THREE.RingGeometry(radius - 5, radius + 5, 32);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: opacity,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
            toneMapped: false
        });

        const glowRing = new THREE.Mesh(geometry, material);
        glowRing.rotation.x = Math.PI / 2; // Horizontal
        glowRing.userData = {
            radius,
            rotationSpeed: 0.02 + Math.random() * 0.01
        };

        this.blackHole.add(glowRing);
    }

    private addVortexLights() {
        const lightCount = 6;
        for (let i = 0; i < lightCount; i++) {
            const angle = (i / lightCount) * Math.PI * 2;
            const radius = 600;
            const isPink = i % 2 === 0;
            const color = isPink ? 0xff2bd6 : 0x53d7ff;

            const light = new THREE.PointLight(color, 200, 600, 1.5);
            light.position.set(
                Math.cos(angle) * radius,
                0,
                Math.sin(angle) * radius
            );

            this.blackHole.add(light);
            this.diskLights.push(light);
        }
    }

    private addPlanets() {
        // Planet 1: Massive Magenta/Pink glowing planet - North-West quadrant
        const g1 = new THREE.SphereGeometry(88, 64, 48);
        const m1 = new THREE.MeshBasicMaterial({
            color: 0xff2bd6, // neon magenta
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p1 = new THREE.Mesh(g1, m1);
        p1.position.set(-900, 120, -600); // More dispersed, further from center
        p1.userData = { orbitRadius: 1000, orbitSpeed: 0.01, orbitAngle: 0 };
        this.planets.add(p1);

        // Add dramatic point light to planet 1
        const light1 = new THREE.PointLight(0xff2bd6, 800, 1200, 1.5);
        p1.add(light1);

        // Add larger glow halo to planet 1
        const halo1 = new THREE.Mesh(
            new THREE.SphereGeometry(112, 48, 36),
            new THREE.MeshBasicMaterial({
                color: 0xff2bd6,
                transparent: true,
                opacity: 0.2,
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide,
                depthWrite: false,
                toneMapped: false
            })
        );
        p1.add(halo1);

        // Planet 2: Large Cyan glowing planet - South-East quadrant
        const g2 = new THREE.SphereGeometry(64, 64, 48);
        const m2 = new THREE.MeshBasicMaterial({
            color: 0x53d7ff, // neon cyan
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p2 = new THREE.Mesh(g2, m2);
        p2.position.set(950, -80, -850); // Spread out on opposite side
        p2.userData = { orbitRadius: 1200, orbitSpeed: 0.008, orbitAngle: Math.PI };
        this.planets.add(p2);

        // Add dramatic point light to planet 2
        const light2 = new THREE.PointLight(0x53d7ff, 600, 1100, 1.5);
        p2.add(light2);

        // Add larger glow halo to planet 2
        const halo2 = new THREE.Mesh(
            new THREE.SphereGeometry(84, 48, 36),
            new THREE.MeshBasicMaterial({
                color: 0x53d7ff,
                transparent: true,
                opacity: 0.2,
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide,
                depthWrite: false,
                toneMapped: false
            })
        );
        p2.add(halo2);

        // Planet 3: Medium Magenta planet - North-East, elevated
        const g3 = new THREE.SphereGeometry(40, 48, 36);
        const m3 = new THREE.MeshBasicMaterial({
            color: 0xff2bd6,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p3 = new THREE.Mesh(g3, m3);
        p3.position.set(700, 250, 800); // Higher up, different area
        p3.userData = { orbitRadius: 900, orbitSpeed: 0.012, orbitAngle: Math.PI / 2 };
        this.planets.add(p3);

        // Add dramatic point light to planet 3
        const light3 = new THREE.PointLight(0xff2bd6, 400, 900, 1.5);
        p3.add(light3);

        // Add larger glow halo to planet 3
        const halo3 = new THREE.Mesh(
            new THREE.SphereGeometry(56, 36, 28),
            new THREE.MeshBasicMaterial({
                color: 0xff2bd6,
                transparent: true,
                opacity: 0.18,
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide,
                depthWrite: false,
                toneMapped: false
            })
        );
        p3.add(halo3);

        // Planet 4: Large Cyan planet - South-West, lower
        const g4 = new THREE.SphereGeometry(56, 56, 40);
        const m4 = new THREE.MeshBasicMaterial({
            color: 0x53d7ff,
            transparent: true,
            opacity: 0.88,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p4 = new THREE.Mesh(g4, m4);
        p4.position.set(-750, -120, 900); // Lower, spread to far side
        p4.userData = { orbitRadius: 1100, orbitSpeed: 0.009, orbitAngle: 3 * Math.PI / 2 };
        this.planets.add(p4);

        // Add dramatic point light to planet 4
        const light4 = new THREE.PointLight(0x53d7ff, 500, 1000, 1.5);
        p4.add(light4);

        // Add larger glow halo to planet 4
        const halo4 = new THREE.Mesh(
            new THREE.SphereGeometry(72, 48, 36),
            new THREE.MeshBasicMaterial({
                color: 0x53d7ff,
                transparent: true,
                opacity: 0.19,
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide,
                depthWrite: false,
                toneMapped: false
            })
        );
        p4.add(halo4);
    }

    update(dt: number) {
        this.time += dt;

        // Animate planets orbiting around black hole
        this.planets.children.forEach((planet) => {
            if (planet.userData && planet.userData.orbitRadius) {
                const userData = planet.userData;
                userData.orbitAngle += dt * userData.orbitSpeed;

                // Calculate orbital position
                const x = Math.cos(userData.orbitAngle) * userData.orbitRadius;
                const z = Math.sin(userData.orbitAngle) * userData.orbitRadius;

                // Keep original Y position for vertical variation
                planet.position.set(x, planet.position.y, z);
            }
        });

        this.stars.rotation.z += dt * 0.005;

        // Animate vortex layers with spiral motion
        if (this.vortexLayers) {
            this.vortexLayers.forEach((layer) => {
                const userData = layer.userData;
                const positions = layer.geometry.attributes.position.array as Float32Array;
                const velocities = layer.geometry.attributes.velocity.array as Float32Array;

                for (let i = 0; i < userData.particleCount; i++) {
                    const idx = i * 3;
                    const x = positions[idx];
                    const y = positions[idx + 1];
                    const z = positions[idx + 2];

                    // Calculate current radius and angle
                    let radius = Math.sqrt(x * x + z * z);
                    let angle = Math.atan2(z, x);

                    // Spiral inward
                    radius -= dt * userData.inwardSpeed;
                    angle += dt * userData.spiralSpeed;

                    // Add turbulence
                    const turbulence = Math.sin(this.time * 2 + i * 0.1) * 5;
                    radius += turbulence * dt;

                    // Reset particle if it gets too close
                    if (radius < userData.minRadius) {
                        radius = userData.maxRadius;
                        angle = Math.random() * Math.PI * 2;
                    }

                    // Update position - keep in flattened event horizon plane
                    positions[idx] = Math.cos(angle) * radius;
                    positions[idx + 1] = y + Math.sin(this.time * 3 + i * 0.05) * 1; // Minimal vertical wobble
                    positions[idx + 2] = Math.sin(angle) * radius;
                }

                layer.geometry.attributes.position.needsUpdate = true;
            });
        }

        // Animate Jupiter rings
        if (this.jupiterRings) {
            this.jupiterRings.forEach((ring) => {
                const userData = ring.userData;
                // Rotate around Y axis
                ring.rotation.y += dt * userData.rotationSpeed;
                // Add precession (tilt change)
                ring.rotation.x = Math.sin(this.time * userData.precessionSpeed) * 0.1;
            });
        }

        // Animate glow rings
        this.blackHole.children.forEach((child) => {
            if (child.userData && child.userData.rotationSpeed) {
                child.rotation.y += dt * child.userData.rotationSpeed;
            }
        });

        // Pulse event horizon glow
        if (this.eventHorizonGlow) {
            const pulseFactor = 0.15 + Math.sin(this.time * 1.2) * 0.08;
            (this.eventHorizonGlow.material as THREE.MeshBasicMaterial).opacity = pulseFactor;
        }

    }

    // Allow the game to expand starfield to enclose the track fully
    public setStarfieldRadius(r: number) {
        const newR = Math.max(STARFIELD_MIN_RADIUS, r);
        if (Math.abs(newR - this.starfieldRadius) < 1) return;
        this.starfieldRadius = newR;
        // rebuild stars with new radius
        this.addStars();
    }
}


