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

        // 3. Clean black hole - no rings or particles

        // 6. No additional effects - clean black hole

        // 7. Add rotating point lights around vortex
        this.addVortexLights();
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

        // No vortex layer animations - clean black hole

        // No Jupiter rings animations - clean black hole

        // No ring animations - clean black hole

        // Static event horizon glow - no pulsing

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
