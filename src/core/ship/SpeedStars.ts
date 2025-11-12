import * as THREE from 'three';
import { Ship } from './Ship';
import { Track } from '../Track';
import { PHYSICS } from '../constants';

export class ShipSpeedStars {
    public root = new THREE.Group();
    private ship: Ship;
    private track: Track;
    private imesh: THREE.InstancedMesh;
    private max = 160;
    private tmpObj = new THREE.Object3D();
    private velocities: Float32Array;
    private offsets: Float32Array; // radial offsets
    private colors: THREE.Color[];
    private radiusInner = 1.2;
    private radiusOuter = 2.6;
    private lengthBase = 1.2;

    constructor(ship: Ship, track: Track) {
        this.ship = ship;
        this.track = track;
        const geo = new THREE.CylinderGeometry(0.01, 0.02, 1, 6, 1, true);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        this.imesh = new THREE.InstancedMesh(geo, mat, this.max);
        this.imesh.renderOrder = 999; // Ensure stars render after other objects

        // Initialize instanceColor attribute for proper rendering
        this.imesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);

        this.velocities = new Float32Array(this.max);
        this.offsets = new Float32Array(this.max);
        this.colors = new Array(this.max);
        this.root.add(this.imesh);

        // Initialize all stars with valid positions
        for (let i = 0; i < this.max; i++) this.respawn(i, true);

        // Force bounds update
        this.imesh.geometry.computeBoundingSphere();
        this.imesh.geometry.computeBoundingBox();
        this.imesh.instanceMatrix.needsUpdate = true;
    }

    update(dt: number) {
        // Always visible - simple approach
        this.root.visible = true;

        const forward = new THREE.Vector3(0, 0, 1);
        this.ship.root.localToWorld(forward).sub(this.ship.root.position).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.ship.root.quaternion);
        const right = new THREE.Vector3().crossVectors(up, forward).normalize();

        const mps = this.ship.state.speedKmh / 3.6;
        const baseSpeed = Math.max(10, mps * 1.5);

        let activeStars = 0;
        for (let i = 0; i < this.max; i++) {
            const speed = baseSpeed * this.velocities[i];
            // move opposite to forward (towards camera)
            const pos = new THREE.Vector3();
            this.imesh.getMatrixAt(i, this.tmpObj.matrix);
            this.tmpObj.matrix.decompose(pos, this.tmpObj.quaternion, this.tmpObj.scale);
            pos.addScaledVector(forward, -speed * dt);

            // if too far behind ship, respawn ahead
            const toStar = new THREE.Vector3().subVectors(pos, this.ship.root.position);
            const ahead = toStar.dot(forward);
            if (ahead < -6) {
                this.respawn(i, false);
                continue;
            }

            this.tmpObj.position.copy(pos);
            // orient elongated along forward
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
            this.tmpObj.quaternion.copy(q);
            const len = this.lengthBase * (0.6 + 0.4 * this.velocities[i]) * (0.8 + 0.4 * (mps / 80));
            this.tmpObj.scale.set(1, len, 1);
            this.tmpObj.updateMatrix();
            this.imesh.setMatrixAt(i, this.tmpObj.matrix);
            activeStars++;
        }
        this.imesh.instanceMatrix.needsUpdate = true;

        // Force bounds update for consistent rendering
        this.imesh.geometry.computeBoundingSphere();
        this.imesh.geometry.computeBoundingBox();
    }

    private respawn(i: number, initial: boolean) {
        const forward = new THREE.Vector3(0, 0, 1);
        this.ship.root.localToWorld(forward).sub(this.ship.root.position).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.ship.root.quaternion);
        const right = new THREE.Vector3().crossVectors(up, forward).normalize();

        const r = THREE.MathUtils.lerp(this.radiusInner, this.radiusOuter, Math.random());
        const ang = Math.random() * Math.PI * 2;
        const radial = new THREE.Vector3().copy(right).multiplyScalar(Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r);
        const ahead = initial ? Math.random() * 6 : (2 + Math.random() * 6);
        const pos = new THREE.Vector3().copy(this.ship.root.position).add(radial).addScaledVector(forward, ahead);

        this.tmpObj.position.copy(pos);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
        this.tmpObj.quaternion.copy(q);
        this.tmpObj.scale.set(1, this.lengthBase, 1);
        this.tmpObj.updateMatrix();
        this.imesh.setMatrixAt(i, this.tmpObj.matrix);

        // store velocity and color
        this.velocities[i] = 0.7 + Math.random() * 1.2;
        const c = new THREE.Color().setHSL(0.13 + Math.random() * 0.06, 0.8, 0.65);
        this.colors[i] = c;
        (this.imesh.material as THREE.MeshBasicMaterial).color = new THREE.Color(1, 1, 1);
    }
}


