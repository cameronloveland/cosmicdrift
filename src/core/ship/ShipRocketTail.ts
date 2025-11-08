import * as THREE from 'three';
import type { Group } from 'three';
import { BOOST_PAD } from '../constants';

interface RocketTailShip {
    root: Group;
    getBoostPadTimer(): number; // remaining boost pad duration
    getNow(): number; // current time for animation
}

export class ShipRocketTail {
    public root = new THREE.Group();
    private ship: RocketTailShip;
    private materials: THREE.MeshBasicMaterial[] = [];
    private baseOpacities: number[] = [];
    private singleConeMode = false;
    private singleConeMaterial: THREE.MeshBasicMaterial | null = null;
    private singleConeBaseOpacity = 1.0;

    constructor(
        ship: RocketTailShip,
        position: THREE.Vector3 = new THREE.Vector3(0, 0, -0.9),
        baseClipOffset: number = 0,
        opts?: { singleCone?: boolean; lengthScale?: number; color?: THREE.Color | number }
    ) {
        this.ship = ship;
        this.root.position.copy(position);
        this.root.visible = false;
        this.singleConeMode = !!opts?.singleCone;
        if (this.singleConeMode) {
            this.createSingleConeTail(baseClipOffset, opts);
        } else {
            this.createRocketTail(baseClipOffset);
        }
    }

    private createRocketTail(baseClipOffset: number) {
        // Create multi-layer jet flame effect with overlapping cones for realistic appearance
        const nozzleRadius = .13; // Slightly inside booster nozzle opening to avoid overlap
        const tailLength = 0.65; // Shortened tail length to appear correctly from jet engine
        const radialSegments = 16; // Smooth circular cross-section

        // Layer 1: Inner bright white core (hottest, smallest, brightest)
        const coreRadius = nozzleRadius * 0.35;
        const coreLength = tailLength * 0.7; // Shorter core
        const coreGeometry = new THREE.ConeGeometry(coreRadius, coreLength, radialSegments);
        const coreColor = new THREE.Color(1, 0.95, 0.9); // Bright white-hot
        const coreMaterial = new THREE.MeshBasicMaterial({
            color: coreColor,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const core = new THREE.Mesh(coreGeometry, coreMaterial);
        core.position.set(0, 0, baseClipOffset);
        core.rotation.x = -Math.PI * 0.5;
        this.root.add(core);
        this.materials.push(coreMaterial);
        this.baseOpacities.push(1.0);

        // Layer 2: Middle orange layer (main flame body)
        const middleRadius = nozzleRadius * 0.7;
        const middleLength = tailLength * 0.95;
        const middleGeometry = new THREE.ConeGeometry(middleRadius, middleLength, radialSegments);
        const middleColor = new THREE.Color(1, 0.55, 0.1); // Bright orange
        const middleMaterial = new THREE.MeshBasicMaterial({
            color: middleColor,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const middle = new THREE.Mesh(middleGeometry, middleMaterial);
        // Slight offset for turbulence effect
        middle.position.set(0, 0.02, baseClipOffset);
        middle.rotation.x = -Math.PI * 0.5;
        middle.rotation.z = 0.05; // Slight rotation for asymmetry
        this.root.add(middle);
        this.materials.push(middleMaterial);
        this.baseOpacities.push(0.85);

        // Layer 3: Outer orange-yellow layer (largest, most translucent, cooling edges)
        const outerRadius = nozzleRadius;
        const outerLength = tailLength;
        const outerGeometry = new THREE.ConeGeometry(outerRadius, outerLength, radialSegments);
        const outerColor = new THREE.Color(1, 0.65, 0.15); // Slightly more yellow-orange
        const outerMaterial = new THREE.MeshBasicMaterial({
            color: outerColor,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const outer = new THREE.Mesh(outerGeometry, outerMaterial);
        // Slight offset in opposite direction for turbulence
        outer.position.set(0, -0.02, baseClipOffset);
        outer.rotation.x = -Math.PI * 0.5;
        outer.rotation.z = -0.05; // Slight rotation for asymmetry
        this.root.add(outer);
        this.materials.push(outerMaterial);
        this.baseOpacities.push(0.6);
    }

    private createSingleConeTail(baseClipOffset: number, opts?: { lengthScale?: number; color?: THREE.Color | number }) {
        const nozzleRadius = .13;
        const baseLength = 0.65 * (opts?.lengthScale ?? 1.8); // longer cone for track boost
        const radialSegments = 24;

        const geometry = new THREE.ConeGeometry(nozzleRadius, baseLength, radialSegments);
        const color = opts?.color instanceof THREE.Color ? opts.color : new THREE.Color(opts?.color ?? 0xffdd55);
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const cone = new THREE.Mesh(geometry, material);
        cone.position.set(0, 0, baseClipOffset);
        cone.rotation.x = -Math.PI * 0.5;
        this.root.add(cone);
        this.singleConeMaterial = material;
        this.singleConeBaseOpacity = 1.0;
    }

    update(dt: number) {
        // Update rocket tail effect based on boost pad state only
        const boostPadTimer = this.ship.getBoostPadTimer();
        const hasBoostPadEffect = boostPadTimer > 0;
        this.root.visible = hasBoostPadEffect;

        if (this.root.visible) {
            // Animate tail intensity based on boost pad effect
            const tailIntensity = Math.min(1, boostPadTimer / BOOST_PAD.boostDuration);

            // Varying pulse animations for each layer (different frequencies for turbulence)
            const now = this.ship.getNow();
            const corePulse = 0.98 + 0.02 * Math.sin(now * 20); // Faster, subtler for core
            const middlePulse = 0.95 + 0.05 * Math.sin(now * 15); // Main pulse
            const outerPulse = 0.92 + 0.08 * Math.sin(now * 12); // Slower, more variation for outer

            // Update all three layers with different intensities
            const intensityMultiplier = BOOST_PAD.tailIntensity || 1.0;
            if (this.singleConeMode && this.singleConeMaterial) {
                // Single long cone: intense yellow with subtle pulse
                const pulse = 0.96 + 0.08 * Math.sin(now * 14);
                this.singleConeMaterial.opacity = this.singleConeBaseOpacity * tailIntensity * pulse * intensityMultiplier;
            } else if (this.materials.length >= 3) {
                // Core layer - brightest, most intense
                this.materials[0].opacity = this.baseOpacities[0] * tailIntensity * corePulse * intensityMultiplier;
                // Middle layer - main flame body
                this.materials[1].opacity = this.baseOpacities[1] * tailIntensity * middlePulse * intensityMultiplier;
                // Outer layer - translucent edges
                this.materials[2].opacity = this.baseOpacities[2] * tailIntensity * outerPulse * intensityMultiplier;
            }
        }
    }

    public dispose() {
        this.materials.forEach(material => material.dispose());
        this.root.children.forEach(child => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
            }
        });
        this.root.clear();
    }
}

