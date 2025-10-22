import * as THREE from 'three';
import { STARFIELD_MIN_RADIUS } from './constants';

export class Environment {
    public root = new THREE.Group();
    private stars = new THREE.Group();
    private starfieldRadius = STARFIELD_MIN_RADIUS;
    private planets = new THREE.Group();
    private blackHole = new THREE.Group();
    private accretionDisk1!: THREE.Mesh;
    private accretionDisk2!: THREE.Mesh;
    private eventHorizonGlow!: THREE.Mesh;
    private blackHoleParticles!: THREE.Points;
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

        // 2. Event horizon glow ring
        const horizonGeometry = new THREE.SphereGeometry(500, 64, 64);
        const horizonMaterial = new THREE.MeshBasicMaterial({
            color: 0x8844ff,
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            depthWrite: false,
            toneMapped: false
        });
        this.eventHorizonGlow = new THREE.Mesh(horizonGeometry, horizonMaterial);
        this.blackHole.add(this.eventHorizonGlow);

        // 3. Inner accretion disk layer (main visible disk)
        const diskGeometry1 = new THREE.TorusGeometry(550, 150, 32, 128);
        const diskMaterial1 = new THREE.MeshBasicMaterial({
            color: 0xff2bd6, // Start with magenta
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
            toneMapped: false
        });
        this.accretionDisk1 = new THREE.Mesh(diskGeometry1, diskMaterial1);
        this.accretionDisk1.rotation.x = Math.PI / 2; // Horizontal disk
        this.blackHole.add(this.accretionDisk1);

        // 4. Outer accretion disk layer (larger, more transparent)
        const diskGeometry2 = new THREE.TorusGeometry(700, 80, 24, 128);
        const diskMaterial2 = new THREE.MeshBasicMaterial({
            color: 0x53d7ff, // Cyan outer edge
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
            toneMapped: false
        });
        this.accretionDisk2 = new THREE.Mesh(diskGeometry2, diskMaterial2);
        this.accretionDisk2.rotation.x = Math.PI / 2;
        this.blackHole.add(this.accretionDisk2);

        // 5. Particle system - swirling into black hole
        const particleCount = 150;
        const particleGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            // Distribute particles in spiral around disk plane
            const angle = (i / particleCount) * Math.PI * 8; // Multiple spirals
            const radius = 400 + Math.random() * 400;
            const height = (Math.random() - 0.5) * 100; // Near disk plane

            positions[i * 3 + 0] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = height;
            positions[i * 3 + 2] = Math.sin(angle) * radius;

            // Alternate pink/cyan colors
            const isPink = Math.random() > 0.5;
            colors[i * 3 + 0] = isPink ? 1.0 : 0.33;
            colors[i * 3 + 1] = isPink ? 0.17 : 0.84;
            colors[i * 3 + 2] = isPink ? 0.84 : 1.0;

            sizes[i] = 3 + Math.random() * 4;
        }

        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const particleMaterial = new THREE.PointsMaterial({
            size: 5,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
            sizeAttenuation: true,
            depthWrite: false,
            toneMapped: false
        });

        this.blackHoleParticles = new THREE.Points(particleGeometry, particleMaterial);
        this.blackHole.add(this.blackHoleParticles);

        // 6. Add rotating point lights around accretion disk
        const lightCount = 8;
        for (let i = 0; i < lightCount; i++) {
            const angle = (i / lightCount) * Math.PI * 2;
            const radius = 550;
            const isPink = i % 2 === 0;
            const color = isPink ? 0xff2bd6 : 0x53d7ff;

            const light = new THREE.PointLight(color, 300, 800, 1.8);
            light.position.set(
                Math.cos(angle) * radius,
                0,
                Math.sin(angle) * radius
            );

            this.accretionDisk1.add(light);
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

        // Rotate planets slowly
        this.planets.rotation.y += dt * 0.02;
        this.stars.rotation.z += dt * 0.005;

        // Animate black hole components
        if (this.accretionDisk1 && this.accretionDisk2) {
            // Rotate accretion disks at different speeds
            this.accretionDisk1.rotation.z += dt * 0.15; // Inner disk rotates faster
            this.accretionDisk2.rotation.z -= dt * 0.08; // Outer disk rotates slower, opposite direction

            // Add subtle wobble to disks
            this.accretionDisk1.rotation.y = Math.sin(this.time * 0.3) * 0.1;
            this.accretionDisk2.rotation.y = Math.cos(this.time * 0.25) * 0.08;
        }

        // Pulse event horizon glow
        if (this.eventHorizonGlow) {
            const pulseFactor = 0.15 + Math.sin(this.time * 1.2) * 0.08;
            (this.eventHorizonGlow.material as THREE.MeshBasicMaterial).opacity = pulseFactor;
        }

        // Animate particles spiraling into black hole
        if (this.blackHoleParticles) {
            const positions = this.blackHoleParticles.geometry.attributes.position.array as Float32Array;

            for (let i = 0; i < positions.length / 3; i++) {
                const idx = i * 3;
                const x = positions[idx];
                const z = positions[idx + 2];

                // Calculate current radius and angle
                let radius = Math.sqrt(x * x + z * z);
                let angle = Math.atan2(z, x);

                // Spiral inward and rotate
                radius -= dt * 20; // Move inward
                angle += dt * 0.5; // Rotate

                // Reset particle if it gets too close to center
                if (radius < 400) {
                    radius = 800;
                    positions[idx + 1] = (Math.random() - 0.5) * 100; // Random height
                }

                // Update position
                positions[idx] = Math.cos(angle) * radius;
                positions[idx + 2] = Math.sin(angle) * radius;
            }

            this.blackHoleParticles.geometry.attributes.position.needsUpdate = true;
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


