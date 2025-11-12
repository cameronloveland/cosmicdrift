import * as THREE from 'three';
import { COLORS, PHYSICS, BOOST_PAD, TUNNEL, CAMERA, NPC, DRAFTING, RAMP } from './constants';
import { Track } from './Track';
import type { ShipState, RacePosition } from './types';
import { Ship } from './ship/Ship';
import { ShipRocketTail } from './ship/ShipRocketTail';
import { ShipJetEngine } from './ship/ShipJetEngine';
import { DraftingParticles } from './ship/drafting/DraftingParticles';
import { DraftingVectorLines } from './ship/drafting/DraftingVectorLines';

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
    private laneChangeTimer = 0;
    private laneChangeIntervalSec = THREE.MathUtils.lerp(NPC.laneChangeIntervalMinSec, NPC.laneChangeIntervalMaxSec, Math.random());
    private evasiveCooldown = 0;
    private isDraftingTarget = false;

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

    // Rocket tail effect (shared with player)
    public rocketTail!: ShipRocketTail;

    // Jet engine visuals (shared with player)
    public jetEngine!: ShipJetEngine;

    // Speed stars effect (like player ship)
    private speedStars!: THREE.Group;
    private speedStarsMesh!: THREE.InstancedMesh;
    private speedStarsVelocities!: Float32Array;
    private speedStarsOffsets!: Float32Array;
    private speedStarsColors!: THREE.Color[];
    private speedStarsMax = 80; // Fewer stars for NPCs
    private tmpObj = new THREE.Object3D();

    // Drafting state/visual
    private draftingActive = false;
    private draftingLeadSpeedKmh = 0;
    private draftingCone: THREE.Mesh | null = null;
    private draftingParticles: DraftingParticles | null = null;
    private draftingLines: DraftingVectorLines | null = null;
    private tmp = {
        playerPos: new THREE.Vector3(),
        playerForward: new THREE.Vector3(),
        selfPos: new THREE.Vector3(),
        selfForward: new THREE.Vector3(),
        otherPos: new THREE.Vector3(),
        otherForward: new THREE.Vector3(),
        v: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        binormal: new THREE.Vector3(),
        tangent: new THREE.Vector3()
    };

    // Roll flip animation state (match player visual behavior)
    private flipAnimating = false;
    private flipProgress = 0;
    private flipDir = 0;
    private flipStartAngle = 0;
    private flipCompletedDir = 0;
    private visualRoll = 0;
    private turnHoldTimer = 0;
    private turnHoldDir = 0;
    private lastVisualUpdateSec = 0;


    // Add this field to the class properties (after line 55)
    private hasCrossedCheckpointThisFrame = false;
    private prevT = 0;
    // Tiny persistent per-NPC speed variation (0.99 - 1.01)
    private individualVariation = 1.0;

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
            verticalOffset: 0,
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
        // Assign a tiny persistent speed variation (±1%)
        this.individualVariation = 0.99 + Math.random() * 0.02;
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

    private ensureDraftingCone() {
        if (this.draftingCone || !DRAFTING.showCone) return;
        const height = 2.0;
        const baseRadius = 0.9;
        const geo = new THREE.CylinderGeometry(baseRadius, 0, height, 24, 1, true);
        const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0x3bd1ff),
            emissive: new THREE.Color(0x3bd1ff),
            emissiveIntensity: 0.9,
            metalness: 0.0,
            roughness: 0.25,
            transparent: true,
            opacity: 0.2,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: true,
            side: THREE.DoubleSide
        });
        this.draftingCone = new THREE.Mesh(geo, mat);
        this.draftingCone.rotation.x = Math.PI / 2;
        this.draftingCone.position.set(0, 0, 0.9 + height * 0.5);
        this.draftingCone.visible = false;
        this.root.add(this.draftingCone);
    }

    private setDraftingVisible(v: boolean) {
        if (this.draftingCone) this.draftingCone.visible = v && DRAFTING.showCone;
        if (this.draftingParticles) this.draftingParticles.setVisible(v);
        if (this.draftingLines) this.draftingLines.setVisible(v);
    }

    private draftLock = 0;
    private draftFail = 0;

    private updateDrafting(dt: number, playerT: number, playerLateral: number, allNPCs: NPCShip[]) {
        const cosCone = Math.cos(THREE.MathUtils.degToRad(DRAFTING.coneDeg));

        // Self frame
        this.track.getShipWorldPosition(this.state.t, this.state.lateralOffset, this.tmp.selfPos);
        this.tmp.selfForward.set(0, 0, 1).applyQuaternion(this.root.quaternion).normalize();

        let bestDist = Infinity;
        let bestLeadSpeed = 0;
        let conditionsOk = false;

        // Candidate: player
        {
            this.track.getShipWorldPosition(playerT, playerLateral, this.tmp.playerPos);
            // Approximate player forward from track tangent
            this.track.getFrenetFrame(playerT, this.tmp.normal, this.tmp.binormal, this.tmp.tangent);
            this.tmp.playerForward.copy(this.tmp.tangent).normalize();
            this.tmp.v.subVectors(this.tmp.selfPos, this.tmp.playerPos);
            const dist = this.tmp.v.length();
            if (dist >= DRAFTING.minDistance && dist <= DRAFTING.maxDistance) {
                const dirLeadToSelf = this.tmp.v.normalize();
                const behindDot = dirLeadToSelf.dot(this.tmp.playerForward.clone().negate());
                const aligned = this.tmp.selfForward.dot(this.tmp.playerForward) >= DRAFTING.alignmentMinDot;
                const inCone = behindDot >= cosCone;
                if (inCone && aligned) {
                    bestDist = dist;
                    bestLeadSpeed = this.latestPlayerSpeedKmh;
                    conditionsOk = true;
                }
            }
        }

        // Candidates: other NPCs
        for (const other of allNPCs) {
            if (other === this) continue;
            this.track.getShipWorldPosition(other.state.t, other.state.lateralOffset, this.tmp.otherPos);
            this.tmp.otherForward.set(0, 0, 1).applyQuaternion(other.root.quaternion).normalize();
            this.tmp.v.subVectors(this.tmp.selfPos, this.tmp.otherPos);
            const dist = this.tmp.v.length();
            if (dist < DRAFTING.minDistance || dist > DRAFTING.maxDistance) continue;
            const dirLeadToSelf = this.tmp.v.normalize();
            const behindDot = dirLeadToSelf.dot(this.tmp.otherForward.clone().negate());
            const aligned = this.tmp.selfForward.dot(this.tmp.otherForward) >= DRAFTING.alignmentMinDot;
            const inCone = behindDot >= cosCone;
            if (inCone && aligned && dist < bestDist) {
                bestDist = dist;
                bestLeadSpeed = other.state.speedKmh;
                conditionsOk = true;
            }
        }

        if (conditionsOk) {
            this.draftLock += dt;
            this.draftFail = 0;
        } else {
            this.draftFail += dt;
            this.draftLock = 0;
        }

        if (!this.draftingActive && this.draftLock >= DRAFTING.lockTime) this.draftingActive = true;
        if (this.draftingActive && !conditionsOk && this.draftFail >= DRAFTING.dropoutGrace) this.draftingActive = false;

        if (this.draftingActive) {
            this.draftingLeadSpeedKmh = bestLeadSpeed;
            // Recharge own flow slightly (not shown in UI but keeps parity)
            this.state.flow = THREE.MathUtils.clamp(this.state.flow + DRAFTING.flowRefillRate * dt, 0, 1);
        }

        this.setDraftingVisible(this.draftingActive);
        if (this.draftingParticles) this.draftingParticles.update(dt);
        if (this.draftingLines) this.draftingLines.update(dt);
    }

    private ensureDraftingParticles() {
        if (this.draftingParticles) return;
        this.draftingParticles = new DraftingParticles(this as any);
        // Add to the same parent (scene) to avoid double-transforming world-space positions
        const parent = this.root.parent;
        if (parent) parent.add(this.draftingParticles.root);
        else this.root.add(this.draftingParticles.root);
    }

    private ensureDraftingLines() {
        if (this.draftingLines) return;
        this.draftingLines = new DraftingVectorLines(this as any, { count: 4, points: 22 });
        this.root.add(this.draftingLines.root);
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

        // Jet engine visuals (idle disc + blue cone), positioned at nozzle
        this.jetEngine = new ShipJetEngine(new THREE.Vector3(0, 0, -0.72));
        body.add(this.jetEngine.root);

        this.root.add(body);

        // Create rocket tail boost effect (initially hidden) - exactly like player
        // Position at jet engine nozzle opening (z=-0.72) so tail starts right at the nozzle
        this.rocketTail = new ShipRocketTail(
            this,
            new THREE.Vector3(0, 0, -0.74),
            0,
            { singleCone: true, lengthScale: 2.2, color: 0xffdd55 }
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

        // Create drafting cone visual (hidden by default)
        this.ensureDraftingCone();
        // Create drafting particles
        this.ensureDraftingParticles();
        // Create drafting vector lines
        this.ensureDraftingLines();
    }

    // Vertical/ramp state
    private verticalVelocity = 0;
    private wasOnRamp = false;
    private airborneTimer = 0;


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
            this.speedVariation = 0.02;
            this.laneSwayAmplitude = NPC.laneSwayAmplitude * 1.3;
            this.laneStickiness = Math.max(0.5, NPC.laneStickiness - 0.1);
        } else {
            this.speedVariation = 0.01;
            this.laneSwayAmplitude = NPC.laneSwayAmplitude * 0.9;
            this.laneStickiness = Math.min(0.9, NPC.laneStickiness + 0.1);
        }
    }

    public update(dt: number, playerPosition: number, playerLap: number, playerSpeed: number, allNPCs: NPCShip[] = [], playerLateral: number = 0) {
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

        // Ramp detection and impulse (same as player)
        const rampInfo = this.track.getRampAtT(this.state.t);
        const justEnteredRamp = rampInfo.onRamp && !this.wasOnRamp;
        if (justEnteredRamp) {
            this.verticalVelocity += RAMP.upwardImpulseMps;
            this.airborneTimer = RAMP.airDuration;
        }
        this.wasOnRamp = rampInfo.onRamp;

        // Drafting detection & visuals
        this.updateDrafting(dt, playerPosition, playerLateral, allNPCs);

        // Update AI behavior periodically
        if (this.aiUpdateTimer >= this.aiUpdateInterval) {
            this.updateAI(playerPosition, playerLap, playerSpeed, playerLateral, allNPCs);
            this.updateCollisionAvoidance(allNPCs);
            this.aiUpdateTimer = 0;
        }

        // Boost behavior (timers/energy/FX) must update every frame for correct durations
        this.updateBoostBehavior(dt);

        // Update ship physics
        this.updatePhysics(dt);
        // Update vertical arc (after physics so dt sequencing matches player)
        this.updateVertical(dt);
        this.updatePosition(dt);

        // Simple drift detection: turning (lateralVelocity) + boosting
        const isTurning = Math.abs(this.lateralVelocity) > 0.2;
        const isDriftingNow = isTurning && this.isBoosting;
        this.state.isDrifting = isDriftingNow;
        if (isDriftingNow) {
            this.state.driftDuration += dt;
        }

        // Update drafting visual pulse
        if (this.draftingCone && this.draftingActive) {
            const mat = this.draftingCone.material as THREE.MeshPhysicalMaterial;
            const now = this.getNow();
            const pulse = 0.85 + Math.sin(now * 2.0) * 0.15;
            mat.emissiveIntensity = pulse;
            mat.opacity = 0.18 + (pulse - 0.85) * 0.4;
        }

    }

    private updateVertical(dt: number) {
        // Airborne spring-damper back toward 0 offset, like player (no free flight)
        const springK = this.airborneTimer > 0 ? RAMP.airSpring : PHYSICS.verticalSpring;
        const dampingC = this.airborneTimer > 0 ? RAMP.airDamping : PHYSICS.verticalSpringDamping;
        const springForce = -springK * this.state.verticalOffset;
        const springDamp = -dampingC * this.verticalVelocity;
        this.verticalVelocity += (springForce + springDamp) * dt;
        this.state.verticalOffset += this.verticalVelocity * dt;
        if (this.airborneTimer > 0) this.airborneTimer = Math.max(0, this.airborneTimer - dt);

        // Clamp to corridor
        const vHalf = this.airborneTimer > 0 ? RAMP.airCorridorHalfHeight : PHYSICS.corridorHalfHeight;
        if (this.state.verticalOffset < 0) {
            this.state.verticalOffset = 0;
            if (this.verticalVelocity < 0) this.verticalVelocity = 0;
        }
        if (this.state.verticalOffset > vHalf) {
            this.state.verticalOffset = vHalf;
            if (this.verticalVelocity > 0) this.verticalVelocity = 0;
        }
    }

    private updateAI(playerPosition: number, playerLap: number, playerSpeed: number, playerLateral: number, allNPCs: NPCShip[] = []) {
        // Store player state for rubber banding
        this.playerPosition = playerPosition;
        this.playerLap = playerLap;

        // Calculate our position relative to player
        const ourPosition = this.getTrackPosition();
        const positionDiff = ourPosition - playerPosition;

        // Calculate rubber banding multiplier based on distance from player
        this.updateRubberBanding();

        // Bounds
        const half = this.track.width * 0.5;
        const lateralLimit = half * 0.95;

        // Timers
        this.laneChangeTimer += this.aiUpdateInterval;
        this.evasiveCooldown = Math.max(0, this.evasiveCooldown - this.aiUpdateInterval);

        // Drafting/evasion detection
        const trackLen = this.track.length; // meters
        const ourT = this.state.t;
        const ourLat = this.state.lateralOffset;

        // Helper: ahead distance in meters (0..trackLen)
        const aheadMetersTo = (otherT: number): number => {
            let d = otherT - ourT;
            if (d < 0) d += 1;
            return d * trackLen;
        };
        // Helper: behind distance in meters
        const behindMetersFrom = (otherT: number): number => {
            let d = ourT - otherT;
            if (d < 0) d += 1;
            return d * trackLen;
        };

        // Find best draft target ahead (player or NPC)
        let bestAheadDist = Infinity;
        let draftTargetLateral = playerLateral;
        let draftFound = false;

        // Check player
        const playerAheadDist = aheadMetersTo(this.playerPosition);
        const playerLatDiff = Math.abs(playerLateral - ourLat);
        if (playerAheadDist > 0 && playerAheadDist <= NPC.draftEngageDistanceMeters && playerLatDiff <= NPC.draftAlignTolerance) {
            bestAheadDist = playerAheadDist;
            draftTargetLateral = playerLateral;
            draftFound = true;
        }
        // Check other NPCs
        for (const other of allNPCs) {
            if (other === this) continue;
            const dist = aheadMetersTo(other.state.t);
            const latDiff = Math.abs(other.state.lateralOffset - ourLat);
            if (dist > 0 && dist <= NPC.draftEngageDistanceMeters && latDiff <= NPC.draftAlignTolerance && dist < bestAheadDist) {
                bestAheadDist = dist;
                draftTargetLateral = other.state.lateralOffset;
                draftFound = true;
            }
        }

        // Detect pursuer behind
        let evasionTriggered = false;
        let pursuerLat = playerLateral;
        const playerBehindDist = behindMetersFrom(this.playerPosition);
        const playerBehindLatDiff = Math.abs(playerLateral - ourLat);
        let pursuerDetected = playerBehindDist > 0 && playerBehindDist <= NPC.evasiveDistanceMetersBehind && playerBehindLatDiff <= NPC.draftAlignTolerance;
        if (!pursuerDetected) {
            for (const other of allNPCs) {
                if (other === this) continue;
                const distBack = behindMetersFrom(other.state.t);
                const latDiff = Math.abs(other.state.lateralOffset - ourLat);
                if (distBack > 0 && distBack <= NPC.evasiveDistanceMetersBehind && latDiff <= NPC.draftAlignTolerance) {
                    pursuerDetected = true;
                    pursuerLat = other.state.lateralOffset;
                    break;
                }
            }
        }

        // Adjust preferred lane for evasion
        if (pursuerDetected && this.evasiveCooldown <= 0) {
            const dirAway = this.state.lateralOffset >= pursuerLat ? 1 : -1;
            this.preferredLateralOffset = THREE.MathUtils.clamp(this.preferredLateralOffset + dirAway * NPC.evasiveShiftMeters, -lateralLimit, lateralLimit);
            this.evasiveCooldown = NPC.evasiveCooldownSec;
            // Shorten next lane change interval
            this.laneChangeIntervalSec = Math.max(NPC.laneChangeIntervalMinSec, this.laneChangeIntervalSec * 0.6);
            this.laneChangeTimer = 0;
            evasionTriggered = true;
        }

        // Periodic lane change (continuous offset)
        if (this.laneChangeTimer >= this.laneChangeIntervalSec) {
            // Random continuous target within bounds
            const newPref = THREE.MathUtils.randFloatSpread(lateralLimit * 2 * 0.9); // keep margin from edges
            this.preferredLateralOffset = THREE.MathUtils.clamp(newPref, -lateralLimit, lateralLimit);
            // Set next interval, modulate by context
            let next = THREE.MathUtils.lerp(NPC.laneChangeIntervalMinSec, NPC.laneChangeIntervalMaxSec, Math.random());
            if (draftFound) next *= 1.3; // linger while drafting
            if (evasionTriggered) next *= 0.7; // more jitter after evasion
            this.laneChangeIntervalSec = THREE.MathUtils.clamp(next, NPC.laneChangeIntervalMinSec, NPC.laneChangeIntervalMaxSec * 1.5);
            this.laneChangeTimer = 0;
        }

        // Apply drafting influence to preferred lane (bias toward target lateral)
        if (draftFound) {
            this.preferredLateralOffset = THREE.MathUtils.lerp(this.preferredLateralOffset, draftTargetLateral, 0.7);
        }
        this.isDraftingTarget = draftFound;

        // AI lateral movement - bias around a (possibly updated) preferred lane with gentle sway and jitter
        this.lateralSwayTimer += this.aiUpdateInterval * NPC.laneSwaySpeed;
        const sway = Math.sin(this.lateralSwayTimer + this.laneSwayPhase) * this.laneSwayAmplitude;
        const jitter = (Math.random() - 0.5) * NPC.laneJitterRange * (this.aiBehavior === 'aggressive' ? 1.2 : 1.0);
        const desired = THREE.MathUtils.clamp(this.preferredLateralOffset + sway + jitter, -lateralLimit, lateralLimit);
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
        const maxAheadDistance = 100; // meters - hard cap threshold for slowdown
        const farBehindDistance = 300; // meters - beyond this, maximum speedup effect
        const veryFarBehindDistance = 400; // meters - beyond this, extra strong speedup
        const maxSlowdown = 0.85; // Slow down to 85% when far ahead
        const maxSpeedup = 1.08; // Mild speedup when very far behind
        const normalSpeedup = 1.05; // Mild speedup when moderately behind

        // Tiny persistent variation so NPCs don't all feel identical
        const rubberBandingVariation = this.individualVariation;

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

        // Animate jet engine visuals based on movement
        const isMoving = this.state.speedKmh > 1;
        this.jetEngine.update(dt, isMoving, this.isBoosting);

        // Ship boost particle effect is handled externally by ShipBoost class (same as player)
    }

    // Jet engine visuals now shared with player via ShipJetEngine

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

        // Boost more frequently when drafting (capitalize on slipstream)
        if (this.isDraftingTarget) {
            baseChance += 0.1;
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

        // Remove per-frame jitter; use persistent tiny variation only
        const speedVariationFactor = this.individualVariation;

        // Target speed calculation with rubber banding and individual variation
        let targetSpeed = baseSpeed * this.speedMultiplier * boostMultiplier * tunnelMultiplier * boostPadMultiplier * rubberBanding * speedVariationFactor;

        // Drafting speed match: raise target toward lead speed when locked
        if (this.draftingActive) {
            const matchTarget = Math.min(
                Math.max(this.draftingLeadSpeedKmh + DRAFTING.matchMaxDelta, this.state.speedKmh),
                PHYSICS.maxSpeed
            );
            targetSpeed = Math.max(targetSpeed, matchTarget);
        }

        // Allow NPCs to legitimately get ahead; rubber banding below will prevent runaway leads

        // Soft cap when ahead: don't exceed player speed by more than 2%
        {
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
                const cap = this.latestPlayerSpeedKmh * 1.02;
                targetSpeed = Math.min(targetSpeed, cap);
            }
        }

        // Acceleration-limited speed change so NPCs start from 0 and ramp up naturally
        const prevSpeed = this.state.speedKmh;
        const accelKmhPerSec = PHYSICS.throttleAccelKmhPerSec;
        const decelKmhPerSec = PHYSICS.coastDecelKmhPerSec;
        let newSpeed = prevSpeed;
        if (targetSpeed > prevSpeed) {
            newSpeed = Math.min(prevSpeed + accelKmhPerSec * dt, targetSpeed);
        } else {
            newSpeed = Math.max(prevSpeed - decelKmhPerSec * dt, targetSpeed);
        }
        this.state.speedKmh = newSpeed;

        // No artificial minimum speed clamp: NPCs should start at 0 and accelerate naturally

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
            // Add vertical offset for ramps/airtime (match player)
            pos.addScaledVector(normal, this.state.verticalOffset);

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

            // Roll behavior mirrors player: ramp to sideways, one 360° flip, then stay sideways; on release, back to level
            const nowSec = this.getNow();
            const dtVis = this.lastVisualUpdateSec > 0 ? Math.min(0.05, nowSec - this.lastVisualUpdateSec) : 1 / 60;
            this.lastVisualUpdateSec = nowSec;

            const yawRatio = THREE.MathUtils.clamp(this.lateralVelocity / PHYSICS.lateralAccel, -1, 1);
            const turnDir = yawRatio > 0.25 ? 1 : (yawRatio < -0.25 ? -1 : 0);

            // Update hold timers and direction state
            if (turnDir !== 0) {
                if (this.turnHoldDir === 0 || this.turnHoldDir === turnDir) {
                    this.turnHoldTimer += dtVis;
                    this.turnHoldDir = turnDir;
                } else {
                    this.turnHoldDir = turnDir;
                    this.turnHoldTimer = 0;
                    this.flipAnimating = false;
                    this.flipProgress = 0;
                    this.flipCompletedDir = 0;
                }
            } else {
                this.turnHoldTimer = 0;
                this.turnHoldDir = 0;
                if (this.flipAnimating) {
                    this.flipAnimating = false;
                    this.flipProgress = 0;
                }
                this.flipCompletedDir = 0;
            }

            // Ramp to sideways while holding
            if (turnDir !== 0) {
                const progress = THREE.MathUtils.clamp(this.turnHoldTimer / PHYSICS.rollHoldToSideSec, 0, 1);
                const targetSide = turnDir * PHYSICS.rollSideAngle;
                this.visualRoll = THREE.MathUtils.lerp(this.visualRoll, targetSide, progress);
            } else {
                // Not turning: roll back to level
                this.visualRoll = THREE.MathUtils.damp(this.visualRoll, 0, PHYSICS.rollDamping, dtVis);
            }

            // Start flip after sideways reached, once per direction hold
            if (!this.flipAnimating && turnDir !== 0 && this.flipCompletedDir !== turnDir && this.turnHoldTimer >= PHYSICS.rollHoldToSideSec) {
                this.flipAnimating = true;
                this.flipProgress = 0;
                this.flipDir = turnDir;
                this.flipStartAngle = this.visualRoll;
            }
            if (this.flipAnimating) {
                this.flipProgress = Math.min(1, this.flipProgress + dtVis / PHYSICS.rollFlipDurationSec);
                const fullTurn = Math.PI * 2;
                this.visualRoll = this.flipStartAngle + this.flipDir * fullTurn * this.flipProgress;
                if (this.flipProgress >= 1) {
                    this.flipAnimating = false;
                    this.flipProgress = 0;
                    this.flipCompletedDir = this.flipDir;
                    // After flip, remain sideways while still holding
                    this.visualRoll = this.flipDir * PHYSICS.rollSideAngle;
                }
            }

            const shipYaw = -yawRatio * CAMERA.shipYawFromInput * 0.4;
            const inputEuler = new THREE.Euler(this.state.pitch || 0, shipYaw, this.visualRoll, 'YXZ');
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
