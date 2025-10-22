import * as THREE from 'three';
import { STARFIELD_MIN_RADIUS } from './constants';

export class Environment {
    public root = new THREE.Group();
    private stars = new THREE.Group();
    private starfieldRadius = STARFIELD_MIN_RADIUS;
    private planets = new THREE.Group();

    constructor() {
        this.addStars();
        this.addPlanets();
        this.root.add(this.planets);
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

    private addPlanets() {
        // Planet 1: Massive Magenta/Pink glowing planet (4x larger)
        const g1 = new THREE.SphereGeometry(88, 64, 48);
        const m1 = new THREE.MeshBasicMaterial({
            color: 0xff2bd6, // neon magenta
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p1 = new THREE.Mesh(g1, m1);
        p1.position.set(-120, 40, -180); // Closer to track for better lighting
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

        // Planet 2: Large Cyan glowing planet (4x larger)
        const g2 = new THREE.SphereGeometry(64, 64, 48);
        const m2 = new THREE.MeshBasicMaterial({
            color: 0x53d7ff, // neon cyan
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p2 = new THREE.Mesh(g2, m2);
        p2.position.set(140, -20, -250); // Closer to track
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

        // Planet 3: Medium Magenta planet (4x larger)
        const g3 = new THREE.SphereGeometry(40, 48, 36);
        const m3 = new THREE.MeshBasicMaterial({
            color: 0xff2bd6,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p3 = new THREE.Mesh(g3, m3);
        p3.position.set(80, 60, 200); // Different side of track
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

        // Planet 4: Large Cyan planet (4x larger)
        const g4 = new THREE.SphereGeometry(56, 56, 40);
        const m4 = new THREE.MeshBasicMaterial({
            color: 0x53d7ff,
            transparent: true,
            opacity: 0.88,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p4 = new THREE.Mesh(g4, m4);
        p4.position.set(-100, -35, 220); // Different quadrant
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
        this.planets.rotation.y += dt * 0.02;
        this.stars.rotation.z += dt * 0.005;
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


