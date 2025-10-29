import * as THREE from 'three';
import { Ship } from './Ship';

interface Particle {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    age: number;
    maxAge: number;
    opacity: number;
    scale: number;
}

export class ShipBoost {
    public root = new THREE.Group();
    private ship: Ship;
    private particles: Particle[] = [];
    private imesh: THREE.InstancedMesh;
    private tmpObj = new THREE.Object3D();
    private colors: THREE.Color[] = [];
    private maxParticles = 50;

    constructor(ship: Ship) {
        this.ship = ship;

        // Create particle geometry (small spheres)
        const geometry = new THREE.SphereGeometry(0.05, 8, 6);

        // Create material with additive blending for glow effect
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ffff, // Cyan
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // Create instanced mesh for efficient rendering
        this.imesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
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
        const shipRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.ship.root.quaternion);

        // Spawn particles behind the ship
        const offset = (Math.random() - 0.5) * 0.6; // Spread across ship width
        const spawnPos = shipPos.clone()
            .addScaledVector(shipRight, offset)
            .addScaledVector(shipDir, -0.5); // Behind ship

        const particle: Particle = {
            position: spawnPos,
            velocity: shipDir.clone().multiplyScalar(-2 - Math.random() * 3), // Move backward
            age: 0,
            maxAge: 0.5 + Math.random() * 1.0, // 0.5-1.5 seconds
            opacity: 1.0,
            scale: 0.5 + Math.random() * 0.5 // 0.5-1.0 scale
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

            // Fade out over time
            particle.opacity = 1 - (particle.age / particle.maxAge);

            // Remove dead particles
            if (particle.age >= particle.maxAge || particle.opacity <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            // Update instance matrix
            this.tmpObj.position.copy(particle.position);
            this.tmpObj.scale.setScalar(particle.scale * particle.opacity);
            this.tmpObj.updateMatrix();
            this.imesh.setMatrixAt(i, this.tmpObj.matrix);

            // Update color
            const color = this.colors[i];
            color.setHSL(0.5, 1.0, 0.5); // Cyan
            color.multiplyScalar(particle.opacity);
            this.imesh.setColorAt(i, color);
        }

        // Update instanced mesh
        this.imesh.instanceMatrix.needsUpdate = true;
        this.imesh.instanceColor!.needsUpdate = true;
        this.imesh.count = this.particles.length;
    }

    public dispose() {
        this.imesh.geometry.dispose();
        (this.imesh.material as THREE.Material).dispose();
        this.root.remove(this.imesh);
    }
}