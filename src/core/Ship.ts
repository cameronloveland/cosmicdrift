import * as THREE from 'three';
import { CAMERA, COLORS, LAPS_TOTAL, PHYSICS, TUNNEL, BOOST_PAD, FOCUS_REFILL, DRIFT } from './constants';
import { Track } from './Track';
import { ShipRocketTail } from './ShipRocketTail';

function kmhToMps(kmh: number) { return kmh / 3.6; }

export class Ship {
    public root = new THREE.Group();
    public state = {
        t: 0,
        speedKmh: 0, // Start completely stationary
        lateralOffset: 0,
        pitch: 0,
        flow: 0,
        boosting: false,
        lapCurrent: 0, // Start at lap 0 (pre-race)
        lapTotal: LAPS_TOTAL,
        boostLevel: 1,
        inTunnel: false,
        tunnelCenterBoost: 1.0, // multiplier from tunnel center alignment
        lastLapTime: 0,
        lapTimes: [] as number[],
        onBoostPadEntry: false, // true when just entered a boost pad (resets after check)
        isDrifting: false, // true when drifting (turning + boosting)
        driftDuration: 0, // accumulated drift time in seconds
        driftLength: 0, // accumulated drift distance in meters
    };

    private track: Track;
    private camera: THREE.PerspectiveCamera;
    private cameraControlEnabled = true; // can be disabled for free fly mode
    private inputEnabled = false; // disabled during countdown
    private velocitySide = 0;
    private velocityPitch = 0;
    private boostTimer = 0; // visual intensity for camera/shake
    private wasDrifting = false; // track previous frame's drift state
    private boostEnergy = 1; // 0..1 manual boost resource
    private boostRechargeDelay = 0; // countdown timer for recharge delay (0 = can recharge)
    private boostKeyWasPressed = false; // track previous frame's boost key state to detect release
    private boostEnergyPrevious = 1; // track previous frame's boost energy to detect depletion
    private now = 0;
    // lap detection helpers
    private prevT = 0;
    private checkpointT = 0.0; // could move later; start line
    private hasCrossedCheckpointThisFrame = false;
    private lapStartTime = 0; // Time when the current lap started
    private lapTime = 0; // Time elapsed since the start of the current lap

    private mouseYawTarget = 0;
    private mousePitchTarget = 0;
    private mouseYaw = 0;
    private mousePitch = 0;
    private mouseButtonDown = false;

    // Mario Kart-style camera tracking
    private cameraYaw = 0;
    private cameraYawVelocity = 0;
    private targetCameraYaw = 0;

    private tunnelBoostAccumulator = 1.0; // tracks current tunnel boost multiplier
    private boostPadMultiplier = 1.0; // tracks current boost pad multiplier
    private boostPadTimer = 0; // remaining boost pad duration
    private wasOnBoostPad = false; // track previous frame's boost pad state to detect entry
    private baseFov = CAMERA.fov;
    private currentFov = CAMERA.fov;

    // Focus refill state
    private focusRefillActive = false;
    private focusRefillProgress = 0;
    private focusRefillDuration = FOCUS_REFILL.duration;

    private shipMaterial!: THREE.MeshStandardMaterial;
    private glowMaterial!: THREE.MeshBasicMaterial;
    private engineGlow!: THREE.Mesh;
    public rocketTail!: ShipRocketTail;

    private tmp = {
        pos: new THREE.Vector3(),
        tangent: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        binormal: new THREE.Vector3(),
        right: new THREE.Vector3(),
        up: new THREE.Vector3(),
        forward: new THREE.Vector3()
    };

    private addEdgeLines(mesh: THREE.Mesh): void {
        // Create edge geometry from the mesh geometry
        const edgesGeometry = new THREE.EdgesGeometry(mesh.geometry);
        const edgeMaterial = new THREE.LineBasicMaterial({
            color: 0x000000
        });
        const edges = new THREE.LineSegments(edgesGeometry, edgeMaterial);
        // Add as child of mesh so it inherits all transformations (position, rotation, scale)
        mesh.add(edges);
    }

    private createShipHullGeometry(): THREE.BufferGeometry {
        // Create simple wedge hull - basic triangular prism shape
        // Points defined in local space (ship faces forward along +Z)

        const vertices: number[] = [];
        const indices: number[] = [];

        // Simple wedge dimensions
        const length = 1.2;        // Ship length
        const frontWidth = 0.08;   // Small width at front tip (not a pure point)
        const rearWidth = 0.5;     // Wider rear
        const frontHeight = 0.05;  // Front height (lower - slanted hood)
        const rearHeight = 0.25;   // Rear height (taller - kept high)

        const frontZ = length * 0.5;
        const rearZ = -length * 0.5;

        // Helper to add vertex and return index
        const addVertex = (v: THREE.Vector3): number => {
            const idx = vertices.length / 3;
            vertices.push(v.x, v.y, v.z);
            return idx;
        };

        // Front face (small width at nose, not a pure point - lower slanted hood effect)
        const frontTopLeft = addVertex(new THREE.Vector3(-frontWidth * 0.5, frontHeight * 0.5, frontZ));
        const frontTopRight = addVertex(new THREE.Vector3(frontWidth * 0.5, frontHeight * 0.5, frontZ));
        const frontBottomLeft = addVertex(new THREE.Vector3(-frontWidth * 0.5, -frontHeight * 0.5, frontZ));
        const frontBottomRight = addVertex(new THREE.Vector3(frontWidth * 0.5, -frontHeight * 0.5, frontZ));

        // Rear face (wider, taller - top stays high for slanted hood)
        const rearTopLeft = addVertex(new THREE.Vector3(-rearWidth * 0.5, rearHeight * 0.5, rearZ));
        const rearTopRight = addVertex(new THREE.Vector3(rearWidth * 0.5, rearHeight * 0.5, rearZ));
        const rearBottomLeft = addVertex(new THREE.Vector3(-rearWidth * 0.5, -rearHeight * 0.5, rearZ));
        const rearBottomRight = addVertex(new THREE.Vector3(rearWidth * 0.5, -rearHeight * 0.5, rearZ));

        // Build wedge with front face (not a pure point) - all sides properly enclosed
        // Top face (quadrilateral from front to rear)
        indices.push(frontTopLeft, frontTopRight, rearTopLeft);
        indices.push(frontTopRight, rearTopRight, rearTopLeft);

        // Bottom face (quadrilateral from front to rear)
        indices.push(frontBottomLeft, rearBottomLeft, frontBottomRight);
        indices.push(frontBottomRight, rearBottomLeft, rearBottomRight);

        // Left side (two triangles to form quadrilateral)
        indices.push(frontTopLeft, frontBottomLeft, rearTopLeft);
        indices.push(frontBottomLeft, rearBottomLeft, rearTopLeft);

        // Right side (two triangles to form quadrilateral)
        indices.push(frontTopRight, rearTopRight, frontBottomRight);
        indices.push(frontBottomRight, rearTopRight, rearBottomRight);

        // Rear face (two triangles to form quadrilateral)
        indices.push(rearTopLeft, rearBottomLeft, rearTopRight);
        indices.push(rearBottomLeft, rearBottomRight, rearTopRight);

        // Front face (nose) - flat face with width (not a pure point)
        indices.push(frontTopLeft, frontBottomLeft, frontTopRight);
        indices.push(frontBottomLeft, frontBottomRight, frontTopRight);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return geometry;
    }

    constructor(track: Track, camera: THREE.PerspectiveCamera) {
        this.track = track;
        this.camera = camera;

        // Simple wedge ship hull
        const body = new THREE.Group();

        // Create simple wedge geometry
        const hullGeometry = this.createShipHullGeometry();

        this.shipMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.neonCyan,
            metalness: 0.3,
            roughness: 0.2,
            emissive: COLORS.neonCyan.clone().multiplyScalar(0.8),
            transparent: false,
            opacity: 1.0,
            side: THREE.DoubleSide
        });
        const hullMesh = new THREE.Mesh(hullGeometry, this.shipMaterial);
        body.add(hullMesh);
        this.addEdgeLines(hullMesh);

        // Jet wings (swept-back angular wings) - 20% height, lowered on wedge body
        const wingMaterial = this.shipMaterial.clone();
        const wingTop = -0.01;    // Top of wing (lowered on body)
        const wingBottom = -0.05; // Bottom of wing (lower on body)

        // Left wing - swept back with blunt/square tip (touching center wedge, thin)
        const leftWingGeo = new THREE.BufferGeometry();
        const leftWingVerts = new Float32Array([
            // Root at fuselage (top vertices)
            -0.15, wingTop, 0,
            -0.2, wingTop, -0.5,   // Trailing edge at root
            // Wing tip - blunt/square edge (two points forming a flat tip)
            -0.7, wingTop - 0.004, -0.35,  // Tip leading edge (forward point)
            -0.68, wingTop - 0.004, -0.45, // Tip trailing edge (rear point)
            // Root at fuselage (bottom vertices)
            -0.15, wingBottom, 0,
            -0.2, wingBottom, -0.5,   // Trailing edge at root
            // Wing tip bottom - blunt/square edge
            -0.7, wingBottom - 0.004, -0.35,  // Tip leading edge (forward point)
            -0.68, wingBottom - 0.004, -0.45  // Tip trailing edge (rear point)
        ]);
        leftWingGeo.setAttribute('position', new THREE.BufferAttribute(leftWingVerts, 3));
        leftWingGeo.setIndex([
            // Top surface (quad with blunt tip)
            0, 2, 1,
            1, 2, 3,
            // Bottom surface
            4, 6, 5,
            5, 6, 7,
            // Front edge (leading edge)
            0, 4, 2,
            2, 4, 6,
            // Rear edge (trailing edge)
            1, 5, 3,
            3, 5, 7,
            // Outboard edge (blunt tip - flat edge perpendicular to wing)
            2, 6, 3,
            3, 6, 7,
            // Root edge (complete, connects to fuselage)
            0, 4, 1,
            1, 4, 5
        ]);
        leftWingGeo.computeVertexNormals();

        const leftWing = new THREE.Mesh(leftWingGeo, wingMaterial);
        body.add(leftWing);
        this.addEdgeLines(leftWing);

        // Right wing - swept back with blunt/square tip (mirrored, touching center wedge, thin)
        const rightWingGeo = new THREE.BufferGeometry();
        const rightWingVerts = new Float32Array([
            // Root at fuselage (top vertices)
            0.15, wingTop, 0,
            0.2, wingTop, -0.5,   // Trailing edge at root
            // Wing tip - blunt/square edge (two points forming a flat tip)
            0.7, wingTop - 0.004, -0.35,  // Tip leading edge (forward point)
            0.68, wingTop - 0.004, -0.45, // Tip trailing edge (rear point)
            // Root at fuselage (bottom vertices)
            0.15, wingBottom, 0,
            0.2, wingBottom, -0.5,   // Trailing edge at root
            // Wing tip bottom - blunt/square edge
            0.7, wingBottom - 0.004, -0.35,  // Tip leading edge (forward point)
            0.68, wingBottom - 0.004, -0.45  // Tip trailing edge (rear point)
        ]);
        rightWingGeo.setAttribute('position', new THREE.BufferAttribute(rightWingVerts, 3));
        rightWingGeo.setIndex([
            // Top surface (quad with blunt tip)
            0, 1, 2,
            1, 3, 2,
            // Bottom surface
            4, 5, 6,
            5, 7, 6,
            // Front edge (leading edge)
            0, 2, 4,
            2, 6, 4,
            // Rear edge (trailing edge)
            1, 3, 5,
            3, 7, 5,
            // Outboard edge (blunt tip - flat edge perpendicular to wing)
            2, 3, 6,
            3, 7, 6,
            // Root edge (complete, connects to fuselage)
            0, 1, 4,
            1, 5, 4
        ]);
        rightWingGeo.computeVertexNormals();

        const rightWing = new THREE.Mesh(rightWingGeo, wingMaterial);
        body.add(rightWing);
        this.addEdgeLines(rightWing);

        // Tail fins (vertical stabilizers) - triangular/trapezoidal shape, wider at bottom, tapering to top
        const tailFinMaterial = this.shipMaterial.clone();

        // Left tail fin - swept-back design like modern jet aircraft
        const leftTailFinGeo = new THREE.BufferGeometry();
        const leftTailFinVerts = new Float32Array([
            // Bottom vertices (wider base, placed lower, extended front-to-back)
            -0.2, 0.05, -0.35,   // Bottom front outer (more forward)
            -0.18, 0.05, -0.75,  // Bottom rear outer (more backward)
            -0.12, 0.05, -0.35,  // Bottom front inner (more forward)
            -0.1, 0.05, -0.75,   // Bottom rear inner (more backward)
            // Top edge - swept back dramatically (leading edge angles back, trailing edge also sweeps back)
            -0.28, 0.25, -0.55,  // Top front point (swept back from bottom front)
            -0.26, 0.25, -0.90   // Top rear point (slightly further back than bottom rear)
        ]);
        leftTailFinGeo.setAttribute('position', new THREE.BufferAttribute(leftTailFinVerts, 3));
        leftTailFinGeo.setIndex([
            // Outer face (quad - has top edge length)
            0, 1, 4,
            1, 5, 4,
            // Inner face (quad)
            2, 4, 3,
            3, 4, 5,
            // Bottom edge (quad)
            0, 2, 1,
            1, 2, 3,
            // Front edge (triangle)
            0, 2, 4,
            // Rear edge (triangle)
            1, 5, 3,
            // Top edge is formed by outer/inner faces connecting the two top points (4, 5)
            // Left edge (triangles)
            0, 1, 2
        ]);
        leftTailFinGeo.computeVertexNormals();

        const leftTailFin = new THREE.Mesh(leftTailFinGeo, tailFinMaterial);
        leftTailFin.rotation.z = -0.15; // Slight outward tilt
        body.add(leftTailFin);
        this.addEdgeLines(leftTailFin);

        // Right tail fin - swept-back design like modern jet aircraft
        const rightTailFinGeo = new THREE.BufferGeometry();
        const rightTailFinVerts = new Float32Array([
            0.2, 0.05, -0.35,   // Bottom front outer (more forward)
            0.18, 0.05, -0.75,  // Bottom rear outer (more backward)
            0.12, 0.05, -0.35,  // Bottom front inner (more forward)
            0.1, 0.05, -0.75,   // Bottom rear inner (more backward)
            0.28, 0.25, -0.55,  // Top front point (swept back from bottom front)
            0.26, 0.25, -0.90   // Top rear point (slightly further back than bottom rear)
        ]);
        rightTailFinGeo.setAttribute('position', new THREE.BufferAttribute(rightTailFinVerts, 3));
        rightTailFinGeo.setIndex([
            // Outer face (quad - has top edge length)
            0, 4, 1,
            1, 4, 5,
            // Inner face (quad)
            2, 3, 4,
            3, 5, 4,
            // Bottom edge (quad)
            0, 1, 2,
            1, 3, 2,
            // Front edge (triangle)
            0, 4, 2,
            // Rear edge (triangle)
            1, 3, 5,
            // Top edge is formed by outer/inner faces connecting the two top points (4, 5)
            // Right edge (triangles)
            0, 2, 1
        ]);
        rightTailFinGeo.computeVertexNormals();

        const rightTailFin = new THREE.Mesh(rightTailFinGeo, tailFinMaterial);
        rightTailFin.rotation.z = 0.15;
        body.add(rightTailFin);
        this.addEdgeLines(rightTailFin);

        // Rocket booster on the back (smaller) - using ship base color but slightly darker
        const boosterColor = COLORS.neonCyan.clone().multiplyScalar(0.4); // Darker version of ship color
        const boosterMaterial = new THREE.MeshStandardMaterial({
            color: boosterColor,
            metalness: 0.8,
            roughness: 0.2,
            emissive: boosterColor.clone().multiplyScalar(0.3)
        });

        // Booster body (cylinder - made smaller)
        const boosterBody = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.12, 0.2, 12),
            boosterMaterial
        );
        boosterBody.rotation.x = Math.PI / 2;
        boosterBody.position.set(0, 0, -0.65);
        body.add(boosterBody);
        this.addEdgeLines(boosterBody);

        // Booster nozzle (wider opening - made smaller)
        const boosterNozzle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.15, 0.1, 0.1, 12),
            boosterMaterial
        );
        boosterNozzle.rotation.x = Math.PI / 2;
        boosterNozzle.position.set(0, 0, -0.72);
        body.add(boosterNozzle);
        this.addEdgeLines(boosterNozzle);

        // Engine glow effect (from rocket booster) - blue to orange gradient
        this.glowMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff, // White base, will use vertex colors
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            vertexColors: true // Enable vertex colors for gradient
        });

        // Create rocket booster flame with blue-to-orange gradient
        const coneGeometry = new THREE.ConeGeometry(0.12, 0.3, 16, 1, true);

        // Add vertex colors for blue-to-orange gradient
        const colors: number[] = [];
        const positions = coneGeometry.attributes.position.array;
        const vertexCount = positions.length / 3;

        for (let i = 0; i < vertexCount; i++) {
            // Y coordinate determines position along cone (0 at base, 0.15 at tip for height 0.3)
            const yPos = positions[i * 3 + 1];
            const normalizedY = (yPos + 0.15) / 0.3; // Normalize to 0-1
            const clampedY = THREE.MathUtils.clamp(normalizedY, 0, 1);

            // Gradient: 30% blue, then blend to vibrant orange at tip
            const blueColor = new THREE.Color(0.2, 0.6, 1.0); // Bright blue
            const vibrantOrangeColor = new THREE.Color(1.0, 0.5, 0.0); // Vibrant orange
            const orangeColor = new THREE.Color(1.0, 0.6, 0.15); // Orange transition

            let gradientColor: THREE.Color;
            if (clampedY <= 0.3) {
                // First 30%: pure blue
                gradientColor = blueColor;
            } else if (clampedY <= 0.7) {
                // 30-70%: blue to orange
                const t = (clampedY - 0.3) / 0.4;
                gradientColor = blueColor.clone().lerp(orangeColor, t);
            } else {
                // 70-100%: orange to vibrant orange at tip
                const t = (clampedY - 0.7) / 0.3;
                gradientColor = orangeColor.clone().lerp(vibrantOrangeColor, t);
            }

            colors.push(gradientColor.r, gradientColor.g, gradientColor.b);
        }

        coneGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        this.engineGlow = new THREE.Mesh(coneGeometry, this.glowMaterial);
        this.engineGlow.position.set(0, 0, -0.9); // Start at nozzle
        this.engineGlow.rotation.x = -Math.PI / 2; // Point backward
        body.add(this.engineGlow);

        this.root.add(body);

        // Create rocket tail boost effect (initially hidden)
        // Position further back at jet engine nozzle opening (z=-0.85) so tail starts right at the nozzle
        this.rocketTail = new ShipRocketTail(
            this,
            new THREE.Vector3(0, 0, -0.85),
            0 // no baseClipOffset for player ship
        );
        this.root.add(this.rocketTail.root);

        // Double the ship size
        this.root.scale.set(3, 3, 3);

        window.addEventListener('keydown', (e) => this.onKey(e, true));
        window.addEventListener('keyup', (e) => this.onKey(e, false));
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mousedown', (e) => this.onMouseButton(e, true));
        window.addEventListener('mouseup', (e) => this.onMouseButton(e, false));
        window.addEventListener('contextmenu', (e) => e.preventDefault());

        // Start 12 meters behind the starting line
        this.state.t = -12 / this.track.length // Start 12 meters behind start line

        // Initially disable camera control (will be enabled after splash transition)
        this.cameraControlEnabled = false;
    }

    public input = { left: false, right: false, up: false, down: false, boost: false };

    private onKey(e: KeyboardEvent, down: boolean) {
        // Only process input if input is enabled (not during countdown)
        if (!this.inputEnabled) return;

        if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.input.left = down;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') this.input.right = down;
        if (e.code === 'ArrowUp' || e.code === 'KeyW') this.input.up = down;
        if (e.code === 'ArrowDown' || e.code === 'KeyS') this.input.down = down;
        if (e.code === 'Space') this.input.boost = down;

        // Focus refill key (F key)
        if (e.code === 'KeyF' && down) {
            this.triggerFocusRefill();
        }
    }

    private onMouseMove(e: MouseEvent) {
        // Click-to-look: only update camera when mouse button is held
        if (!this.mouseButtonDown) return;
        const dx = e.movementX;
        const dy = e.movementY;
        if (dx === 0 && dy === 0) return;
        this.mouseYawTarget = THREE.MathUtils.clamp(this.mouseYawTarget - dx * 0.002, -0.6, 0.6);
        this.mousePitchTarget = THREE.MathUtils.clamp(this.mousePitchTarget + dy * 0.0015, -0.35, 0.35);
    }

    private onMouseButton(e: MouseEvent, down: boolean) {
        // Temporarily disable all mouse handling to test UI
        return; // Disable all mouse handling for now

        // Check if the click is on a UI element
        const target = e.target as HTMLElement;
        const isUIElement = target.closest('.planet-fx, .radio, .hud .control, input, button, label');


        // Only prevent default for non-UI elements
        if (!isUIElement && (e.button === 0 || e.button === 1 || e.button === 2)) {
            e.preventDefault();
            this.mouseButtonDown = down;
        } else if (isUIElement) {
        }
    }

    clearInput() {
        this.input.left = false;
        this.input.right = false;
        this.input.up = false;
        this.input.down = false;
        this.input.boost = false;
    }

    setCameraControl(enabled: boolean) {
        this.cameraControlEnabled = enabled;
    }

    enableInput() {
        this.inputEnabled = true;
    }

    disableInput() {
        this.inputEnabled = false;
    }

    private triggerFocusRefill() {
        // Check if flow is nearly full and not already refilling
        if (this.state.flow >= FOCUS_REFILL.minFlowRequired && !this.focusRefillActive) {
            this.focusRefillActive = true;
            this.focusRefillProgress = 0;
        }
    }

    startRace() {
        // Keep lap at 0 - we start before the start line
        // Lap will increment to 1 when crossing the start line for the first time
        // Reset checkpoint flag to ensure clean detection
        this.hasCrossedCheckpointThisFrame = false;
        // Ensure prevT is set correctly
        this.prevT = this.state.t;
        this.lapStartTime = this.now; // Initialize lap start time
        this.lapTime = 0; // Reset lap time
    }

    reset() {
        // Reset ship to starting position and state
        this.state.t = -12 / this.track.length; // Start 12 meters behind start line (matches constructor)
        this.state.speedKmh = 0;
        this.state.lateralOffset = 0;
        this.state.pitch = 0;
        this.state.flow = 0;
        this.state.boosting = false;
        this.state.lapCurrent = 0; // Reset to pre-race
        this.state.boostLevel = 1;
        this.state.inTunnel = false;
        this.state.tunnelCenterBoost = 1.0;

        // Reset internal state
        this.velocitySide = 0;
        this.velocityPitch = 0;
        this.boostTimer = 0;
        this.boostEnergy = 1;
        this.boostRechargeDelay = 0;
        this.boostKeyWasPressed = false;
        this.boostEnergyPrevious = 1;
        this.now = 0;
        this.prevT = this.state.t; // Initialize to match starting position
        this.checkpointT = 0.0;
        this.hasCrossedCheckpointThisFrame = false;
        this.mouseYawTarget = 0;
        this.mousePitchTarget = 0;
        this.mouseYaw = 0;
        this.mousePitch = 0;
        this.mouseButtonDown = false;
        this.cameraYaw = 0;
        this.cameraYawVelocity = 0;
        this.targetCameraYaw = 0;
        this.tunnelBoostAccumulator = 1.0;
        this.boostPadMultiplier = 1.0;
        this.boostPadTimer = 0;
        this.currentFov = this.baseFov;
        this.lapStartTime = this.now; // Reset lap start time
        this.lapTime = 0; // Reset lap time

        // Reset focus refill state
        this.focusRefillActive = false;
        this.focusRefillProgress = 0;

        // Reset drift state
        this.state.isDrifting = false;
        this.state.driftDuration = 0;
        this.state.driftLength = 0;
        this.wasDrifting = false;

        // Clear input
        this.clearInput();

        // Reset camera FOV
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
    }


    update(dt: number) {
        this.now += dt;

        // Don't move during countdown (when input is disabled)
        if (!this.inputEnabled) {
            this.state.speedKmh = 0;
            // Still update ship position and camera even when input is disabled
            this.updatePositionAndCamera(dt);
            return;
        }

        // speed and boost
        // Manual boost resource: drains while active, regens when not held (with delay)
        let isBoosting = false;
        const boostKeyCurrentlyPressed = this.input.boost;

        // Check if we were boosting in the previous frame
        const wasBoostingLastFrame = this.boostKeyWasPressed && this.boostEnergy > 0.01;

        if (boostKeyCurrentlyPressed && this.boostEnergy > 0) {
            isBoosting = true;
            this.boostEnergy = Math.max(0, this.boostEnergy - dt / PHYSICS.boostDurationSec);
        }

        // Detect if boost just ran out (energy drained to 0 while boosting)
        const boostJustRanOut = this.boostEnergyPrevious > 0 && this.boostEnergy <= 0 && this.boostKeyWasPressed;

        // Detect boost key release to start recharge delay
        if (!boostKeyCurrentlyPressed && wasBoostingLastFrame) {
            this.boostRechargeDelay = PHYSICS.boostRechargeDelaySec;
        }

        // If boost just ran out while holding, start recharge delay
        if (boostJustRanOut && boostKeyCurrentlyPressed) {
            this.boostRechargeDelay = PHYSICS.boostRechargeDelaySec;
        }

        // Decrement recharge delay timer
        if (this.boostRechargeDelay > 0) {
            this.boostRechargeDelay = Math.max(0, this.boostRechargeDelay - dt);
        }

        // Only regenerate boost energy when not actively boosting, delay has elapsed, and key is not pressed
        if (!isBoosting && !boostKeyCurrentlyPressed && this.boostRechargeDelay <= 0) {
            this.boostEnergy = Math.min(1, this.boostEnergy + PHYSICS.boostRegenPerSec * dt);
        }

        // Update previous frame's state
        this.boostKeyWasPressed = boostKeyCurrentlyPressed;
        this.boostEnergyPrevious = this.boostEnergy;

        const manual = isBoosting ? PHYSICS.boostMultiplier : 1;

        // Tunnel boost logic: progressive boost based on center alignment
        const tunnelInfo = this.track.getTunnelAtT(this.state.t, this.state.lateralOffset);
        this.state.inTunnel = tunnelInfo.inTunnel;

        if (tunnelInfo.inTunnel && tunnelInfo.centerAlignment >= TUNNEL.centerThreshold) {
            // Accumulate boost when well-centered in tunnel
            const targetBoost = 1 + (TUNNEL.centerBoostMultiplier - 1) * tunnelInfo.centerAlignment;
            this.tunnelBoostAccumulator = THREE.MathUtils.lerp(
                this.tunnelBoostAccumulator,
                targetBoost,
                TUNNEL.boostAccumulationSpeed * dt
            );
        } else {
            // Decay boost when not in tunnel or not centered
            this.tunnelBoostAccumulator = THREE.MathUtils.lerp(
                this.tunnelBoostAccumulator,
                1.0,
                TUNNEL.boostDecaySpeed * dt
            );
        }
        this.state.tunnelCenterBoost = this.tunnelBoostAccumulator;

        // Boost pad logic: temporary speed boost when driving over pads
        const boostPadInfo = this.track.getBoostPadAtT(this.state.t);
        const justEnteredBoostPad = boostPadInfo.onPad && !this.wasOnBoostPad;
        if (boostPadInfo.onPad) {
            // On a boost pad - activate boost and reset timer
            this.boostPadTimer = BOOST_PAD.boostDuration;
            this.boostPadMultiplier = BOOST_PAD.boostMultiplier;
        } else if (this.boostPadTimer > 0) {
            // Boost pad effect is still active after leaving pad
            this.boostPadTimer = Math.max(0, this.boostPadTimer - dt);
            // Maintain boost multiplier while timer is active
            if (this.boostPadTimer <= 0) {
                this.boostPadMultiplier = 1.0;
            }
        } else {
            // No boost pad effect - decay multiplier smoothly
            this.boostPadMultiplier = THREE.MathUtils.lerp(
                this.boostPadMultiplier,
                1.0,
                BOOST_PAD.boostDecaySpeed * dt
            );
        }

        // Store boost pad state for next frame (to detect entry)
        this.wasOnBoostPad = boostPadInfo.onPad;

        // Expose boost pad entry for audio trigger (set by Game.ts)
        this.state.onBoostPadEntry = justEnteredBoostPad;

        // Auto-cruise: always move forward at base speed with all active multipliers
        const targetSpeed = PHYSICS.baseSpeed * manual * this.tunnelBoostAccumulator * this.boostPadMultiplier;

        const speedLerp = 1 - Math.pow(0.001, dt); // smooth
        // Maintain consistent speed across track width for uniform turning feel
        this.state.speedKmh = THREE.MathUtils.lerp(this.state.speedKmh, targetSpeed, speedLerp);
        this.state.boosting = isBoosting;
        if (isBoosting) this.boostTimer = Math.min(this.boostTimer + dt, 1); else this.boostTimer = Math.max(this.boostTimer - dt * 2, 0);
        this.state.boostLevel = this.boostEnergy;


        // advance along curve
        const mps = kmhToMps(this.state.speedKmh);
        const prevTBeforeUpdate = this.state.t;
        this.state.t += (mps * dt) / this.track.length; // normalize by length

        // lap time calculation
        this.lapTime = this.now - this.lapStartTime;

        // lap detection: crossing checkpoint at t=0
        // Count laps from the start (lapCurrent >= 0)
        if (this.state.lapCurrent >= 0 && !this.hasCrossedCheckpointThisFrame) {
            const prevT = prevTBeforeUpdate;
            let newT = this.state.t;

            // Check if we'll wrap
            const willWrapForward = newT > 1;
            const willWrapBackward = newT < 0;

            // Normal case: crossed from negative to positive (without wrapping)
            const normalCrossing = prevT < 0 && newT >= 0 && !willWrapForward && !willWrapBackward;

            // Wrapping case: detect if we're about to wrap or just wrapped
            let wrappingCrossing = false;
            if (willWrapForward) {
                // We're about to wrap forward: prevT was > 0.5 means we crossed 0
                wrappingCrossing = prevT > 0.5;
                // Wrap now for detection
                newT = newT - 1;
            } else if (willWrapBackward) {
                // Wrapping backward shouldn't happen, but handle it
                wrappingCrossing = false;
            } else {
                // Check if we already wrapped (prevT high, newT low after wrap)
                // This handles the case where wrapping happened in a previous step
                // But since we wrap after detection, we can check: prevT > 0.9 and newT < 0.1
                wrappingCrossing = prevT > 0.9 && newT < 0.1;
            }

            if (normalCrossing || wrappingCrossing) {
                // Increment lap count (0 -> 1, 1 -> 2, 2 -> 3)
                // Race finishes when crossing at lap 3 (lapCurrent >= lapTotal after increment)
                this.state.lapCurrent++;
                this.hasCrossedCheckpointThisFrame = true;

                // Store lap time before resetting
                if (this.state.lapCurrent > 1) {
                    // Lap times after lap 1 (don't count the pre-race countdown lap)
                    this.state.lastLapTime = this.lapTime;
                    this.state.lapTimes!.push(this.lapTime);
                }

                this.lapStartTime = this.now; // Update lap start time
                this.lapTime = 0; // Reset lap time
            }
        }

        // Wrap t after checkpoint detection
        if (this.state.t > 1) this.state.t -= 1;
        if (this.state.t < 0) this.state.t += 1;

        // Update prevT for next frame (after all checks)
        this.prevT = this.state.t;

        // Reset checkpoint flag for next frame
        this.hasCrossedCheckpointThisFrame = false;

        // lateral control
        const sideInput = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
        const targetSideVel = sideInput * PHYSICS.lateralAccel;
        this.velocitySide = THREE.MathUtils.damp(this.velocitySide, targetSideVel, PHYSICS.lateralDamping, dt);

        // Force velocitySide to 0 when there's no input and it's very small (prevents drift)
        if (Math.abs(sideInput) < 0.01 && Math.abs(this.velocitySide) < 0.01) {
            this.velocitySide = 0;
        }

        const half = this.track.width * 0.5;
        const lateralLimit = half * 0.95;
        this.state.lateralOffset = THREE.MathUtils.clamp(this.state.lateralOffset + this.velocitySide * dt, -lateralLimit, lateralLimit);


        // pitch control
        const pitchInput = (this.input.up ? 1 : 0) - (this.input.down ? 1 : 0);
        const targetPitchVel = pitchInput * PHYSICS.pitchAccel;
        this.velocityPitch = THREE.MathUtils.damp(this.velocityPitch, targetPitchVel, PHYSICS.pitchDamping, dt);
        this.state.pitch = THREE.MathUtils.clamp(this.state.pitch + this.velocityPitch * dt, -PHYSICS.pitchMax, PHYSICS.pitchMax);

        // Explicitly damp pitch back to 0 when there's no input (prevents stuck orientation)
        if (Math.abs(pitchInput) < 0.01 && Math.abs(this.velocityPitch) < 0.01) {
            this.state.pitch = THREE.MathUtils.damp(this.state.pitch, 0, PHYSICS.pitchDamping * 1.5, dt);
            // Clamp very small values to 0 to prevent floating point drift
            if (Math.abs(this.state.pitch) < 0.001) {
                this.state.pitch = 0;
                this.velocityPitch = 0;
            }
        }

        // Drift detection: turning (left/right) AND boosting simultaneously
        // sideInput already defined above in lateral control section
        const isTurning = Math.abs(sideInput) > 0.01;
        const isDriftingNow = isTurning && isBoosting;

        // Update drift state
        if (isDriftingNow && !this.wasDrifting) {
            // Drift just started
            this.state.isDrifting = true;
            this.state.driftDuration = 0;
            this.state.driftLength = 0;
        } else if (!isDriftingNow && this.wasDrifting) {
            // Drift just ended
            this.state.isDrifting = false;
        }

        // Accumulate drift duration and length while drifting
        if (this.state.isDrifting) {
            this.state.driftDuration += dt;
            const mps = kmhToMps(this.state.speedKmh);
            this.state.driftLength += mps * dt;
        }

        // Update previous frame's drift state
        this.wasDrifting = isDriftingNow;
        this.state.isDrifting = isDriftingNow;

        // Focus refill logic
        if (this.focusRefillActive) {
            this.focusRefillProgress += dt / this.focusRefillDuration;

            if (this.focusRefillProgress >= 1) {
                // Complete the refill
                this.focusRefillActive = false;
                this.focusRefillProgress = 1;
                this.state.flow = 0;
                this.boostEnergy = 1;
            } else {
                // Progress the refill: drain flow and fill boost proportionally
                const startFlow = 1; // flow starts at 1 when refill begins
                const startBoost = this.boostEnergy; // boost starts at current level

                this.state.flow = THREE.MathUtils.lerp(startFlow, 0, this.focusRefillProgress);
                this.boostEnergy = THREE.MathUtils.lerp(startBoost, 1, this.focusRefillProgress);
            }
        } else {
            // Normal flow meter logic (only when not refilling)
            // Flow only increases when drifting, never drains
            // When flow is full, user can use it to refill boost (focus refill)
            if (this.state.isDrifting) {
                // Only add flow when drifting
                const driftFlowGain = DRIFT.flowRefillRate * dt;
                this.state.flow = THREE.MathUtils.clamp(this.state.flow + driftFlowGain, 0, 1);
            }
            // Flow does not drain - it stays at current level until drifting adds more
            // or until focus refill is used (which drains flow to refill boost)
        }

        // position and orientation from banked Frenet frame
        const { pos, tangent, normal, binormal, right, up, forward } = this.tmp;
        this.track.getPointAtT(this.state.t, pos);
        this.track.getFrenetFrame(this.state.t, normal, binormal, tangent);

        // Construct frame directly from cached normals/binormals for banking
        forward.copy(tangent).normalize();
        right.copy(binormal).normalize();
        up.copy(normal).normalize();

        // apply lateral offset (side to side across the ribbon) and hover height
        pos.addScaledVector(right, this.state.lateralOffset);
        pos.addScaledVector(up, PHYSICS.hoverHeight);

        // compute quaternion from basis vectors (forward, up)
        const m = new THREE.Matrix4();
        const z = forward.clone().normalize();
        const x = new THREE.Vector3().crossVectors(up, z).normalize();
        const y = new THREE.Vector3().crossVectors(z, x).normalize();
        m.makeBasis(x, y, z);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);

        // Apply rotations independently using Euler angles for player input
        // Standard approach in racing games: base orientation from track, inputs as separate Euler rotations
        const shipYaw = -sideInput * CAMERA.shipYawFromInput;
        const bankAngle = THREE.MathUtils.degToRad(22) * THREE.MathUtils.clamp(this.velocitySide / PHYSICS.lateralAccel, -1, 1);

        // Create rotation from Euler with order 'YXZ': Y (yaw) first, X (pitch) second, Z (bank) last
        // Euler(x, y, z, order) where x=pitch, y=yaw, z=bank
        // 'YXZ' order ensures yaw is applied first so it doesn't affect pitch axis
        const inputEuler = new THREE.Euler(this.state.pitch, shipYaw, -bankAngle, 'YXZ');
        const inputQ = new THREE.Quaternion().setFromEuler(inputEuler);

        // Apply input rotation to base quaternion
        // This adds player controls on top of track-aligned base orientation
        q.multiply(inputQ);
        this.root.position.copy(pos);
        this.root.quaternion.copy(q);

        // Update target camera yaw based on ship's yaw rotation
        this.targetCameraYaw = -shipYaw * CAMERA.cameraYawScale;

        // Update camera position
        this.updateCamera(dt);

        // Update rocket tail effect based on boost pad state only
        this.rocketTail.update(dt);

        // Animate engine glow - realistic jet boost effect
        this.updateEngineGlow(dt, isBoosting);
    }

    private updateEngineGlow(dt: number, isBoosting: boolean) {
        // Static glow - blue flame effect
        // Core color (bright blue)
        const coreColor = new THREE.Color(0.2, 0.6, 1.0);
        // Brighter blue tint when boosting
        const boostColor = new THREE.Color(0.4, 0.8, 1.0);

        // Lerp between colors based on boost state - subtle transition
        const finalColor = coreColor.clone();
        if (isBoosting) {
            finalColor.lerp(boostColor, 0.3); // Brighter blue when boosting
        }

        // Update material color
        this.glowMaterial.color.copy(finalColor);

        // Constant opacity - static size
        this.glowMaterial.opacity = 0.85;

        // Static size - no scale animation
        this.engineGlow.scale.set(1.0, 1.0, 1.0);

        // Always visible
        this.engineGlow.visible = true;
    }

    public updatePositionAndCamera(dt: number) {
        // Update ship position and orientation without input processing
        this.updateShipPosition();
        this.updateCamera(dt);
    }

    private updateShipPosition() {
        // Check if track is ready
        if (!this.track.curve || !this.track.curve.points || this.track.curve.points.length === 0) {
            console.warn('Track not ready, skipping ship position update');
            return;
        }

        // position and orientation from banked Frenet frame
        const { pos, tangent, normal, binormal, right, up, forward } = this.tmp;

        // Ensure tmp vectors are properly initialized
        if (!pos || !tangent || !normal || !binormal || !right || !up || !forward) {
            console.error('Ship tmp vectors not properly initialized');
            return;
        }

        this.track.getPointAtT(this.state.t, pos);
        this.track.getFrenetFrame(this.state.t, normal, binormal, tangent);

        // Construct frame directly from cached normals/binormals for banking
        forward.copy(tangent).normalize();
        right.copy(binormal).normalize();
        up.copy(normal).normalize();

        // apply lateral offset (side to side across the ribbon) and hover height
        pos.addScaledVector(binormal, this.state.lateralOffset);
        pos.addScaledVector(up, PHYSICS.hoverHeight);

        // compute quaternion from basis vectors (forward, up)
        const m = new THREE.Matrix4();
        const z = forward.clone().normalize(); // Remove .negate() - ship should face forward
        const x = new THREE.Vector3().crossVectors(up, z).normalize();
        const y = new THREE.Vector3().crossVectors(z, x).normalize();

        m.makeBasis(x, y, z);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);

        // No input-based rotation during countdown
        this.root.position.copy(pos);
        this.root.quaternion.copy(q);
    }

    private updateCamera(dt: number) {
        // Only update camera if camera control is enabled (disabled in free fly mode)
        if (!this.cameraControlEnabled) return;

        // Check if track is ready
        if (!this.track.curve) {
            console.warn('Track not ready, skipping camera update');
            return;
        }

        // Get current ship position and orientation
        const { pos, tangent, normal, binormal, right, up, forward } = this.tmp;
        this.track.getPointAtT(this.state.t, pos);
        this.track.getFrenetFrame(this.state.t, normal, binormal, tangent);

        // Construct frame directly from cached normals/binormals for banking
        forward.copy(tangent).normalize();
        right.copy(binormal).normalize();
        up.copy(normal).normalize();

        // Create a local copy of position for camera calculations
        const camPos = pos.clone();
        camPos.addScaledVector(right, this.state.lateralOffset);
        camPos.addScaledVector(up, PHYSICS.hoverHeight);

        // Mario Kart-style camera: independent smoothed yaw with heavy damping
        this.cameraYawVelocity = THREE.MathUtils.damp(this.cameraYawVelocity, this.targetCameraYaw - this.cameraYaw, CAMERA.cameraYawDamping, dt);
        this.cameraYaw += this.cameraYawVelocity * dt;

        // chase camera locked directly behind ship (racing game style)
        const camDistance = CAMERA.chaseDistance * (1 + this.boostTimer * 0.6);
        const cameraPosition = new THREE.Vector3()
            .copy(camPos)
            .addScaledVector(up, CAMERA.chaseHeight)
            .addScaledVector(forward, -camDistance);
        this.camera.position.lerp(cameraPosition, 1 - Math.pow(0.0001, dt));

        // Look ahead down the track in Frenet frame, then apply Mario Kart-style camera yaw
        const lookAhead = CAMERA.lookAheadDistance;
        const baseLookPoint = new THREE.Vector3()
            .copy(camPos)
            .addScaledVector(forward, lookAhead)
            .addScaledVector(up, 0.2);

        // Align camera up with track normal so roll matches banking
        this.camera.up.copy(up);

        // Reset mouse look targets when button is not held
        if (!this.mouseButtonDown) {
            this.mouseYawTarget = 0;
            this.mousePitchTarget = 0;
        }

        // Smooth mouse deltas
        this.mouseYaw = THREE.MathUtils.damp(this.mouseYaw, this.mouseYawTarget, 6, dt);
        this.mousePitch = THREE.MathUtils.damp(this.mousePitch, this.mousePitchTarget, 6, dt);

        // Build direction from camera to target and rotate by Mario Kart camera yaw + mouse deltas
        const toTarget = new THREE.Vector3().subVectors(baseLookPoint, this.camera.position);
        const qCameraYaw = new THREE.Quaternion().setFromAxisAngle(up, this.cameraYaw);
        const qYaw = new THREE.Quaternion().setFromAxisAngle(up, this.mouseYaw);
        const qPitch = new THREE.Quaternion().setFromAxisAngle(right, -this.mousePitch);
        toTarget.applyQuaternion(qCameraYaw).applyQuaternion(qYaw).applyQuaternion(qPitch);
        const finalLook = new THREE.Vector3().addVectors(this.camera.position, toTarget);
        this.camera.lookAt(finalLook);

        // Dynamic FOV in tunnels
        const targetFov = this.state.inTunnel ? this.baseFov + TUNNEL.fovBoost : this.baseFov;
        this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, 1 - Math.pow(0.01, dt));
        this.camera.fov = this.currentFov;
        this.camera.updateProjectionMatrix();

        // subtle speed shake
        const shake = CAMERA.shakeMax * (this.state.speedKmh / PHYSICS.maxSpeed) * (0.4 + 0.6 * this.boostTimer);
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
    }

    // Getters for focus refill state
    public getFocusRefillActive(): boolean {
        return this.focusRefillActive;
    }

    public getFocusRefillProgress(): number {
        return this.focusRefillProgress;
    }

    // Getters for boost recharge delay
    public getBoostRechargeDelay(): number {
        return this.boostRechargeDelay;
    }

    public getBoostPadTimer(): number {
        return this.boostPadTimer;
    }

    public getNow(): number {
        return this.now;
    }

    // Expose ship color for color-matched effects
    public getColor(): THREE.Color {
        return this.shipMaterial?.color ?? new THREE.Color(0xffffff);
    }
}


