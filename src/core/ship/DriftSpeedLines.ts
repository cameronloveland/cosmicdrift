import * as THREE from 'three';
import { DRIFT, PHYSICS } from '../constants';
import { Ship } from './Ship';
import { Track } from '../Track';

export class DriftSpeedLines {
	public root = new THREE.Group();
	private ship: Ship;
	private track: Track;
	private dirSign: number;
	private imesh: THREE.InstancedMesh;
	private max: number;
	private tmpObj = new THREE.Object3D();
	private tmpNormal = new THREE.Vector3();
	private tmpBinormal = new THREE.Vector3();
	private tmpTangent = new THREE.Vector3();
	private tmpQuat = new THREE.Quaternion();
	private backDir = new THREE.Vector3();

	// Particle state (pre-allocated)
	private positions: Float32Array;
	private velocities: Float32Array;
	private ages: Float32Array;
	private lifetimes: Float32Array;
	private lengths: Float32Array;

	private spawnAccumulator = 0;
	private nextIndex = 0; // ring buffer writer

	constructor(ship: Ship, track: Track, opts?: { useTrackForward?: boolean }) {
		this.ship = ship;
		this.track = track;
		// In-race: we want backward relative to travel => -tangent (default)
		// ShipViewer mini track uses tangent opposite the ship facing; use +tangent there.
		this.dirSign = opts?.useTrackForward ? 1 : -1;
		this.max = DRIFT.speedLines.maxCount;

		// Geometry: thin open cylinder oriented along +Y; we'll rotate to -forward.
		const geo = new THREE.CylinderGeometry(DRIFT.speedLines.width, DRIFT.speedLines.width, 1, 6, 1, true);
		const mat = new THREE.MeshBasicMaterial({
			color: ship.getColor().clone().multiplyScalar(1.2),
			transparent: true,
			opacity: DRIFT.speedLines.opacity,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false
		});
		this.imesh = new THREE.InstancedMesh(geo, mat, this.max);
		this.imesh.frustumCulled = false;
		this.imesh.renderOrder = 999;
		this.root.add(this.imesh);

		// Allocate state arrays
		this.positions = new Float32Array(this.max * 3);
		this.velocities = new Float32Array(this.max * 3);
		this.ages = new Float32Array(this.max);
		this.lifetimes = new Float32Array(this.max);
		this.lengths = new Float32Array(this.max);

		// Start all dead
		for (let i = 0; i < this.max; i++) {
			this.ages[i] = 1e9;
			this.lifetimes[i] = 0;
			// initialize matrices so nothing flickers on first frame
			this.tmpObj.position.set(0, -9999, 0);
			this.tmpObj.scale.set(1, 0.0001, 1);
			this.tmpObj.updateMatrix();
			this.imesh.setMatrixAt(i, this.tmpObj.matrix);
		}
		this.imesh.count = 0;
		this.imesh.instanceMatrix.needsUpdate = true;
	}

	update(dt: number) {
		const isDrifting = this.ship.state.isDrifting;
		// Always age out existing lines; only spawn when drifting
		this.root.visible = isDrifting || this.imesh.count > 0;
		this.imesh.visible = this.root.visible;

		// Compute Frenet frame at current t so lines track the track direction (like drift trail)
		this.track.getFrenetFrame(this.ship.state.t, this.tmpNormal, this.tmpBinormal, this.tmpTangent);
		// Backward/forward along track (sign controlled by constructor)
		this.backDir.copy(this.tmpTangent).multiplyScalar(this.dirSign).normalize();
		this.tmpQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.backDir);

		// Spawn rate scales with speed
		if (isDrifting) {
			const speedRatio = THREE.MathUtils.clamp(this.ship.state.speedKmh / PHYSICS.maxSpeed, 0, 1);
			const spawnRate = DRIFT.speedLines.spawnRateBase * (0.35 + 0.65 * speedRatio);
			this.spawnAccumulator += spawnRate * dt;
			while (this.spawnAccumulator >= 1) {
				this.spawnOne();
				this.spawnAccumulator -= 1;
			}
		} else {
			// Decay accumulator when not drifting to avoid burst on next start
			this.spawnAccumulator = 0;
		}

		// Integrate and write visible instances contiguously
		let visible = 0;
		const max = this.max;
		for (let i = 0; i < max; i++) {
			const age = this.ages[i];
			const life = this.lifetimes[i];
			if (age >= life) continue;

			// Age
			const newAge = age + dt;
			this.ages[i] = newAge;
			const t = THREE.MathUtils.clamp(1 - newAge / life, 0, 1);

			// Integrate position
			const idx = i * 3;
			this.positions[idx + 0] += this.velocities[idx + 0] * dt;
			this.positions[idx + 1] += this.velocities[idx + 1] * dt;
			this.positions[idx + 2] += this.velocities[idx + 2] * dt;

			// Light velocity damping for nicer taper
			this.velocities[idx + 0] *= 0.98;
			this.velocities[idx + 1] *= 0.98;
			this.velocities[idx + 2] *= 0.98;

			// Build instance transform
			this.tmpObj.position.set(
				this.positions[idx + 0],
				this.positions[idx + 1],
				this.positions[idx + 2]
			);
			this.tmpObj.quaternion.copy(this.tmpQuat);
			// Scale Y to length; fade over time
			const length = this.lengths[i] * (0.4 + 0.6 * t);
			this.tmpObj.scale.set(1, length, 1);
			this.tmpObj.updateMatrix();
			this.imesh.setMatrixAt(visible, this.tmpObj.matrix);
			visible++;
			if (visible >= max) break;
		}

		this.imesh.count = visible;
		this.imesh.instanceMatrix.needsUpdate = true;
	}

	private spawnOne() {
		const i = this.nextIndex;
		this.nextIndex = (this.nextIndex + 1) % this.max;

		// Base spawn around ship center in binormal/normal plane with slight along-track scatter
		const binormalJitter = (Math.random() * 2 - 1) * DRIFT.speedLines.spawnRadiusRight;
		const normalJitter = (Math.random() * 2 - 1) * DRIFT.speedLines.spawnRadiusUp;
		const alongOffset = -0.2 + Math.random() * 0.4; // small fore/aft scatter

		const spawnPos = new THREE.Vector3()
			.copy(this.ship.root.position)
			.addScaledVector(this.tmpBinormal, binormalJitter)
			.addScaledVector(this.tmpNormal, normalJitter)
			.addScaledVector(this.backDir, alongOffset); // scatter along track direction

		const idx = i * 3;
		this.positions[idx + 0] = spawnPos.x;
		this.positions[idx + 1] = spawnPos.y;
		this.positions[idx + 2] = spawnPos.z;

		// Move mostly backward along track (with tiny lateral/vertical burst outward)
		const backSpeed = (this.ship.state.speedKmh / 3.6) * (0.9 + Math.random() * 0.6);
		const lateral = 0.6 * (Math.random() * 2 - 1);
		const vertical = 0.3 * (Math.random() * 2 - 1);

		const vx = this.backDir.x * backSpeed + this.tmpBinormal.x * lateral + this.tmpNormal.x * vertical;
		const vy = this.backDir.y * backSpeed + this.tmpBinormal.y * lateral + this.tmpNormal.y * vertical;
		const vz = this.backDir.z * backSpeed + this.tmpBinormal.z * lateral + this.tmpNormal.z * vertical;
		this.velocities[idx + 0] = vx;
		this.velocities[idx + 1] = vy;
		this.velocities[idx + 2] = vz;

		this.ages[i] = 0;
		this.lifetimes[i] = DRIFT.speedLines.lifetime * (0.8 + Math.random() * 0.5);
		this.lengths[i] = THREE.MathUtils.lerp(DRIFT.speedLines.lengthMin, DRIFT.speedLines.lengthMax, Math.random());
	}
}


