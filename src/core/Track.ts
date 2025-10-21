import * as THREE from 'three';
import { COLORS, TRACK_OPTS, TRACK_SOURCE, CUSTOM_TRACK_POINTS, TUNNEL, BOOST_PAD } from './constants';
import type { TrackOptions, TrackSample, TunnelSegment, TunnelInfo, BoostPadSegment, BoostPadInfo } from './types';

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
        this.buildTunnels();
        this.buildBoostPads();
        this.buildStartLine(); // Build after tunnels so we can position relative to first tunnel
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

        // Gate dimensions
        const gateHeight = 12;
        const postRadius = 0.4; // Make poles thicker for better visibility
        const crossbarHeight = 0.4;
        const crossbarWidth = 0.3;

        // Create vertical posts (left and right) - position them directly at start line
        const postGeom = new THREE.CylinderGeometry(postRadius, postRadius, gateHeight, 12);

        // Left post - position at track edge at start line
        const leftPost = new THREE.Mesh(postGeom, gateMat);
        const leftPostPos = new THREE.Vector3()
            .copy(center)
            .addScaledVector(bin, -this.width * 0.5 - 0.1) // Just outside left track edge
            .addScaledVector(up, gateHeight * 0.5);
        leftPost.position.copy(leftPostPos);
        this.root.add(leftPost); // Add directly to root, not gate group

        // Right post - position at track edge at start line
        const rightPost = new THREE.Mesh(postGeom, gateMat);
        const rightPostPos = new THREE.Vector3()
            .copy(center)
            .addScaledVector(bin, this.width * 0.5 + 0.1) // Just outside right track edge
            .addScaledVector(up, gateHeight * 0.5);
        rightPost.position.copy(rightPostPos);
        this.root.add(rightPost); // Add directly to root, not gate group

        // Add some debug info to ensure poles are being created
        console.log('Created starting gate with poles at positions:', leftPostPos, rightPostPos);
        console.log('Track width:', this.width, 'Center position:', center);
        console.log('Track vectors - up:', up, 'bin:', bin, 'tan:', tan);

        // Create gate group for text only
        const gateGroup = new THREE.Group();

        // Horizontal crossbar connecting the posts - position directly at start line
        const crossbarLength = this.width + 0.2; // Span the track width plus small margin
        const crossbarGeom = new THREE.BoxGeometry(crossbarLength, crossbarHeight, crossbarWidth);
        const crossbar = new THREE.Mesh(crossbarGeom, gateMat);
        const crossbarPos = new THREE.Vector3()
            .copy(center)
            .addScaledVector(up, gateHeight);
        crossbar.position.copy(crossbarPos);
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
        const textYOffset = 5.0; // Higher above starting line

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
        // Text should read left-to-right across the track width
        const m = new THREE.Matrix4().makeBasis(trackForward, trackUp, trackRight.clone().negate());
        const q = new THREE.Quaternion().setFromRotationMatrix(m);

        gateGroup.quaternion.copy(q);
        gateGroup.position.copy(center).addScaledVector(up, textYOffset);

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

    private buildBoostPads() {
        // Clear old boost pads
        if (this.boostPadGroup.parent) this.root.remove(this.boostPadGroup);
        this.boostPadGroup = new THREE.Group();
        this.boostPads = [];

        // Calculate number of boost pads based on track length and spacing
        const count = Math.floor(this.length / BOOST_PAD.spacing);
        const actualSpacing = this.length / count; // evenly distribute

        for (let i = 0; i < count; i++) {
            const startMeters = i * actualSpacing;
            const startT = startMeters / this.length;
            const lengthT = BOOST_PAD.lengthMeters / this.length;

            this.boostPads.push({ t: startT, lengthT });

            // Create visual boost pad stripe across the track
            this.createBoostPadVisual(startT, lengthT);
        }

        this.root.add(this.boostPadGroup);
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


