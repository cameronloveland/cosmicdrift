import * as THREE from 'three';
import { DRIFT } from './constants';
import type { ShipState } from './types';
import type { Track } from './Track';

interface RibbonPoint {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    binormal: THREE.Vector3;
    age: number; // seconds since creation
    t: number; // track position
    halfWidth: number; // half-width at creation time
}

export class DriftTrail {
    public root = new THREE.Group();
    private track: Track;
    private color: THREE.Color;
    private points: RibbonPoint[] = [];
    private geometry: THREE.BufferGeometry;
    private material: THREE.MeshBasicMaterial;
    private mesh: THREE.Mesh;
    private maxPoints: number;
    private lastShipT: number = -1; // last sampled track position
    private baseHalfWidth: number;
    private posBuffer: Float32Array;
    private colorBuffer: Float32Array;
    private indexBuffer: Uint32Array;
	private _tmpL = new THREE.Vector3();
	private _tmpR = new THREE.Vector3();
    private lastOffset = 0;

    // Spark particle system
    private sparkPositions: Float32Array;
    private sparkColors: Float32Array;
    private sparkVelocities: Float32Array;
    private sparkAges: Float32Array;
    private sparkLifetimes: Float32Array;
    private sparkPoints: THREE.Points;
    private sparkGeometry: THREE.BufferGeometry;
    private sparkMaterial: THREE.PointsMaterial;
    private sparkMax: number;
    private sparkIndex = 0;
    private sparkSpawnAcc = 0;
    private _tmpPos = new THREE.Vector3();
    private _tmpN = new THREE.Vector3();
    private _tmpB = new THREE.Vector3();
    private _tmpT = new THREE.Vector3();

    constructor(track: Track, color: THREE.Color) {
        this.track = track;
        this.color = color.clone();
        this.maxPoints = DRIFT.trailMaxSegments; // reuse existing limit
        this.baseHalfWidth = (track.width * (DRIFT.ribbonWidthRatio ?? 0.18) * (DRIFT.ribbonWidthScale ?? 1.0)) * 0.5;

        // Allocate buffers for a triangle strip (2 verts per point)
        const maxVerts = this.maxPoints * 2;
        const maxQuads = Math.max(0, this.maxPoints - 1);
        this.posBuffer = new Float32Array(maxVerts * 3);
        this.colorBuffer = new Float32Array(maxVerts * 3); // RGB per vertex (use brightness as opacity proxy)
        this.indexBuffer = new Uint32Array(maxQuads * 6);

        // Precompute indices for max quads
        for (let i = 0; i < maxQuads; i++) {
            const a = i * 2;
            const b = a + 1;
            const c = a + 2;
            const d = a + 3;
            const base = i * 6;
            this.indexBuffer[base] = a;
            this.indexBuffer[base + 1] = b;
            this.indexBuffer[base + 2] = c;
            this.indexBuffer[base + 3] = b;
            this.indexBuffer[base + 4] = d;
            this.indexBuffer[base + 5] = c;
        }

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.posBuffer, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colorBuffer, 3));
        this.geometry.setIndex(new THREE.BufferAttribute(this.indexBuffer, 1));
        this.geometry.setDrawRange(0, 0);

        this.material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 998; // render above track, below line trails
        this.root.add(this.mesh);

        // --- Sparks ---
        this.sparkMax = DRIFT.sparkMaxCount ?? 400;
        this.sparkPositions = new Float32Array(this.sparkMax * 3);
        this.sparkColors = new Float32Array(this.sparkMax * 3);
        this.sparkVelocities = new Float32Array(this.sparkMax * 3);
        this.sparkAges = new Float32Array(this.sparkMax);
        this.sparkLifetimes = new Float32Array(this.sparkMax);
        for (let i = 0; i < this.sparkMax; i++) {
            this.sparkAges[i] = 1e9; // start dead
            this.sparkLifetimes[i] = DRIFT.sparkLifetime ?? 0.35;
            // initial color set to pink-ish; intensity per-frame
            this.sparkColors[i * 3 + 0] = this.color.r;
            this.sparkColors[i * 3 + 1] = this.color.g;
            this.sparkColors[i * 3 + 2] = this.color.b;
        }

        this.sparkGeometry = new THREE.BufferGeometry();
        this.sparkGeometry.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
        this.sparkGeometry.setAttribute('color', new THREE.BufferAttribute(this.sparkColors, 3));
        this.sparkMaterial = new THREE.PointsMaterial({
            size: DRIFT.sparkSize ?? 0.06,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.95,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        this.sparkPoints = new THREE.Points(this.sparkGeometry, this.sparkMaterial);
        this.sparkPoints.frustumCulled = false;
        this.sparkPoints.renderOrder = 999;
        this.root.add(this.sparkPoints);
    }

    public update(dt: number, shipState: ShipState) {
        // Add new points only while drifting; always age and fade existing
        if (shipState.isDrifting) {
            const t = THREE.MathUtils.euclideanModulo(shipState.t, 1);
            const needFirst = this.points.length === 0 || this.lastShipT < 0;
            const movedEnough = !needFirst && Math.abs(t - this.lastShipT) > (DRIFT.trailSegmentLength / this.track.length);

            if (needFirst || movedEnough) {
                const pos = new THREE.Vector3();
                const normal = new THREE.Vector3();
                const binormal = new THREE.Vector3();
                const tangent = new THREE.Vector3();


				this.track.getPointAtT(t, pos);
				this.track.getFrenetFrame(t, normal, binormal, tangent);

				// Center ribbon under the ship (apply lateral offset) and lift slightly
				pos.addScaledVector(binormal, shipState.lateralOffset);
				pos.addScaledVector(normal, 0.02);

                // Dynamic width based on lateral turning speed
                const dtSafe = Math.max(1e-4, dt);
                const turnSpeed = Math.abs(shipState.lateralOffset - this.lastOffset) / dtSafe; // m/s sideways
                const minAt = DRIFT.ribbonTurnSpeedForMin ?? 8.0;
                const turnRatio = THREE.MathUtils.clamp(turnSpeed / minAt, 0, 1);
                const widthFactor = THREE.MathUtils.lerp(1.0, (DRIFT.ribbonMinWidthFactor ?? 0.55), turnRatio);
                const halfWidth = this.baseHalfWidth * widthFactor;

                // Newest at the front
                this.points.unshift({
                    position: pos.clone(),
                    normal: normal.clone(),
                    binormal: binormal.clone(),
                    age: 0,
                    t,
                    halfWidth
                });

                // Cap length
                if (this.points.length > this.maxPoints) this.points.pop();
                this.lastShipT = t;
                this.lastOffset = shipState.lateralOffset;
            }
        } else {
            // When not drifting, allow trail to fade out naturally
            this.lastShipT = -1;
        }

        // Age and prune
        for (let i = this.points.length - 1; i >= 0; i--) {
            const p = this.points[i];
            p.age += dt;
            if (p.age >= DRIFT.trailFadeTime) this.points.splice(i, 1);
        }

        this.updateGeometry();

        // Update and spawn sparks
        this.updateSparks(dt, shipState);
    }

    private updateGeometry() {
        const count = this.points.length;
        if (count === 0) {
            this.geometry.setDrawRange(0, 0);
            return;
        }

        // Build vertices (two per point: left and right across track width)
        const color = this.color.clone();
        const glow = DRIFT.trailGlowIntensity;

		for (let i = 0; i < count; i++) {
            const p = this.points[i];
            const center = p.position;
            const bin = p.binormal;
            const up = p.normal;

			const w = p.halfWidth;
			const left = this._tmpL.copy(center).addScaledVector(bin, -w).addScaledVector(up, 0);
			const right = this._tmpR.copy(center).addScaledVector(bin, w).addScaledVector(up, 0);

            const vi = i * 2;
            // left vertex
            this.posBuffer[vi * 3 + 0] = left.x;
            this.posBuffer[vi * 3 + 1] = left.y;
            this.posBuffer[vi * 3 + 2] = left.z;
            // right vertex
            this.posBuffer[(vi + 1) * 3 + 0] = right.x;
            this.posBuffer[(vi + 1) * 3 + 1] = right.y;
            this.posBuffer[(vi + 1) * 3 + 2] = right.z;

            // Intensity fades with age and along the ribbon tail
            const ageFactor = Math.max(0, 1 - (p.age / DRIFT.trailFadeTime));
            const tailFactor = (count > 1) ? (1 - i / (count - 1)) : 1;
            const intensity = ageFactor * tailFactor * glow;

            const r = color.r * intensity;
            const g = color.g * intensity;
            const b = color.b * intensity;

            // left color
            this.colorBuffer[vi * 3 + 0] = r;
            this.colorBuffer[vi * 3 + 1] = g;
            this.colorBuffer[vi * 3 + 2] = b;
            // right color
            this.colorBuffer[(vi + 1) * 3 + 0] = r;
            this.colorBuffer[(vi + 1) * 3 + 1] = g;
            this.colorBuffer[(vi + 1) * 3 + 2] = b;
        }

        // Update attributes
        const vertCount = count * 2;
        const quadCount = Math.max(0, count - 1);
        const indexCount = quadCount * 6;

        (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
        this.geometry.computeBoundingSphere();
        this.geometry.computeBoundingBox();
        this.geometry.setDrawRange(0, indexCount);
    }

    private spawnSpark(at: THREE.Vector3, normal: THREE.Vector3, binormal: THREE.Vector3, tangent: THREE.Vector3, halfWidth: number) {
        const i = this.sparkIndex;
        this.sparkIndex = (this.sparkIndex + 1) % this.sparkMax;

        // Position: near ribbon centerline with slight across-track jitter
        const lateral = (Math.random() * 2 - 1) * halfWidth;
        const pos = this._tmpPos.copy(at).addScaledVector(binormal, lateral).addScaledVector(normal, 0.02);

        this.sparkPositions[i * 3 + 0] = pos.x;
        this.sparkPositions[i * 3 + 1] = pos.y;
        this.sparkPositions[i * 3 + 2] = pos.z;

        // Velocity: upward + small lateral + small forward
        const vUp = (DRIFT.sparkUpwardSpeed ?? 1.6) * (0.8 + Math.random() * 0.4);
        const vLat = (DRIFT.sparkLateralSpeed ?? 1.2) * (Math.random() * 2 - 1);
        const vFwd = (DRIFT.sparkForwardSpeed ?? 0.6) * (0.5 + Math.random() * 0.8);

        const vx = normal.x * vUp + binormal.x * vLat + tangent.x * vFwd;
        const vy = normal.y * vUp + binormal.y * vLat + tangent.y * vFwd;
        const vz = normal.z * vUp + binormal.z * vLat + tangent.z * vFwd;

        this.sparkVelocities[i * 3 + 0] = vx;
        this.sparkVelocities[i * 3 + 1] = vy;
        this.sparkVelocities[i * 3 + 2] = vz;

        this.sparkAges[i] = 0;
        this.sparkLifetimes[i] = DRIFT.sparkLifetime ?? 0.35;
    }

    private updateSparks(dt: number, shipState: ShipState) {
        // Integrate existing sparks
        let anyAlive = false;
        for (let i = 0; i < this.sparkMax; i++) {
            const age = this.sparkAges[i];
            const life = this.sparkLifetimes[i];
            if (age >= life) continue;
            anyAlive = true;
            const t = Math.max(0, Math.min(1, 1 - age / life));
            // Fade via vertex color intensity using per-ship color
            const r = this.color.r * t * 1.4;
            const g = this.color.g * t * 1.1;
            const b = this.color.b * t * 1.4;
            this.sparkColors[i * 3 + 0] = r;
            this.sparkColors[i * 3 + 1] = g;
            this.sparkColors[i * 3 + 2] = b;

            // Simple integration (no gravity for crisp sparks)
            const vx = this.sparkVelocities[i * 3 + 0];
            const vy = this.sparkVelocities[i * 3 + 1];
            const vz = this.sparkVelocities[i * 3 + 2];
            this.sparkPositions[i * 3 + 0] += vx * dt;
            this.sparkPositions[i * 3 + 1] += vy * dt;
            this.sparkPositions[i * 3 + 2] += vz * dt;

            // Light damping
            this.sparkVelocities[i * 3 + 0] *= 0.96;
            this.sparkVelocities[i * 3 + 1] *= 0.96;
            this.sparkVelocities[i * 3 + 2] *= 0.96;

            this.sparkAges[i] = age + dt;
        }

        if (anyAlive) {
            (this.sparkGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
            (this.sparkGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
        }

        // Spawn new sparks near newest ribbon point while drifting
        if (!shipState.isDrifting) return;
        const spawnRate = DRIFT.sparkSpawnRate ?? 140;
        this.sparkSpawnAcc += spawnRate * dt;
        if (this.points.length === 0) return;

        // Use newest point as emission reference
        const p0 = this.points[0];
        const at = p0.position;
        const n = p0.normal;
        const b = p0.binormal;
        // Recover tangent from cross(n, b)
        const tVec = this._tmpT.copy(b).cross(n).normalize();

        while (this.sparkSpawnAcc >= 1) {
            this.spawnSpark(at, n, b, tVec, p0.halfWidth ?? this.baseHalfWidth);
            this.sparkSpawnAcc -= 1;
        }
    }

    public dispose() {
        this.geometry.dispose();
        this.material.dispose();
        this.root.remove(this.mesh);
    }
}


