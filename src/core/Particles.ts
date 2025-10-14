import * as THREE from 'three';
import { Ship } from './Ship';

export class Particles {
    public root = new THREE.Group();
    private ship: Ship;
    private imesh!: THREE.InstancedMesh;
    private max = 120;
    private cursor = 0;
    private tmpObj = new THREE.Object3D();
    private colors!: Float32Array;

    constructor(ship: Ship) {
        this.ship = ship;
        const geo = new THREE.CylinderGeometry(0.02, 0.04, 0.5, 6, 1, true);
        const mat = new THREE.MeshBasicMaterial({ color: 0x53d7ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        this.imesh = new THREE.InstancedMesh(geo, mat, this.max);
        this.colors = new Float32Array(this.max * 3);
        this.root.add(this.imesh);
    }

    update(dt: number) {
        // spawn rate scales with speed
        const rate = THREE.MathUtils.clamp((this.ship.state.speedKmh - 50) / 200, 0, 1) * 80;
        const count = Math.floor(rate * dt * 10);
        for (let i = 0; i < count; i++) this.spawn();
    }

    private spawn() {
        const i = this.cursor++ % this.max;
        const base = this.ship.root.position;
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.root.quaternion);
        this.tmpObj.position.copy(base).addScaledVector(dir, -0.8);
        this.tmpObj.quaternion.copy(this.ship.root.quaternion);
        this.tmpObj.scale.setScalar(0.6 + Math.random() * 0.8);
        this.tmpObj.updateMatrix();
        this.imesh.setMatrixAt(i, this.tmpObj.matrix);
        const c = 0.7 + 0.3 * Math.random();
        this.imesh.setColorAt(i, new THREE.Color(0.2, c, 1));
        this.imesh.instanceMatrix.needsUpdate = true;
        (this.imesh.instanceColor as any).needsUpdate = true;
    }
}


