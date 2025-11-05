import * as THREE from 'three';
import { COLORS, PHYSICS, BOOST_PAD, TUNNEL, CAMERA, NPC } from './constants';
import { Track } from './Track';
import type { ShipState, RacePosition } from './types';
import { ShipRocketTail } from './ShipRocketTail';

export class NPCShip {
    public root = new THREE.Group();
    public state: ShipState;
    public racerId: string;
    public color: THREE.Color;
    public finished = false;
    public finishTime?: number;

    private track: Track;
    private aiBehavior: 'aggressive' | 'conservative';
    private lateralTarget = 0;
    private lateralVelocity = 0;
    private speedMultiplier = 1.0;
    private aiUpdateTimer = 0;
    private aiUpdateInterval = 0.1; // Update AI every 100ms

    // AI state
    private targetLateralOffset = 0;
    private lateralSwayTimer = 0;
    private speedVariation = 0;
    private preferredLateralOffset = 0;
    private laneSwayPhase = Math.random() * Math.PI * 2;
    private laneSwayAmplitude = NPC.laneSwayAmplitude;
    private laneStickiness = NPC.laneStickiness;

    // Stuck detection
    private stuckDetectionTimer = 0;
    private lastPositionT = 0;
    private stuckThreshold = 1.5; // seconds (reduced from 3.0 for faster detection)
    private positionChangeThreshold = 0.001; // minimum track distance change

    // NPC boost system
    private boostEnergy = 1.0; // 0-1 boost resource like player
    private boostCooldown = 0; // time until next boost can be used
    private boostDuration = 0; // remaining boost time
    private isBoosting = false;

    // Tunnel boost system (like player ship)
    private tunnelBoostAccumulator = 1.0; // tracks current tunnel boost multiplier

    // Boost pad system (like player ship)
    private boostPadMultiplier = 1.0; // tracks current boost pad multiplier
    private boostPadTimer = 0; // remaining boost pad duration

    // Race state system
    private countdownMode = false; // prevents movement during countdown

    // Rubber banding system
    private rubberBandingMultiplier = 1.0; // speed multiplier based on distance from player
    private targetRubberBandingMultiplier = 1.0; // target multiplier (smoothly lerped to)
    private playerPosition = 0;
    private playerLap = 0;
    private latestPlayerSpeedKmh = 0;
    private raceStartTime = 0; // Track elapsed game time since race started (in seconds)
    private raceStarted = false; // Track if race has started

    // Rocket tail effect (like player ship)
    public rocketTail!: ShipRocketTail;

    // Engine glow effect (like player ship)
    private glowMaterial!: THREE.MeshBasicMaterial;
    private engineGlow!: THREE.Mesh;

    // Speed stars effect (like player ship)
    private speedStars!: THREE.Group;
    private speedStarsMesh!: THREE.InstancedMesh;
    private speedStarsVelocities!: Float32Array;
    private speedStarsOffsets!: Float32Array;
    private speedStarsColors!: THREE.Color[];
    private speedStarsMax = 80; // Fewer stars for NPCs
    private tmpObj = new THREE.Object3D();


    // Add this field to the class properties (after line 55)
    private hasCrossedCheckpointThisFrame = false;
    private prevT = 0;

    constructor(track: Track, racerId: string, color: THREE.Color, behavior: 'aggressive' | 'conservative' = 'conservative', lateralOffset: number = 0, speedMultiplier: number = 1.0) {
        this.track = track;
        this.racerId = racerId;
        this.color = color;
        this.aiBehavior = behavior;
        this.speedMultiplier = speedMultiplier;

        this.state = {
            t: -12 / track.length, // Start 12 meters behind start line (matches player)
            speedKmh: 0,
            lateralOffset: lateralOffset, // Position NPCs at different lateral positions
            pitch: 0,
            flow: 0,
            boosting: false,
            lapCurrent: 0, // Start at lap 0 (pre-race)
            lapTotal: 3,
            boostLevel: 1,
            inTunnel: false,
            tunnelCenterBoost: 1.0,
            onBoostPadEntry: false,
            isDrifting: false,
            driftDuration: 0,
            driftLength: 0
        };

        // Initialize lap tracking state
        this.prevT = this.state.t;
        this.hasCrossedCheckpointThisFrame = false;

        // NPCs start immediately when countdown ends (no random delay)

        this.createShipModel();
        this.setupAIBehavior();

        // Establish preferred lane from initial lateralOffset
        const half = this.track.width * 0.5;
        const lateralLimit = half * 0.95;
        this.preferredLateralOffset = THREE.MathUtils.clamp(this.state.lateralOffset, -lateralLimit, lateralLimit);

        // Set initial position immediately so NPCs are visible
        this.updateVisualPosition();
    }

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
        // Same geometry as player ship
        const vertices: number[] = [];
        const indices: number[] = [];

        const length = 1.2;
        const frontWidth = 0.08;   // Small width at front tip (not a pure point)
        const rearWidth = 0.5;
        const frontHeight = 0.05;  // Front height (lower - slanted hood)
        const rearHeight = 0.25;   // Rear height (taller - kept high)

        const frontZ = length * 0.5;
        const rearZ = -length * 0.5;

        const addVertex = (v: THREE.Vector3): number => {
            const idx = vertices.length / 3;
            vertices.push(v.x, v.y, v.z);
            return idx;
        };

        // Front face (small width at nose, not a pure point)
        const frontTopLeft = addVertex(new THREE.Vector3(-frontWidth * 0.5, frontHeight * 0.5, frontZ));
        const frontTopRight = addVertex(new THREE.Vector3(frontWidth * 0.5, frontHeight * 0.5, frontZ));
        const frontBottomLeft = addVertex(new THREE.Vector3(-frontWidth * 0.5, -frontHeight * 0.5, frontZ));
        const frontBottomRight = addVertex(new THREE.Vector3(frontWidth * 0.5, -frontHeight * 0.5, frontZ));
        const rearTopLeft = addVertex(new THREE.Vector3(-rearWidth * 0.5, rearHeight * 0.5, rearZ));
        const rearTopRight = addVertex(new THREE.Vector3(rearWidth * 0.5, rearHeight * 0.5, rearZ));
        const rearBottomLeft = addVertex(new THREE.Vector3(-rearWidth * 0.5, -rearHeight * 0.5, rearZ));
        const rearBottomRight = addVertex(new THREE.Vector3(rearWidth * 0.5, -rearHeight * 0.5, rearZ));

        // Top face (quadrilateral from front to rear)
        indices.push(frontTopLeft, frontTopRight, rearTopLeft);
        indices.push(frontTopRight, rearTopRight, rearTopLeft);
        // Bottom face (quadrilateral from front to rear)
        indices.push(frontBottomLeft, rearBottomLeft, frontBottomRight);
        indices.push(frontBottomRight, rearBottomLeft, rearBottomRight);
        // Left side (complete)
        indices.push(frontTopLeft, frontBottomLeft, rearTopLeft);
        indices.push(frontBottomLeft, rearBottomLeft, rearTopLeft);
        // Right side (complete)
        indices.push(frontTopRight, rearTopRight, frontBottomRight);
        indices.push(frontBottomRight, rearTopRight, rearBottomRight);
        // Rear face (complete)
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

    private createShipModel() {
        // Create ship geometry exactly like player ship but with NPC color
        const body = new THREE.Group();

        // Create custom low-poly hull geometry (sleek wedge/arrowhead shape)
        const hullGeometry = this.createShipHullGeometry();

        const shipMaterial = new THREE.MeshStandardMaterial({
            color: this.color,
            metalness: 0.3,
            roughness: 0.2,
            emissive: this.color.clone().multiplyScalar(0.8),
            transparent: false,
            opacity: 1.0,
            side: THREE.DoubleSide
        });
        const hullMesh = new THREE.Mesh(hullGeometry, shipMaterial);
        body.add(hullMesh);
        this.addEdgeLines(hullMesh);

        // Jet wings (swept-back angular wings) - 20% height, lowered on wedge body
        const wingMaterial = shipMaterial.clone();
        const wingTop = -0.01;    // Top of wing (lowered on body)
        const wingBottom = -0.05; // Bottom of wing (lower on body)

        // Left wing - swept back with blunt/square tip (touching center wedge, thin)
        const leftWingGeo = new THREE.BufferGeometry();
        const leftWingVerts = new Float32Array([
            // Root at fuselage (top vertices)
            -0.15, wingTop, 0,
            -0.2, wingTop, -0.5,
            // Wing tip - blunt/square edge
            -0.7, wingTop - 0.004, -0.35,  // Tip leading edge
            -0.68, wingTop - 0.004, -0.45, // Tip trailing edge
            // Root at fuselage (bottom vertices)
            -0.15, wingBottom, 0,
            -0.2, wingBottom, -0.5,
            // Wing tip bottom - blunt/square edge
            -0.7, wingBottom - 0.004, -0.35,
            -0.68, wingBottom - 0.004, -0.45
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
            // Outboard edge (blunt tip)
            2, 6, 3,
            3, 6, 7,
            // Root edge
            0, 4, 1,
            1, 4, 5
        ]);
        leftWingGeo.computeVertexNormals();

        const leftWing = new THREE.Mesh(leftWingGeo, wingMaterial);
        body.add(leftWing);
        this.addEdgeLines(leftWing);

        // Right wing - swept back with blunt/square tip (touching center wedge, thin)
        const rightWingGeo = new THREE.BufferGeometry();
        const rightWingVerts = new Float32Array([
            // Root at fuselage (top vertices)
            0.15, wingTop, 0,
            0.2, wingTop, -0.5,
            // Wing tip - blunt/square edge
            0.7, wingTop - 0.004, -0.35,  // Tip leading edge
            0.68, wingTop - 0.004, -0.45, // Tip trailing edge
            // Root at fuselage (bottom vertices)
            0.15, wingBottom, 0,
            0.2, wingBottom, -0.5,
            // Wing tip bottom - blunt/square edge
            0.7, wingBottom - 0.004, -0.35,
            0.68, wingBottom - 0.004, -0.45
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
            // Outboard edge (blunt tip)
            2, 3, 6,
            3, 7, 6,
            // Root edge
            0, 1, 4,
            1, 5, 4
        ]);
        rightWingGeo.computeVertexNormals();

        const rightWing = new THREE.Mesh(rightWingGeo, wingMaterial);
        body.add(rightWing);
        this.addEdgeLines(rightWing);

        // Tail fins (vertical stabilizers) - triangular shape, wider at bottom, tapering to top
        const tailFinMaterial = shipMaterial.clone();

        // Left tail fin - swept-back design like modern jet aircraft
        const leftTailFinGeo = new THREE.BufferGeometry();
        const leftTailFinVerts = new Float32Array([
            -0.2, 0.05, -0.35,   // Bottom front outer (more forward)
            -0.18, 0.05, -0.75,  // Bottom rear outer (more backward)
            -0.12, 0.05, -0.35,  // Bottom front inner (more forward)
            -0.1, 0.05, -0.75,   // Bottom rear inner (more backward)
            -0.28, 0.25, -0.55,  // Top front point (swept back from bottom front)
            -0.26, 0.25, -0.90   // Top rear point (slightly further back than bottom rear)
        ]);
        leftTailFinGeo.setAttribute('position', new THREE.BufferAttribute(leftTailFinVerts, 3));
        leftTailFinGeo.setIndex([
            0, 1, 4,
            1, 5, 4,
            2, 4, 3,
            3, 4, 5,
            0, 2, 1,
            1, 2, 3,
            0, 2, 4,
            1, 5, 3,
            // Top edge is formed by outer/inner faces connecting the two top points (4, 5)
            0, 1, 2
        ]);
        leftTailFinGeo.computeVertexNormals();

        const leftTailFin = new THREE.Mesh(leftTailFinGeo, tailFinMaterial);
        leftTailFin.rotation.z = -0.15;
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
        const boosterColor = this.color.clone().multiplyScalar(0.4); // Darker version of ship color
        const boosterMaterial = new THREE.MeshStandardMaterial({
            color: boosterColor,
            metalness: 0.8,
            roughness: 0.2,
            emissive: boosterColor.clone().multiplyScalar(0.3)
        });

        const boosterBody = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.12, 0.2, 12),
            boosterMaterial
        );
        boosterBody.rotation.x = Math.PI / 2;
        boosterBody.position.set(0, 0, -0.65);
        body.add(boosterBody);
        this.addEdgeLines(boosterBody);

        const boosterNozzle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.15, 0.1, 0.1, 12),
            boosterMaterial
        );
        boosterNozzle.rotation.x = Math.PI / 2;
        boosterNozzle.position.set(0, 0, -0.72);
        body.add(boosterNozzle);
        this.addEdgeLines(boosterNozzle);

        // Engine glow effect (from rocket booster) - glowing blue
        this.glowMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(0.2, 0.6, 1.0), // Bright blue
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });

        // Create rocket booster flame - simple blue cone
        this.engineGlow = new THREE.Mesh(
            new THREE.ConeGeometry(0.12, 0.3, 16),
            this.glowMaterial
        );
        this.engineGlow.position.set(0, 0, -0.9); // Start at nozzle
        this.engineGlow.rotation.x = -Math.PI / 2; // Point backward
        body.add(this.engineGlow);

        this.root.add(body);

        // Create rocket tail boost effect (initially hidden) - exactly like player
        // Position at jet engine nozzle opening (z=-0.72) so tail starts right at the nozzle
        const nozzleRadius = 0.15;
        const baseClipOffset = -nozzleRadius * 0.15; // Small backward offset to clip base
        this.rocketTail = new ShipRocketTail(
            this,
            new THREE.Vector3(0, 0, -0.72),
            baseClipOffset
        );
        this.root.add(this.rocketTail.root);

        // Create speed stars effect (initially hidden) - like player
        this.speedStars = new THREE.Group();
        this.createSpeedStars();
        this.root.add(this.speedStars);
        this.speedStars.visible = false;

        // Double the ship size
        this.root.scale.set(3, 3, 3);

        // Ship boost effect is handled externally by ShipBoost class (same as player)
    }


    private createSpeedStars() {
        // Create speed stars effect (like player ship but with NPC color)
        const geo = new THREE.CylinderGeometry(0.01, 0.02, 1, 6, 1, true);
        const mat = new THREE.MeshBasicMaterial({
            color: this.color,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        this.speedStarsMesh = new THREE.InstancedMesh(geo, mat, this.speedStarsMax);
        this.speedStarsVelocities = new Float32Array(this.speedStarsMax);
        this.speedStarsOffsets = new Float32Array(this.speedStarsMax);
        this.speedStarsColors = new Array(this.speedStarsMax);
        this.speedStars.add(this.speedStarsMesh);

        // Initialize all stars
        for (let i = 0; i < this.speedStarsMax; i++) {
            this.respawnSpeedStar(i, true);
        }
        this.speedStarsMesh.instanceMatrix.needsUpdate = true;
    }

    private setupAIBehavior() {
        // Set up AI behavior parameters based on type
        if (this.aiBehavior === 'aggressive') {
            this.speedVariation = 0.1;
            this.laneSwayAmplitude = NPC.laneSwayAmplitude * 1.3;
            this.laneStickiness = Math.max(0.5, NPC.laneStickiness - 0.1);
        } else {
            this.speedVariation = 0.05;
            this.laneSwayAmplitude = NPC.laneSwayAmplitude * 0.9;
            this.laneStickiness = Math.min(0.9, NPC.laneStickiness + 0.1);
        }
    }

    public update(dt: number, playerPosition: number, playerLap: number, playerSpeed: number, allNPCs: NPCShip[] = []) {
        // Update visual position even during countdown
        this.updateVisualPosition();

        // Store latest player state for speed capping / drift logic
        this.latestPlayerSpeedKmh = playerSpeed;

        // Don't move during countdown
        if (this.countdownMode) {
            return; // Stay stationary during countdown
        }

        // Track race time (elapsed game time since race started)
        if (this.raceStarted) {
            this.raceStartTime += dt;
        }

        this.aiUpdateTimer += dt;

        // Check for stuck condition and reset if needed
        if (this.checkIfStuck(dt)) {
            this.resetIfStuck();
        }

        // Update tunnel boost and boost pad every frame (same as player ship)
        // These need continuous frame updates for proper decay/accumulation
        this.updateTunnelBoost(dt);
        this.updateBoostPad(dt);

        // Update AI behavior periodically
        if (this.aiUpdateTimer >= this.aiUpdateInterval) {
            this.updateAI(playerPosition, playerLap, playerSpeed);
            this.updateCollisionAvoidance(allNPCs);
            this.updateBoostBehavior(dt);
            this.aiUpdateTimer = 0;
        }

        // Update ship physics
        this.updatePhysics(dt);
        this.updatePosition(dt);

        // Simple drift detection: turning (lateralVelocity) + boosting
        const isTurning = Math.abs(this.lateralVelocity) > 0.2;
        const isDriftingNow = isTurning && this.isBoosting;
        this.state.isDrifting = isDriftingNow;
        if (isDriftingNow) {
            this.state.driftDuration += dt;
        }

    }

    private updateAI(playerPosition: number, playerLap: number, playerSpeed: number) {
        // Store player state for rubber banding
        this.playerPosition = playerPosition;
        this.playerLap = playerLap;

        // Calculate our position relative to player
        const ourPosition = this.getTrackPosition();
        const positionDiff = ourPosition - playerPosition;

        // Calculate rubber banding multiplier based on distance from player
        this.updateRubberBanding();

        // AI lateral movement - bias around a preferred lane with gentle sway and jitter
        this.lateralSwayTimer += this.aiUpdateInterval * NPC.laneSwaySpeed;

        const sway = Math.sin(this.lateralSwayTimer + this.laneSwayPhase) * this.laneSwayAmplitude;
        const jitter = (Math.random() - 0.5) * NPC.laneJitterRange * (this.aiBehavior === 'aggressive' ? 1.2 : 1.0);

        // Compute target around preferred lane and clamp to track bounds
        const half = this.track.width * 0.5;
        const lateralLimit = half * 0.95;
        const desired = THREE.MathUtils.clamp(this.preferredLateralOffset + sway + jitter, -lateralLimit, lateralLimit);

        // Stick towards the desired lane-biased target
        this.targetLateralOffset = THREE.MathUtils.lerp(this.targetLateralOffset, desired, this.laneStickiness);
    }

    private updateRubberBanding() {
        // Don't apply rubber banding if player position hasn't been initialized yet
        // (playerPosition defaults to 0, which could cause issues at race start)
        if (this.playerLap === 0 && this.state.lapCurrent === 0) {
            // Both are at pre-race state, no rubber banding needed
            this.targetRubberBandingMultiplier = 1.0;
            return;
        }

        // Calculate player distance from start line (tracks are normalized 0-1, start is at t=0)
        // If player hasn't moved significantly from start, disable rubber banding
        // Handle both positive and negative positions (player might start behind start line)
        let playerDistanceFromStart = this.playerPosition;
        if (playerDistanceFromStart < 0) {
            // Player is behind start line (negative t), use absolute value
            playerDistanceFromStart = Math.abs(playerDistanceFromStart);
        } else if (playerDistanceFromStart > 0.5) {
            // Player wrapped around track, calculate distance from start going the other way
            playerDistanceFromStart = 1 - playerDistanceFromStart;
        }
        const playerDistanceMeters = playerDistanceFromStart * 8000;

        // Disable rubber banding until player has moved > 50m from start line
        // This ensures NPCs can accelerate naturally at race start
        if (playerDistanceMeters < 50) {
            this.targetRubberBandingMultiplier = 1.0;
            return;
        }

        // Calculate distance from player (accounting for lap differences)
        const ourPosition = this.getTrackPosition();
        const lapDiff = this.state.lapCurrent - this.playerLap;

        // Calculate normalized track distance (0-1 range)
        let trackDistance: number;
        if (lapDiff === 0) {
            // Same lap - calculate simple distance
            trackDistance = ourPosition - this.playerPosition;
            // Handle track wrapping
            if (Math.abs(trackDistance) > 0.5) {
                trackDistance = trackDistance > 0 ? trackDistance - 1 : trackDistance + 1;
            }
        } else if (lapDiff > 0) {
            // NPC is ahead by lapDiff laps
            trackDistance = (1 - this.playerPosition) + ourPosition + (lapDiff - 1);
        } else {
            // NPC is behind by |lapDiff| laps
            trackDistance = ourPosition - (1 + this.playerPosition) - (Math.abs(lapDiff) - 1);
        }

        // Convert to meters (track length is 8000m)
        const distanceMeters = Math.abs(trackDistance) * 8000;

        // Rubber banding thresholds and multipliers
        const closeDistance = 50; // meters - within this, no rubber banding
        const maxAheadDistance = 100; // meters - hard cap: NPCs cannot get more than this ahead
        const farBehindDistance = 300; // meters - beyond this, maximum speedup effect
        const veryFarBehindDistance = 400; // meters - beyond this, extra strong speedup
        const maxSlowdown = 0.75; // Slow down to 75% when at max ahead distance (slightly less aggressive)
        const maxSpeedup = 1.25; // Speed up to 125% when very far behind (reduced to prevent pack formation)
        const normalSpeedup = 1.15; // Speed up to 115% when moderately behind (reduced to prevent pack formation)

        // Add individual variation to rubber banding so NPCs don't all get the same multiplier
        // This creates natural spread instead of pack behavior
        const rubberBandingVariation = 0.95 + (Math.random() * 0.1); // 0.95 to 1.05 variation

        // Calculate target rubber banding multiplier
        if (trackDistance > 0) {
            // NPC is ahead of player
            if (distanceMeters >= maxAheadDistance) {
                // At or beyond hard cap - apply maximum slowdown to prevent getting further ahead
                this.targetRubberBandingMultiplier = maxSlowdown * rubberBandingVariation;
            } else if (distanceMeters > closeDistance) {
                // Between close distance and max ahead - gradual slowdown
                const t = THREE.MathUtils.clamp((distanceMeters - closeDistance) / (maxAheadDistance - closeDistance), 0, 1);
                this.targetRubberBandingMultiplier = THREE.MathUtils.lerp(1.0, maxSlowdown, t) * rubberBandingVariation;
            } else {
                // Very close to player - no rubber banding, but still add variation
                this.targetRubberBandingMultiplier = 1.0 * rubberBandingVariation;
            }
        } else {
            // NPC is behind player
            if (distanceMeters < closeDistance) {
                // Close to player - no rubber banding, but still add variation
                this.targetRubberBandingMultiplier = 1.0 * rubberBandingVariation;
            } else if (distanceMeters >= veryFarBehindDistance) {
                // Very far behind (>400m) - maximum speedup to catch up quickly
                this.targetRubberBandingMultiplier = maxSpeedup * rubberBandingVariation;
            } else {
                // Moderately behind - gradual speedup
                const t = THREE.MathUtils.clamp((distanceMeters - closeDistance) / (farBehindDistance - closeDistance), 0, 1);
                this.targetRubberBandingMultiplier = THREE.MathUtils.lerp(1.0, normalSpeedup, t) * rubberBandingVariation;
            }
        }

        // Smoothly transition rubber banding multiplier (update happens in updatePhysics with dt)
    }

    private updateBoostBehavior(dt: number) {
        // Update boost cooldown and duration
        this.boostCooldown = Math.max(0, this.boostCooldown - dt);
        this.boostDuration = Math.max(0, this.boostDuration - dt);

        // Determine if we should be boosting (duration-based like original, but also check energy)
        const shouldBeBoosting = this.boostDuration > 0 && this.boostEnergy > 0;

        // Boost energy: drain while active, regen when not held (same as player ship)
        if (shouldBeBoosting) {
            // Continuously drain boost energy while boosting (same as player)
            this.boostEnergy = Math.max(0, this.boostEnergy - dt / PHYSICS.boostDurationSec);
            // If boost energy runs out, stop boosting
            if (this.boostEnergy <= 0) {
                this.boostDuration = 0;
            }
        } else {
            // Regenerate boost energy when not boosting (same as player ship)
            this.boostEnergy = Math.min(1, this.boostEnergy + PHYSICS.boostRegenPerSec * dt);
        }

        // Decide whether to boost based on AI behavior and conditions
        const shouldBoost = this.shouldUseBoost();

        if (shouldBoost && this.boostCooldown <= 0 && this.boostEnergy > 0.3 && !shouldBeBoosting) {
            this.activateBoost();
        }

        // Update boost state
        this.isBoosting = this.boostDuration > 0 && this.boostEnergy > 0;
        this.state.boosting = this.isBoosting;

        // Update rocket tail effect based on boost pad timer (like player ship)
        this.rocketTail.update(dt);

        // Update speed stars effect based on boost state
        this.updateSpeedStars(dt);

        // Animate engine glow - realistic jet boost effect
        this.updateEngineGlow(dt, this.isBoosting);

        // Ship boost particle effect is handled externally by ShipBoost class (same as player)
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

    private shouldUseBoost(): boolean {
        // Competitive boost usage - NPCs should use boost strategically to stay competitive
        // More likely to boost when:
        // 1. They have enough energy (>0.3)
        // 2. They're behind the player (need to catch up)
        // 3. They're aggressive AI (more boost usage)

        // Check if we're behind player (encourage catch-up boosting)
        const ourPosition = this.getTrackPosition();
        const lapDiff = this.state.lapCurrent - this.playerLap;
        let isBehind = false;
        if (lapDiff < 0) {
            isBehind = true; // Behind by laps
        } else if (lapDiff === 0) {
            const distance = ourPosition - this.playerPosition;
            if (distance < 0) {
                isBehind = true; // Behind on same lap
            }
        }

        // Base boost chance based on behavior
        let baseChance = this.aiBehavior === 'aggressive' ? 0.25 : 0.15;

        // Increase chance if behind player (competitive catch-up)
        if (isBehind) {
            baseChance += 0.2;
        }

        // Boost more frequently when energy is high (can afford to boost)
        if (this.boostEnergy > 0.7) {
            baseChance += 0.1;
        }

        const boostChance = THREE.MathUtils.clamp(baseChance, 0, 0.6); // Cap at 60% max chance
        return Math.random() < boostChance;
    }

    private activateBoost() {
        this.isBoosting = true;
        this.boostDuration = PHYSICS.boostDurationSec; // Same boost duration as player
        this.boostCooldown = 0.5; // Short cooldown to prevent immediate re-boost (but energy drain limits it naturally)
    }

    private updateTunnelBoost(dt: number) {
        // Tunnel boost logic: progressive boost based on center alignment (like player ship)
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
    }

    private updateBoostPad(dt: number) {
        // Boost pad logic: temporary speed boost when driving over pads (like player ship)
        const boostPadInfo = this.track.getBoostPadAtT(this.state.t);
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
    }

    private updateSpeedStars(dt: number) {
        const show = this.isBoosting;
        this.speedStars.visible = show;
        if (!show) return;

        const forward = new THREE.Vector3(0, 0, 1);
        this.root.localToWorld(forward).sub(this.root.position).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.root.quaternion);
        const right = new THREE.Vector3().crossVectors(up, forward).normalize();

        const mps = this.state.speedKmh / 3.6;
        const baseSpeed = Math.max(10, mps * 1.5);

        for (let i = 0; i < this.speedStarsMax; i++) {
            const speed = baseSpeed * this.speedStarsVelocities[i];
            // move opposite to forward (towards camera)
            const pos = new THREE.Vector3();
            pos.copy(this.root.position);
            pos.addScaledVector(forward, -speed * dt);
            pos.addScaledVector(right, this.speedStarsOffsets[i] * 0.8);
            pos.addScaledVector(up, (Math.random() - 0.5) * 0.4);

            this.tmpObj.position.copy(pos);
            this.tmpObj.scale.setScalar(0.3 + Math.random() * 0.4);
            this.tmpObj.quaternion.setFromAxisAngle(forward, Math.random() * Math.PI * 2);
            this.tmpObj.updateMatrix();
            this.speedStarsMesh.setMatrixAt(i, this.tmpObj.matrix);

            // Check if star is behind ship and respawn if needed
            const dist = this.root.position.distanceTo(pos);
            if (dist > 8) {
                this.respawnSpeedStar(i, false);
            }
        }
        this.speedStarsMesh.instanceMatrix.needsUpdate = true;
    }

    private respawnSpeedStar(i: number, init: boolean) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 1.2 + Math.random() * 1.4; // radiusInner to radiusOuter
        this.speedStarsOffsets[i] = Math.cos(angle) * radius;
        this.speedStarsVelocities[i] = 0.3 + Math.random() * 0.7;
        this.speedStarsColors[i] = this.color.clone();
    }


    private updatePhysics(dt: number) {
        // Calculate base speed - same as player ship
        const baseSpeed = PHYSICS.baseSpeed;

        // Apply boost multiplier if boosting - same as player
        const boostMultiplier = this.isBoosting ? PHYSICS.boostMultiplier : 1.0;

        // Apply tunnel boost multiplier - same as player
        const tunnelMultiplier = this.tunnelBoostAccumulator;

        // Apply boost pad multiplier - same as player
        const boostPadMultiplier = this.boostPadMultiplier;

        // Smoothly update rubber banding multiplier (prevent sudden changes)
        const rubberBandingLerpSpeed = 3.0; // How fast to transition to target multiplier
        this.rubberBandingMultiplier = THREE.MathUtils.lerp(
            this.rubberBandingMultiplier,
            this.targetRubberBandingMultiplier,
            1 - Math.pow(0.001, dt * rubberBandingLerpSpeed)
        );

        // Apply rubber banding multiplier (slows NPCs when ahead, speeds up when behind)
        const rubberBanding = this.rubberBandingMultiplier;

        // Apply individual speed variation to create racing differences between NPCs
        // Add random variation that changes slowly over time (more realistic than constant variation)
        const speedVariationFactor = 1.0 + (Math.random() - 0.5) * this.speedVariation * 2;

        // Target speed calculation with rubber banding and individual variation
        let targetSpeed = baseSpeed * this.speedMultiplier * boostMultiplier * tunnelMultiplier * boostPadMultiplier * rubberBanding * speedVariationFactor;

        // When ahead of player, cap speed to ~92% of player to avoid runaway
        // Recompute ahead/behind based on stored player state
        const ourPosition = this.getTrackPosition();
        const lapDiff = this.state.lapCurrent - this.playerLap;
        let isAhead = false;
        if (lapDiff > 0) {
            isAhead = true;
        } else if (lapDiff === 0) {
            let trackDistance = ourPosition - this.playerPosition;
            if (Math.abs(trackDistance) > 0.5) trackDistance = trackDistance > 0 ? trackDistance - 1 : trackDistance + 1;
            isAhead = trackDistance > 0;
        }
        if (isAhead && this.latestPlayerSpeedKmh > 1) {
            const cap = this.latestPlayerSpeedKmh * 0.92;
            targetSpeed = Math.min(targetSpeed, cap);
        }

        // Ensure minimum speed to prevent NPCs from getting completely stuck
        // Minimum is 50% of base speed (allows rubber banding to slow them when ahead, but not stop them)
        const minSpeed = PHYSICS.baseSpeed * 0.5;
        targetSpeed = Math.max(targetSpeed, minSpeed);

        // Smooth speed transitions (same lerp rate as player ship for consistency)
        const speedLerp = 1 - Math.pow(0.001, dt);
        const prevSpeed = this.state.speedKmh;
        this.state.speedKmh = THREE.MathUtils.lerp(this.state.speedKmh, targetSpeed, speedLerp);

        // Force minimum speed if somehow speed dropped too low (prevent getting stuck)
        if (this.state.speedKmh < minSpeed * 0.8) {
            console.warn(`NPC ${this.racerId} speed too low (${this.state.speedKmh.toFixed(1)} km/h), forcing minimum`, {
                targetSpeed,
                minSpeed
            });
            this.state.speedKmh = minSpeed;
        }

        // Debug logging for significant speed drops (>20% drop in one frame)
        if (prevSpeed > 50 && this.state.speedKmh < prevSpeed * 0.8) {
            const speedDrop = prevSpeed - this.state.speedKmh;
            const dropPercent = (speedDrop / prevSpeed) * 100;
            console.warn(`NPC ${this.racerId} speed drop: ${prevSpeed.toFixed(1)} -> ${this.state.speedKmh.toFixed(1)} km/h (${dropPercent.toFixed(1)}% drop)`, {
                boostMultiplier,
                tunnelMultiplier,
                boostPadMultiplier,
                isBoosting: this.isBoosting,
                boostEnergy: this.boostEnergy,
                targetSpeed
            });
        }

        // Update lateral movement
        const lateralAccel = PHYSICS.lateralAccel * 0.8; // Slightly slower than player
        const lateralDamping = PHYSICS.lateralDamping * 0.9;

        const targetLateralVel = (this.targetLateralOffset - this.state.lateralOffset) * 2;
        this.lateralVelocity = THREE.MathUtils.damp(this.lateralVelocity, targetLateralVel, lateralDamping, dt);

        // Apply lateral movement
        const half = this.track.width * 0.5;
        const lateralLimit = half * 0.95;
        this.state.lateralOffset = THREE.MathUtils.clamp(
            this.state.lateralOffset + this.lateralVelocity * dt,
            -lateralLimit,
            lateralLimit
        );
    }

    private updatePosition(dt: number) {
        // Move along track
        const mps = (this.state.speedKmh / 3.6);

        // Safety check: ensure track.length is valid
        if (this.track.length <= 0) {
            console.error(`NPC ${this.racerId}: Invalid track length (${this.track.length}), skipping position update`);
            return;
        }

        // Calculate position change (normalized track distance)
        const positionDelta = (mps * dt) / this.track.length;

        // Ensure we always move forward (even if very slowly) to prevent getting stuck
        const minDelta = 0.000001; // Very small minimum to ensure continuous movement
        const actualDelta = Math.max(positionDelta, minDelta);

        this.state.t += actualDelta;

        // Update lap tracking BEFORE wrapping t (matches player ship logic)
        // This ensures crossing detection uses unwrapped t values
        this.updateLapTracking();

        // Wrap t after checkpoint detection (matches player ship)
        if (this.state.t > 1) this.state.t -= 1;
        if (this.state.t < 0) this.state.t += 1;

        // Update prevT AFTER wrapping (matches player ship - prevT stores wrapped values)
        // But updateLapTracking already set prevT, so we need to update it here with wrapped value
        this.prevT = this.state.t;

        // Update visual position
        this.updateVisualPosition();
    }

    private updateLapTracking() {
        // Proper lap detection - only count each crossing once per frame
        // Uses the same logic as the player ship (check BEFORE wrapping t)
        if (this.state.lapCurrent >= 0 && !this.hasCrossedCheckpointThisFrame) {
            const prevT = this.prevT;
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
                if (this.state.lapCurrent < this.state.lapTotal) {
                    console.log(`[${this.racerId}] LAP CROSSING: prevT=${prevT.toFixed(4)}, newT=${this.state.t.toFixed(4)}, normalCrossing=${normalCrossing}, wrappingCrossing=${wrappingCrossing}, lap: ${this.state.lapCurrent} -> ${this.state.lapCurrent + 1}`);
                    this.state.lapCurrent++;
                    this.hasCrossedCheckpointThisFrame = true;
                }
            }
        }

        // Note: t wrapping is handled in updatePosition() after this method returns
        // prevT is updated in updatePosition() after wrapping to match player ship logic

        // Reset checkpoint flag for next frame
        this.hasCrossedCheckpointThisFrame = false;
    }

    public updateVisualPosition() {
        try {
            const { pos, tangent, normal, binormal } = this.getFrenetFrame();

            // Apply lateral offset and hover height (match player ship height)
            pos.addScaledVector(binormal, this.state.lateralOffset);
            pos.addScaledVector(normal, PHYSICS.hoverHeight);

            this.root.position.copy(pos);



            // Orient ship along track
            const forward = tangent.clone().normalize();
            const right = binormal.clone().normalize();
            const up = normal.clone().normalize();

            const m = new THREE.Matrix4();
            const z = forward.clone().normalize(); // Remove .negate() - ships should face forward
            const x = new THREE.Vector3().crossVectors(up, z).normalize();
            const y = new THREE.Vector3().crossVectors(z, x).normalize();
            m.makeBasis(x, y, z);
            const baseQ = new THREE.Quaternion().setFromRotationMatrix(m);

            // Apply input-like yaw and bank based on lateral velocity (match player feel)
            const yawRatio = THREE.MathUtils.clamp(this.lateralVelocity / PHYSICS.lateralAccel, -1, 1);
            const shipYaw = -yawRatio * CAMERA.shipYawFromInput;
            const bankAngle = THREE.MathUtils.degToRad(22) * yawRatio;
            const inputEuler = new THREE.Euler(this.state.pitch || 0, shipYaw, -bankAngle, 'YXZ');
            const inputQ = new THREE.Quaternion().setFromEuler(inputEuler);

            baseQ.multiply(inputQ);
            this.root.quaternion.copy(baseQ);
        } catch (error) {
            console.warn(`NPC ${this.racerId} visual position update failed:`, error);
        }
    }

    private getFrenetFrame() {
        const pos = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const binormal = new THREE.Vector3();

        this.track.getPointAtT(this.state.t, pos);
        this.track.getFrenetFrame(this.state.t, normal, binormal, tangent);

        return { pos, tangent, normal, binormal };
    }

    private getTrackPosition(): number {
        return this.state.t;
    }

    public getBoostPadTimer(): number {
        return this.boostPadTimer;
    }

    public getNow(): number {
        // Convert Date.now() (milliseconds) to seconds to match Ship's now property
        // This ensures the pulse animation matches Ship's pattern
        return Date.now() * 0.001;
    }

    public getPosition(): RacePosition {
        return {
            racerId: this.racerId,
            position: 0, // Will be calculated by RaceManager
            lapCurrent: this.state.lapCurrent,
            lapTotal: this.state.lapTotal,
            finished: this.finished,
            finishTime: this.finishTime
        };
    }

    public finish(finishTime: number) {
        this.finished = true;
        this.finishTime = finishTime;
    }

    public setCountdownMode(enabled: boolean) {
        this.countdownMode = enabled;
        if (enabled) {
            // Reset speed to 0 during countdown
            this.state.speedKmh = 0;
        }
    }

    public startRace() {
        // Keep lap at 0 - we start before the start line
        // Lap will increment to 1 when crossing the start line for the first time (matches player ship logic)
        console.log(`[${this.racerId}] startRace() called, lapCurrent: ${this.state.lapCurrent}, prevT: ${this.prevT.toFixed(4)}, state.t: ${this.state.t.toFixed(4)}`);
        // Don't set lapCurrent = 1 here! Let lap detection handle the first crossing naturally
        this.countdownMode = false; // Allow movement when race starts
        this.raceStarted = true;
        this.raceStartTime = 0; // Reset race start timer (will accumulate dt each frame)
        // Make sure checkpoint flag is reset for clean detection
        this.hasCrossedCheckpointThisFrame = false;
        this.prevT = this.state.t;
    }

    public reset() {
        this.state.t = -12 / this.track.length; // Reset to pre-race staging position (matches player)
        this.state.speedKmh = 0;
        this.state.lateralOffset = 0;
        this.state.lapCurrent = 0; // Reset to pre-race
        this.finished = false;
        this.finishTime = undefined;
        this.lateralVelocity = 0;
        this.speedMultiplier = 1.0;
        this.stuckDetectionTimer = 0;
        this.lastPositionT = this.state.t;

        // Reset lap tracking state
        this.prevT = this.state.t;
        this.hasCrossedCheckpointThisFrame = false;

        // Reset boost system
        this.boostEnergy = 1.0;
        this.boostCooldown = 0;
        this.boostDuration = 0;
        this.isBoosting = false;
        this.state.boosting = false;

        // Reset tunnel boost
        this.tunnelBoostAccumulator = 1.0;
        this.state.tunnelCenterBoost = 1.0;

        // Reset boost pad
        this.boostPadMultiplier = 1.0;
        this.boostPadTimer = 0;

        // Reset race state
        this.countdownMode = false;

        // Reset rubber banding
        this.rubberBandingMultiplier = 1.0;
        this.targetRubberBandingMultiplier = 1.0;
        this.playerPosition = 0;
        this.playerLap = 0;
        this.raceStartTime = 0;
        this.raceStarted = false;

        // Hide all boost effects
        this.rocketTail.root.visible = false;
        this.speedStars.visible = false;
    }

    private updateCollisionAvoidance(allNPCs: NPCShip[]) {
        const minLateralDistance = 3.0; // minimum units apart
        const trackDistanceThreshold = 0.05; // within 5% of track distance

        for (const otherNPC of allNPCs) {
            if (otherNPC === this) continue;

            const ourT = this.state.t;
            const theirT = otherNPC.state.t;

            // Check if we're close on the track
            const trackDistance = Math.abs(ourT - theirT);
            const wrappedDistance = Math.min(trackDistance, 1 - trackDistance);

            if (wrappedDistance < trackDistanceThreshold) {
                // We're close on track, check lateral distance
                const lateralDistance = Math.abs(this.state.lateralOffset - otherNPC.state.lateralOffset);

                if (lateralDistance < minLateralDistance) {
                    // Too close laterally, adjust our target
                    const avoidDirection = this.state.lateralOffset > otherNPC.state.lateralOffset ? 1 : -1;
                    this.targetLateralOffset += avoidDirection * (minLateralDistance - lateralDistance) * 0.5;

                    // Clamp to track bounds
                    const half = this.track.width * 0.5;
                    const lateralLimit = half * 0.95;
                    this.targetLateralOffset = THREE.MathUtils.clamp(this.targetLateralOffset, -lateralLimit, lateralLimit);
                }
            }
        }
    }

    private checkIfStuck(dt: number): boolean {
        // Don't check for stuck during countdown or if race hasn't started
        if (this.countdownMode || !this.raceStarted) {
            return false;
        }

        const currentT = this.state.t;
        const positionChange = Math.abs(currentT - this.lastPositionT);

        if (positionChange < this.positionChangeThreshold) {
            this.stuckDetectionTimer += dt;
        } else {
            this.stuckDetectionTimer = 0;
            this.lastPositionT = currentT;
        }

        return this.stuckDetectionTimer >= this.stuckThreshold;
    }

    private resetIfStuck() {
        console.warn(`NPC ${this.racerId} was stuck at t=${this.state.t.toFixed(4)} for ${this.stuckThreshold}s, attempting recovery`, {
            position: this.state.t,
            speed: this.state.speedKmh,
            targetSpeed: PHYSICS.baseSpeed * this.rubberBandingMultiplier,
            rubberBanding: this.rubberBandingMultiplier,
            boostMultiplier: this.isBoosting ? PHYSICS.boostMultiplier : 1.0,
            tunnelMultiplier: this.tunnelBoostAccumulator,
            boostPadMultiplier: this.boostPadMultiplier
        });

        // Teleport forward by a larger amount to ensure we move past the stuck point
        this.state.t += 0.05; // Increased from 0.02
        if (this.state.t > 1) this.state.t -= 1;

        // Force speed to base speed (100% instead of 50%) to ensure strong movement
        this.state.speedKmh = PHYSICS.baseSpeed;

        // Reset velocity to prevent immediate re-sticking
        this.lateralVelocity = 0;

        // Temporarily disable rubber banding to allow acceleration
        this.rubberBandingMultiplier = 1.0;
        this.targetRubberBandingMultiplier = 1.0;

        // Reset all boost effects that might be causing issues
        this.tunnelBoostAccumulator = 1.0;
        this.boostPadMultiplier = 1.0;
        this.boostPadTimer = 0;

        // Reset stuck detection
        this.stuckDetectionTimer = 0;
        this.lastPositionT = this.state.t;

        console.log(`NPC ${this.racerId} recovery complete: t=${this.state.t.toFixed(4)}, speed=${this.state.speedKmh.toFixed(1)} km/h`);
    }
}
