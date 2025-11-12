import * as THREE from 'three';
import { COLORS, TRACK_OPTS, TRACK_SOURCE, CUSTOM_TRACK_POINTS, TUNNEL, BOOST_PAD, RAMP, BANK_PROFILE, FRAME_PROFILES } from './constants';
import type { TrackOptions, TrackSample, TunnelSegment, TunnelInfo, BoostPadSegment, BoostPadInfo, RampSegment, RampInfo } from './types';

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

    private tunnelSegments: TunnelSegment[] = [];
    private tunnels = new THREE.Group();
    private boostPads: BoostPadSegment[] = [];
    private boostPadGroup = new THREE.Group();
    private ramps: RampSegment[] = [];
    private rampGroup = new THREE.Group();
    private rampChevronMaterials: THREE.MeshBasicMaterial[] = [];

    // Start line gate fade-out state
    private gateMaterials: THREE.MeshBasicMaterial[] = [];
    private gateBaseOpacities: number[] = []; // Store original opacities
    private gateFadeStartTime: number | null = null;
    private gateFadeDuration = 3.0; // 3 seconds fade (duration of countdown)

    private opts: TrackOptions = TRACK_OPTS;

    // sampled frames cache (exposed for wormhole tunnel generation)
    public samples = this.opts.samples;
    public cachedPositions: THREE.Vector3[] = [];
    public cachedTangents: THREE.Vector3[] = [];
    public cachedNormals: THREE.Vector3[] = [];
    public cachedBinormals: THREE.Vector3[] = [];
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

        // Debug: Check if controls array is valid
        if (!controls || controls.length < 4) {
            console.error('Track generation failed: insufficient control points', controls?.length);
            // Create a simple fallback track
            const fallbackControls = [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(100, 0, 0),
                new THREE.Vector3(100, 0, 100),
                new THREE.Vector3(0, 0, 100)
            ];
            this.curve = new THREE.CatmullRomCurve3(fallbackControls, true, 'centripetal');
        } else {
            // Use centripetal Catmull-Rom to avoid overshooting/self-intersections
            this.curve = new THREE.CatmullRomCurve3(controls, true, 'centripetal');
        }

        // Validate curve points
        if (!this.curve.points || this.curve.points.length === 0) {
            console.error('Curve points are invalid after creation');
            return;
        }

        // Validate that all points are valid Vector3 objects
        for (let i = 0; i < this.curve.points.length; i++) {
            const point = this.curve.points[i];
            if (!point || typeof point.x !== 'number' || typeof point.y !== 'number' || typeof point.z !== 'number') {
                console.error('Invalid curve point at index', i, ':', point);
                return;
            }
        }
        // Optional curvature-aware relax (before arc-length and length fetch)
        this.relaxByCurvature();
        this.separateCloseSegments();

        // Increase arc length precision to remove quantization artifacts
        this.curve.arcLengthDivisions = Math.max(200, this.samples * 16);

        // Ensure curve is fully initialized before getting length
        try {
            // Test the curve with a simple point first
            const testPoint = new THREE.Vector3();
            this.curve.getPointAt(0, testPoint);

            // Test a few more points to ensure curve is working
            for (let t = 0.1; t <= 1.0; t += 0.2) {
                const testPoint2 = new THREE.Vector3();
                this.curve.getPointAt(t, testPoint2);
            }

            this.length = this.curve.getLength();
            console.log('Track curve length:', this.length);
        } catch (error) {
            console.error('Error getting curve length:', error);
            this.length = 100; // fallback length
        }

        this.precomputeFramesAndBank();
        this.boundingRadius = this.computeBoundingRadius();

        this.buildGeometry();
        this.buildRails();
        this.buildMarkers();
        this.buildTunnels();
        this.buildBoostPads();
        this.buildRamps();
        this.buildStartLine(); // Build after tunnels so we can position relative to first tunnel
        this.updateTrackAlphaForTunnels();

        // Optional debug helpers
        if (this.opts.debugFrames) {
            this.buildDebugVisualization();
        }
    }

    private makeControlPoints(opts: TrackOptions): THREE.Vector3[] {
        const rnd = mulberry32(opts.seed);
        const pts: THREE.Vector3[] = [];
        const n = opts.controlPointCount;

        // Always add the first point
        const firstA = 0;
        const firstR = THREE.MathUtils.lerp(opts.radiusMin, opts.radiusMax, rnd());
        const firstX = Math.cos(firstA) * firstR;
        const firstZ = Math.sin(firstA) * firstR;
        const firstY = 0;
        pts.push(new THREE.Vector3(firstX, firstY, firstZ));

        for (let i = 1; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const jitter = (rnd() - 0.5) * 0.1; // significantly reduce jitter for smoother curves
            const r = THREE.MathUtils.lerp(opts.radiusMin, opts.radiusMax, rnd());
            const x = Math.cos(a + jitter) * r;
            const z = Math.sin(a + jitter) * r;
            const elev = (Math.sin(a * 0.5 + rnd() * 2.0) + Math.sin(a * 0.23 + rnd() * 4.0) * 0.5) * opts.elevationAmplitude * 0.5;
            const y = elev;
            const p = new THREE.Vector3(x, y, z);
            // enforce minimum chord length to avoid nearly coincident points
            const last = pts[pts.length - 1];
            if (last.distanceToSquared(p) >= opts.minChord * opts.minChord) {
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

        // Additional Laplacian smoothing pass for extra smoothness
        const laplacianPasses = 2;
        for (let pass = 0; pass < laplacianPasses; pass++) {
            const smoothed: THREE.Vector3[] = [];
            for (let i = 0; i < out.length; i++) {
                const prev = out[(i - 1 + out.length) % out.length];
                const curr = out[i];
                const next = out[(i + 1) % out.length];

                // Laplacian smoothing: new = current + 0.5 * (neighbors - current)
                const smoothedPoint = new THREE.Vector3(
                    curr.x + 0.5 * ((prev.x + next.x) * 0.5 - curr.x),
                    curr.y + 0.5 * ((prev.y + next.y) * 0.5 - curr.y),
                    curr.z + 0.5 * ((prev.z + next.z) * 0.5 - curr.z)
                );
                smoothed.push(smoothedPoint);
            }
            out = smoothed;
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

            // Parallel transport with degeneracy fallback:
            // project previous normal onto plane perpendicular to current tangent
            tmp.copy(tmpNormal).sub(tan.clone().multiplyScalar(tmpNormal.dot(tan))).normalize();
            // Fallbacks to avoid degeneracy/flip
            if (!Number.isFinite(tmp.x) || tmp.length() < 0.1) {
                const cross = new THREE.Vector3().crossVectors(tan, tmpNormal);
                if (cross.length() > 0.01) {
                    tmp.copy(cross).cross(tan).normalize();
                } else {
                    const arbitrary = Math.abs(tan.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
                    tmp.copy(arbitrary).sub(tan.clone().multiplyScalar(arbitrary.dot(tan))).normalize();
                }
            }
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
            let bank = THREE.MathUtils.degToRad(this.opts.bankMaxDeg) * curveStrength * sign;
            // Apply bank profile shaping
            try {
                bank *= BANK_PROFILE(t);
            } catch { }
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

        // Optional per-section frame customization
        if (TRACK_OPTS.enableFrameProfiles && FRAME_PROFILES.length > 0) {
            this.applyFrameProfiles();
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
        // Build exactly 'segments' vertices (no duplicate seam)
        for (let i = 0; i < segments; i++) {
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
            const c = ((i + 1) % segments) * 2;
            const d = c + 1;
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
            metalness: 0.1, // Slightly increased for more reflection
            transparent: true,
            opacity: 0.98,
            emissive: COLORS.deepBlue.clone().multiplyScalar(0.4), // Increased from 0.25 for stronger glow
            envMapIntensity: 1.2, // Increased from 0.4 for stronger reflective lighting
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


    private buildStartLine() {
        // Create an imposing starting gate with vertical posts, crossbar, and glowing "START" text
        // Position at the ship's starting location
        const startT = 0.0; // 0% along the track - where the ship starts

        const idx = Math.floor(startT * this.samples) % this.samples;
        const center = this.cachedPositions[idx];
        const up = this.cachedNormals[idx];
        const bin = this.cachedBinormals[idx];
        const tan = this.cachedTangents[idx];

        // Glowing material for all gate elements
        const gateMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0, // Full opacity for better visibility
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });

        // Store material reference and base opacity for fade-out animation
        this.gateMaterials.push(gateMat);
        this.gateBaseOpacities.push(1.0);

        // Gate dimensions
        const gateHeight = 12;
        const postRadius = 0.4; // Make poles thicker for better visibility
        const crossbarHeight = 0.4;
        const crossbarWidth = 0.3;

        // Create vertical posts (left and right) - position them directly at start line
        const postGeom = new THREE.CylinderGeometry(postRadius, postRadius, gateHeight, 12);

        // Orient posts to be perpendicular to track surface (along track's up vector)
        // CylinderGeometry is oriented along Y-axis by default, so we need to rotate it
        // to align with the track's local up vector (normal)
        const postX = new THREE.Vector3().copy(tan).normalize(); // X perpendicular to up and bin
        const postY = new THREE.Vector3().copy(up).normalize(); // Y along track up (normal)
        const postZ = new THREE.Vector3().copy(bin).normalize(); // Z along track width
        const postM = new THREE.Matrix4().makeBasis(postX, postY, postZ);
        const postQ = new THREE.Quaternion().setFromRotationMatrix(postM);

        // Left post - position at track edge at start line
        const leftPost = new THREE.Mesh(postGeom, gateMat);
        const leftPostPos = new THREE.Vector3()
            .copy(center)
            .addScaledVector(bin, -this.width * 0.5 - 0.1) // Just outside left track edge
            .addScaledVector(up, gateHeight * 0.5); // Center vertically along track normal
        leftPost.position.copy(leftPostPos);
        leftPost.quaternion.copy(postQ); // Orient perpendicular to track surface
        this.root.add(leftPost); // Add directly to root, not gate group

        // Right post - position at track edge at start line
        const rightPost = new THREE.Mesh(postGeom, gateMat);
        const rightPostPos = new THREE.Vector3()
            .copy(center)
            .addScaledVector(bin, this.width * 0.5 + 0.1) // Just outside right track edge
            .addScaledVector(up, gateHeight * 0.5); // Center vertically along track normal
        rightPost.position.copy(rightPostPos);
        rightPost.quaternion.copy(postQ); // Orient perpendicular to track surface
        this.root.add(rightPost); // Add directly to root, not gate group


        // Create gate group for text only
        const gateGroup = new THREE.Group();

        // Calculate exact positions of post outer edges at top for flush alignment
        const leftPostOuterEdge = new THREE.Vector3()
            .copy(center)
            .addScaledVector(bin, -this.width * 0.5 - 0.1 - postRadius) // Left post outer edge
            .addScaledVector(up, gateHeight); // At top of posts
        const rightPostOuterEdge = new THREE.Vector3()
            .copy(center)
            .addScaledVector(bin, this.width * 0.5 + 0.1 + postRadius) // Right post outer edge
            .addScaledVector(up, gateHeight); // At top of posts

        // Calculate exact distance between post outer edges for perfect flush alignment
        const crossbarLength = leftPostOuterEdge.distanceTo(rightPostOuterEdge);

        // Horizontal crossbar connecting the posts - position flush with post tops
        const crossbarGeom = new THREE.BoxGeometry(crossbarHeight, crossbarWidth, crossbarLength);
        const crossbar = new THREE.Mesh(crossbarGeom, gateMat);

        // Position crossbar at midpoint between post outer edges, at top of posts
        const crossbarPos = new THREE.Vector3()
            .copy(leftPostOuterEdge)
            .add(rightPostOuterEdge)
            .multiplyScalar(0.5);
        crossbar.position.copy(crossbarPos);

        // Orient crossbar: length is along Z-axis, span across track width (binormal)
        // BoxGeometry(X=height, Y=width, Z=length) -> need Z along binormal
        const crossbarX = new THREE.Vector3().copy(tan).normalize(); // X perpendicular to bin and up
        const crossbarY = new THREE.Vector3().copy(up).normalize(); // Y up
        const crossbarZ = new THREE.Vector3().copy(bin).normalize(); // Z along track width
        const crossbarM = new THREE.Matrix4().makeBasis(crossbarX, crossbarY, crossbarZ);
        const crossbarQ = new THREE.Quaternion().setFromRotationMatrix(crossbarM);
        crossbar.quaternion.copy(crossbarQ);

        this.root.add(crossbar); // Add directly to root, not gate group

        // Create "START" text using simple box geometry letters
        const textMat = new THREE.MeshBasicMaterial({
            color: 0x53d7ff, // cyan glow
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });

        // Letter dimensions - make text bigger and readable left-to-right
        const letterHeight = 3.0; // Much bigger
        const letterThickness = 0.4; // Thicker letters
        const letterSpacing = 0.6; // More spacing
        const textYOffset = 12.0; // Higher above starting line for better visibility

        // Helper to create letter segments
        const createLetterSegment = (width: number, height: number, xOffset: number, yOffset: number) => {
            const seg = new THREE.Mesh(
                new THREE.BoxGeometry(width, height, letterThickness),
                textMat
            );
            seg.position.set(xOffset, yOffset, 0);
            return seg;
        };

        // Create letters for "START"
        const letterWidth = 1.0;
        const barWidth = 0.25;
        let xPos = -(letterWidth * 5 + letterSpacing * 4) * 0.5; // center the word

        // S
        const sGroup = new THREE.Group();
        sGroup.add(createLetterSegment(letterWidth, barWidth, 0, letterHeight * 0.5)); // top
        sGroup.add(createLetterSegment(letterWidth, barWidth, 0, 0)); // middle
        sGroup.add(createLetterSegment(letterWidth, barWidth, 0, -letterHeight * 0.5)); // bottom
        sGroup.add(createLetterSegment(barWidth, letterHeight * 0.5, -letterWidth * 0.5 + barWidth * 0.5, letterHeight * 0.25)); // top left
        sGroup.add(createLetterSegment(barWidth, letterHeight * 0.5, letterWidth * 0.5 - barWidth * 0.5, -letterHeight * 0.25)); // bottom right
        sGroup.position.set(xPos, 0, 0);
        gateGroup.add(sGroup);
        xPos += letterWidth + letterSpacing;

        // T
        const tGroup = new THREE.Group();
        tGroup.add(createLetterSegment(letterWidth, barWidth, 0, letterHeight * 0.5)); // top
        tGroup.add(createLetterSegment(barWidth, letterHeight, 0, 0)); // vertical
        tGroup.position.set(xPos, 0, 0);
        gateGroup.add(tGroup);
        xPos += letterWidth + letterSpacing;

        // A
        const aGroup = new THREE.Group();
        aGroup.add(createLetterSegment(letterWidth, barWidth, 0, letterHeight * 0.5)); // top
        aGroup.add(createLetterSegment(letterWidth, barWidth, 0, 0)); // middle
        aGroup.add(createLetterSegment(barWidth, letterHeight, -letterWidth * 0.5 + barWidth * 0.5, 0)); // left vertical
        aGroup.add(createLetterSegment(barWidth, letterHeight, letterWidth * 0.5 - barWidth * 0.5, 0)); // right vertical
        aGroup.position.set(xPos, 0, 0);
        gateGroup.add(aGroup);
        xPos += letterWidth + letterSpacing;

        // R
        const rGroup = new THREE.Group();
        rGroup.add(createLetterSegment(letterWidth, barWidth, 0, letterHeight * 0.5)); // top
        rGroup.add(createLetterSegment(letterWidth, barWidth, 0, 0)); // middle
        rGroup.add(createLetterSegment(barWidth, letterHeight, -letterWidth * 0.5 + barWidth * 0.5, 0)); // left vertical
        rGroup.add(createLetterSegment(barWidth, letterHeight * 0.5, letterWidth * 0.5 - barWidth * 0.5, letterHeight * 0.25)); // top right
        rGroup.add(createLetterSegment(barWidth, letterHeight * 0.5, letterWidth * 0.5 - barWidth * 0.5, -letterHeight * 0.25)); // bottom right diagonal (simplified)
        rGroup.position.set(xPos, 0, 0);
        gateGroup.add(rGroup);
        xPos += letterWidth + letterSpacing;

        // T (second)
        const t2Group = new THREE.Group();
        t2Group.add(createLetterSegment(letterWidth, barWidth, 0, letterHeight * 0.5)); // top
        t2Group.add(createLetterSegment(barWidth, letterHeight, 0, 0)); // vertical
        t2Group.position.set(xPos, 0, 0);
        gateGroup.add(t2Group);

        // Orient the entire gate group to align with track
        // Make text perpendicular to track and readable left-to-right
        const trackForward = new THREE.Vector3().copy(tan).normalize(); // track direction
        const trackRight = new THREE.Vector3().copy(bin).normalize(); // track right side
        const trackUp = new THREE.Vector3().copy(up).normalize(); // track up

        // Create rotation matrix where text is perpendicular to track direction
        // Text should read left-to-right across the track width (X = binormal, Y = up, Z = -tangent)
        const m = new THREE.Matrix4().makeBasis(trackRight, trackUp, trackForward.clone().negate());
        const q = new THREE.Quaternion().setFromRotationMatrix(m);

        gateGroup.quaternion.copy(q);
        gateGroup.position.copy(center).addScaledVector(up, textYOffset + 2); // Move text up slightly

        this.root.add(gateGroup);

        // Create a better-looking starting line stripe
        const stripe = new THREE.PlaneGeometry(1, 1);
        const stripeMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, // Clean white
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const stripeMesh = new THREE.Mesh(stripe, stripeMat);
        const stripeZ = new THREE.Vector3().copy(up).normalize();
        const stripeX = new THREE.Vector3().copy(bin).normalize();
        const stripeY = new THREE.Vector3().crossVectors(stripeZ, stripeX).normalize();
        const stripeM = new THREE.Matrix4().makeBasis(stripeX, stripeY, stripeZ);
        const stripeQ = new THREE.Quaternion().setFromRotationMatrix(stripeM);
        stripeMesh.quaternion.copy(stripeQ);
        stripeMesh.position.copy(center).addScaledVector(up, 0.5);
        stripeMesh.scale.set(this.width, 2.0, 1); // Make it thicker
        this.root.add(stripeMesh);

        // Create glowing holographic wall at start line
        // Width spans between the inner edges of the posts
        const wallWidth = crossbarLength; // Match the crossbar span
        const wallHeight = gateHeight; // Match the height of the side columns (posts)
        const wallGeom = new THREE.PlaneGeometry(wallWidth, wallHeight);

        // Create holographic glowing material
        const wallMat = new THREE.MeshBasicMaterial({
            color: 0x53d7ff, // Cyan blue
            transparent: true,
            opacity: 0.3, // Semi-transparent for holographic effect
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide, // Visible from both sides
            toneMapped: false
        });

        // Store wall materials and base opacity for fade-out animation
        this.gateMaterials.push(wallMat);
        this.gateBaseOpacities.push(0.3);

        const wallMesh = new THREE.Mesh(wallGeom, wallMat);

        // Position wall aligned with posts - bottom at track level, top at post top
        const wallPos = new THREE.Vector3()
            .copy(center)
            .addScaledVector(up, gateHeight * 0.5); // Center vertically to match posts

        // Orient wall perpendicular to track direction - standing upright like a barrier
        // PlaneGeometry: default plane lies in XY, with +Z as normal (outward facing)
        // For upright wall: width along X (bin), height along Y (up), normal along -Z (faces backward/opposite track)
        // Since ships come from behind start line, wall faces backward (negative tangent)
        const wallX = new THREE.Vector3().copy(bin).normalize(); // Width spans across track (X-axis)
        const wallY = new THREE.Vector3().copy(up).normalize(); // Height goes up (Y-axis)  
        const wallZ = new THREE.Vector3().copy(tan).negate().normalize(); // Normal faces backward (negative Z, opposite track direction)
        const wallM = new THREE.Matrix4().makeBasis(wallX, wallY, wallZ);
        const wallQ = new THREE.Quaternion().setFromRotationMatrix(wallM);
        wallMesh.quaternion.copy(wallQ);
        wallMesh.position.copy(wallPos);

        this.root.add(wallMesh);

        // Add edge glow effect with a slightly larger, brighter rectangle
        const edgeGeom = new THREE.PlaneGeometry(wallWidth + 0.2, wallHeight + 0.2);
        const edgeMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff, // Bright cyan
            transparent: true,
            opacity: 0.15, // Subtle edge glow
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });

        // Store edge material and base opacity for fade-out animation
        this.gateMaterials.push(edgeMat);
        this.gateBaseOpacities.push(0.15);

        const edgeMesh = new THREE.Mesh(edgeGeom, edgeMat);
        edgeMesh.quaternion.copy(wallQ);
        edgeMesh.position.copy(wallPos);
        this.root.add(edgeMesh);
    }

    public startGateFade(currentTime: number) {
        // Start the fade-out animation
        if (this.gateFadeStartTime === null) {
            // Store base opacities before starting fade
            this.gateFadeStartTime = currentTime;
        }
    }

    public updateGateFade(currentTime: number) {
        if (this.gateFadeStartTime === null) return;

        const elapsed = currentTime - this.gateFadeStartTime;
        const fadeProgress = Math.min(elapsed / this.gateFadeDuration, 1.0);

        // Calculate opacity (fade from base opacity to 0.0)
        this.gateMaterials.forEach((mat, index) => {
            const baseOpacity = this.gateBaseOpacities[index];
            const opacity = baseOpacity * (1.0 - fadeProgress);
            mat.opacity = opacity;
        });

        // If fade is complete, keep materials at 0 opacity
        if (fadeProgress >= 1.0) {
            this.gateMaterials.forEach(mat => {
                mat.opacity = 0;
            });
        }
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
        let wormholeCount = 0;
        for (let i = 0; i < placements.length; i++) {
            const startT = placements[i];
            const lengthMeters = TUNNEL.lengthMin + rnd() * (TUNNEL.lengthMax - TUNNEL.lengthMin);
            const endT = THREE.MathUtils.euclideanModulo(startT + lengthMeters / this.length, 1);

            // Randomly assign tunnel type (60% chance wormhole, 40% rings)
            // Also ensure at least one wormhole exists
            let tunnelType: 'rings' | 'wormhole';
            if (i === placements.length - 1 && wormholeCount === 0) {
                // Force last tunnel to be wormhole if we haven't created any yet
                tunnelType = 'wormhole';
            } else {
                tunnelType = rnd() > 0.4 ? 'wormhole' : 'rings';
            }

            if (tunnelType === 'wormhole') wormholeCount++;


            this.tunnelSegments.push({ startT, endT, lengthMeters, tunnelType });

            // Only create ring geometry for 'rings' type tunnels
            if (tunnelType === 'rings') {
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
        for (let i = 0; i < this.samples; i++) {
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

        // Create TubeGeometry for smooth rails with higher quality
        const tubularSegments = Math.floor(this.samples * 1.5); // 50% more segments for smoother path
        const radius = width * 0.15; // Slightly larger radius for more prominent presence
        const radialSegments = 16; // Double the segments for perfectly round cross-section

        const tubeGeom = new THREE.TubeGeometry(
            offsetCurve,
            tubularSegments,
            radius,
            radialSegments,
            true // closed
        );

        // Enhanced material with better glow properties
        const mat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 1.0, // Increased from 0.95 for stronger neon glow
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide // Ensure both sides are rendered for smooth appearance
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

        // Create thin TubeGeometry for soft edge glow with higher quality
        const tubularSegments = Math.floor(this.samples * 1.2); // 20% more segments for smoother path
        const radialSegments = 12; // Double the segments for smoother cross-section
        const glowRadius = radius * 1.5; // Slightly wider glow for better blending

        const tubeGeom = new THREE.TubeGeometry(
            offsetCurve,
            tubularSegments,
            glowRadius,
            radialSegments,
            true // closed
        );

        // Enhanced glow material with smooth falloff
        const mat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.5, // Increased from 0.4 for stronger edge glow
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide // Ensure both sides are rendered for seamless blending
        });

        const glowMesh = new THREE.Mesh(tubeGeom, mat);
        this.root.add(glowMesh);
    }

    public updateResolution(width: number, height: number) {
        // No longer needed with TubeGeometry rails
    }

    // --- Curvature-aware relax -------------------------------------------------
    private relaxByCurvature() {
        const limit = this.opts.curvatureLimit ?? 0;
        const iters = Math.max(0, (this.opts.curvatureRelaxIters ?? 0) | 0);
        if (!this.curve || limit <= 0 || iters <= 0) return;

        // Sample a manageable number of points (tie to samples but cap for cost)
        const n = Math.max(256, Math.min(this.samples, 3000));
        const pts: THREE.Vector3[] = new Array(n);
        const tans: THREE.Vector3[] = new Array(n);
        const tmp = new THREE.Vector3();

        for (let i = 0; i < n; i++) {
            const t = i / n;
            pts[i] = this.curve.getPointAt(t);
            tans[i] = this.curve.getTangentAt(t).normalize();
        }

        const getKappa = (i: number) => {
            const i0 = (i - 1 + n) % n;
            const i2 = (i + 1) % n;
            const a = pts[i].clone().sub(pts[i0]);
            const b = pts[i2].clone().sub(pts[i]);
            const la = Math.max(1e-4, a.length());
            const lb = Math.max(1e-4, b.length());
            const angle = Math.acos(THREE.MathUtils.clamp(a.clone().normalize().dot(b.clone().normalize()), -1, 1));
            const ds = 0.5 * (la + lb);
            return angle / ds; // ≈ curvature
        };

        for (let it = 0; it < iters; it++) {
            for (let i = 0; i < n; i++) {
                const kappa = getKappa(i);
                const kappaMax = (this.opts.minTurnRadiusMeters && this.opts.minTurnRadiusMeters > 0)
                    ? 1 / this.opts.minTurnRadiusMeters : Infinity;
                const limitEff = Math.min(limit, kappaMax);
                if (kappa > limitEff) {
                    // Move point toward averaged direction corridor
                    const prev = pts[(i - 1 + n) % n];
                    const next = pts[(i + 1) % n];
                    const mid = tmp.copy(prev).add(next).multiplyScalar(0.5);
                    // Severity factor
                    const severity = THREE.MathUtils.clamp((kappa - limitEff) / limitEff, 0, 2);
                    pts[i].lerp(mid, 0.25 * severity);
                }
            }
            // Small Taubin-style smoothing to reduce shrinkage
            const lambda = 0.28, mu = -0.24;
            for (let i = 0; i < n; i++) {
                const a = pts[(i - 1 + n) % n];
                const b = pts[i];
                const c = pts[(i + 1) % n];
                const mid = tmp.copy(a).add(c).multiplyScalar(0.5);
                const delta = mid.sub(b);
                b.addScaledVector(delta, lambda);
            }
            for (let i = 0; i < n; i++) {
                const a = pts[(i - 1 + n) % n];
                const b = pts[i];
                const c = pts[(i + 1) % n];
                const mid = tmp.copy(a).add(c).multiplyScalar(0.5);
                const delta = mid.sub(b);
                b.addScaledVector(delta, mu);
            }
        }

        // Optional jerk smoothing of curvature changes (G2-like)
        const jerkLimit = this.opts.curvatureJerkLimit ?? 0;
        const jerkIters = Math.max(0, (this.opts.jerkRelaxIters ?? 0) | 0);
        if (jerkLimit > 0 && jerkIters > 0) {
            const kappaAt = (i: number) => getKappa(i);
            for (let it = 0; it < jerkIters; it++) {
                for (let i = 0; i < n; i++) {
                    const i0 = (i - 1 + n) % n;
                    const i2 = (i + 1) % n;
                    const kapPrev = kappaAt(i0);
                    const kap = kappaAt(i);
                    const kapNext = kappaAt(i2);
                    const dsPrev = pts[i].clone().sub(pts[i0]).length();
                    const dsNext = pts[i2].clone().sub(pts[i]).length();
                    const ds = Math.max(1e-4, 0.5 * (dsPrev + dsNext));
                    const avg = 0.5 * (kapPrev + kapNext);
                    const delta = kap - avg;
                    const limitDelta = jerkLimit * ds;
                    if (Math.abs(delta) > limitDelta) {
                        // Pull point toward neighbor midpoint to reduce curvature spike
                        const prev = pts[i0];
                        const next = pts[i2];
                        const mid = prev.clone().add(next).multiplyScalar(0.5);
                        const w = THREE.MathUtils.clamp((Math.abs(delta) - limitDelta) / Math.max(Math.abs(delta), 1e-6), 0, 1);
                        pts[i].lerp(mid, 0.18 * w);
                    }
                }
                // Light smoothing to keep noise down
                const l2 = 0.18, m2 = -0.15;
                for (let i = 0; i < n; i++) {
                    const a = pts[(i - 1 + n) % n];
                    const b = pts[i];
                    const c = pts[(i + 1) % n];
                    const mid = a.clone().add(c).multiplyScalar(0.5);
                    b.addScaledVector(mid.sub(b), l2);
                }
                for (let i = 0; i < n; i++) {
                    const a = pts[(i - 1 + n) % n];
                    const b = pts[i];
                    const c = pts[(i + 1) % n];
                    const mid = a.clone().add(c).multiplyScalar(0.5);
                    b.addScaledVector(mid.sub(b), m2);
                }
            }
        }

        // Rebuild curve from relaxed/jerk-smoothed samples
        this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    }

    // --- Self-repel pass to avoid pinched corners / near self-intersections ----
    private separateCloseSegments() {
        const clearance = this.opts.minClearanceMeters ?? 0;
        const iters = Math.max(0, (this.opts.selfRepelIters ?? 0) | 0);
        if (!this.curve || clearance <= 0 || iters <= 0) return;

        const n = Math.max(256, Math.min(this.samples, 2000));
        const pts: THREE.Vector3[] = new Array(n);
        for (let i = 0; i < n; i++) {
            pts[i] = this.curve.getPointAt(i / n);
        }

        const neighborSkipMeters = this.opts.repelNeighborSkipMeters ?? (this.width * 0.8);
        const minGap = Math.max(1, Math.floor((neighborSkipMeters / this.length) * n));
        const clearance2 = clearance * clearance;

        const dir = new THREE.Vector3();
        for (let it = 0; it < iters; it++) {
            for (let i = 0; i < n; i++) {
                // Local radius around i to limit pair checks
                for (let dj = minGap; dj < n - minGap; dj += 1) {
                    const j = (i + dj) % n;
                    // Ensure unique pairs
                    if (j <= i) continue;
                    const d2 = pts[i].distanceToSquared(pts[j]);
                    if (d2 < clearance2) {
                        const d = Math.sqrt(Math.max(d2, 1e-8));
                        dir.subVectors(pts[j], pts[i]).multiplyScalar(1 / d);
                        const push = (clearance - d) / clearance;
                        const amt = 0.25 * push; // conservative
                        // Move opposite directions; preserve loop centroid over many pairs
                        pts[i].addScaledVector(dir, -amt);
                        pts[j].addScaledVector(dir, +amt);
                    }
                }
            }
            // Light smoothing to prevent zig-zags
            const lambda = 0.18, mu = -0.15;
            for (let i = 0; i < n; i++) {
                const a = pts[(i - 1 + n) % n];
                const b = pts[i];
                const c = pts[(i + 1) % n];
                const mid = a.clone().add(c).multiplyScalar(0.5);
                b.addScaledVector(mid.sub(b), lambda);
            }
            for (let i = 0; i < n; i++) {
                const a = pts[(i - 1 + n) % n];
                const b = pts[i];
                const c = pts[(i + 1) % n];
                const mid = a.clone().add(c).multiplyScalar(0.5);
                b.addScaledVector(mid.sub(b), mu);
            }
        }

        this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    }

    // --- Frame profiles --------------------------------------------------------
    private applyFrameProfiles() {
        const sections = FRAME_PROFILES;
        if (!sections || sections.length === 0) return;

        const n = this.samples;
        const smoothstep = (x: number) => x * x * (3 - 2 * x);

        for (let i = 0; i < n; i++) {
            const t = i / n;

            for (const s of sections) {
                // Determine if t is within [startT,endT] with wrap
                let inSection = false;
                let localT = 0;
                if (s.startT <= s.endT) {
                    inSection = t >= s.startT && t <= s.endT;
                    if (inSection) localT = (t - s.startT) / Math.max(1e-6, s.endT - s.startT);
                } else {
                    inSection = t >= s.startT || t <= s.endT;
                    if (inSection) {
                        const len = (1 - s.startT) + s.endT;
                        localT = (t >= s.startT) ? (t - s.startT) / len : (1 - s.startT + t) / len;
                    }
                }
                if (!inSection) continue;

                // Edge feather
                const feather = THREE.MathUtils.clamp(s.feather ?? 0.1, 0, 0.49);
                let w = 1.0;
                if (feather > 0) {
                    const f0 = feather;
                    const f1 = 1 - feather;
                    if (localT < f0) w = smoothstep(localT / f0);
                    else if (localT > f1) w = smoothstep((1 - localT) / feather);
                }

                // Compute roll/twist radians
                const rollDeg = typeof s.rollDeg === 'function' ? s.rollDeg(localT, t) : (s.rollDeg ?? 0);
                const twistDeg = typeof s.twistDeg === 'function' ? s.twistDeg(localT, t) : (s.twistDeg ?? 0);
                const rollRad = THREE.MathUtils.degToRad(rollDeg) * w;
                const twistRad = THREE.MathUtils.degToRad(twistDeg) * w;

                const tan = this.cachedTangents[i];
                const qRoll = new THREE.Quaternion().setFromAxisAngle(tan, rollRad);
                const qTwist = new THREE.Quaternion().setFromAxisAngle(tan, twistRad);
                const q = qRoll.multiply(qTwist);

                this.cachedNormals[i].applyQuaternion(q);
                this.cachedBinormals[i].applyQuaternion(q);

                // Up bias
                if (s.upBias) {
                    const target =
                        typeof s.upBias === 'function' ? s.upBias(localT, t) : s.upBias;
                    if (target && Number.isFinite(target.x)) {
                        const currentUp = this.cachedNormals[i].clone().normalize();
                        const desiredUp = target.clone().normalize();
                        // Build quaternion rotating currentUp toward desiredUp around tangent
                        const axis = tan.clone().normalize();
                        // project desired onto plane ⟂ axis
                        const projDesired = desiredUp.sub(axis.clone().multiplyScalar(desiredUp.dot(axis))).normalize();
                        const projCurrent = currentUp.sub(axis.clone().multiplyScalar(currentUp.dot(axis))).normalize();
                        const dot = THREE.MathUtils.clamp(projCurrent.dot(projDesired), -1, 1);
                        const ang = Math.acos(dot) * w;
                        const qBias = new THREE.Quaternion().setFromAxisAngle(axis, ang);
                        this.cachedNormals[i].applyQuaternion(qBias);
                        this.cachedBinormals[i].applyQuaternion(qBias);
                    }
                }
            }
        }
    }

    // --- Debug visualization ---------------------------------------------------
    private buildDebugVisualization() {
        const group = new THREE.Group();
        const step = Math.max(1, Math.floor(this.samples / 180));
        const len = 2.0;
        const matT = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, toneMapped: false });
        const matN = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8, toneMapped: false });
        const matB = new THREE.LineBasicMaterial({ color: 0x0000ff, transparent: true, opacity: 0.8, toneMapped: false });

        for (let i = 0; i < this.samples; i += step) {
            const p = this.cachedPositions[i];
            const t = this.cachedTangents[i];
            const n = this.cachedNormals[i];
            const b = this.cachedBinormals[i];

            const makeLine = (dir: THREE.Vector3, mat: THREE.LineBasicMaterial) => {
                const g = new THREE.BufferGeometry().setFromPoints([
                    p.clone(),
                    p.clone().addScaledVector(dir, len)
                ]);
                const line = new THREE.Line(g, mat);
                group.add(line);
            };
            makeLine(t, matT);
            makeLine(n, matN);
            makeLine(b, matB);
        }

        this.root.add(group);
    }

    public getPointAtT(t: number, target: THREE.Vector3): THREE.Vector3 {
        // Safety check: ensure curve exists and is valid
        if (!this.curve || !this.curve.points || this.curve.points.length === 0) {
            console.warn('Track curve not ready, returning default position');
            return target.set(0, 0, 0);
        }

        // Additional safety check: ensure target is valid
        if (!target) {
            console.warn('Target vector is undefined, creating new one');
            target = new THREE.Vector3();
        }

        // Handle negative t values by wrapping around (for positions behind start line)
        if (t < 0) {
            t = 1 + t; // Wrap negative values to end of track
        }
        // Ensure t is within valid range
        t = Math.max(0, Math.min(1, t));

        try {
            return this.curve.getPointAt(t, target);
        } catch (error) {
            console.error('Error in getPointAt:', error, 't:', t, 'curve points:', this.curve.points.length);
            return target.set(0, 0, 0);
        }
    }

    public getFrenetFrame(t: number, normal: THREE.Vector3, binormal: THREE.Vector3, tangent: THREE.Vector3) {
        // Safety check: ensure cached frames exist
        if (!this.cachedTangents || this.cachedTangents.length === 0) {
            console.warn('Track frames not ready, using default orientation');
            tangent.set(0, 0, 1);
            normal.set(0, 1, 0);
            binormal.set(1, 0, 0);
            return;
        }
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

    public getTunnelSegments(): TunnelSegment[] {
        return this.tunnelSegments;
    }

    // Check if any track segments are inside the event horizon
    public isTrackInsideEventHorizon(eventHorizonRadius: number, sampleCount: number = 100): boolean {
        // Sample track positions to check if any are inside
        const step = 1.0 / sampleCount;
        for (let i = 0; i <= sampleCount; i++) {
            const t = i * step;
            const idx = Math.floor(THREE.MathUtils.euclideanModulo(t, 1) * this.samples) % this.samples;
            const position = this.cachedPositions[idx];
            const distance = position.length();

            if (distance < eventHorizonRadius) {
                return true;
            }
        }
        return false;
    }

    // Check if the entire track is completely engulfed by the blackhole
    public isTrackFullyEngulfed(coreRadius: number, sampleCount: number = 200): boolean {
        // Sample track positions more densely to check if ALL are inside
        const step = 1.0 / sampleCount;
        for (let i = 0; i <= sampleCount; i++) {
            const t = i * step;
            const idx = Math.floor(THREE.MathUtils.euclideanModulo(t, 1) * this.samples) % this.samples;
            const position = this.cachedPositions[idx];
            const distance = position.length();

            // If any point is outside, track is not fully engulfed
            if (distance >= coreRadius) {
                return false;
            }
        }
        // All sampled points are inside
        return true;
    }

    // Get ship world position based on track position
    public getShipWorldPosition(t: number, lateralOffset: number, target: THREE.Vector3): THREE.Vector3 {
        const normalizedT = THREE.MathUtils.euclideanModulo(t, 1);
        const idx = Math.floor(normalizedT * this.samples) % this.samples;
        const center = this.cachedPositions[idx];
        const binormal = this.cachedBinormals[idx];
        const normal = this.cachedNormals[idx];

        target.copy(center)
            .addScaledVector(binormal, lateralOffset)
            .addScaledVector(normal, 0.3); // Ship hovers above track

        return target;
    }

    private buildBoostPads() {
        // Clear old boost pads
        if (this.boostPadGroup.parent) this.root.remove(this.boostPadGroup);
        this.boostPadGroup = new THREE.Group();
        this.boostPads = [];

        // Minimum distance from start before boost pads appear
        const minStartOffset = BOOST_PAD.minStartOffset; // meters
        const minStartT = minStartOffset / this.length;

        // Calculate number of boost pads based on track length and spacing
        const count = Math.floor(this.length / BOOST_PAD.spacing);
        const actualSpacing = this.length / count; // evenly distribute

        for (let i = 0; i < count; i++) {
            const startMeters = i * actualSpacing;
            const startT = startMeters / this.length;

            // Skip boost pads before minimum offset
            if (startT < minStartT) continue;

            const lengthT = BOOST_PAD.lengthMeters / this.length;

            this.boostPads.push({ t: startT, lengthT });

            // Create visual boost pad stripe across the track
            this.createBoostPadVisual(startT, lengthT);
        }

        this.root.add(this.boostPadGroup);
    }

    private buildRamps() {
        // Clear old ramps
        if (this.rampGroup.parent) this.root.remove(this.rampGroup);
        this.rampGroup = new THREE.Group();
        this.ramps = [];
        this.rampChevronMaterials = [];

        const minStartT = RAMP.minStartOffset / this.length;
        const count = Math.max(1, RAMP.count | 0);
        const segLengthT = RAMP.lengthMeters / this.length;
        const tStep = 5 / this.length; // 5m forward step when nudging out of tunnels

        for (let i = 0; i < count; i++) {
            let startT = THREE.MathUtils.euclideanModulo(minStartT + i * (1 / count), 1);

            // Avoid tunnels: nudge forward until clear or after one full loop
            let tries = 0;
            const maxTries = Math.ceil(1 / tStep) + 2;
            while (this.isTInAnyTunnel(startT) && tries < maxTries) {
                startT = THREE.MathUtils.euclideanModulo(startT + tStep, 1);
                tries++;
            }

            this.ramps.push({ t: startT, lengthT: segLengthT });
            this.createRampVisual(startT, segLengthT);
        }

        this.root.add(this.rampGroup);
    }

    private isTInAnyTunnel(t: number): boolean {
        const normalizedT = THREE.MathUtils.euclideanModulo(t, 1);
        for (const tunnel of this.tunnelSegments) {
            if (tunnel.startT <= tunnel.endT) {
                if (normalizedT >= tunnel.startT && normalizedT <= tunnel.endT) return true;
            } else {
                // wrap case
                if (normalizedT >= tunnel.startT || normalizedT <= tunnel.endT) return true;
            }
        }
        return false;
    }

    private createRampVisual(startT: number, lengthT: number) {
        // Create multiple chevrons indicating a launch zone; visually distinct from boost pads
        const chevronCount = Math.max(3, Math.floor((RAMP.lengthMeters / 10)));
        for (let i = 0; i < chevronCount; i++) {
            const progress = i / chevronCount;
            const t = startT + progress * lengthT;
            const idx = Math.floor(THREE.MathUtils.euclideanModulo(t, 1) * this.samples) % this.samples;
            const center = this.cachedPositions[idx];
            const binormal = this.cachedBinormals[idx];
            const up = this.cachedNormals[idx];
            const tangent = this.cachedTangents[idx];

            const color = new THREE.Color().lerpColors(RAMP.colorStart, RAMP.colorEnd, 0.5);
            const chevronWidth = this.width * 0.9;
            const chevronLength = 7.5; // slightly shorter segments
            const chevronThickness = 1.5; // thicker bars to differentiate from boost pads

            const tipOffset = chevronLength * 0.5;
            const backOffset = -chevronLength * 0.5;
            const sideOffset = chevronWidth * 0.5;

            const tip = new THREE.Vector3()
                .copy(center)
                .addScaledVector(tangent, tipOffset)
                .addScaledVector(up, RAMP.thickness);
            const rightBack = new THREE.Vector3()
                .copy(center)
                .addScaledVector(tangent, backOffset)
                .addScaledVector(binormal, sideOffset)
                .addScaledVector(up, RAMP.thickness);
            const leftBack = new THREE.Vector3()
                .copy(center)
                .addScaledVector(tangent, backOffset)
                .addScaledVector(binormal, -sideOffset)
                .addScaledVector(up, RAMP.thickness);

            // Create shared animated materials for arrows (store for pulsing)
            const chevronMat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });
            this.rampChevronMaterials.push(chevronMat);
            const chevronMat2 = chevronMat.clone();
            this.rampChevronMaterials.push(chevronMat2);

            // Build bars with animated materials
            this.addChevronBarWithMaterial(tip, rightBack, chevronThickness, up, binormal, chevronMat, this.rampGroup);
            this.addChevronBarWithMaterial(tip, leftBack, chevronThickness, up, binormal, chevronMat2, this.rampGroup);
        }

        // Add a subtle translucent plate spanning the ramp length for glow
        // Build at the center of the ramp
        const midT = THREE.MathUtils.euclideanModulo(startT + lengthT * 0.5, 1);
        const midIdx = Math.floor(midT * this.samples) % this.samples;
        const midCenter = this.cachedPositions[midIdx];
        const midUp = this.cachedNormals[midIdx];
        const midBin = this.cachedBinormals[midIdx];
        const midTan = this.cachedTangents[midIdx];

        const plateGeom = new THREE.PlaneGeometry(this.width * 0.98, RAMP.lengthMeters * 0.85);
        const plateMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().lerpColors(RAMP.colorStart, RAMP.colorEnd, 0.5),
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        const plate = new THREE.Mesh(plateGeom, plateMat);
        const z = midUp.clone().normalize(); // plane normal
        const x = midBin.clone().normalize(); // width across track
        const y = new THREE.Vector3().crossVectors(z, x).normalize(); // along track
        const m = new THREE.Matrix4().makeBasis(x, y, z);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        plate.quaternion.copy(q);
        plate.position.copy(midCenter).addScaledVector(midUp, RAMP.thickness * 0.5);
        this.rampGroup.add(plate);
    }

    public getRampAtT(t: number): RampInfo {
        const normalizedT = THREE.MathUtils.euclideanModulo(t, 1);
        for (const seg of this.ramps) {
            const endT = seg.t + seg.lengthT;
            if (endT <= 1.0) {
                if (normalizedT >= seg.t && normalizedT <= endT) {
                    return { onRamp: true };
                }
            } else {
                const wrappedEndT = endT - 1.0;
                if (normalizedT >= seg.t || normalizedT <= wrappedEndT) {
                    return { onRamp: true };
                }
            }
        }
        return { onRamp: false };
    }

    // Animate ramp arrow opacity to create a forward-moving pulse
    public updateRampAnimation(currentTime: number) {
        if (this.rampChevronMaterials.length === 0) return;
        const speed = 3.2; // wave speed
        const base = 0.35;
        const range = 0.6;
        const count = this.rampChevronMaterials.length;
        for (let i = 0; i < count; i++) {
            const phase = (i / count) * Math.PI * 2;
            const s = Math.sin(currentTime * speed + phase) * 0.5 + 0.5; // 0..1
            const opacity = base + range * s;
            const mat = this.rampChevronMaterials[i];
            mat.opacity = opacity;
        }
    }

    private addChevronBarWithMaterial(
        start: THREE.Vector3,
        end: THREE.Vector3,
        thickness: number,
        up: THREE.Vector3,
        binormal: THREE.Vector3,
        material: THREE.MeshBasicMaterial,
        group: THREE.Group
    ) {
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();
        const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

        const barGeom = new THREE.BoxGeometry(thickness, thickness * 0.5, length);
        const bar = new THREE.Mesh(barGeom, material);
        bar.position.copy(center);

        const forward = direction.clone().normalize();
        const right = new THREE.Vector3().crossVectors(up, forward).normalize();
        const upNorm = new THREE.Vector3().crossVectors(forward, right).normalize();
        const m = new THREE.Matrix4().makeBasis(right, upNorm, forward);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        bar.quaternion.copy(q);

        group.add(bar);
    }

    private createBoostPadVisual(startT: number, lengthT: number) {
        // Create chevron arrows pointing in the direction of travel
        const chevronCount = Math.max(3, Math.floor(BOOST_PAD.lengthMeters / 12));

        for (let i = 0; i < chevronCount; i++) {
            const progress = i / chevronCount;
            const t = startT + progress * lengthT;
            const idx = Math.floor(THREE.MathUtils.euclideanModulo(t, 1) * this.samples) % this.samples;
            const center = this.cachedPositions[idx];
            const binormal = this.cachedBinormals[idx];
            const up = this.cachedNormals[idx];
            const tangent = this.cachedTangents[idx];

            // Create a chevron shape (arrow pointing forward)
            const chevronWidth = this.width * 0.8;
            const chevronLength = 6; // length along track direction
            const chevronThickness = 1.2; // thickness of the arrow lines

            // Chevron geometry: V shape pointing forward
            // We'll create two diagonal bars forming a > shape
            const positions: number[] = [];
            const colors: number[] = [];
            const indices: number[] = [];

            // Color based on position
            const color = new THREE.Color().lerpColors(BOOST_PAD.colorStart, BOOST_PAD.colorEnd, progress);

            // Create the two diagonal bars of the chevron
            // Right bar: from center-front to right-back
            // Left bar: from center-front to left-back

            const tipOffset = chevronLength * 0.5; // tip of arrow
            const backOffset = -chevronLength * 0.5; // back of arrow
            const sideOffset = chevronWidth * 0.5;

            // Tip point (center front)
            const tip = new THREE.Vector3()
                .copy(center)
                .addScaledVector(tangent, tipOffset)
                .addScaledVector(up, BOOST_PAD.thickness);

            // Right back point
            const rightBack = new THREE.Vector3()
                .copy(center)
                .addScaledVector(tangent, backOffset)
                .addScaledVector(binormal, sideOffset)
                .addScaledVector(up, BOOST_PAD.thickness);

            // Left back point
            const leftBack = new THREE.Vector3()
                .copy(center)
                .addScaledVector(tangent, backOffset)
                .addScaledVector(binormal, -sideOffset)
                .addScaledVector(up, BOOST_PAD.thickness);

            // Build right bar (thick line from tip to right back)
            this.addChevronBar(tip, rightBack, chevronThickness, up, binormal, color, this.boostPadGroup);

            // Build left bar (thick line from tip to left back)
            this.addChevronBar(tip, leftBack, chevronThickness, up, binormal, color, this.boostPadGroup);

            // Add glow sphere at the tip
            const glowGeom = new THREE.SphereGeometry(0.8, 12, 12);
            const glowMat = new THREE.MeshBasicMaterial({
                color: BOOST_PAD.colorStart,
                transparent: true,
                opacity: 0.7,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });
            const glowSphere = new THREE.Mesh(glowGeom, glowMat);
            glowSphere.position.copy(tip);
            this.boostPadGroup.add(glowSphere);
        }
    }

    private addChevronBar(
        start: THREE.Vector3,
        end: THREE.Vector3,
        thickness: number,
        up: THREE.Vector3,
        binormal: THREE.Vector3,
        color: THREE.Color,
        group: THREE.Group
    ) {
        // Create a thick line segment using box geometry
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();
        const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

        const barGeom = new THREE.BoxGeometry(thickness, thickness * 0.5, length);
        const barMat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });

        const bar = new THREE.Mesh(barGeom, barMat);
        bar.position.copy(center);

        // Orient the bar along the direction
        const forward = direction.clone().normalize();
        const right = new THREE.Vector3().crossVectors(up, forward).normalize();
        const upNorm = new THREE.Vector3().crossVectors(forward, right).normalize();
        const m = new THREE.Matrix4().makeBasis(right, upNorm, forward);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        bar.quaternion.copy(q);

        group.add(bar);
    }

    public getBoostPadAtT(t: number): BoostPadInfo {
        const normalizedT = THREE.MathUtils.euclideanModulo(t, 1);

        for (const pad of this.boostPads) {
            const endT = pad.t + pad.lengthT;
            let onPad = false;

            // Handle wrap-around case
            if (endT <= 1.0) {
                // Normal case: pad doesn't wrap around t=0/1
                onPad = normalizedT >= pad.t && normalizedT <= endT;
            } else {
                // Wrap case: pad crosses t=0/1 boundary
                const wrappedEndT = endT - 1.0;
                onPad = normalizedT >= pad.t || normalizedT <= wrappedEndT;
            }

            if (onPad) {
                return {
                    onPad: true,
                    boostActive: true,
                    boostTimer: BOOST_PAD.boostDuration
                };
            }
        }

        return {
            onPad: false,
            boostActive: false,
            boostTimer: 0
        };
    }
}


