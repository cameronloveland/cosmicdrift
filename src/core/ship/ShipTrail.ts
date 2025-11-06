import * as THREE from 'three';

export interface ShipTrailConfig {
    maxPoints: number;
    pointSpacing: number;
    color: THREE.Color;
    opacity: number;
    offset?: number;
}

export class ShipTrail {
    public root = new THREE.Group();
    private trail: THREE.Line;
    private trailPoints: THREE.Vector3[] = [];
    private trailMaterial: THREE.LineBasicMaterial;
    private config: ShipTrailConfig;
    private initialized = false;

    constructor(config: ShipTrailConfig) {
        this.config = config;

        // Create trail geometry with valid initial data
        const trailGeometry = new THREE.BufferGeometry();

        // Initialize with dummy positions to ensure geometry is valid
        const dummyPositions = new Float32Array(config.maxPoints * 3);
        const dummyColors = new Float32Array(config.maxPoints * 3);

        // Fill with initial data
        for (let i = 0; i < config.maxPoints; i++) {
            dummyPositions[i * 3] = 0;
            dummyPositions[i * 3 + 1] = 0;
            dummyPositions[i * 3 + 2] = 0;
            dummyColors[i * 3] = config.color.r;
            dummyColors[i * 3 + 1] = config.color.g;
            dummyColors[i * 3 + 2] = config.color.b;
        }

        trailGeometry.setAttribute('position', new THREE.BufferAttribute(dummyPositions, 3));
        trailGeometry.setAttribute('color', new THREE.BufferAttribute(dummyColors, 3));

        // Create trail material
        this.trailMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: config.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // Create the trail line
        this.trail = new THREE.Line(trailGeometry, this.trailMaterial);
        this.trail.renderOrder = 999; // Ensure trails render after other objects
        this.root.add(this.trail);

        // Don't initialize trail points yet - wait for first update with ship position
    }

    private initializeTrailPoints(shipPos: THREE.Vector3, shipDir: THREE.Vector3, shipRight: THREE.Vector3) {
        // Create initial trail points at ship position
        const offset = this.config.offset || 0;
        for (let i = 0; i < this.config.maxPoints; i++) {
            const point = shipPos.clone()
                .addScaledVector(shipRight, offset)
                .addScaledVector(shipDir, -(i * this.config.pointSpacing));
            this.trailPoints.push(point);
        }

        this.updateTrailGeometry();
    }

    private updateTrailGeometry() {
        const positions = new Float32Array(this.trailPoints.length * 3);
        const colors = new Float32Array(this.trailPoints.length * 3);

        for (let i = 0; i < this.trailPoints.length; i++) {
            const point = this.trailPoints[i];
            positions[i * 3] = point.x;
            positions[i * 3 + 1] = point.y;
            positions[i * 3 + 2] = point.z;

            // Calculate fade based on position in trail (0 = newest, 1 = oldest)
            const fadeProgress = i / (this.trailPoints.length - 1);
            const fadeAlpha = 1 - fadeProgress; // Fade from 1 to 0

            // Set color with fade
            colors[i * 3] = this.config.color.r * fadeAlpha;
            colors[i * 3 + 1] = this.config.color.g * fadeAlpha;
            colors[i * 3 + 2] = this.config.color.b * fadeAlpha;
        }

        const geometry = this.trail.geometry as THREE.BufferGeometry;
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;

        // Force Three.js to recalculate bounds
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
    }

    public update(shipPos: THREE.Vector3, shipDir: THREE.Vector3, shipRight: THREE.Vector3, dt: number, isBoosting: boolean) {
        // Only visible when boosting
        this.trail.visible = isBoosting;
        this.root.visible = isBoosting;

        // Initialize trail points on first update with ship position
        if (!this.initialized) {
            this.initializeTrailPoints(shipPos, shipDir, shipRight);
            this.initialized = true;
        }

        // Add new point at ship position with offset
        const offset = this.config.offset || 0;
        const newPoint = shipPos.clone().addScaledVector(shipRight, offset);
        this.trailPoints.unshift(newPoint);

        // Keep only max points for performance
        if (this.trailPoints.length > this.config.maxPoints) {
            this.trailPoints.pop();
        }

        // Simple trailing motion - just move points backward
        for (let i = 1; i < this.trailPoints.length; i++) {
            const currentPoint = this.trailPoints[i];

            // Move point backward along ship direction
            currentPoint.addScaledVector(shipDir, -dt * 5);
        }

        // Update trail geometry
        this.updateTrailGeometry();
    }

    public setVisible(visible: boolean) {
        this.trail.visible = visible;
    }

    public dispose() {
        this.trail.geometry.dispose();
        this.trailMaterial.dispose();
        this.root.remove(this.trail);
    }
}
