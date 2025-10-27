import * as THREE from 'three';
import { SHOOTING_STARS } from './constants';

export class ShootingStars {
    public root = new THREE.Group();
    private starMesh!: THREE.InstancedMesh;
    private trailMesh!: THREE.InstancedMesh;
    private maxStars = SHOOTING_STARS.maxCount;
    private camera?: THREE.Camera;
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
        this.nextSpawnTime = 0.1;
    }

    setCamera(camera: THREE.Camera) {
        this.camera = camera;
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
            toneMapped: false
        });
        this.trailMesh = new THREE.InstancedMesh(trailGeometry, trailMaterial, this.maxStars * SHOOTING_STARS.trailParticleCount);
    }

    update(dt: number) {
        // Spawn new shooting stars
        this.nextSpawnTime -= dt;
        if (this.nextSpawnTime <= 0 && this.activeStars.length < this.maxStars) {
            // Use a mix of spawning methods to ensure full coverage
            const spawnMethod = Math.random();
            if (spawnMethod < 0.4) {
                // 40% camera-aware spawning (in direction player is looking)
                this.spawnStar();
            } else if (spawnMethod < 0.7) {
                // 30% omnidirectional spawning (all around the player)
                this.spawnStarOmnidirectional();
            } else {
                // 30% fallback spawning (wider area coverage)
                this.spawnStarFallback();
            }
            this.nextSpawnTime = SHOOTING_STARS.spawnRateMin + Math.random() * (SHOOTING_STARS.spawnRateMax - SHOOTING_STARS.spawnRateMin);
        }

        // Ensure we always have some shooting stars in the field of view
        // If we have very few stars, spawn more aggressively
        if (this.activeStars.length < this.maxStars * 0.3) {
            this.nextSpawnTime = Math.min(this.nextSpawnTime, 0.1); // Force spawn soon
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
        if (!this.camera) return;

        // Get camera position and direction
        const cameraPos = this.camera.position.clone();
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);

        // Create a cone of directions around the camera's look direction
        // This ensures shooting stars appear in the depths where the player is looking
        const baseDirection = cameraDirection.clone();

        // Add some randomness around the camera's look direction
        const randomAngle = (Math.random() - 0.5) * Math.PI * 0.6; // ±54 degrees
        const randomAxis = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize();

        const randomRotation = new THREE.Quaternion().setFromAxisAngle(randomAxis, randomAngle);
        const spawnDirection = baseDirection.clone().applyQuaternion(randomRotation);

        // Spawn at various distances in the direction the player is looking
        const minDistance = SHOOTING_STARS.starfieldRadius * 0.8;
        const maxDistance = SHOOTING_STARS.starfieldRadius * 1.5;
        const spawnDistance = minDistance + Math.random() * (maxDistance - minDistance);

        const position = cameraPos.clone().addScaledVector(spawnDirection, spawnDistance);

        // Create velocity that moves across the field of view
        // Mix the spawn direction with some perpendicular movement for natural "shooting" effect
        const perpendicular1 = new THREE.Vector3().crossVectors(spawnDirection, new THREE.Vector3(0, 1, 0)).normalize();
        const perpendicular2 = new THREE.Vector3().crossVectors(spawnDirection, perpendicular1).normalize();

        const crossMovement = new THREE.Vector3()
            .addScaledVector(perpendicular1, (Math.random() - 0.5) * 0.8)
            .addScaledVector(perpendicular2, (Math.random() - 0.5) * 0.8)
            .addScaledVector(spawnDirection, -0.3) // Slight movement toward camera for "shooting" effect
            .normalize();

        const speed = SHOOTING_STARS.speedMin + Math.random() * (SHOOTING_STARS.speedMax - SHOOTING_STARS.speedMin);
        const velocity = crossMovement.multiplyScalar(speed);

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

    private spawnStarOmnidirectional() {
        // Omnidirectional spawning - spawn from any direction around the player
        // This ensures coverage of all areas of the starfield
        if (!this.camera) return;

        const cameraPos = this.camera.position.clone();

        // Spawn in a full sphere around the camera position
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const radius = SHOOTING_STARS.starfieldRadius * (0.9 + Math.random() * 0.2);

        const position = new THREE.Vector3(
            cameraPos.x + radius * Math.sin(phi) * Math.cos(theta),
            cameraPos.y + radius * Math.cos(phi) * 0.85, // Slight bias toward horizontal
            cameraPos.z + radius * Math.sin(phi) * Math.sin(theta)
        );

        // Create velocity that moves across the field of view
        // Mix random direction with slight bias toward camera for "shooting" effect
        const randomDirection = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 1,
            (Math.random() - 0.5) * 2
        ).normalize();

        // Add slight bias toward camera for more natural shooting effect
        const toCamera = cameraPos.clone().sub(position).normalize();
        const biasedDirection = randomDirection.clone().lerp(toCamera, 0.2).normalize();

        const speed = SHOOTING_STARS.speedMin + Math.random() * (SHOOTING_STARS.speedMax - SHOOTING_STARS.speedMin);
        const velocity = biasedDirection.multiplyScalar(speed);

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

    private spawnStarFallback() {
        // Fallback spawning method - spawn from the outer edges of the starfield
        // This ensures coverage even when the camera is in unusual positions
        if (!this.camera) return;

        const cameraPos = this.camera.position.clone();

        // Spawn from the outer edges of the starfield, ensuring full coverage
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const radius = SHOOTING_STARS.starfieldRadius * (1.2 + Math.random() * 0.3); // Further out

        const position = new THREE.Vector3(
            cameraPos.x + radius * Math.sin(phi) * Math.cos(theta),
            cameraPos.y + radius * Math.cos(phi) * 0.85,
            cameraPos.z + radius * Math.sin(phi) * Math.sin(theta)
        );

        // Create velocity that moves across the field of view
        // Use a more varied approach for fallback spawning
        const randomDirection = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 1,
            (Math.random() - 0.5) * 2
        ).normalize();

        // Add slight bias toward camera for more natural shooting effect
        const toCamera = cameraPos.clone().sub(position).normalize();
        const biasedDirection = randomDirection.clone().lerp(toCamera, 0.3).normalize();

        const speed = SHOOTING_STARS.speedMin + Math.random() * (SHOOTING_STARS.speedMax - SHOOTING_STARS.speedMin);
        const velocity = biasedDirection.multiplyScalar(speed);

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

        // Scale based on lifetime (fade out)
        const lifetimeRatio = star.lifetime / star.maxLifetime;
        const scale = SHOOTING_STARS.starSize * (0.5 + 0.5 * lifetimeRatio);
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

                // Scale based on age (fade out)
                const ageRatio = particle.age / particle.maxAge;
                const scale = 0.3 * (1 - ageRatio);
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
