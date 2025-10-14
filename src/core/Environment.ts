import * as THREE from 'three';

export class Environment {
    public root = new THREE.Group();
    private stars!: THREE.Points;
    private planets = new THREE.Group();

    constructor() {
        this.addStars();
        this.addPlanets();
        this.root.add(this.planets);
    }

    private addStars() {
        const count = 4000;
        const geom = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const r = 600;
            positions[i * 3 + 0] = (Math.random() * 2 - 1) * r;
            positions[i * 3 + 1] = (Math.random() * 2 - 1) * r * 0.6;
            positions[i * 3 + 2] = -Math.random() * r - 50;
        }
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({ color: 0xcfe9ff, size: 1.2, sizeAttenuation: true });
        this.stars = new THREE.Points(geom, mat);
        this.root.add(this.stars);
    }

    private addPlanets() {
        const g1 = new THREE.SphereGeometry(22, 48, 32);
        const m1 = new THREE.MeshStandardMaterial({ color: 0x140b3a, emissive: 0x361069, emissiveIntensity: 0.4, roughness: 0.6 });
        const p1 = new THREE.Mesh(g1, m1);
        p1.position.set(-80, 30, -200);
        this.planets.add(p1);

        const g2 = new THREE.SphereGeometry(12, 48, 32);
        const m2 = new THREE.MeshStandardMaterial({ color: 0x0b1946, emissive: 0x0b66b4, emissiveIntensity: 0.3, roughness: 0.5 });
        const p2 = new THREE.Mesh(g2, m2);
        p2.position.set(120, -10, -320);
        this.planets.add(p2);
    }

    update(dt: number) {
        this.planets.rotation.y += dt * 0.02;
        this.stars.rotation.z += dt * 0.005;
    }
}


