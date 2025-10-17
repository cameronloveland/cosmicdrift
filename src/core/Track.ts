import * as THREE from 'three';
import { COLORS, TRACK_OPTS, TRACK_SOURCE, CUSTOM_TRACK_POINTS, BOOSTER_SPACING_METERS, BOOSTER_COLOR, TUNNEL } from './constants';
import type { TrackOptions, TrackSample, TunnelSegment, TunnelInfo } from './types';

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

    private tunnelSegments: TunnelSegment[] = [];
    private tunnels = new THREE.Group();

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
        this.curve.arcLengthDivisions = Math.max(200, this.samples * 8);
        this.length = this.curve.getLength();

        this.precomputeFramesAndBank();
        this.boundingRadius = this.computeBoundingRadius();

        this.buildGeometry();
        this.buildRails();
        this.buildMarkers();
        this.buildStartLine();
        this.buildBoosters(BOOSTER_SPACING_METERS);
        this.buildTunnels();
        this.updateTrackAlphaForTunnels();
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
        const colors: number[] = []; // RGBA for vertex colors with alpha
        const indices: number[] = [];

        // Initialize with full opacity - we'll update this after tunnels are built
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

            // Add vertex colors (RGBA) - start with full opacity
            colors.push(1, 1, 1, 1); // left vertex
            colors.push(1, 1, 1, 1); // right vertex
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
        geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
        geom.setIndex(indices);

        const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0x0e1130),
            roughness: 0.35,
            metalness: 0.05,
            transparent: true,
            opacity: 0.98,
            emissive: COLORS.deepBlue.clone().multiplyScalar(0.25),
            envMapIntensity: 0.4,
            vertexColors: true,
            alphaTest: 0.01 // Ensure alpha blending works properly
        });
        const ribbon = new THREE.Mesh(geom, mat);
        ribbon.receiveShadow = true;
        this.root.add(ribbon);
    }

    private buildRails() {
        const railOffset = this.width * 0.5 + 0.1;
        this.addRail(railOffset, COLORS.neonCyan, 3.0);
        this.addRail(-railOffset, COLORS.neonMagenta, 3.0);

        // Add soft edge glow strips to hide any track faceting
        this.addEdgeGlow(this.width * 0.5, COLORS.neonCyan, 0.15); // right edge
        this.addEdgeGlow(-this.width * 0.5, COLORS.neonMagenta, 0.15); // left edge
    }

    private buildMarkers() {
        // simple neon posts along the track - enhanced for better visibility
        const group = new THREE.Group();
        const spacing = this.opts.markerSpacing;
        const count = Math.max(8, Math.floor(this.length / spacing));
        const geom = new THREE.CylinderGeometry(0.08, 0.08, 1.0, 8); // larger and taller
        const mat = new THREE.MeshBasicMaterial({
            color: 0x53d7ff,
            toneMapped: false,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending
        });

        // Add glow halo geometry for extra visibility
        const haloGeom = new THREE.SphereGeometry(0.15, 8, 8);
        const haloMat = new THREE.MeshBasicMaterial({
            color: 0x53d7ff,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });

        for (let i = 0; i < count; i++) {
            const t = (i / count);
            const idx = Math.floor(t * this.samples) % this.samples;
            const pos = this.cachedPositions[idx];
            const up = this.cachedNormals[idx];
            const bin = this.cachedBinormals[idx];
            const side = (i % 2 === 0 ? 1 : -1);
            const p = new THREE.Vector3().copy(pos).addScaledVector(bin, side * (this.width * 0.5 + 0.3)).addScaledVector(up, 0.6);

            // Main marker post
            const m = new THREE.Mesh(geom, mat);
            m.position.copy(p);
            group.add(m);

            // Add glow halo at the top
            const halo = new THREE.Mesh(haloGeom, haloMat);
            halo.position.copy(p).addScaledVector(up, 0.5);
            group.add(halo);
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
        const size = this.width * 0.25; // pad spans ~25% of track width (increased from 22%)
        const len = Math.max(2.5, spacingMeters * 0.12); // longer and more visible
        const mat = new THREE.MeshBasicMaterial({
            color: BOOSTER_COLOR,
            transparent: true,
            opacity: 1.0, // fully opaque for maximum visibility
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
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

    private buildTunnels() {
        // Clear old tunnels
        if (this.tunnels.parent) this.root.remove(this.tunnels);
        this.tunnels = new THREE.Group();
        this.tunnelSegments = [];

        const rnd = mulberry32(this.opts.seed + 1000); // different seed for tunnel placement
        const count = Math.floor(rnd() * (TUNNEL.countMax - TUNNEL.countMin + 1)) + TUNNEL.countMin;

        // Generate random tunnel placements ensuring minimum spacing
        const placements: number[] = [];
        const maxAttempts = 100;

        for (let i = 0; i < count; i++) {
            let attempts = 0;
            let validPlacement = false;
            let startT = 0;

            while (!validPlacement && attempts < maxAttempts) {
                startT = rnd();
                validPlacement = true;

                // Check spacing with existing tunnels
                for (const existing of placements) {
                    const distT = Math.abs(startT - existing);
                    const wrapDist = Math.min(distT, 1 - distT);
                    const distMeters = wrapDist * this.length;
                    if (distMeters < TUNNEL.minSpacing) {
                        validPlacement = false;
                        break;
                    }
                }
                attempts++;
            }

            if (validPlacement) {
                placements.push(startT);
            }
        }

        // Build tunnel geometry for each placement
        for (const startT of placements) {
            const lengthMeters = TUNNEL.lengthMin + rnd() * (TUNNEL.lengthMax - TUNNEL.lengthMin);
            const endT = THREE.MathUtils.euclideanModulo(startT + lengthMeters / this.length, 1);

            this.tunnelSegments.push({ startT, endT, lengthMeters });

            // Create tunnel tube geometry
            const tunnelPoints: THREE.Vector3[] = [];
            const segmentCount = Math.floor((lengthMeters / this.length) * this.samples);

            for (let i = 0; i <= segmentCount; i++) {
                const t = startT + (i / segmentCount) * (lengthMeters / this.length);
                const idx = Math.floor(THREE.MathUtils.euclideanModulo(t, 1) * this.samples) % this.samples;
                tunnelPoints.push(this.cachedPositions[idx].clone());
            }

            const tunnelCurve = new THREE.CatmullRomCurve3(tunnelPoints, false, 'centripetal');

            // Add decorative neon rings along the tunnel (no tube walls)
            this.addTunnelRings(tunnelCurve, lengthMeters, startT);
        }

        this.root.add(this.tunnels);
    }

    private addTunnelRings(tunnelCurve: THREE.CatmullRomCurve3, lengthMeters: number, startT: number) {
        const ringCount = Math.floor(lengthMeters / TUNNEL.ringSpacing);
        const torusGeometry = new THREE.TorusGeometry(TUNNEL.radius * 0.95, 0.3, 8, 24);

        for (let i = 0; i < ringCount; i++) {
            const progress = i / ringCount;
            const t = progress;

            // Get position and orientation along the tunnel curve
            const pos = tunnelCurve.getPointAt(t);
            const tangent = tunnelCurve.getTangentAt(t);

            // Calculate corresponding track index for proper orientation
            const trackT = THREE.MathUtils.euclideanModulo(startT + progress * (lengthMeters / this.length), 1);
            const idx = Math.floor(trackT * this.samples) % this.samples;
            const normal = this.cachedNormals[idx];
            const binormal = this.cachedBinormals[idx];

            // Create ring with color gradient
            const colorMix = new THREE.Color().lerpColors(TUNNEL.colorStart, TUNNEL.colorEnd, progress);
            const ringMaterial = new THREE.MeshBasicMaterial({
                color: colorMix,
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });

            const ring = new THREE.Mesh(torusGeometry, ringMaterial);

            // Orient ring perpendicular to tangent
            const z = tangent.clone().normalize();
            const x = binormal.clone().normalize();
            const y = new THREE.Vector3().crossVectors(z, x).normalize();
            const m = new THREE.Matrix4().makeBasis(x, y, z);
            const q = new THREE.Quaternion().setFromRotationMatrix(m);

            ring.position.copy(pos);
            ring.quaternion.copy(q);

            this.tunnels.add(ring);
        }
    }

    private updateTrackAlphaForTunnels() {
        // Find the track ribbon mesh and update its vertex alpha
        const ribbon = this.root.children.find(child => child instanceof THREE.Mesh && child.geometry.attributes.color) as THREE.Mesh | undefined;
        if (!ribbon || !ribbon.geometry.attributes.color) return;

        const colorAttr = ribbon.geometry.attributes.color;
        const colors = colorAttr.array as Float32Array;

        // For each vertex pair (left and right edge of track)
        for (let i = 0; i <= this.samples; i++) {
            const idx = i % this.samples;
            const t = idx / this.samples;

            // Check if this position is inside any tunnel
            let inTunnel = false;
            let transitionFactor = 1.0; // 1.0 = visible, 0.0 = invisible

            for (const tunnel of this.tunnelSegments) {
                let isInside = false;

                if (tunnel.startT <= tunnel.endT) {
                    // Normal case - check if we're inside the tunnel
                    isInside = t >= tunnel.startT && t <= tunnel.endT;
                } else {
                    // Wrap case - tunnel crosses t=0/1 boundary
                    isInside = t >= tunnel.startT || t <= tunnel.endT;
                }

                if (isInside) {
                    inTunnel = true;
                    transitionFactor = 0.0; // Completely transparent inside tunnel
                    break; // No need to check other tunnels
                }
            }

            // Only add fade transitions at tunnel edges if not inside any tunnel
            if (!inTunnel) {
                for (const tunnel of this.tunnelSegments) {
                    let nearEdge = false;
                    let fadeDistance = 0.02; // 2% of track for smooth entry/exit

                    if (tunnel.startT <= tunnel.endT) {
                        // Normal case
                        const distFromStart = Math.abs(t - tunnel.startT);
                        const distFromEnd = Math.abs(t - tunnel.endT);
                        const tunnelLength = tunnel.endT - tunnel.startT;
                        const edgeFadeDistance = Math.min(fadeDistance, tunnelLength * 0.1);

                        if (distFromStart < edgeFadeDistance) {
                            nearEdge = true;
                            transitionFactor = Math.min(transitionFactor, distFromStart / edgeFadeDistance);
                        } else if (distFromEnd < edgeFadeDistance) {
                            nearEdge = true;
                            transitionFactor = Math.min(transitionFactor, distFromEnd / edgeFadeDistance);
                        }
                    } else {
                        // Wrap case
                        const distFromStart = Math.min(Math.abs(t - tunnel.startT), Math.abs(t - tunnel.startT + 1), Math.abs(t - tunnel.startT - 1));
                        const distFromEnd = Math.min(Math.abs(t - tunnel.endT), Math.abs(t - tunnel.endT + 1), Math.abs(t - tunnel.endT - 1));

                        if (distFromStart < fadeDistance) {
                            nearEdge = true;
                            transitionFactor = Math.min(transitionFactor, distFromStart / fadeDistance);
                        } else if (distFromEnd < fadeDistance) {
                            nearEdge = true;
                            transitionFactor = Math.min(transitionFactor, distFromEnd / fadeDistance);
                        }
                    }
                }
            }

            // Update alpha for both vertices (left and right edge)
            const baseIdx = i * 2 * 4; // 2 vertices per segment * 4 components (RGBA)
            colors[baseIdx + 3] = transitionFactor;     // left vertex alpha
            colors[baseIdx + 7] = transitionFactor;     // right vertex alpha
        }

        colorAttr.needsUpdate = true;
    }

    private addRail(sideOffset: number, color: THREE.Color, width: number) {
        // Create offset curve by transforming the main curve
        const offsetCurve = this.createOffsetCurve(sideOffset);

        // Create TubeGeometry for smooth rails
        const tubularSegments = this.samples;
        const radius = width * 0.1; // Convert line width to tube radius
        const radialSegments = 8;

        const tubeGeom = new THREE.TubeGeometry(
            offsetCurve,
            tubularSegments,
            radius,
            radialSegments,
            true // closed
        );

        const mat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });

        const tubeMesh = new THREE.Mesh(tubeGeom, mat);
        this.root.add(tubeMesh);
    }

    private createOffsetCurve(sideOffset: number): THREE.CatmullRomCurve3 {
        // Create control points offset from the main curve
        const offsetPoints: THREE.Vector3[] = [];

        for (let i = 0; i < this.samples; i++) {
            const t = i / this.samples;
            const center = this.curve.getPointAt(t);
            const tangent = this.curve.getTangentAt(t).normalize();
            const normal = this.cachedNormals[i];

            // Build orthonormal frame
            const up = normal.clone();
            const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();

            // Offset position along binormal
            const offsetPos = center.clone().addScaledVector(binormal, sideOffset);
            offsetPoints.push(offsetPos);
        }

        return new THREE.CatmullRomCurve3(offsetPoints, true, 'centripetal');
    }

    private addEdgeGlow(sideOffset: number, color: THREE.Color, radius: number) {
        // Create offset curve for the edge glow
        const offsetCurve = this.createOffsetCurve(sideOffset);

        // Create thin TubeGeometry for soft edge glow
        const tubularSegments = this.samples;
        const radialSegments = 6; // fewer segments for softer look

        const tubeGeom = new THREE.TubeGeometry(
            offsetCurve,
            tubularSegments,
            radius,
            radialSegments,
            true // closed
        );

        const mat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.3, // subtle glow
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });

        const glowMesh = new THREE.Mesh(tubeGeom, mat);
        this.root.add(glowMesh);
    }

    public updateResolution(width: number, height: number) {
        // No longer needed with TubeGeometry rails
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

    public getTunnelAtT(t: number, lateralOffset: number): TunnelInfo {
        const normalizedT = THREE.MathUtils.euclideanModulo(t, 1);

        for (const tunnel of this.tunnelSegments) {
            let inTunnel = false;
            let progress = 0;

            // Handle wrap-around case
            if (tunnel.startT <= tunnel.endT) {
                // Normal case: tunnel doesn't wrap around t=0/1
                inTunnel = normalizedT >= tunnel.startT && normalizedT <= tunnel.endT;
                if (inTunnel) {
                    progress = (normalizedT - tunnel.startT) / (tunnel.endT - tunnel.startT);
                }
            } else {
                // Wrap case: tunnel crosses t=0/1 boundary
                inTunnel = normalizedT >= tunnel.startT || normalizedT <= tunnel.endT;
                if (inTunnel) {
                    if (normalizedT >= tunnel.startT) {
                        progress = (normalizedT - tunnel.startT) / (1 - tunnel.startT + tunnel.endT);
                    } else {
                        progress = (1 - tunnel.startT + normalizedT) / (1 - tunnel.startT + tunnel.endT);
                    }
                }
            }

            if (inTunnel) {
                // Calculate center alignment (0 = at edge, 1 = perfectly centered)
                const centerAlignment = 1 - Math.abs(lateralOffset) / (this.width * 0.5);
                return {
                    inTunnel: true,
                    progress,
                    centerAlignment: Math.max(0, centerAlignment)
                };
            }
        }

        return { inTunnel: false, progress: 0, centerAlignment: 0 };
    }

    public getCheckpointCount(): number {
        return 16;
    }
}


