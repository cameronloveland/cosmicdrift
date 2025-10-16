import * as THREE from 'three';
import { Line2 } from 'three-stdlib';
import { LineMaterial } from 'three-stdlib';
import { LineGeometry } from 'three-stdlib';
import { COLORS, TRACK_OPTS, TRACK_SOURCE, CUSTOM_TRACK_POINTS, BOOSTER_SPACING_METERS, BOOSTER_COLOR } from './constants';
import type { TrackOptions, TrackSample } from './types';

function mulberry32(seed: number) {
    let t = seed >>> 0;
    return function () {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

export class Track {
    public root = new THREE.Group();
    public curve!: THREE.CatmullRomCurve3;
    public length = 0;
    public width = TRACK_OPTS.width;
    public boundingRadius = 2000;

    private boosterTs: number[] = [];
    private boosters?: THREE.InstancedMesh;

    private railMaterials: LineMaterial[] = [];
    private opts: TrackOptions = TRACK_OPTS;

    // sampled frames cache
    private samples = this.opts.samples;
    private cachedPositions: THREE.Vector3[] = [];
    private cachedTangents: THREE.Vector3[] = [];
    private cachedNormals: THREE.Vector3[] = [];
    private cachedBinormals: THREE.Vector3[] = [];
    private cachedBank: number[] = [];

    constructor() {
        this.generate(TRACK_OPTS, TRACK_SOURCE);
    }

    public generate(opts: TrackOptions, source: 'procedural' | 'custom') {
        this.opts = opts;
        this.width = opts.width;
        this.samples = opts.samples;
        const controls =
            (source === 'custom' && CUSTOM_TRACK_POINTS.length > 3)
                ? CUSTOM_TRACK_POINTS
                : this.makeControlPoints(opts);
        // Use centripetal Catmull-Rom to avoid overshooting/self-intersections
        this.curve = new THREE.CatmullRomCurve3(controls, true, 'centripetal');
        // Increase arc length precision to remove quantization artifacts
        this.curve.arcLengthDivisions = Math.max(200, this.samples * 4);
        this.length = this.curve.getLength();

        this.precomputeFramesAndBank();
        this.boundingRadius = this.computeBoundingRadius();

        this.buildGeometry();
        this.buildRails();
        this.buildMarkers();
        this.buildStartLine();
        this.buildBoosters(BOOSTER_SPACING_METERS);
    }

    private makeControlPoints(opts: TrackOptions): THREE.Vector3[] {
        const rnd = mulberry32(opts.seed);
        const pts: THREE.Vector3[] = [];
        const n = opts.controlPointCount;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const jitter = (rnd() - 0.5) * 0.3; // reduce jitter to limit sharp pivots
            const r = THREE.MathUtils.lerp(opts.radiusMin, opts.radiusMax, rnd());
            const x = Math.cos(a + jitter) * r;
            const z = Math.sin(a + jitter) * r;
            const elev = (Math.sin(a * 0.5 + rnd() * 2.0) + Math.sin(a * 0.23 + rnd() * 4.0) * 0.5) * opts.elevationAmplitude * 0.5;
            const y = elev;
            const p = new THREE.Vector3(x, y, z);
            // enforce minimum chord length to avoid nearly coincident points
            const last = pts.length > 0 ? pts[pts.length - 1] : null;
            if (!last || last.distanceToSquared(p) >= opts.minChord * opts.minChord) {
                pts.push(p);
            }
        }
        // Chaikin-style smoothing passes for a closed loop
        const passes = Math.max(0, Math.floor(opts.controlPointSmoothPasses));
        let out = pts;
        for (let pass = 0; pass < passes; pass++) {
            const next: THREE.Vector3[] = [];
            for (let i = 0; i < out.length; i++) {
                const a = out[i];
                const b = out[(i + 1) % out.length];
                // Q = 0.75*a + 0.25*b, R = 0.25*a + 0.75*b
                next.push(new THREE.Vector3(
                    a.x * 0.75 + b.x * 0.25,
                    a.y * 0.75 + b.y * 0.25,
                    a.z * 0.75 + b.z * 0.25
                ));
                next.push(new THREE.Vector3(
                    a.x * 0.25 + b.x * 0.75,
                    a.y * 0.25 + b.y * 0.75,
                    a.z * 0.25 + b.z * 0.75
                ));
            }
            out = next;
        }
        return out;
    }

    private precomputeFramesAndBank() {
        this.cachedPositions = new Array(this.samples);
        this.cachedTangents = new Array(this.samples);
        this.cachedNormals = new Array(this.samples);
        this.cachedBinormals = new Array(this.samples);
        this.cachedBank = new Array(this.samples);

        const tmpPrevTangent = new THREE.Vector3();
        const tmpNormal = new THREE.Vector3(0, 1, 0);
        const tmpBinormal = new THREE.Vector3();
        const tmp = new THREE.Vector3();

        for (let i = 0; i < this.samples; i++) {
            const t = i / this.samples;
            const pos = this.curve.getPointAt(t);
            const tan = this.curve.getTangentAt(t).normalize();
            if (i === 0) tmpPrevTangent.copy(tan);

            // Parallel transport: adjust normal to stay perpendicular and smooth
            // project previous normal onto plane perpendicular to current tangent
            tmp.copy(tmpNormal).sub(tan.clone().multiplyScalar(tmpNormal.dot(tan))).normalize();
            if (!Number.isFinite(tmp.x)) tmp.set(0, 1, 0);
            tmpNormal.copy(tmp);
            tmpBinormal.copy(tan).cross(tmpNormal).normalize();

            this.cachedPositions[i] = pos;
            this.cachedTangents[i] = tan.clone();
            this.cachedNormals[i] = tmpNormal.clone();
            this.cachedBinormals[i] = tmpBinormal.clone();

            // curvature estimate and banking sign
            const d = new THREE.Vector3().crossVectors(tmpPrevTangent, tan);
            const curveStrength = THREE.MathUtils.clamp(d.length(), 0, this.opts.maxCurvature * 100); // heuristic scale
            const sign = Math.sign(d.y || 0);
            const bank = THREE.MathUtils.degToRad(this.opts.bankMaxDeg) * curveStrength * sign;
            this.cachedBank[i] = bank;
            tmpPrevTangent.copy(tan);
        }

        // Seam continuity: ensure first and last frames align for a closed loop
        const n0 = this.cachedNormals[0].clone();
        const nEnd = this.cachedNormals[this.samples - 1].clone();
        const t0 = this.cachedTangents[0];
        const cross = new THREE.Vector3().crossVectors(n0, nEnd);
        const sign = Math.sign(cross.dot(t0) || 1);
        const angle = Math.atan2(cross.length(), THREE.MathUtils.clamp(n0.dot(nEnd), -1, 1)) * sign;
        for (let i = 0; i < this.samples; i++) {
            const f = i / this.samples;
            const q = new THREE.Quaternion().setFromAxisAngle(this.cachedTangents[i], -angle * f);
            this.cachedNormals[i].applyQuaternion(q);
            this.cachedBinormals[i].applyQuaternion(q);
        }

        // smooth bank angles
        const window = Math.max(4, Math.floor(this.samples * 0.01));
        const smoothed = new Array(this.samples).fill(0);
        for (let i = 0; i < this.samples; i++) {
            let acc = 0, c = 0;
            for (let k = -window; k <= window; k++) {
                const j = (i + k + this.samples) % this.samples;
                acc += this.cachedBank[j];
                c++;
            }
            smoothed[i] = acc / c;
        }
        this.cachedBank = smoothed;

        // apply banking to normals/binormals (rotate around tangent)
        for (let i = 0; i < this.samples; i++) {
            const bank = this.cachedBank[i];
            const q = new THREE.Quaternion().setFromAxisAngle(this.cachedTangents[i], bank);
            this.cachedNormals[i].applyQuaternion(q);
            this.cachedBinormals[i].applyQuaternion(q);
        }
    }

    private computeBoundingRadius(): number {
        let r = 0;
        for (let i = 0; i < this.samples; i++) {
            const p = this.cachedPositions[i];
            r = Math.max(r, p.length());
        }
        // add some margin for width and elevation
        return r + this.width * 4 + this.opts.elevationAmplitude;
    }

    private buildGeometry() {
        // clear old
        this.root.clear();

        const segments = this.samples;
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];

        for (let i = 0; i <= segments; i++) {
            const idx = i % segments;
            const center = this.cachedPositions[idx];
            const binormal = this.cachedBinormals[idx];
            const up = this.cachedNormals[idx];

            const half = this.width * 0.5;
            const left = new THREE.Vector3().copy(center).addScaledVector(binormal, -half);
            const right = new THREE.Vector3().copy(center).addScaledVector(binormal, half);

            positions.push(left.x, left.y, left.z);
            positions.push(right.x, right.y, right.z);

            normals.push(up.x, up.y, up.z);
            normals.push(up.x, up.y, up.z);

            const v = (i / segments) * (this.length / 10);
            uvs.push(0, v);
            uvs.push(1, v);
        }

        for (let i = 0; i < segments; i++) {
            const a = i * 2;
            const b = a + 1;
            const c = a + 2;
            const d = a + 3;
            indices.push(a, b, d, a, d, c);
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geom.setIndex(indices);

        const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0x0e1130),
            roughness: 0.35,
            metalness: 0.05,
            transparent: true,
            opacity: 0.98,
            emissive: COLORS.deepBlue.clone().multiplyScalar(0.25),
            envMapIntensity: 0.4
        });
        const ribbon = new THREE.Mesh(geom, mat);
        ribbon.receiveShadow = true;
        this.root.add(ribbon);
    }

    private buildRails() {
        const railOffset = this.width * 0.5 + 0.1;
        this.addRail(railOffset, COLORS.neonCyan, 3.0);
        this.addRail(-railOffset, COLORS.neonMagenta, 3.0);
    }

    private buildMarkers() {
        // simple neon posts along the track
        const group = new THREE.Group();
        const spacing = this.opts.markerSpacing;
        const count = Math.max(8, Math.floor(this.length / spacing));
        const geom = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0x53d7ff, toneMapped: false });
        for (let i = 0; i < count; i++) {
            const t = (i / count);
            const idx = Math.floor(t * this.samples) % this.samples;
            const pos = this.cachedPositions[idx];
            const up = this.cachedNormals[idx];
            const bin = this.cachedBinormals[idx];
            const side = (i % 2 === 0 ? 1 : -1);
            const p = new THREE.Vector3().copy(pos).addScaledVector(bin, side * (this.width * 0.5 + 0.3)).addScaledVector(up, 0.5);
            const m = new THREE.Mesh(geom, mat);
            m.position.copy(p);
            group.add(m);
        }
        this.root.add(group);
    }

    private buildBoosters(spacingMeters: number) {
        // clear old boosters
        if (this.boosters && this.boosters.parent) this.root.remove(this.boosters);
        this.boosterTs = [];

        const count = Math.max(1, Math.floor(this.length / spacingMeters));
        if (count <= 0) return;

        // Glowing square pads flush with the track surface at center lane
        const quad = new THREE.PlaneGeometry(1, 1);
        const size = this.width * 0.22; // pad spans ~22% of track width
        const len = Math.max(2.0, spacingMeters * 0.10);
        const mat = new THREE.MeshBasicMaterial({ color: BOOSTER_COLOR, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        const imesh = new THREE.InstancedMesh(quad, mat, count);
        const tmpObj = new THREE.Object3D();

        for (let i = 0; i < count; i++) {
            const t = i / count;
            const idx = Math.floor(t * this.samples) % this.samples;
            const pos = this.cachedPositions[idx];
            const up = this.cachedNormals[idx];
            const bin = this.cachedBinormals[idx];
            // Build basis with z=up (quad normal), x across track (binormal), y forward (derived)
            const z = new THREE.Vector3().copy(up).normalize();
            const x = new THREE.Vector3().copy(bin).normalize();
            const y = new THREE.Vector3().crossVectors(z, x).normalize();
            const m = new THREE.Matrix4().makeBasis(x, y, z);
            const q = new THREE.Quaternion().setFromRotationMatrix(m);
            tmpObj.position.copy(pos).addScaledVector(up, 0.015); // slight lift to avoid z-fighting
            tmpObj.quaternion.copy(q);
            // scale quad to desired size (x across track, y along track)
            tmpObj.scale.set(size, len, 1);
            tmpObj.updateMatrix();
            imesh.setMatrixAt(i, tmpObj.matrix);
            this.boosterTs.push(t);
        }
        imesh.instanceMatrix.needsUpdate = true;
        this.boosters = imesh;
        this.root.add(imesh);
    }

    private buildStartLine() {
        // A glowing stripe across the full width at t=0, flush on the ribbon
        const idx = 0;
        const center = this.cachedPositions[idx];
        const up = this.cachedNormals[idx];
        const bin = this.cachedBinormals[idx];
        const stripe = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        const mesh = new THREE.Mesh(stripe, mat);
        // Orient plane so normal==up and x across width
        const z = new THREE.Vector3().copy(up).normalize();
        const x = new THREE.Vector3().copy(bin).normalize();
        const y = new THREE.Vector3().crossVectors(z, x).normalize();
        const m = new THREE.Matrix4().makeBasis(x, y, z);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        mesh.quaternion.copy(q);
        mesh.position.copy(center).addScaledVector(up, 0.016);
        mesh.scale.set(this.width, 1.4, 1); // thin stripe
        this.root.add(mesh);
    }

    private addRail(sideOffset: number, color: THREE.Color, width: number) {
        const positions: number[] = [];
        const maxAngle = this.opts.railMaxAngle;
        for (let i = 0; i < this.samples; i++) {
            const idx = i;
            const next = (i + 1) % this.samples;
            const p0 = this.cachedPositions[idx];
            const p1 = this.cachedPositions[next];
            const b0 = this.cachedBinormals[idx];
            const b1 = this.cachedBinormals[next];
            const t0 = this.cachedTangents[idx];
            const t1 = this.cachedTangents[next];
            const dot = THREE.MathUtils.clamp(t0.dot(t1), -1, 1);
            const ang = Math.acos(dot);
            const steps = Math.max(1, Math.ceil(ang / maxAngle));
            for (let s = 0; s < steps; s++) {
                const u = s / steps;
                const pos = new THREE.Vector3().copy(p0).lerp(p1, u);
                const bin = new THREE.Vector3().copy(b0).lerp(b1, u).normalize();
                pos.addScaledVector(bin, sideOffset);
                positions.push(pos.x, pos.y, pos.z);
            }
        }
        // close the loop by adding the final point
        {
            const p = this.cachedPositions[0].clone().addScaledVector(this.cachedBinormals[0], sideOffset);
            positions.push(p.x, p.y, p.z);
        }
        const geom = new LineGeometry();
        geom.setPositions(positions);
        const mat = new LineMaterial({ color: color.getHex(), linewidth: width, worldUnits: true });
        mat.resolution.set(window.innerWidth, window.innerHeight);
        this.railMaterials.push(mat);
        const line = new Line2(geom, mat);
        line.computeLineDistances();
        (line.material as any).toneMapped = false;
        this.root.add(line);
    }

    public updateResolution(width: number, height: number) {
        for (const m of this.railMaterials) m.resolution.set(width, height);
    }

    public getPointAtT(t: number, target: THREE.Vector3): THREE.Vector3 {
        return this.curve.getPointAt(t, target);
    }

    public getFrenetFrame(t: number, normal: THREE.Vector3, binormal: THREE.Vector3, tangent: THREE.Vector3) {
        const idx = Math.floor(THREE.MathUtils.euclideanModulo(t, 1) * this.samples) % this.samples;
        tangent.copy(this.cachedTangents[idx]);
        normal.copy(this.cachedNormals[idx]);
        binormal.copy(this.cachedBinormals[idx]);
    }

    public sampleByT(t: number, out: TrackSample): TrackSample {
        const idx = Math.floor(THREE.MathUtils.euclideanModulo(t, 1) * this.samples) % this.samples;
        out.position.copy(this.cachedPositions[idx]);
        out.tangent.copy(this.cachedTangents[idx]);
        out.normal.copy(this.cachedNormals[idx]);
        out.binormal.copy(this.cachedBinormals[idx]);
        out.bankRadians = this.cachedBank[idx];
        out.up.copy(out.normal);
        return out;
    }

    public getClosestT(worldPos: THREE.Vector3): number {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < this.samples; i++) {
            const p = this.cachedPositions[i];
            const d = worldPos.distanceToSquared(p);
            if (d < bestD) { bestD = d; best = i; }
        }
        return best / this.samples;
    }

    public getBoosterTs(): readonly number[] { return this.boosterTs; }

    public getCheckpointCount(): number {
        return 16;
    }
}


