import * as THREE from 'three';
import { Ship } from './Ship';
import { Track } from './Track';

export class ShipSpeedStars {
    public root = new THREE.Group();
    private ship: Ship;
    private imesh: THREE.InstancedMesh;
    private max = 300; // Increased from 160 to fill larger space
    private tmpObj = new THREE.Object3D();
    private velocities: Float32Array;
    private colors: THREE.Color[];
    private radiusInner = 8.0;  // Much larger inner radius
    private radiusOuter = 25.0; // Much larger outer radius
    private lengthBase = 1.2;

    constructor(ship: Ship, track: Track) {
        this.ship = ship;

        const geo = new THREE.CylinderGeometry(0.01, 0.02, 1, 6, 1, true);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false, // CRITICAL FIX: Disable depth test to ensure visibility
            toneMapped: false
        });

        this.imesh = new THREE.InstancedMesh(geo, mat, this.max);
        this.imesh.renderOrder = 999; // Ensure stars render after other objects

        // CRITICAL FIX: Disable frustum culling to prevent intermittent visibility
        // InstancedMesh with dynamic positions can be incorrectly culled
        this.imesh.frustumCulled = false;

        this.velocities = new Float32Array(this.max);
        this.colors = new Array(this.max);
        this.root.add(this.imesh);

        // Initialize all stars
        for (let i = 0; i < this.max; i++) this.respawn(i, true);

        // CRITICAL FIX: Set count immediately - InstancedMesh defaults to count=0 which renders nothing!
        this.imesh.count = this.max;
        this.imesh.instanceMatrix.needsUpdate = true;

        // CRITICAL FIX: Compute bounding volumes for proper rendering
        this.imesh.geometry.computeBoundingSphere();
        this.imesh.geometry.computeBoundingBox();
    }

    update(dt: number) {
        // Only visible when boosting
        const isBoosting = this.ship.state.boosting;
        this.root.visible = isBoosting;
        this.imesh.visible = isBoosting;

        const forward = new THREE.Vector3(0, 0, 1);
        this.ship.root.localToWorld(forward).sub(this.ship.root.position).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.ship.root.quaternion);
        const right = new THREE.Vector3().crossVectors(up, forward).normalize();

        const mps = this.ship.state.speedKmh / 3.6;
        const baseSpeed = Math.max(5, mps * 0.8); // Reduced base speed for more gradual movement

        let activeStars = 0;
        for (let i = 0; i < this.max; i++) {
            const speed = baseSpeed * this.velocities[i];
            // move opposite to forward (towards camera)
            // Get current world position of the star instance
            const pos = new THREE.Vector3();
            this.imesh.getMatrixAt(i, this.tmpObj.matrix); // Retrieve instance matrix for star i
            this.tmpObj.matrix.decompose(pos, this.tmpObj.quaternion, this.tmpObj.scale); // Extract position

            // Move star along the local forward direction by -speed*dt (simulating ship's motion)
            pos.addScaledVector(forward, -speed * dt);

            // Calculate relative vector from ship to star
            const toStar = new THREE.Vector3().subVectors(pos, this.ship.root.position);

            // Project that vector onto the ship's forward axis
            // (A positive value means star is ahead of ship, negative means behind)
            const ahead = toStar.dot(forward);

            // If star is too far behind the ship's current forward position, respawn it ahead
            if (ahead < -60) { // -60 is the cutoff distance behind the ship before respawning
                // DEBUG: Track respawns
                // console.log(`Star ${i} respawning: ahead=${ahead.toFixed(2)}, pos=`, pos);
                this.respawn(i, false);
                continue;
            }

            // DEBUG: Validate star position
            if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
                console.warn(`Star ${i} has invalid position!`, pos);
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

        // CRITICAL FIX: Always maintain count at max
        // InstancedMesh requires count to be set - if it drops to 0, nothing renders
        this.imesh.count = this.max;
        this.imesh.instanceMatrix.needsUpdate = true;
    }

    private respawn(i: number, initial: boolean) {
        // Always use ship-relative positioning for continuous visibility
        const forward = new THREE.Vector3(0, 0, 1);
        this.ship.root.localToWorld(forward).sub(this.ship.root.position).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.ship.root.quaternion);
        const right = new THREE.Vector3().crossVectors(up, forward).normalize();

        const r = THREE.MathUtils.lerp(this.radiusInner, this.radiusOuter, Math.random());
        const ang = Math.random() * Math.PI * 20;
        const radial = new THREE.Vector3().copy(right).multiplyScalar(Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r);

        // Always spawn ahead of the ship to prevent wave behavior
        const ahead = initial
            ? Math.random() * 100        // 0 to +100 for initial spawn
            : 20 + Math.random() * 130;  // +20 to +150 for respawn (always ahead)

        const pos = new THREE.Vector3().copy(this.ship.root.position).add(radial).addScaledVector(forward, ahead);

        this.tmpObj.position.copy(pos);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
        this.tmpObj.quaternion.copy(q);
        this.tmpObj.scale.set(1, this.lengthBase, 1);
        this.tmpObj.updateMatrix();
        this.imesh.setMatrixAt(i, this.tmpObj.matrix);

        // store velocity and color - wider range for more variation
        this.velocities[i] = 0.3 + Math.random() * 2.3; // 0.3 to 2.3 range
        const c = new THREE.Color().setHSL(0.13 + Math.random() * 0.06, 0.8, 0.65);
        this.colors[i] = c;
        (this.imesh.material as THREE.MeshBasicMaterial).color = new THREE.Color(1, 1, 1);
    }

    public getStarStats(): { ahead: number; behind: number; distant: number; total: number } {
        let ahead = 0;
        let behind = 0;
        let distant = 0;
        const forward = new THREE.Vector3(0, 0, 1);
        this.ship.root.localToWorld(forward).sub(this.ship.root.position).normalize();

        for (let i = 0; i < this.max; i++) {
            const pos = new THREE.Vector3();
            this.imesh.getMatrixAt(i, this.tmpObj.matrix);
            this.tmpObj.matrix.decompose(pos, this.tmpObj.quaternion, this.tmpObj.scale);

            const toStar = new THREE.Vector3().subVectors(pos, this.ship.root.position);
            const aheadDist = toStar.dot(forward);
            const distance = toStar.length();

            // More realistic visibility range - stars within reasonable viewing distance
            // Stars need to be within 200 units distance and within 50 units to the sides
            const sideDistance = Math.sqrt(toStar.x * toStar.x + toStar.y * toStar.y);
            const isVisible = distance < 200 && sideDistance < 50;

            if (isVisible) {
                if (aheadDist > 0) {
                    ahead++;
                } else {
                    behind++;
                }
            } else {
                distant++;
            }
        }

        return { ahead, behind, distant, total: this.max };
    }
}


