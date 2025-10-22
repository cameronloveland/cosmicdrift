import * as THREE from 'three';
import { Ship } from './Ship';
import { PHYSICS } from './constants';

export class ShipBoost {
    public root = new THREE.Group();
    private ship: Ship;
    private imesh!: THREE.InstancedMesh;
    private max = 120;
    private cursor = 0;
    private tmpObj = new THREE.Object3D();
    private colors!: Float32Array;

    constructor(ship: Ship) {
        this.ship = ship;
        const geo = new THREE.CylinderGeometry(2.12, 0.04, 0.5, 6, 1, true);
        const mat = new THREE.MeshBasicMaterial({ color: 0x53d7ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        this.imesh = new THREE.InstancedMesh(geo, mat, this.max);
        this.colors = new Float32Array(this.max * 3);
        this.root.add(this.imesh);
    }

    update(dt: number) {
        // Manual boost particle effect - only emit when ship is actively boosting
        const baseRate = 180;
        let ratePerSec = 0;

        if (this.ship.state.boosting) {
            ratePerSec = baseRate;
        }

        // Increase particle rate dramatically when in tunnel
        if (this.ship.state.inTunnel) {
            ratePerSec = Math.max(ratePerSec, baseRate * 2.5);
        }

        if (ratePerSec === 0) return;

        const count = Math.floor(ratePerSec * dt);
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

        // Vary particle colors: cyan/magenta gradient in tunnels, cyan when boosting
        let color: THREE.Color;
        if (this.ship.state.inTunnel) {
            // Mix cyan and magenta for tunnel particles
            const mix = Math.random();
            if (mix > 0.5) {
                // Cyan
                color = new THREE.Color(0.2, 0.7 + 0.3 * Math.random(), 1);
            } else {
                // Magenta tint
                color = new THREE.Color(1, 0.2, 0.7 + 0.3 * Math.random());
            }
        } else {
            // Manual boost particles (cyan trail)
            const c = 0.7 + 0.3 * Math.random();
            color = new THREE.Color(0.2, c, 1);
        }

        this.imesh.setColorAt(i, color);
        this.imesh.instanceMatrix.needsUpdate = true;
        (this.imesh.instanceColor as any).needsUpdate = true;
    }
}


