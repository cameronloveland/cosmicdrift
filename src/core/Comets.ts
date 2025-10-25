import * as THREE from 'three';
import { COMETS } from './constants';

export class Comets {
    public root = new THREE.Group();
    private headMesh!: THREE.InstancedMesh;
    private tailMesh!: THREE.InstancedMesh;
    private maxComets = COMETS.maxCount;
    private activeComets: Array<{
        index: number;
        position: THREE.Vector3;
        velocity: THREE.Vector3;
        progress: number; // 0-1 along path
        path: any;
        color: THREE.Color;
        tailParticles: Array<{
            position: THREE.Vector3;
            age: number;
            maxAge: number;
        }>;
    }> = [];
    private nextSpawnTime = 0;
    private tmpObj = new THREE.Object3D();
    private tmpVec3 = new THREE.Vector3();
    private tmpQuat = new THREE.Quaternion();

    constructor() {
        this.setupHeadMesh();
        this.setupTailMesh();
        this.root.add(this.headMesh);
        this.root.add(this.tailMesh);

        // Start with a random spawn time
        this.nextSpawnTime = COMETS.spawnIntervalMin + Math.random() * (COMETS.spawnIntervalMax - COMETS.spawnIntervalMin);
    }

    private setupHeadMesh() {
        // Create glowing sphere for comet head
        const headGeometry = new THREE.SphereGeometry(1, 16, 12);
        const headMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        this.headMesh = new THREE.InstancedMesh(headGeometry, headMaterial, this.maxComets);
    }

    private setupTailMesh() {
        // Create small spheres for tail particles
        const tailGeometry = new THREE.SphereGeometry(0.4, 8, 6);
        const tailMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        this.tailMesh = new THREE.InstancedMesh(tailGeometry, tailMaterial, this.maxComets * COMETS.tailParticleCount);
    }

    update(dt: number) {
        // Spawn new comets
        this.nextSpawnTime -= dt;
        if (this.nextSpawnTime <= 0 && this.activeComets.length < this.maxComets) {
            this.spawnComet();
            this.nextSpawnTime = COMETS.spawnIntervalMin + Math.random() * (COMETS.spawnIntervalMax - COMETS.spawnIntervalMin);
        }

        // Update existing comets
        for (let i = this.activeComets.length - 1; i >= 0; i--) {
            const comet = this.activeComets[i];

            // Update progress along path
            const speed = COMETS.speedMin + Math.random() * (COMETS.speedMax - COMETS.speedMin);
            const pathLength = this.getPathLength(comet.path);
            const progressDelta = (speed * dt) / pathLength;
            comet.progress += progressDelta;

            if (comet.progress >= 1.0) {
                this.removeComet(i);
                continue;
            }

            // Update position along Bezier curve
            this.updateCometPosition(comet);

            // Update tail particles
            this.updateTailParticles(comet, dt);

            // Update head mesh
            this.updateHeadMesh(comet);
        }

        // Update tail mesh
        this.updateTailMesh();
    }

    private spawnComet() {
        // Select random path
        const path = COMETS.paths[Math.floor(Math.random() * COMETS.paths.length)];

        // Select random color
        const color = COMETS.colors[Math.floor(Math.random() * COMETS.colors.length)].clone();

        const comet = {
            index: this.activeComets.length,
            position: path.start.clone(),
            velocity: new THREE.Vector3(),
            progress: 0,
            path: path,
            color: color,
            tailParticles: []
        };

        this.activeComets.push(comet);
    }

    private updateCometPosition(comet: any) {
        const t = comet.progress;
        const p0 = comet.path.start;
        const p1 = comet.path.control1;
        const p2 = comet.path.control2;
        const p3 = comet.path.end;

        // Cubic Bezier curve
        const t2 = t * t;
        const t3 = t2 * t;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;

        comet.position.set(
            mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
            mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
            mt3 * p0.z + 3 * mt2 * t * p1.z + 3 * mt * t2 * p2.z + t3 * p3.z
        );

        // Calculate velocity for tail direction
        const dt = 0.01;
        const tNext = Math.min(t + dt, 1.0);
        const tNext2 = tNext * tNext;
        const tNext3 = tNext2 * tNext;
        const mtNext = 1 - tNext;
        const mtNext2 = mtNext * mtNext;
        const mtNext3 = mtNext2 * mtNext;

        const nextPos = new THREE.Vector3(
            mtNext3 * p0.x + 3 * mtNext2 * tNext * p1.x + 3 * mtNext * tNext2 * p2.x + tNext3 * p3.x,
            mtNext3 * p0.y + 3 * mtNext2 * tNext * p1.y + 3 * mtNext * tNext2 * p2.y + tNext3 * p3.y,
            mtNext3 * p0.z + 3 * mtNext2 * tNext * p1.z + 3 * mtNext * tNext2 * p2.z + tNext3 * p3.z
        );

        comet.velocity.subVectors(nextPos, comet.position).normalize();
    }

    private getPathLength(path: any): number {
        // Approximate path length by sampling the Bezier curve
        let length = 0;
        const steps = 100;
        let prevPos = path.start.clone();

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const t2 = t * t;
            const t3 = t2 * t;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;

            const pos = new THREE.Vector3(
                mt3 * path.start.x + 3 * mt2 * t * path.control1.x + 3 * mt * t2 * path.control2.x + t3 * path.end.x,
                mt3 * path.start.y + 3 * mt2 * t * path.control1.y + 3 * mt * t2 * path.control2.y + t3 * path.end.y,
                mt3 * path.start.z + 3 * mt2 * t * path.control1.z + 3 * mt * t2 * path.control2.z + t3 * path.end.z
            );

            length += prevPos.distanceTo(pos);
            prevPos.copy(pos);
        }

        return length;
    }

    private updateTailParticles(comet: any, dt: number) {
        // Add new tail particle at comet position
        if (Math.random() < 0.8) { // 80% chance per frame
            comet.tailParticles.push({
                position: comet.position.clone(),
                age: 0,
                maxAge: 2.0 + Math.random() * 1.0
            });
        }

        // Update existing tail particles
        for (let i = comet.tailParticles.length - 1; i >= 0; i--) {
            const particle = comet.tailParticles[i];
            particle.age += dt;

            if (particle.age >= particle.maxAge) {
                comet.tailParticles.splice(i, 1);
            }
        }

        // Limit tail particle count
        if (comet.tailParticles.length > COMETS.tailParticleCount) {
            comet.tailParticles.splice(0, comet.tailParticles.length - COMETS.tailParticleCount);
        }
    }

    private updateHeadMesh(comet: any) {
        // Position comet head
        this.tmpObj.position.copy(comet.position);
        this.tmpObj.quaternion.identity();

        // Scale based on comet size
        const scale = COMETS.headRadius;
        this.tmpObj.scale.setScalar(scale);

        this.tmpObj.updateMatrix();
        this.headMesh.setMatrixAt(comet.index, this.tmpObj.matrix);

        // Set head color
        this.headMesh.setColorAt(comet.index, comet.color);
    }

    private updateTailMesh() {
        let tailIndex = 0;

        for (const comet of this.activeComets) {
            for (const particle of comet.tailParticles) {
                if (tailIndex >= this.maxComets * COMETS.tailParticleCount) break;

                // Position tail particle
                this.tmpObj.position.copy(particle.position);
                this.tmpObj.quaternion.identity();

                // Scale based on age (fade out)
                const ageRatio = particle.age / particle.maxAge;
                const scale = 0.4 * (1 - ageRatio);
                this.tmpObj.scale.setScalar(scale);

                this.tmpObj.updateMatrix();
                this.tailMesh.setMatrixAt(tailIndex, this.tmpObj.matrix);

                // Set tail color (fade with age)
                const color = comet.color.clone();
                color.multiplyScalar(1 - ageRatio);
                this.tailMesh.setColorAt(tailIndex, color);

                tailIndex++;
            }
        }

        // Hide unused tail instances
        for (let i = tailIndex; i < this.maxComets * COMETS.tailParticleCount; i++) {
            this.tmpObj.scale.setScalar(0);
            this.tmpObj.updateMatrix();
            this.tailMesh.setMatrixAt(i, this.tmpObj.matrix);
        }

        this.headMesh.instanceMatrix.needsUpdate = true;
        this.tailMesh.instanceMatrix.needsUpdate = true;
        (this.headMesh.instanceColor as any).needsUpdate = true;
        (this.tailMesh.instanceColor as any).needsUpdate = true;
    }

    private removeComet(index: number) {
        this.activeComets.splice(index, 1);

        // Reindex remaining comets
        for (let i = 0; i < this.activeComets.length; i++) {
            this.activeComets[i].index = i;
        }
    }
}
