import * as THREE from 'three';
import { SHOOTING_STARS, STARFIELD_MIN_RADIUS } from './constants';

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

    constructor() {
        this.setupStarMesh();
        this.setupTrailMesh();
        this.root.add(this.starMesh);
        this.root.add(this.trailMesh);

        // Start with immediate spawn for testing
        this.nextSpawnTime = 0.05; // Frequent spawning for good coverage
    }


    private setupStarMesh() {
        // Create elongated cylinder for shooting star core
        const starGeometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 6, 1, true);
        const starMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0, // Full opacity for maximum visibility
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false, // Disable depth test to ensure visibility
            toneMapped: false
        });
        this.starMesh = new THREE.InstancedMesh(starGeometry, starMaterial, this.maxStars);
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
            star.lifetime -= dt;

            if (star.lifetime <= 0) {
                this.removeStar(i);
                continue;
            }

            // Update star position
            star.position.addScaledVector(star.velocity, dt);

            // Update trail particles
            this.updateTrailParticles(star, dt);

            // Update star mesh
            this.updateStarMesh(star);
        }

        // Update trail mesh
        this.updateTrailMesh();
    }

    private spawnStar() {
        // Create multiple spawn zones for better distribution
        const spawnZones = [
            { radius: 800, weight: 0.3 },   // Close zone
            { radius: 1200, weight: 0.4 },  // Medium zone  
            { radius: 1800, weight: 0.3 }   // Far zone
        ];

        // Select spawn zone based on weights
        const rand = Math.random();
        let selectedZone = spawnZones[0];
        let cumulativeWeight = 0;

        for (const zone of spawnZones) {
            cumulativeWeight += zone.weight;
            if (rand <= cumulativeWeight) {
                selectedZone = zone;
                break;
            }
        }

        // Use uniform distribution across the sphere
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        const position = new THREE.Vector3(
            selectedZone.radius * Math.sin(phi) * Math.cos(theta),
            selectedZone.radius * Math.cos(phi),
            selectedZone.radius * Math.sin(phi) * Math.sin(theta)
        );

        // Create direction that ensures shooting stars cross through the track area
        // Generate a random direction but bias it toward the center (where track is)
        const centerDirection = new THREE.Vector3(0, 0, 0).sub(position).normalize();
        const randomDirection = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
        ).normalize();

        // Mix random direction with center direction for better track crossing
        const finalDirection = randomDirection.clone().lerp(centerDirection, 0.1).normalize(); // Reduced bias

        const speed = SHOOTING_STARS.speedMin + Math.random() * (SHOOTING_STARS.speedMax - SHOOTING_STARS.speedMin);
        const velocity = finalDirection.multiplyScalar(speed);

        // Random trail color
        const trailColor = SHOOTING_STARS.trailColors[Math.floor(Math.random() * SHOOTING_STARS.trailColors.length)].clone();

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

        // Orient star along velocity direction
        const direction = star.velocity.clone().normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, direction);
        this.tmpObj.quaternion.copy(quat);

        // Scale based on lifetime (fade out) - make larger for visibility
        const lifetimeRatio = star.lifetime / star.maxLifetime;
        const scale = SHOOTING_STARS.starSize * 4.0 * (0.5 + 0.5 * lifetimeRatio); // 4x larger for visibility
        this.tmpObj.scale.set(1, scale * 2, 1); // Elongated along velocity

        this.tmpObj.updateMatrix();
        this.starMesh.setMatrixAt(star.index, this.tmpObj.matrix);
    }

    private updateTrailMesh() {
        let trailIndex = 0;

        for (const star of this.activeStars) {
            for (const particle of star.trailParticles) {
                if (trailIndex >= this.maxStars * SHOOTING_STARS.trailParticleCount) break;

                // Position trail particle
                this.tmpObj.position.copy(particle.position);
                this.tmpObj.quaternion.identity();

                // Scale based on age (fade out) - make larger for visibility
                const ageRatio = particle.age / particle.maxAge;
                const scale = 2.0 * (1 - ageRatio); // Much larger trail particles
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

        this.starMesh.instanceMatrix.needsUpdate = true;
        this.trailMesh.instanceMatrix.needsUpdate = true;
        (this.trailMesh.instanceColor as any).needsUpdate = true;
    }

    private removeStar(index: number) {
        this.activeStars.splice(index, 1);

        // Reindex remaining stars
        for (let i = 0; i < this.activeStars.length; i++) {
            this.activeStars[i].index = i;
        }
    }
}
