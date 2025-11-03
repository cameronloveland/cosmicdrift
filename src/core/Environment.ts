import * as THREE from 'three';
import { STARFIELD_MIN_RADIUS, PLANET_EFFECTS, BLACKHOLE } from './constants';
import { AccretionParticles } from './AccretionParticles';

export class Environment {
    public root = new THREE.Group();
    private stars = new THREE.Group();
    private starfieldRadius = STARFIELD_MIN_RADIUS;
    private planets = new THREE.Group();
    private blackHole = new THREE.Group();
    private eventHorizonGlow!: THREE.Mesh;
    private blackHoleCore!: THREE.Mesh;
    private accretionParticles!: AccretionParticles;
    private vortexLayers: THREE.Points[] = [];
    private jupiterRings: THREE.Points[] = [];
    private diskLights: THREE.PointLight[] = [];
    private time = 0;
    private raceTime = 0; // Track race time for blackhole growth
    private currentCoreRadius = BLACKHOLE.coreRadiusInitial;
    private blackholeFadeProgress = 0; // 0 = visible, 1 = completely faded
    private blackholeRemoved = false; // Track if blackhole has been removed

    constructor() {
        this.addStars();
        this.addBlackHole();
        this.addPlanets();
        this.planets.visible = false; // Temporarily hidden
        this.root.add(this.planets);
        this.root.add(this.blackHole);
    }

    private addStars() {
        // remove previous stars group if attached
        if (this.stars.parent) this.root.remove(this.stars);
        this.stars = new THREE.Group();

        // Near shell — bright, closer, not affected by fog
        const nearCount = 4000;
        const nearGeom = new THREE.BufferGeometry();
        const nearPos = new Float32Array(nearCount * 3);
        const nearMin = 800;
        const nearMax = 1400;
        for (let i = 0; i < nearCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = nearMin + Math.random() * (nearMax - nearMin);
            nearPos[i * 3 + 0] = radius * Math.sin(phi) * Math.cos(theta);
            nearPos[i * 3 + 1] = radius * Math.cos(phi) * 0.85;
            nearPos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
        }
        nearGeom.setAttribute('position', new THREE.BufferAttribute(nearPos, 3));
        const nearMat = new THREE.PointsMaterial({ color: 0xcfe9ff, size: 1.6, sizeAttenuation: true, fog: false });
        const nearPoints = new THREE.Points(nearGeom, nearMat);
        this.stars.add(nearPoints);

        // Far shell — very large enclosure with fog disabled
        const farCount = 6000;
        const farGeom = new THREE.BufferGeometry();
        const farPos = new Float32Array(farCount * 3);
        const r = this.starfieldRadius;
        const farMin = Math.max(nearMax * 1.5, r * 0.6);
        const farMax = r * 1.05;
        for (let i = 0; i < farCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = farMin + Math.random() * (farMax - farMin);
            farPos[i * 3 + 0] = radius * Math.sin(phi) * Math.cos(theta);
            farPos[i * 3 + 1] = radius * Math.cos(phi) * 0.9;
            farPos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
        }
        farGeom.setAttribute('position', new THREE.BufferAttribute(farPos, 3));
        const farMat = new THREE.PointsMaterial({ color: 0xbfe0ff, size: 1.8, sizeAttenuation: false, fog: false });
        const farPoints = new THREE.Points(farGeom, farMat);
        this.stars.add(farPoints);

        this.root.add(this.stars);
    }

    private addBlackHole() {
        // Position at center of world
        this.blackHole.position.set(0, 0, 0);

        // 1. Black hole core - dark void sphere
        const coreGeometry = new THREE.SphereGeometry(BLACKHOLE.coreRadiusInitial, 64, 64);
        const coreMaterial = new THREE.MeshBasicMaterial({
            color: 0x0a0015,
            transparent: true,
            opacity: 0.95,
            toneMapped: false
        });
        this.blackHoleCore = new THREE.Mesh(coreGeometry, coreMaterial);
        this.blackHole.add(this.blackHoleCore);

        // 2. Event horizon glow ring - subtle
        const horizonGeometry = new THREE.SphereGeometry(BLACKHOLE.coreRadiusInitial + BLACKHOLE.eventHorizonOffset, 64, 64);
        const horizonMaterial = new THREE.MeshBasicMaterial({
            color: 0x8844ff,
            transparent: true,
            opacity: 0.05,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            depthWrite: false,
            toneMapped: false
        });
        this.eventHorizonGlow = new THREE.Mesh(horizonGeometry, horizonMaterial);
        this.blackHole.add(this.eventHorizonGlow);

        // 3. Accretion particles
        this.accretionParticles = new AccretionParticles();
        this.blackHole.add(this.accretionParticles.root);

        // 5. Add rotating point lights around vortex
        this.addVortexLights();
    }





    private addVortexLights() {
        const lightCount = 6;
        for (let i = 0; i < lightCount; i++) {
            const angle = (i / lightCount) * Math.PI * 2;
            const radius = 600;
            const isPink = i % 2 === 0;
            const color = isPink ? 0xff2bd6 : 0x53d7ff;

            const light = new THREE.PointLight(color, 200, 600, 1.5);
            light.position.set(
                Math.cos(angle) * radius,
                0,
                Math.sin(angle) * radius
            );

            this.blackHole.add(light);
            this.diskLights.push(light);
        }
    }

    // Calculate growth progress based on race time (0 to 1)
    private calculateGrowthProgress(): number {
        const progress = Math.min(this.raceTime / BLACKHOLE.growthDuration, 1.0);
        // Apply easing for smooth growth
        if (progress < 0.5) {
            return 0.5 * Math.pow(progress * 2, 1 + BLACKHOLE.growthEasing);
        } else {
            return 0.5 + 0.5 * (1 - Math.pow(1 - (progress - 0.5) * 2, 1 + BLACKHOLE.growthEasing));
        }
    }

    // Update blackhole size based on race time
    private updateBlackholeSize() {
        const growthProgress = this.calculateGrowthProgress();
        this.currentCoreRadius = THREE.MathUtils.lerp(
            BLACKHOLE.coreRadiusInitial,
            BLACKHOLE.coreRadiusMax,
            growthProgress
        );

        // Scale core
        const coreScale = this.currentCoreRadius / BLACKHOLE.coreRadiusInitial;
        this.blackHoleCore.scale.setScalar(coreScale);

        // Scale event horizon glow
        const eventHorizonRadius = this.currentCoreRadius + BLACKHOLE.eventHorizonOffset;
        const horizonScale = eventHorizonRadius / (BLACKHOLE.coreRadiusInitial + BLACKHOLE.eventHorizonOffset);
        this.eventHorizonGlow.scale.setScalar(horizonScale);

        // Update particle system
        this.accretionParticles.setBlackholeRadius(this.currentCoreRadius);

        // Update vortex lights radius
        const lightRadius = 600 * (1.0 + growthProgress * 4.0); // Lights move out as blackhole grows
        this.diskLights.forEach((light, i) => {
            const angle = (i / this.diskLights.length) * Math.PI * 2;
            light.position.set(
                Math.cos(angle) * lightRadius,
                0,
                Math.sin(angle) * lightRadius
            );
        });
    }

    // Check if a position is inside the event horizon (for effects activation)
    public isInsideEventHorizon(position: THREE.Vector3): boolean {
        if (this.blackholeRemoved) return false;
        const distance = position.length();
        // Use actual core radius (no margin) - effects should only activate when truly inside
        return distance < this.currentCoreRadius;
    }

    // Get current blackhole radius (for other systems)
    public getCurrentRadius(): number {
        if (this.blackholeRemoved) return 0;
        return this.currentCoreRadius;
    }

    // Get event horizon radius
    public getEventHorizonRadius(): number {
        if (this.blackholeRemoved) return 0;
        return this.currentCoreRadius + BLACKHOLE.eventHorizonOffset;
    }

    // Check if blackhole has reached maximum size
    public hasReachedMaxSize(): boolean {
        if (this.blackholeRemoved) return true; // Consider consumed as max size reached
        const growthProgress = this.calculateGrowthProgress();
        return growthProgress >= 0.99; // Consider max size when 99% grown
    }

    // Set race time for growth calculation
    public setRaceTime(raceTime: number) {
        this.raceTime = raceTime;
    }

    // Set inside blackhole progress for enhanced particle effects
    public setInsideBlackholeProgress(progress: number) {
        if (this.accretionParticles) {
            this.accretionParticles.setInsideProgress(progress);
        }
    }

    // Set fade progress for blackhole disappearance (0 = visible, 1 = invisible)
    public setBlackholeFadeProgress(progress: number) {
        if (this.blackholeRemoved) return; // Don't update if already removed
        this.blackholeFadeProgress = progress;
        this.updateBlackholeFade();
    }

    private updateBlackholeFade() {
        const fade = 1.0 - this.blackholeFadeProgress; // 1 = fully visible, 0 = invisible

        // Fade out blackhole core
        if (this.blackHoleCore && this.blackHoleCore.material instanceof THREE.MeshBasicMaterial) {
            this.blackHoleCore.material.opacity = 0.95 * fade;
            this.blackHoleCore.material.transparent = fade < 1.0;
        }

        // Fade out event horizon glow
        if (this.eventHorizonGlow && this.eventHorizonGlow.material instanceof THREE.MeshBasicMaterial) {
            this.eventHorizonGlow.material.opacity = 0.05 * fade;
        }

        // Fade out accretion particles
        if (this.accretionParticles && this.accretionParticles.root) {
            this.accretionParticles.root.traverse((object) => {
                if (object instanceof THREE.Points) {
                    if (object.material instanceof THREE.PointsMaterial) {
                        const originalOpacity = object.userData.originalOpacity ?? 0.9;
                        object.material.opacity = originalOpacity * fade;
                    }
                }
            });
            // Store original opacity on first traversal
            if (this.accretionParticles.root.userData.opacityStored !== true) {
                this.accretionParticles.root.traverse((object) => {
                    if (object instanceof THREE.Points && object.material instanceof THREE.PointsMaterial) {
                        object.userData.originalOpacity = object.material.opacity;
                    }
                });
                this.accretionParticles.root.userData.opacityStored = true;
            }
        }

        // Fade out vortex lights
        this.diskLights.forEach((light) => {
            light.intensity = 200 * fade;
        });

        // Fade out entire blackhole group opacity
        this.blackHole.traverse((object) => {
            if (object instanceof THREE.Mesh && object.material instanceof THREE.Material) {
                if (!object.userData.fadeOriginalOpacity) {
                    object.userData.fadeOriginalOpacity = object.material.opacity ?? 1.0;
                }
                if (object.material.transparent !== undefined) {
                    object.material.transparent = fade < 1.0;
                }
                object.material.opacity = object.userData.fadeOriginalOpacity * fade;
            } else if (object instanceof THREE.Points && object.material instanceof THREE.PointsMaterial) {
                if (!object.userData.fadeOriginalOpacity) {
                    object.userData.fadeOriginalOpacity = object.material.opacity ?? 1.0;
                }
                object.material.transparent = true;
                object.material.opacity = object.userData.fadeOriginalOpacity * fade;
            }
        });
    }

    // Remove blackhole and all its effects from the scene after consumption
    public removeBlackhole() {
        if (!this.blackHole || !this.blackHole.parent || this.blackholeRemoved) return;
        this.blackholeRemoved = true;

        // Stop particle updates
        if (this.accretionParticles) {
            this.accretionParticles.root.traverse((object) => {
                if (object instanceof THREE.Points) {
                    if (object.geometry) {
                        object.geometry.dispose();
                    }
                    if (object.material instanceof THREE.Material) {
                        object.material.dispose();
                    }
                }
            });
        }

        // Dispose of geometries and materials
        this.blackHole.traverse((object) => {
            if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
                if (object.geometry) {
                    object.geometry.dispose();
                }
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(mat => mat.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            }
        });

        // Remove all lights from scene
        this.diskLights.forEach((light) => {
            if (light.parent) {
                light.parent.remove(light);
            }
            light.dispose();
        });
        this.diskLights = [];

        // Remove blackhole group from root
        this.root.remove(this.blackHole);

        // Clear references
        this.blackHole = new THREE.Group();
        this.eventHorizonGlow = null!;
        this.blackHoleCore = null!;
        this.accretionParticles = null!;
        this.vortexLayers = [];
    }

    private addPlanets() {
        // Planet 1: Massive Magenta/Pink glowing planet - North-West quadrant
        const g1 = new THREE.SphereGeometry(88, 64, 48);
        const m1 = new THREE.MeshBasicMaterial({
            color: 0xff2bd6, // neon magenta
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p1 = new THREE.Mesh(g1, m1);
        p1.position.set(-900, 120, -600); // More dispersed, further from center
        p1.userData = { orbitRadius: 1000, orbitSpeed: 0.01, orbitAngle: 0 };
        this.planets.add(p1);

        // Add dramatic point light to planet 1
        const light1 = new THREE.PointLight(0xff2bd6, 800, 1200, 1.5);
        p1.add(light1);

        // Add visual effects to planet 1
        this.addPlanetEffects(p1, 88, 0xff2bd6);

        // Planet 2: Large Cyan glowing planet - South-East quadrant
        const g2 = new THREE.SphereGeometry(64, 64, 48);
        const m2 = new THREE.MeshBasicMaterial({
            color: 0x53d7ff, // neon cyan
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p2 = new THREE.Mesh(g2, m2);
        p2.position.set(950, -80, -850); // Spread out on opposite side
        p2.userData = { orbitRadius: 1200, orbitSpeed: 0.008, orbitAngle: Math.PI };
        this.planets.add(p2);

        // Add dramatic point light to planet 2
        const light2 = new THREE.PointLight(0x53d7ff, 600, 1100, 1.5);
        p2.add(light2);

        // Add visual effects to planet 2
        this.addPlanetEffects(p2, 64, 0x53d7ff);

        // Planet 3: Medium Magenta planet - North-East, elevated
        const g3 = new THREE.SphereGeometry(40, 48, 36);
        const m3 = new THREE.MeshBasicMaterial({
            color: 0xff2bd6,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p3 = new THREE.Mesh(g3, m3);
        p3.position.set(700, 250, 800); // Higher up, different area
        p3.userData = { orbitRadius: 900, orbitSpeed: 0.012, orbitAngle: Math.PI / 2 };
        this.planets.add(p3);

        // Add dramatic point light to planet 3
        const light3 = new THREE.PointLight(0xff2bd6, 400, 900, 1.5);
        p3.add(light3);

        // Add visual effects to planet 3
        this.addPlanetEffects(p3, 40, 0xff2bd6);

        // Planet 4: Large Cyan planet - South-West, lower
        const g4 = new THREE.SphereGeometry(56, 56, 40);
        const m4 = new THREE.MeshBasicMaterial({
            color: 0x53d7ff,
            transparent: true,
            opacity: 0.88,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const p4 = new THREE.Mesh(g4, m4);
        p4.position.set(-750, -120, 900); // Lower, spread to far side
        p4.userData = { orbitRadius: 1100, orbitSpeed: 0.009, orbitAngle: 3 * Math.PI / 2 };
        this.planets.add(p4);

        // Add dramatic point light to planet 4
        const light4 = new THREE.PointLight(0x53d7ff, 500, 1000, 1.5);
        p4.add(light4);

        // Add visual effects to planet 4
        this.addPlanetEffects(p4, 56, 0x53d7ff);
    }

    private addPlanetEffects(planet: THREE.Mesh, planetRadius: number, color: number) {
        // Simple planets with no effects for now
        // Effects can be added back later if needed
    }





    private animatePlanetEffects(planet: THREE.Mesh, dt: number) {
        // No effects to animate for simple planets
    }

    update(dt: number) {
        this.time += dt;

        // Update blackhole size based on race time (temporarily disabled)
        // if (!this.blackholeRemoved) {
        //     this.updateBlackholeSize();
        // }

        // Animate planets orbiting around black hole
        this.planets.children.forEach((planet) => {
            if (planet.userData && planet.userData.orbitRadius) {
                const userData = planet.userData;
                userData.orbitAngle += dt * userData.orbitSpeed;

                // Calculate orbital position
                const x = Math.cos(userData.orbitAngle) * userData.orbitRadius;
                const z = Math.sin(userData.orbitAngle) * userData.orbitRadius;

                // Keep original Y position for vertical variation
                planet.position.set(x, planet.position.y, z);

                // No planet effects to animate for simple planets
            }
        });

        this.stars.rotation.z += dt * 0.005;

        // Update accretion particles (only if blackhole still exists)
        if (!this.blackholeRemoved && this.accretionParticles) {
            this.accretionParticles.update(dt);
        }
    }

    // Allow the game to expand starfield to enclose the track fully
    public setStarfieldRadius(r: number) {
        const newR = Math.max(STARFIELD_MIN_RADIUS, r);
        if (Math.abs(newR - this.starfieldRadius) < 1) return;
        this.starfieldRadius = newR;
        // rebuild stars with new radius
        this.addStars();
    }

    // Get planet positions for track proximity calculations
    public getPlanetPositions(): Array<{ position: THREE.Vector3, color: THREE.Color }> {
        const planetData: Array<{ position: THREE.Vector3, color: THREE.Color }> = [];

        this.planets.children.forEach((planet) => {
            if (planet instanceof THREE.Mesh && planet.material instanceof THREE.MeshBasicMaterial) {
                const color = planet.material.color.clone();
                planetData.push({
                    position: planet.position.clone(),
                    color: color
                });
            }
        });

        return planetData;
    }

}
