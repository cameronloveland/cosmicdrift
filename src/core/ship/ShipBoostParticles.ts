import * as THREE from 'three';
import type { Group } from 'three';

interface Particle {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    age: number;
    maxAge: number;
    opacity: number;
    scale: number;
    // Axis convergence data to shape plume
    axisOrigin: THREE.Vector3; // world-space point on axis at spawn (nozzle exit)
    axisDir: THREE.Vector3;    // world-space backward axis direction at spawn
    radialDir: THREE.Vector3;  // world-space unit vector perpendicular to axis (spawn rim direction)
}

type Boostable = { root: Group; state: { boosting: boolean } };

type BoostParticleOptions = {
    scaleMultiplier?: number;
    opacity?: number;
    toneMapped?: boolean;
    depthTest?: boolean;
};

export class ShipBoostParticles {
    public root = new THREE.Group();
    private ship: Boostable;
    private particles: Particle[] = [];
    private imesh: THREE.InstancedMesh;
    private tmpObj = new THREE.Object3D();
    private colors: THREE.Color[] = [];
    private maxParticles = 50;
    private scaleMultiplier = 1.0;
    private baseOpacity = 0.8;

    constructor(ship: Boostable, opts?: BoostParticleOptions) {
        this.ship = ship;
        if (opts?.scaleMultiplier !== undefined) this.scaleMultiplier = opts.scaleMultiplier;
        if (opts?.opacity !== undefined) this.baseOpacity = opts.opacity;

        // Create particle geometry (small spheres)
        const geometry = new THREE.SphereGeometry(0.05, 8, 6);

        // Create material with additive blending for glow effect
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ffff, // Cyan
            transparent: true,
            opacity: this.baseOpacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: opts?.depthTest ?? false,
            toneMapped: opts?.toneMapped ?? true
        });

        // Create instanced mesh for efficient rendering
        this.imesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);

        // Explain frustumCulled:
        // By default, Three.js objects set `frustumCulled = true`, which means the renderer skips drawing them if their bounding volume is outside the camera's view (the "view frustum").
        // For InstancedMesh used with dynamic, procedural, or fast-moving particles, the automatic bounding box may be incorrect (especially before first update), causing objects to disappear or "pop" even when they should be visible.
        // Disabling frustum culling here (`frustumCulled = false`) ensures all instances are always drawn, regardless of computed bounds—eliminating intermittent particle trail visibility issues during initialization and fast motion.
        this.imesh.frustumCulled = false;

        this.imesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxParticles * 3), 3);
        this.imesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.root.add(this.imesh);

        // Initialize colors array
        for (let i = 0; i < this.maxParticles; i++) {
            this.colors[i] = new THREE.Color();
        }
    }

    private spawn() {
        if (this.particles.length >= this.maxParticles) return;

        const shipPos = this.ship.root.position.clone();
        const shipDir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.ship.root.quaternion);
        const shipUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.ship.root.quaternion);
        const shipRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.ship.root.quaternion);

        // Spawn particles from the jet engine nozzle
        // Jet engine nozzle is at (0, 0, -0.72) in body local space
        // Ship root is scaled by 3x, so nozzle is at -0.72 * 3 = -2.16 units behind root origin
        const nozzleOffset = -0.72 * 3; // -2.16 units behind ship root

        // Approximate nozzle radius in world units (geometry radius 0.15 scaled by 3x)
        const nozzleRadius = 0.15 * 3;

        // Sample around the nozzle rim to create a cylindrical shell emission
        const theta = Math.random() * Math.PI * 2;
        const rimRadius = nozzleRadius * (0.75 + Math.random() * 0.25); // bias near the edge
        const radialDir = shipRight.clone().multiplyScalar(Math.cos(theta))
            .add(shipUp.clone().multiplyScalar(Math.sin(theta))).normalize();

        const spawnPos = shipPos.clone()
            .addScaledVector(shipDir, nozzleOffset)
            .addScaledVector(radialDir, rimRadius); // ring around the nozzle axis

        const particle: Particle = {
            position: spawnPos,
            // Backward along ship direction with slight radial convergence so plume narrows into a shaft
            velocity: shipDir.clone().multiplyScalar(-(2 + Math.random() * 3))
                .add(radialDir.clone().multiplyScalar(-(0.5 + Math.random() * 0.7))),
            age: 0,
            maxAge: 0.5 + Math.random() * 1.0, // 0.5-1.5 seconds
            opacity: 1.0,
            scale: 0.5 + Math.random() * 0.5, // 0.5-1.0 scale
            axisOrigin: shipPos.clone().addScaledVector(shipDir, nozzleOffset),
            axisDir: shipDir.clone().normalize(),
            radialDir: radialDir.clone()
        };

        this.particles.push(particle);
    }

    update(dt: number) {
        // Only visible when boosting
        const isBoosting = this.ship.state.boosting;
        this.root.visible = isBoosting;
        this.imesh.visible = isBoosting;

        // Spawn new particles when boosting
        if (this.ship.state.boosting) {
            this.spawn();
        }

        // Update existing particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];

            // Age particle
            particle.age += dt;

            // Move particle
            particle.position.addScaledVector(particle.velocity, dt);

            // Converge toward a shaft radius along the axis defined at spawn
            // Target smaller radius than nozzle to create a tapered entry that stabilizes
            const targetRadius = 0.15 * 3 * 0.4; // 40% of nozzle radius
            const radialStiffness = 10.0; // how fast we correct toward target radius

            // Closest point on axis line to current position
            const originToPos = new THREE.Vector3().subVectors(particle.position, particle.axisOrigin);
            const t = originToPos.dot(particle.axisDir); // signed distance along axis
            const closestOnAxis = particle.axisOrigin.clone().addScaledVector(particle.axisDir, t);
            const radialVec = new THREE.Vector3().subVectors(particle.position, closestOnAxis);
            const radialLen = radialVec.length();

            // Compute desired radial vector toward target radius, stable direction even if near axis
            const desiredDir = radialLen > 1e-4 ? radialVec.clone().multiplyScalar(1 / radialLen) : particle.radialDir;
            const desiredRadial = desiredDir.clone().multiplyScalar(targetRadius);
            const radialError = radialVec.sub(desiredRadial); // current - desired

            // Apply spring-like correction to position (visual shaping) and lightly damp radial velocity
            particle.position.addScaledVector(radialError, -radialStiffness * dt);
            // Dampen any residual radial velocity so it doesn't expand
            const velAlongAxis = particle.axisDir.clone().multiplyScalar(particle.velocity.dot(particle.axisDir));
            const velRadial = particle.velocity.clone().sub(velAlongAxis).multiplyScalar(0.5); // keep half radial component
            particle.velocity.copy(velAlongAxis.add(velRadial));

            // Fade out over time
            particle.opacity = 1 - (particle.age / particle.maxAge);

            // Remove dead particles
            if (particle.age >= particle.maxAge || particle.opacity <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            // Update instance matrix
            this.tmpObj.position.copy(particle.position);
            this.tmpObj.scale.setScalar(particle.scale * particle.opacity * this.scaleMultiplier);
            this.tmpObj.updateMatrix();
            this.imesh.setMatrixAt(i, this.tmpObj.matrix);

            // Update color
            const color = this.colors[i];
            color.setHSL(0.5, 1.0, 0.5); // Cyan
            color.multiplyScalar(particle.opacity);
            this.imesh.setColorAt(i, color);
        }

        // CRITICAL FIX: Update instanced mesh - must set count BEFORE needsUpdate
        // If count is 0, Three.js won't render anything even if matrices are valid
        this.imesh.count = this.particles.length;
        this.imesh.instanceMatrix.needsUpdate = true;
        this.imesh.instanceColor!.needsUpdate = true;
    }

    public dispose() {
        this.imesh.geometry.dispose();
        (this.imesh.material as THREE.Material).dispose();
        this.root.remove(this.imesh);
    }
}