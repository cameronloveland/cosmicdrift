import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import { COLORS, PHYSICS, POST, BOOST_PAD } from '../constants';
import type { Ship } from './Ship';
import { ShipRocketTail } from './ShipRocketTail';
import { DriftTrail } from './DriftTrail';
import { DraftingParticles } from './drafting/DraftingParticles';
import { DraftingVectorLines } from './drafting/DraftingVectorLines';
import type { ShipState } from '../types';
import { ShipBoostParticles } from './ShipBoostParticles';

export class ShipViewer {
    private mount: HTMLElement;
    private ship: Ship | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private composer: EffectComposer | null = null;
    private scene: THREE.Scene | null = null;
    private camera: THREE.PerspectiveCamera | null = null;
    private controls: OrbitControls | null = null;
    private rafId: number | null = null;
    private onResizeBound: (() => void) | null = null;

    // UI state and overlay
    private ui = { boost: false, trackBoost: false, drift: false, draft: false };
    private controlsEl: HTMLDivElement | null = null;

    // Viewer ship clone and engine glow ref
    private viewerShip: THREE.Group | null = null;
    private engineGlowMesh: THREE.Mesh | null = null;
    private engineGlowMat: THREE.MeshBasicMaterial | null = null;

    // Timekeeping
    private lastTimeSec: number = 0;
    private nowSec: number = 0;

    // Track boost (rocket tail)
    private rocketTail: ShipRocketTail | null = null;
    private trackBoostTimer: number = 0;

    // Drafting visuals
    private draftingParticles: DraftingParticles | null = null;
    private draftingLines: DraftingVectorLines | null = null;
    private draftProxy: { root: THREE.Group; state: { speedKmh: number } } | null = null;

    // Drifting visuals
    private driftTrail: DriftTrail | null = null;
    private miniTrack: { width: number; length: number; getPointAtT: (t: number, pos: THREE.Vector3) => void; getFrenetFrame: (t: number, n: THREE.Vector3, b: THREE.Vector3, tan: THREE.Vector3) => void } | null = null;
    private driftState: ShipState | null = null;

    // Boost particles
    private shipBoostParticles: ShipBoostParticles | null = null;
    private boostProxy: { root: THREE.Group; state: { boosting: boolean } } | null = null;

    constructor(mount: HTMLElement, ship: Ship) {
        this.mount = mount;
        this.ship = ship;
    }

    start() {
        if (this.renderer) return;

        // Scene
        const scene = new THREE.Scene();
        // Set dark background similar to game background
        scene.background = new THREE.Color(0x050314);
        this.scene = scene;

        // Camera
        const rect = this.mount.getBoundingClientRect();
        // Ensure we have valid dimensions
        if (rect.width === 0 || rect.height === 0) {
            console.warn('ShipViewer: Mount element has zero dimensions, using fallback', rect);
        }
        const aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
        const camera = new THREE.PerspectiveCamera(65, aspect, 0.1, 2000);
        // Position camera to see the ship and grid centered at origin
        camera.position.set(2.5, 1.5, 3.0);
        camera.lookAt(0, PHYSICS.hoverHeight, 0); // Look at where ship will be
        this.camera = camera;

        // Renderer - keep alpha for transparency but use scene background for color
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
        // Use actual dimensions or fallback to window size if mount is hidden
        const width = rect.width > 0 ? rect.width : window.innerWidth;
        const height = rect.height > 0 ? rect.height : window.innerHeight;
        renderer.setSize(width, height);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setClearColor(0x050314, 1); // Match scene background
        // Modern lighting (default) supports emissive materials properly
        this.mount.innerHTML = '';
        this.mount.appendChild(renderer.domElement);
        this.renderer = renderer;

        // Post-processing: Bloom effect to make emissive glow visible (matching in-game)
        const composer = new EffectComposer(renderer);
        const renderPass = new RenderPass(scene, camera);
        // Use same bloom settings as main game for consistent glow appearance
        const bloom = new BloomEffect({
            intensity: POST.bloomStrength,
            luminanceThreshold: POST.bloomThreshold,
            luminanceSmoothing: 0.2,
            radius: POST.bloomRadius
        });
        const effectPass = new EffectPass(camera, bloom);
        composer.addPass(renderPass);
        composer.addPass(effectPass);
        this.composer = composer;

        // Lights - dimmed to make emissive glow visible (matching in-game appearance)
        // Reduced intensity so the ship's emissive properties create the glow effect
        const hemi = new THREE.HemisphereLight(0x6e5cd6, 0x0a082a, 0.3); // Reduced from 0.9 to 0.3
        scene.add(hemi);
        const dir = new THREE.DirectionalLight(0xffffff, 0.25); // Reduced from 0.7 to 0.25
        dir.position.set(5, 6, 4);
        dir.castShadow = false;
        scene.add(dir);

        // Light teal glowing grid (similar to radio player style - thin teal grid)
        const gridSize = 10;
        const gridDivisions = 20; // Grid spacing similar to radio player (20px)
        const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x53d7ff, 0x53d7ff);
        gridHelper.position.y = 0.0001; // Slightly above ground plane to avoid z-fighting

        // Make grid visible and glowing like radio player
        const gridMaterial = gridHelper.material as THREE.LineBasicMaterial;
        if (gridMaterial) {
            gridMaterial.color.setHex(0x53d7ff); // Teal color #53d7ff matching radio player
            gridMaterial.transparent = true;
            gridMaterial.opacity = 0.6; // More visible for better glow effect
        }
        scene.add(gridHelper);

        // Dark ground circle for reference (below grid to not obscure it)
        const ground = new THREE.Mesh(
            new THREE.CircleGeometry(10, 64),
            new THREE.MeshBasicMaterial({ color: 0x0b1a5f, transparent: true, opacity: 0.3 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.001; // Slightly below grid
        scene.add(ground);

        // Clone the actual ship geometry (exclude dynamic effects like rocket tail)
        if (this.ship) {
            const shipClone = this.cloneShipGeometry(this.ship);
            if (shipClone.children.length > 0) {
                scene.add(shipClone);
                this.viewerShip = shipClone;
                this.locateEngineGlow(shipClone);
                this.initEffects();
            } else {
                console.warn('ShipViewer: Ship clone has no children. Original ship root has', this.ship.root.children.length, 'children');
            }
        } else {
            console.warn('ShipViewer: No ship provided');
        }

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 1.0;
        controls.maxDistance = 8.0;
        controls.target.set(0, PHYSICS.hoverHeight, 0); // Target where ship is positioned
        controls.update();
        this.controls = controls;

        // Overlay control buttons
        this.createControlsOverlay();

        // Resize handling
        this.onResizeBound = () => {
            if (!this.renderer || !this.camera) return;
            const r = this.mount.getBoundingClientRect();
            this.camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(r.width, r.height);
            // Update composer size to match renderer
            if (this.composer) {
                this.composer.setSize(r.width, r.height);
            }
        };
        window.addEventListener('resize', this.onResizeBound);
        // Trigger resize once to correct sizing if viewport was hidden during init
        requestAnimationFrame(() => {
            if (this.renderer && this.camera && this.onResizeBound) {
                this.onResizeBound();
            }
        });

        // Animate
        this.lastTimeSec = performance.now() * 0.001;
        const animate = () => {
            this.rafId = requestAnimationFrame(animate);
            const tNow = performance.now() * 0.001;
            let dt = tNow - this.lastTimeSec;
            if (dt > 0.1) dt = 0.1; // cap to avoid spikes
            if (dt < 0) dt = 0;
            this.lastTimeSec = tNow;
            this.nowSec = tNow;
            if (this.controls) this.controls.update();

            // Effect updates
            this.updateBoost(dt);
            this.updateTrackBoost(dt);
            this.updateDrift(dt);
            this.updateDrafting(dt);

            // Use composer (with bloom) instead of direct renderer
            if (this.composer && this.scene && this.camera) {
                this.composer.render();
            } else if (this.renderer && this.scene && this.camera) {
                // Fallback to direct render if composer not available
                this.renderer.render(this.scene, this.camera);
            }
        };
        this.rafId = requestAnimationFrame(animate);
    }

    stop() {
        if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
        if (this.controls) { this.controls.dispose(); this.controls = null; }
        if (this.composer) { this.composer.dispose(); this.composer = null; }
        if (this.renderer) { this.renderer.dispose(); this.renderer.domElement.remove(); this.renderer = null; }
        this.scene = null;
        this.camera = null;
        if (this.onResizeBound) { window.removeEventListener('resize', this.onResizeBound); this.onResizeBound = null; }
    }

    dispose() { this.stop(); }

    private createControlsOverlay() {
        const container = document.createElement('div');
        container.className = 'shipviewer-controls';
        (container.style as any).position = 'absolute';
        (container.style as any).bottom = '64px';
        (container.style as any).left = '50%';
        (container.style as any).transform = 'translateX(-50%)';
        (container.style as any).display = 'flex';
        (container.style as any).gap = '12px';
        (container.style as any).zIndex = '5';

        const setActiveButtonStyle = (btn: HTMLButtonElement, active: boolean) => {
            const s = btn.style as any;
            if (active) {
                // Active: blue outline glow (teal) without gradient fill
                s.background = 'rgba(20, 18, 35, 0.90)';
                s.color = '#eaf6ff';
                s.border = '2px solid rgba(83, 215, 255, 0.85)';
                s.boxShadow = '0 0 18px rgba(83, 215, 255, 0.65), 0 0 26px rgba(83, 215, 255, 0.35)';
                s.textShadow = '0 0 10px rgba(83, 215, 255, 0.8)';
                s.transform = 'none';
            } else {
                s.background = 'rgba(20, 18, 35, 0.82)';
                s.color = '#eaf6ff';
                s.border = '1px solid rgba(255, 255, 255, 0.12)';
                s.boxShadow = '0 0 0 rgba(0,0,0,0)';
                s.textShadow = 'none';
                s.transform = 'none';
            }
        };

        const mkBtn = (label: string, handler: () => void) => {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.className = 'shipviewer-btn';
            const s = btn.style as any;
            s.background = 'rgba(20, 18, 35, 0.82)';
            s.color = '#eaf6ff';
            s.border = '1px solid rgba(255, 255, 255, 0.12)';
            s.borderRadius = '999px';
            s.padding = '12px 22px';
            s.font = '800 15px Orbitron, system-ui, sans-serif';
            s.letterSpacing = '2px';
            s.cursor = 'pointer';
            s.boxShadow = '0 0 0 rgba(0,0,0,0)';
            s.textTransform = 'uppercase';
            btn.onmouseenter = () => {
                if (!btn.classList.contains('active')) {
                    (btn.style as any).background = 'rgba(20, 18, 35, 0.9)';
                }
            };
            btn.onmouseleave = () => {
                if (!btn.classList.contains('active')) {
                    (btn.style as any).background = 'rgba(20, 18, 35, 0.82)';
                }
            };
            btn.onclick = handler;
            return btn as HTMLButtonElement;
        };

        const boostBtn = mkBtn('Boost', () => {
            this.ui.boost = !this.ui.boost;
            boostBtn.classList.toggle('active', this.ui.boost);
            setActiveButtonStyle(boostBtn, this.ui.boost);
        });
        const trackBoostBtn = mkBtn('Track Boost', () => {
            this.ui.trackBoost = !this.ui.trackBoost;
            trackBoostBtn.classList.toggle('active', this.ui.trackBoost);
            setActiveButtonStyle(trackBoostBtn, this.ui.trackBoost);
        });
        const driftBtn = mkBtn('Drift', () => {
            this.ui.drift = !this.ui.drift;
            driftBtn.classList.toggle('active', this.ui.drift);
            setActiveButtonStyle(driftBtn, this.ui.drift);
        });
        const draftBtn = mkBtn('Drafting', () => {
            this.ui.draft = !this.ui.draft;
            draftBtn.classList.toggle('active', this.ui.draft);
            setActiveButtonStyle(draftBtn, this.ui.draft);
            if (this.draftingParticles) this.draftingParticles.setVisible(this.ui.draft);
            if (this.draftingLines) this.draftingLines.setVisible(this.ui.draft);
        });

        container.appendChild(boostBtn);
        container.appendChild(trackBoostBtn);
        container.appendChild(driftBtn);
        container.appendChild(draftBtn);

        const mountStyle = getComputedStyle(this.mount);
        if (mountStyle.position === 'static') {
            this.mount.style.position = 'relative';
        }
        // Initialize default inactive visual style
        setActiveButtonStyle(boostBtn, this.ui.boost);
        setActiveButtonStyle(trackBoostBtn, this.ui.trackBoost);
        setActiveButtonStyle(driftBtn, this.ui.drift);
        setActiveButtonStyle(draftBtn, this.ui.draft);

        this.mount.appendChild(container);
        this.controlsEl = container;
    }

    private initEffects() {
        if (!this.viewerShip) return;
        const rocketProxy = {
            root: this.viewerShip,
            getBoostPadTimer: () => this.trackBoostTimer,
            getNow: () => this.nowSec
        } as any;
        this.rocketTail = new ShipRocketTail(rocketProxy, new THREE.Vector3(0, 0, -0.85), 0);
        this.viewerShip.add(this.rocketTail.root);

        this.draftProxy = { root: this.viewerShip, state: { speedKmh: 200 } };
        this.draftingParticles = new DraftingParticles(this.draftProxy as any);
        this.draftingLines = new DraftingVectorLines(this.draftProxy as any, { count: 22, points: 26 });
        this.viewerShip.add(this.draftingParticles.root);
        this.viewerShip.add(this.draftingLines.root);
        this.draftingParticles.setVisible(false);
        this.draftingLines.setVisible(false);

        // Boost particles (viewer-local)
        this.boostProxy = { root: this.viewerShip, state: { boosting: false } };
        this.shipBoostParticles = new ShipBoostParticles(this.boostProxy as any);
        this.viewerShip.add(this.shipBoostParticles.root);

        const mini = {
            width: 4,
            length: 120,
            getPointAtT: (t: number, pos: THREE.Vector3) => {
                pos.set(0, PHYSICS.hoverHeight, -t * 120);
            },
            getFrenetFrame: (_t: number, normal: THREE.Vector3, binormal: THREE.Vector3, tangent: THREE.Vector3) => {
                normal.set(0, 1, 0);
                binormal.set(1, 0, 0);
                tangent.set(0, 0, 1);
            }
        };
        this.miniTrack = mini;
        this.driftTrail = new DriftTrail(this.miniTrack as any, COLORS.neonCyan);
        this.scene?.add(this.driftTrail.root);

        this.driftState = {
            t: 0,
            speedKmh: 160,
            lateralOffset: 0,
            pitch: 0,
            flow: 0,
            boosting: false,
            lapCurrent: 0,
            lapTotal: 1,
            boostLevel: 1,
            inTunnel: false,
            tunnelCenterBoost: 1,
            lastLapTime: 0,
            lapTimes: [] as number[],
            onBoostPadEntry: false,
            isDrifting: false,
            driftDuration: 0,
            driftLength: 0
        } as ShipState;
    }

    private locateEngineGlow(root: THREE.Object3D) {
        let foundMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]> | null = null;
        root.traverse(obj => {
            if (foundMesh) return;
            if (obj instanceof THREE.Mesh) {
                const mat = obj.material as any;
                const isBasic = mat instanceof THREE.MeshBasicMaterial;
                const hasVC = !!(obj.geometry as any)?.attributes?.color;
                const isCone = obj.geometry instanceof THREE.ConeGeometry;
                if (isBasic && hasVC && isCone) {
                    foundMesh = obj as any;
                    this.engineGlowMesh = obj as any;
                    this.engineGlowMat = obj.material as THREE.MeshBasicMaterial;
                    // Hide engine glow in viewer to prevent tiny bright point artifacts
                    (this.engineGlowMesh as any).visible = false;
                }
            }
        });
        // engineGlowMesh/Mat set within traverse when found
    }

    private updateBoost(dt: number) {
        // Engine glow pulse
        if (this.engineGlowMesh && this.engineGlowMat) {
            if (this.ui.boost) {
                const pulse = 0.85 + Math.sin(this.nowSec * 12.0) * 0.15;
                this.engineGlowMat.opacity = THREE.MathUtils.clamp(pulse, 0.2, 1.0);
                const s = 1.0 + 0.05 * Math.sin(this.nowSec * 10.0);
                this.engineGlowMesh.scale.set(s, s, s);
            } else {
                this.engineGlowMat.opacity = 0.85;
                this.engineGlowMesh.scale.set(1.0, 1.0, 1.0);
            }
        }

        // Drive boost particle system
        if (this.boostProxy && this.shipBoostParticles) {
            this.boostProxy.state.boosting = !!this.ui.boost;
            this.shipBoostParticles.update(dt);
        }
    }

    private updateTrackBoost(dt: number) {
        if (!this.rocketTail) return;
        this.trackBoostTimer = this.ui.trackBoost ? BOOST_PAD.boostDuration : Math.max(0, this.trackBoostTimer - dt);
        this.rocketTail.update(dt);
    }

    private updateDrift(dt: number) {
        if (!this.driftTrail || !this.driftState || !this.miniTrack) return;
        const active = this.ui.drift;
        this.driftState.isDrifting = active;
        this.driftState.lateralOffset = active ? Math.sin(this.nowSec * 0.8) * 0.4 : 0;
        const mps = this.driftState.speedKmh / 3.6;
        const L = this.miniTrack.length;
        this.driftState.t = (this.driftState.t + (mps * dt) / L) % 1;
        this.driftTrail.update(dt, this.driftState);
    }

    private updateDrafting(dt: number) {
        if (!this.draftingParticles || !this.draftingLines || !this.draftProxy) return;
        if (this.ui.draft) {
            this.draftingParticles.setVisible(true);
            this.draftingLines.setVisible(true);
            this.draftProxy.state.speedKmh = 200;
        } else {
            this.draftingParticles.setVisible(false);
            this.draftingLines.setVisible(false);
        }
        this.draftingParticles.update(dt);
        this.draftingLines.update(dt);
    }

    private cloneShipGeometry(ship: Ship): THREE.Group {
        // Create a new group for the cloned ship
        const cloneGroup = new THREE.Group();

        // Clone the ship's root geometry, excluding dynamic effects
        const shipRoot = ship.root;

        if (shipRoot.children.length === 0) {
            console.warn('ShipViewer: Ship root has no children');
            return cloneGroup;
        }

        shipRoot.children.forEach((child) => {
            // Skip rocket tail (dynamic effect) - check if it's a group with many cone meshes
            if (this.isRocketTail(child)) {
                return;
            }

            // Clone the child group/mesh
            const clonedChild = this.deepCloneObject3D(child);
            if (clonedChild) {
                cloneGroup.add(clonedChild);
            }
        });

        // Reset position and rotation for display; match in-race ship scale (3x)
        cloneGroup.position.set(0, PHYSICS.hoverHeight, 0); // Position above ground
        cloneGroup.rotation.set(0, 0, 0);
        cloneGroup.scale.set(3, 3, 3);

        // Ensure visibility
        cloneGroup.visible = true;
        cloneGroup.traverse((obj) => {
            obj.visible = true;
        });

        return cloneGroup;
    }

    private isRocketTail(object: THREE.Object3D): boolean {
        // Rocket tail component is a group with 3 overlapping cone meshes (core, middle, outer layers)
        if (object instanceof THREE.Group) {
            const coneMeshes = object.children.filter(child =>
                child instanceof THREE.Mesh &&
                child.geometry instanceof THREE.ConeGeometry
            );

            // Check for 3 cone meshes (the enhanced rocket tail component)
            if (coneMeshes.length === 3) {
                // Check if at least one cone has orange/white flame colors
                for (const mesh of coneMeshes) {
                    const meshObj = mesh as THREE.Mesh;
                    if (meshObj.material instanceof THREE.MeshBasicMaterial) {
                        const color = meshObj.material.color;
                        // Check for orange colors (middle/outer layers): (1, 0.55-0.65, 0.1-0.15)
                        const isOrangeColor = color.r > 0.9 && color.g > 0.5 && color.g < 0.7 && color.b > 0.05 && color.b < 0.2;
                        // Check for white-hot core: (1, 0.9-1.0, 0.85-1.0)
                        const isWhiteCore = color.r > 0.95 && color.g > 0.9 && color.b > 0.85;
                        if (isOrangeColor || isWhiteCore) {
                            return true;
                        }
                    }
                }
            }
            // Legacy check: single cone (old version) or many cone particles
            if (coneMeshes.length === 1) {
                const mesh = coneMeshes[0] as THREE.Mesh;
                if (mesh.material instanceof THREE.MeshBasicMaterial) {
                    const color = mesh.material.color;
                    // Boost color is bright orange: (1, 0.55, 0.1)
                    const isBoostColor = color.r > 0.9 && color.g > 0.5 && color.g < 0.6 && color.b > 0.05 && color.b < 0.15;
                    if (isBoostColor) {
                        return true;
                    }
                }
            }
            // Legacy check: many cone particles (for backward compatibility)
            return coneMeshes.length > 5;
        }
        return false;
    }

    private deepCloneObject3D(object: THREE.Object3D): THREE.Object3D | null {
        if (object instanceof THREE.Mesh) {
            // Clone geometry
            const geometry = object.geometry.clone();

            // Clone material (create new instance to avoid conflicts)
            let material: THREE.Material | THREE.Material[];
            if (object.material instanceof THREE.Material) {
                material = object.material.clone();
                // Update material to match player ship's neon cyan color (replace glossy skin with game colors)
                this.updateMaterialToMatchPlayerShip(material);
            } else if (Array.isArray(object.material)) {
                material = object.material.map(m => {
                    const cloned = m.clone();
                    this.updateMaterialToMatchPlayerShip(cloned);
                    return cloned;
                });
            } else {
                material = object.material;
            }

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(object.position);
            mesh.rotation.copy(object.rotation);
            mesh.scale.copy(object.scale);
            // Clone children (edge lines, etc.) so they're included in the viewer
            object.children.forEach(child => {
                const clonedChild = this.deepCloneObject3D(child);
                if (clonedChild) {
                    mesh.add(clonedChild);
                }
            });
            return mesh;
        } else if (object instanceof THREE.LineSegments) {
            // Clone LineSegments (edge lines) - preserve black color
            const geometry = object.geometry.clone();
            const material = object.material instanceof THREE.Material
                ? object.material.clone()
                : object.material;
            const lineSegments = new THREE.LineSegments(geometry, material);
            lineSegments.position.copy(object.position);
            lineSegments.rotation.copy(object.rotation);
            lineSegments.scale.copy(object.scale);
            return lineSegments;
        } else if (object instanceof THREE.Group) {
            const group = new THREE.Group();
            object.children.forEach(child => {
                const clonedChild = this.deepCloneObject3D(child);
                if (clonedChild) {
                    group.add(clonedChild);
                }
            });
            group.position.copy(object.position);
            group.rotation.copy(object.rotation);
            group.scale.copy(object.scale);
            return group;
        }

        return null;
    }

    private updateMaterialToMatchPlayerShip(material: THREE.Material): void {
        // Skip glow materials (engine glow, etc.) - they should remain as-is
        if (material instanceof THREE.MeshBasicMaterial && material.transparent) {
            // This is likely a glow/emissive effect - keep it as-is
            return;
        }

        // Update MeshStandardMaterial to match player ship's appearance
        if (material instanceof THREE.MeshStandardMaterial) {
            // Check if this is the booster material (darker color, higher metalness)
            // Booster has metalness 0.8 and darker color, ship has metalness 0.3 and neon cyan
            const isBoosterMaterial = material.metalness > 0.7 && material.roughness < 0.3;

            if (isBoosterMaterial) {
                // Update booster material (darker version of neon cyan)
                const boosterColor = COLORS.neonCyan.clone().multiplyScalar(0.4);
                material.color.copy(boosterColor);
                material.metalness = 0.8;
                material.roughness = 0.2;
                material.emissive.copy(boosterColor.clone().multiplyScalar(0.3));
            } else {
                // Apply player ship's neon cyan color and material properties with strong emissive glow
                material.color.copy(COLORS.neonCyan);
                material.metalness = 0.3;
                material.roughness = 0.2;
                // Strong emissive glow to match in-game appearance
                material.emissive.copy(COLORS.neonCyan.clone().multiplyScalar(0.8));
                // Ensure emissive intensity is high for visible glow
                material.emissiveIntensity = 1.0; // Explicitly set emissive intensity
            }

            material.transparent = false;
            material.opacity = 1.0;
            material.side = THREE.DoubleSide;
            material.needsUpdate = true;
        }
    }
}


