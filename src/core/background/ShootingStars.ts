import * as THREE from 'three';
import { SHOOTING_STARS, STARFIELD_MIN_RADIUS } from '../constants';

export class ShootingStars {
    public root = new THREE.Group();
    private starMesh!: THREE.InstancedMesh;
    private trailMesh!: THREE.InstancedMesh;
    private maxStars = SHOOTING_STARS.maxCount;
    private activeStars: Array<{
        index: number;
        position: THREE.Vector3;
        velocity: THREE.Vector3;
        lifetime: number;
        maxLifetime: number;
        trailColor: THREE.Color;
        trailParticles: Array<{
            position: THREE.Vector3;
            age: number;
            maxAge: number;
        }>;
    }> = [];
    private nextSpawnTime = 0;
    private tmpObj = new THREE.Object3D();
    private tmpVec3 = new THREE.Vector3();
    private tmpQuat = new THREE.Quaternion();
    private starfieldRadius = STARFIELD_MIN_RADIUS;

    constructor() {
        this.setupStarMesh();
        this.setupTrailMesh();
        this.root.add(this.starMesh);
        this.root.add(this.trailMesh);

        // Start with immediate spawn for testing
        this.nextSpawnTime = 0.05; // Frequent spawning for good coverage
    }

    public setStarfieldRadius(r: number) {
        this.starfieldRadius = r;
    }


    private setupStarMesh() {
        // Create bright sphere for shooting star core with soft glow
        const starGeometry = new THREE.SphereGeometry(0.1, 8, 8); // Very small for point-like appearance
        const starMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8, // Slightly softer for glow
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true, // Enable depth test for proper layering
            toneMapped: false
        });
        this.starMesh = new THREE.InstancedMesh(starGeometry, starMaterial, this.maxStars);
        // Note: instanceColor works with InstancedMesh without vertexColors
        this.starMesh.frustumCulled = false; // CRITICAL FIX: Disable frustum culling to prevent intermittent visibility

        // Initialize instanceColor for per-star fade effects
        this.starMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxStars * 3), 3);
        this.starMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }

    private setupTrailMesh() {
        // Create small spheres for trail particles
        const trailGeometry = new THREE.SphereGeometry(0.3, 8, 6);
        const trailMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0, // Full opacity for maximum visibility
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false, // Disable depth test to ensure visibility
            toneMapped: false
        });
        this.trailMesh = new THREE.InstancedMesh(trailGeometry, trailMaterial, this.maxStars * SHOOTING_STARS.trailParticleCount);
        // Note: instanceColor works with InstancedMesh without vertexColors
        this.trailMesh.frustumCulled = false; // CRITICAL FIX: Disable frustum culling to prevent intermittent visibility

        // Initialize instanceColor for per-trail fade effects
        this.trailMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxStars * SHOOTING_STARS.trailParticleCount * 3), 3);
        this.trailMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }

    update(dt: number) {


        // Spawn new shooting stars
        this.nextSpawnTime -= dt;
        if (this.nextSpawnTime <= 0 && this.activeStars.length < this.maxStars) {
            this.spawnStar();
            this.nextSpawnTime = SHOOTING_STARS.spawnRateMin + Math.random() * (SHOOTING_STARS.spawnRateMax - SHOOTING_STARS.spawnRateMin);
        }

        // Update existing stars
        for (let i = this.activeStars.length - 1; i >= 0; i--) {
            const star = this.activeStars[i];

            // Update star position
            star.position.addScaledVector(star.velocity, dt);

            // Remove star if it travels too far from center (beyond outer shell with fade distance)
            const distanceFromCenter = star.position.length();
            if (distanceFromCenter > this.starfieldRadius * 2.0) {
                this.removeStar(i);
                continue;
            }

            // Update trail particles
            this.updateTrailParticles(star, dt);

            // Update star mesh
            this.updateStarMesh(star);
        }

        // Update trail mesh
        this.updateTrailMesh();
    }

    private spawnStar() {
        // Spawn in far shell for distant background shooting stars
        // Use starfield radius to ensure they're as distant as background stars
        const spawnRadius = this.starfieldRadius * (0.8 + Math.random() * 0.4); // 80-120% of starfield for far distant background

        // Use uniform distribution across the sphere
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        const position = new THREE.Vector3(
            spawnRadius * Math.sin(phi) * Math.cos(theta),
            spawnRadius * Math.cos(phi),
            spawnRadius * Math.sin(phi) * Math.sin(theta)
        );

        // Random direction for ambient movement
        const randomDirection = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
        ).normalize();

        // Much faster speed for visible streaks
        const speed = 300 + Math.random() * 200; // 300-500 units/sec
        const velocity = randomDirection.multiplyScalar(speed);

        // White trail color to match background stars
        const trailColor = new THREE.Color(0xffffff);

        const star = {
            index: this.activeStars.length,
            position: position.clone(),
            velocity: velocity,
            lifetime: SHOOTING_STARS.lifetimeMin + Math.random() * (SHOOTING_STARS.lifetimeMax - SHOOTING_STARS.lifetimeMin),
            maxLifetime: SHOOTING_STARS.lifetimeMin + Math.random() * (SHOOTING_STARS.lifetimeMax - SHOOTING_STARS.lifetimeMin),
            trailColor: trailColor,
            trailParticles: []
        };

        this.activeStars.push(star);
    }

    private updateTrailParticles(star: any, dt: number) {
        // Add new trail particle at star position
        if (Math.random() < 0.8) { // 80% chance per frame for denser trails
            star.trailParticles.push({
                position: star.position.clone(),
                age: 0,
                maxAge: 1.0 + Math.random() * 0.5
            });
        }

        // Update existing trail particles
        for (let i = star.trailParticles.length - 1; i >= 0; i--) {
            const particle = star.trailParticles[i];
            particle.age += dt;

            if (particle.age >= particle.maxAge) {
                star.trailParticles.splice(i, 1);
            }
        }

        // Limit trail particle count
        if (star.trailParticles.length > SHOOTING_STARS.trailParticleCount) {
            star.trailParticles.splice(0, star.trailParticles.length - SHOOTING_STARS.trailParticleCount);
        }
    }

    private updateStarMesh(star: any) {
        // Position star
        this.tmpObj.position.copy(star.position);

        // Orient star along velocity direction with proper 3D rotation (fixes flat plane bug)
        const direction = star.velocity.clone().normalize();
        const up = new THREE.Vector3(0, 1, 0);

        // Handle edge case where direction is parallel to up
        let right: THREE.Vector3;
        if (Math.abs(direction.y) > 0.99) {
            right = new THREE.Vector3(1, 0, 0);
        } else {
            right = new THREE.Vector3().crossVectors(up, direction).normalize();
        }
        const upCorrected = new THREE.Vector3().crossVectors(direction, right).normalize();

        const m = new THREE.Matrix4().makeBasis(right, upCorrected, direction);
        const quat = new THREE.Quaternion().setFromRotationMatrix(m);
        this.tmpObj.quaternion.copy(quat);

        // Scale based on distance from center for consistent visibility
        // Star is a sphere, so scale uniformly (no elongation - trail provides streak)
        const distance = star.position.length();
        const minDistance = this.starfieldRadius * 0.8;
        const fadeStartDistance = this.starfieldRadius * 1.5;
        const fadeEndDistance = this.starfieldRadius * 2.0;

        // Calculate fade ratio based on distance
        let visibility = 1.0;
        if (distance > fadeStartDistance) {
            const fadeRatio = THREE.MathUtils.clamp((distance - fadeStartDistance) / (fadeEndDistance - fadeStartDistance), 0, 1);
            visibility = 1.0 - fadeRatio; // Fade from 100% to 0% over fade zone
        }

        const scale = SHOOTING_STARS.starSize * 15.0 * visibility;
        this.tmpObj.scale.setScalar(scale); // Uniform scale for sphere

        this.tmpObj.updateMatrix();
        this.starMesh.setMatrixAt(star.index, this.tmpObj.matrix);

        // Set color based on visibility for fade effect
        const color = star.trailColor.clone().multiplyScalar(visibility);
        this.starMesh.setColorAt(star.index, color);
    }

    private updateTrailMesh() {
        let trailIndex = 0;

        for (const star of this.activeStars) {
            for (const particle of star.trailParticles) {
                if (trailIndex >= this.maxStars * SHOOTING_STARS.trailParticleCount) break;

                // Position trail particle
                this.tmpObj.position.copy(particle.position);
                this.tmpObj.quaternion.identity();

                // Scale based on age (fade out) - make much larger for visibility
                const ageRatio = particle.age / particle.maxAge;
                const scale = 15.0 * (1 - ageRatio); // Much larger trail particles
                this.tmpObj.scale.setScalar(scale);

                this.tmpObj.updateMatrix();
                this.trailMesh.setMatrixAt(trailIndex, this.tmpObj.matrix);

                // Set trail color
                const color = star.trailColor.clone();
                color.multiplyScalar(1 - ageRatio); // Fade with age
                this.trailMesh.setColorAt(trailIndex, color);

                trailIndex++;
            }
        }

        // Hide unused trail instances
        for (let i = trailIndex; i < this.maxStars * SHOOTING_STARS.trailParticleCount; i++) {
            this.tmpObj.scale.setScalar(0);
            this.tmpObj.updateMatrix();
            this.trailMesh.setMatrixAt(i, this.tmpObj.matrix);
        }

        // Only update if meshes exist and are initialized
        if (this.starMesh && this.starMesh.instanceMatrix) {
            this.starMesh.instanceMatrix.needsUpdate = true;
        }
        if (this.trailMesh && this.trailMesh.instanceMatrix) {
            this.trailMesh.instanceMatrix.needsUpdate = true;
        }
        if (this.starMesh && this.starMesh.instanceColor) {
            (this.starMesh.instanceColor as any).needsUpdate = true;
        }
        if (this.trailMesh && this.trailMesh.instanceColor) {
            (this.trailMesh.instanceColor as any).needsUpdate = true;
        }
    }

    private removeStar(index: number) {
        this.activeStars.splice(index, 1);

        // Reindex remaining stars
        for (let i = 0; i < this.activeStars.length; i++) {
            this.activeStars[i].index = i;
        }
    }
}