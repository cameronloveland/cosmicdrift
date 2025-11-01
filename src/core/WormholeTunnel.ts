import * as THREE from 'three';
import { Track } from './Track';
import { WORMHOLE } from './constants';

export class WormholeTunnel {
    public root = new THREE.Group();
    private track: Track;
    private instancedMeshes: THREE.InstancedMesh[] = [];
    private tunnelData: { startIdx: number; count: number; lengthMeters: number }[] = [];
    private time = 0;

    constructor(track: Track) {
        this.track = track;
        this.buildWormholeTunnels();
    }

    private mulberry32(seed: number) {
        let t = seed >>> 0;
        return () => {
            t += 0x6D2B79F5;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    }

    private buildWormholeTunnels() {
        // Get tunnel segments from track
        const tunnelSegments = this.track.getTunnelSegments();

        console.log(`[WormholeTunnel] Total tunnels: ${tunnelSegments.length}`);
        let wormholeCount = 0;

        for (const segment of tunnelSegments) {
            if (segment.tunnelType !== 'wormhole') continue;
            wormholeCount++;

            // Calculate number of dots for this tunnel
            const dotsAlongLength = Math.ceil(segment.lengthMeters * WORMHOLE.dotsPerMeter);
            const totalDots = dotsAlongLength * WORMHOLE.dotsPerRing;

            console.log(`[WormholeTunnel] Building wormhole ${wormholeCount}: ${totalDots} dots (${dotsAlongLength} rings x ${WORMHOLE.dotsPerRing} dots)`);

            // Create instanced mesh for this tunnel
            const geometry = new THREE.SphereGeometry(WORMHOLE.dotSize, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: WORMHOLE.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });

            const instancedMesh = new THREE.InstancedMesh(geometry, material, totalDots);
            instancedMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage); // positions won't change

            // Store color array for animation
            const colors = new Float32Array(totalDots * 3);
            instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

            const tmpObj = new THREE.Object3D();
            let dotIndex = 0;

            // Seeded random for consistent but varied dot placement
            const dotRnd = this.mulberry32(segment.startT * 10000);

            // Generate dot positions along tunnel
            for (let i = 0; i < dotsAlongLength; i++) {
                const progress = i / Math.max(1, dotsAlongLength - 1);

                // Handle wrap-around tunnels (when endT < startT)
                let tDelta: number;
                if (segment.endT >= segment.startT) {
                    tDelta = segment.endT - segment.startT;
                } else {
                    // Tunnel wraps around the 0/1 boundary
                    tDelta = (1 - segment.startT) + segment.endT;
                }

                const t = segment.startT + progress * tDelta;
                const normalizedT = THREE.MathUtils.euclideanModulo(t, 1);

                // Get position along track curve
                const idx = Math.floor(normalizedT * this.track.samples) % this.track.samples;
                const center = this.track.cachedPositions[idx];
                const tangent = this.track.cachedTangents[idx];
                const normal = this.track.cachedNormals[idx];
                const binormal = this.track.cachedBinormals[idx];

                // Calculate spiral twist based on distance
                const distanceAlongTunnel = i / WORMHOLE.dotsPerMeter;
                const spiralRotation = distanceAlongTunnel * WORMHOLE.spiralTwist;

                // Create ring of dots at this position
                for (let j = 0; j < WORMHOLE.dotsPerRing; j++) {
                    const angle = (j / WORMHOLE.dotsPerRing) * Math.PI * 2 + spiralRotation;

                    // Vary the radius for depth effect
                    const radiusVariation = dotRnd();
                    const radius = THREE.MathUtils.lerp(WORMHOLE.radiusMin, WORMHOLE.radiusMax, radiusVariation);

                    // Add randomness to position for organic feel
                    const angleJitter = (dotRnd() - 0.5) * WORMHOLE.randomness;
                    const radiusJitter = (dotRnd() - 0.5) * WORMHOLE.randomness * 2;

                    const finalAngle = angle + angleJitter;
                    const finalRadius = radius + radiusJitter;

                    // Calculate dot position with varied depth
                    const offsetX = Math.cos(finalAngle) * finalRadius;
                    const offsetY = Math.sin(finalAngle) * finalRadius;

                    // Transform to world space using track frame
                    const dotPos = new THREE.Vector3()
                        .copy(center)
                        .addScaledVector(binormal, offsetX)
                        .addScaledVector(normal, offsetY);

                    // Vary scale based on depth for perspective
                    const scaleVariation = 0.7 + radiusVariation * 0.6;
                    tmpObj.position.copy(dotPos);
                    tmpObj.scale.setScalar(scaleVariation);
                    tmpObj.updateMatrix();

                    instancedMesh.setMatrixAt(dotIndex, tmpObj.matrix);

                    // Initialize color (will be animated in update)
                    // Cycle between cyan (0.5) and pink/magenta (0.85)
                    const colorMix = (j / WORMHOLE.dotsPerRing + progress * 0.3 + radiusVariation * 0.2) % 1.0;
                    const hue = THREE.MathUtils.lerp(0.5, 0.85, colorMix); // cyan to pink
                    const color = new THREE.Color().setHSL(
                        hue,
                        WORMHOLE.saturation,
                        WORMHOLE.lightness
                    );
                    color.multiplyScalar(WORMHOLE.glowIntensity);
                    instancedMesh.setColorAt(dotIndex, color);

                    dotIndex++;
                }
            }

            instancedMesh.instanceMatrix.needsUpdate = true;
            if (instancedMesh.instanceColor) {
                instancedMesh.instanceColor.needsUpdate = true;
            }

            this.instancedMeshes.push(instancedMesh);
            this.tunnelData.push({
                startIdx: 0,
                count: totalDots,
                lengthMeters: segment.lengthMeters
            });
            this.root.add(instancedMesh);
        }

        console.log(`[WormholeTunnel] Created ${wormholeCount} wormhole tunnels with ${this.instancedMeshes.length} meshes`);
    }

    public update(dt: number) {
        this.time += dt;

        // Animate colors for all wormhole tunnels
        for (let meshIdx = 0; meshIdx < this.instancedMeshes.length; meshIdx++) {
            const mesh = this.instancedMeshes[meshIdx];
            const data = this.tunnelData[meshIdx];

            if (!mesh.instanceColor) continue;

            const dotsAlongLength = Math.ceil(data.lengthMeters * WORMHOLE.dotsPerMeter);

            for (let i = 0; i < data.count; i++) {
                // Calculate base hue from position in tunnel
                const ringIdx = Math.floor(i / WORMHOLE.dotsPerRing);
                const dotIdx = i % WORMHOLE.dotsPerRing;
                const progress = ringIdx / Math.max(1, dotsAlongLength);

                // Create varied, flowing colors based on position and time
                // Cycle between cyan (0.5) and pink/magenta (0.85)
                const depthVariation = (i % 7) / 7; // pseudo-random depth variation
                const colorMix = (dotIdx / WORMHOLE.dotsPerRing + progress * 0.3 + depthVariation * 0.2 + this.time * WORMHOLE.hueSpeed) % 1.0;
                const hue = THREE.MathUtils.lerp(0.5, 0.85, colorMix); // cyan to pink

                const color = new THREE.Color().setHSL(
                    hue,
                    WORMHOLE.saturation,
                    WORMHOLE.lightness
                );
                color.multiplyScalar(WORMHOLE.glowIntensity);

                mesh.setColorAt(i, color);
            }

            mesh.instanceColor.needsUpdate = true;
        }
    }

    public rebuild() {
        // Clear existing meshes
        for (const mesh of this.instancedMeshes) {
            this.root.remove(mesh);
            mesh.geometry.dispose();
            if (mesh.material instanceof THREE.Material) {
                mesh.material.dispose();
            }
        }
        this.instancedMeshes = [];
        this.tunnelData = [];
        this.time = 0;

        // Rebuild with new track data
        this.buildWormholeTunnels();
    }
}

