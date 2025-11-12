import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import { COLORS, PHYSICS, POST, BOOST_PAD } from '../constants';
import type { Ship } from './Ship';
import { ShipRocketTail } from './ShipRocketTail';
import { DriftTrail } from './DriftTrail';
import { DriftSpeedLines } from './DriftSpeedLines';
import { DraftingParticles } from './drafting/DraftingParticles';
import { DraftingVectorLines } from './drafting/DraftingVectorLines';
import type { ShipState } from '../types';
import { ShipBoostParticles } from './ShipBoostParticles';
import { ShipShield } from './ShipShield';

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
    private ui = { boost: true, trackBoost: false, drift: false, draft: false, shield: false };
    private controlsEl: HTMLDivElement | null = null;

    // Viewer ship clone and engine refs
    private viewerShip: THREE.Group | null = null;
    // Legacy gradient cone support (pre-refactor)
    private engineGlowMesh: THREE.Mesh | null = null;
    private engineGlowMat: THREE.MeshBasicMaterial | null = null;
    private engineGlowOpacityCurrent: number = 0.0;
    private engineGlowScaleCurrent: number = 1.0;
    // New jet engine components (idle disc + blue cone)
    private idleDiscMesh: THREE.Mesh | null = null;
    private idleDiscMat: THREE.ShaderMaterial | null = null;
    private jetConeMesh: THREE.Mesh | null = null;
    private jetConeMat: THREE.MeshBasicMaterial | null = null;
    private coreConeMesh: THREE.Mesh | null = null;
    private coreConeMat: THREE.MeshBasicMaterial | null = null;
    private outerConeMesh: THREE.Mesh | null = null;
    private outerConeMat: THREE.MeshBasicMaterial | null = null;

    // Timekeeping
    private lastTimeSec: number = 0;
    private nowSec: number = 0;

    // Simulated environment motion (world flow)
    private envGroup: THREE.Group | null = null;
    private envTravel: number = 0; // meters along forward axis

    // Track boost (rocket tail)
    private rocketTail: ShipRocketTail | null = null;
    private trackBoostTimer: number = 0;

    // Drafting visuals
    private draftingParticles: DraftingParticles | null = null;
    private draftingLines: DraftingVectorLines | null = null;
    private draftProxy: { root: THREE.Group; state: { speedKmh: number } } | null = null;

    // Drifting visuals
    private driftTrail: DriftTrail | null = null;
    private driftSpeedLines: DriftSpeedLines | null = null;
    private miniTrack: { width: number; length: number; getPointAtT: (t: number, pos: THREE.Vector3) => void; getFrenetFrame: (t: number, n: THREE.Vector3, b: THREE.Vector3, tan: THREE.Vector3) => void } | null = null;
    private driftState: ShipState | null = null;
    private speedLinesShipProxy: { root: THREE.Group; state: { isDrifting: boolean; speedKmh: number; t: number }; getColor: () => THREE.Color } | null = null;

    // Boost particles
    private shipBoostParticles: ShipBoostParticles | null = null;
    private boostProxy: { root: THREE.Group; state: { boosting: boolean } } | null = null;

    // Shield
    private shield: ShipShield | null = null;

    constructor(mount: HTMLElement, ship: Ship) {
        this.mount = mount;
        this.ship = ship;
    }

    start() {
        if (this.renderer) return;

        // Scene
        const scene = new THREE.Scene();
        // Set dark background similar to game background
        scene.background = new THREE.Color(0x02010a);
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
        camera.position.set(3.1, 6.6, 4.9);
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
        renderer.setClearColor(0x02010a, 1); // Match scene background
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
        // Environment group to simulate world flow
        const envGroup = new THREE.Group();
        envGroup.add(gridHelper);

        // Dark ground circle for reference (below grid to not obscure it)
        const ground = new THREE.Mesh(
            new THREE.CircleGeometry(10, 64),
            new THREE.MeshBasicMaterial({ color: 0x0b1a5f, transparent: true, opacity: 0.3 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.001; // Slightly below grid
        envGroup.add(ground);
        scene.add(envGroup);
        this.envGroup = envGroup;

        // Clone the actual ship geometry (exclude dynamic effects like rocket tail)
        if (this.ship) {
            const shipClone = this.cloneShipGeometry(this.ship);
            if (shipClone.children.length > 0) {
                scene.add(shipClone);
                this.viewerShip = shipClone;
                this.locateEngineMeshes(shipClone);
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
        controls.minDistance = 2.0;
        controls.maxDistance = 20.0;
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
            this.updateEngineGlow(dt);
            this.updateTrackBoost(dt);
            this.updateDrift(dt);
            this.updateDrafting(dt);
            this.updateShield(dt);

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
        const shieldBtn = mkBtn('Shield', () => {
            this.ui.shield = !this.ui.shield;
            shieldBtn.classList.toggle('active', this.ui.shield);
            setActiveButtonStyle(shieldBtn, this.ui.shield);
            if (this.shield) this.shield.setActive(this.ui.shield);
        });

        container.appendChild(boostBtn);
        container.appendChild(trackBoostBtn);
        container.appendChild(driftBtn);
        container.appendChild(draftBtn);
        container.appendChild(shieldBtn);

        const mountStyle = getComputedStyle(this.mount);
        if (mountStyle.position === 'static') {
            this.mount.style.position = 'relative';
        }
        // Ensure initial active classes reflect UI state
        boostBtn.classList.toggle('active', this.ui.boost);
        trackBoostBtn.classList.toggle('active', this.ui.trackBoost);
        driftBtn.classList.toggle('active', this.ui.drift);
        draftBtn.classList.toggle('active', this.ui.draft);
        shieldBtn.classList.toggle('active', this.ui.shield);
        // Initialize default inactive visual style
        setActiveButtonStyle(boostBtn, this.ui.boost);
        setActiveButtonStyle(trackBoostBtn, this.ui.trackBoost);
        setActiveButtonStyle(driftBtn, this.ui.drift);
        setActiveButtonStyle(draftBtn, this.ui.draft);
        setActiveButtonStyle(shieldBtn, this.ui.shield);

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
        // Viewer track boost: use single long yellow cone for clarity
        this.rocketTail = new ShipRocketTail(
            rocketProxy,
            new THREE.Vector3(0, 0, -0.74),
            0,
            { singleCone: true, lengthScale: 1.8, color: 0xffdd55 }
        );
        this.viewerShip.add(this.rocketTail.root);

        this.draftProxy = { root: this.viewerShip, state: { speedKmh: 200 } };
        this.draftingParticles = new DraftingParticles(this.draftProxy as any, {
            scaleMultiplier: 0.7,
            opacity: 0.8,
            depthTest: true,
            toneMapped: true
        } as any);
        this.draftingLines = new DraftingVectorLines(this.draftProxy as any, { count: 22, points: 26 });
        // Particles use world coordinates -> add to scene (avoid double transform).
        // Vector lines are authored in local space -> keep as child of ship.
        this.scene?.add(this.draftingParticles.root);
        this.viewerShip.add(this.draftingLines.root);
        this.draftingParticles.setVisible(false);
        this.draftingLines.setVisible(false);

        // Boost particles (viewer-local)
        this.boostProxy = { root: this.viewerShip, state: { boosting: false } };
        this.shipBoostParticles = new ShipBoostParticles(this.boostProxy as any, {
            scaleMultiplier: 0.7,
            opacity: 0.7,
            depthTest: true,
            toneMapped: true
        } as any);
        // Important: add boost particles to the scene (world space), not as a child of the ship.
        // The particle system already spawns in world coordinates using the ship's world transform.
        // Parenting it to the ship would apply the ship's transform a second time, pushing particles too high.
        this.scene?.add(this.shipBoostParticles.root);

        const mini = {
            width: 4,
            length: 120,
            getPointAtT: (t: number, pos: THREE.Vector3) => {
                pos.set(0, PHYSICS.hoverHeight, -t * 120);
            },
            getFrenetFrame: (_t: number, normal: THREE.Vector3, binormal: THREE.Vector3, tangent: THREE.Vector3) => {
                normal.set(0, 1, 0);
                binormal.set(1, 0, 0);
                // Match direction of getPointAtT (negative Z as t increases)
                tangent.set(0, 0, -1);
            }
        };
        this.miniTrack = mini;
        this.driftTrail = new DriftTrail(this.miniTrack as any, COLORS.neonCyan);
        this.scene?.add(this.driftTrail.root);

        // Drift speed lines (viewer-local) using mini track + proxy ship
        if (this.viewerShip) {
            this.speedLinesShipProxy = {
                root: this.viewerShip,
                state: { isDrifting: false, speedKmh: 160, t: 0 },
                getColor: () => COLORS.neonCyan
            };
            this.driftSpeedLines = new DriftSpeedLines(this.speedLinesShipProxy as any, this.miniTrack as any, { useTrackForward: true });
            this.scene?.add(this.driftSpeedLines.root);
        }

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

        // Create shield effect
        this.shield = new ShipShield(new THREE.Vector3(0, 0, 0));
        this.viewerShip.add(this.shield.root);
        // Center the shield on the ship geometry
        this.shield.centerOn(this.viewerShip);
        this.shield.setActive(this.ui.shield);
    }

    private locateEngineMeshes(root: THREE.Object3D) {
        // Try to find new-style meshes first (idle disc ShaderMaterial + blue cone)
        root.traverse(obj => {
            if (!(obj instanceof THREE.Mesh)) return;
            // Idle disc: CircleGeometry + ShaderMaterial with uOpacity uniform
            if (!this.idleDiscMesh && obj.geometry instanceof THREE.CircleGeometry && (obj.material as any)?.isShaderMaterial) {
                const mat = obj.material as THREE.ShaderMaterial;
                if ((mat.uniforms as any)?.uOpacity) {
                    this.idleDiscMesh = obj as any;
                    this.idleDiscMat = mat;
                    // Ensure proper render setup
                    if (this.idleDiscMesh) this.idleDiscMesh.visible = true; // default: idle glow visible
                    if (this.idleDiscMat) {
                        this.idleDiscMat.transparent = true;
                        this.idleDiscMat.depthWrite = false;
                    }
                }
            }
            // Jet cone: ConeGeometry + MeshBasicMaterial (blue)
            if (!this.jetConeMesh && obj.geometry instanceof THREE.ConeGeometry && obj.material instanceof THREE.MeshBasicMaterial) {
                // Skip rocket tail cones by checking approximate color (orange/white) and scale; jet cone is cyan/blue
                const m = obj.material as THREE.MeshBasicMaterial;
                const c = m.color;
                const isBlue = c.b > c.g && c.g >= 0.55; // bluish
                if (isBlue) {
                    // Check if this is the inner core (smaller radius) or main cone
                    const geo = obj.geometry as THREE.ConeGeometry;
                    const radius = geo.parameters?.radius ?? 0;
                    // Core cone is smaller (radius ~0.06), main cone is larger (radius ~0.10)
                    if (radius < 0.08) {
                        this.coreConeMesh = obj as any;
                        this.coreConeMat = m;
                    } else {
                        this.jetConeMesh = obj as any;
                        this.jetConeMat = m;
                    }
                }
            }
            // Outer warm cone: ConeGeometry + MeshBasicMaterial (yellow/orange)
            if (!this.outerConeMesh && obj.geometry instanceof THREE.ConeGeometry && obj.material instanceof THREE.MeshBasicMaterial) {
                const m = obj.material as THREE.MeshBasicMaterial;
                const c = m.color;
                const isWarm = c.r > 0.9 && c.g > 0.6 && c.b < 0.3;
                if (isWarm) {
                    this.outerConeMesh = obj as any;
                    this.outerConeMat = m;
                }
            }
        });

        // Fallback: legacy gradient cone
        if (!this.jetConeMesh) {
            root.traverse(obj => {
                if (!(obj instanceof THREE.Mesh)) return;
                const mat = obj.material as any;
                const isBasic = mat instanceof THREE.MeshBasicMaterial;
                const hasVC = !!(obj.geometry as any)?.attributes?.color;
                const isCone = obj.geometry instanceof THREE.ConeGeometry;
                if (isBasic && hasVC && isCone && !this.engineGlowMesh) {
                    this.engineGlowMesh = obj as any;
                    this.engineGlowMat = obj.material as THREE.MeshBasicMaterial;
                    (this.engineGlowMesh as any).visible = true;
                    this.engineGlowMat.transparent = true;
                    this.engineGlowMat.depthWrite = false;
                    this.engineGlowMat.blending = THREE.AdditiveBlending;
                    this.engineGlowMat.toneMapped = false;
                    this.engineGlowOpacityCurrent = 0.18;
                    this.engineGlowScaleCurrent = 0.95;
                    this.engineGlowMat.opacity = this.engineGlowOpacityCurrent;
                    if (this.engineGlowMesh) {
                        this.engineGlowMesh.scale.set(this.engineGlowScaleCurrent, this.engineGlowScaleCurrent, this.engineGlowScaleCurrent);
                    }
                }
            });
        }
    }

    private updateBoost(dt: number) {
        // Drive boost particle system
        if (this.boostProxy && this.shipBoostParticles) {
            this.boostProxy.state.boosting = !!this.ui.boost;
            this.shipBoostParticles.update(dt);
        }
    }

    private updateEngineGlow(dt: number) {
        // If new engine meshes are present, drive them and hide overlap
        if (this.idleDiscMesh && this.idleDiscMat && this.jetConeMesh && this.jetConeMat) {
            const boosting = this.ui.boost;
            const trackBoosting = this.ui.trackBoost;
            const isMoving = boosting || trackBoosting; // treat as moving/ignited
            // Regular boost (not track boost) should show larger blue cone
            // Track boost takes precedence - when active, show rocket tail instead of enlarged blue cone
            const isRegularBoost = boosting && !trackBoosting;

            // Idle disc: visible only when not moving
            const idlePulse = 0.9 + 0.1 * (0.5 + 0.5 * Math.sin(this.nowSec * 4.0));
            const idleOpacity = THREE.MathUtils.clamp((isMoving ? 0.0 : 0.32 * idlePulse), 0, 0.6);
            this.idleDiscMat.uniforms.uOpacity.value = idleOpacity;
            this.idleDiscMesh.visible = idleOpacity > 0.01 && !isMoving;

            // Blue cone: scale and brightness based on boost state
            // When regular boost: larger (length ~1.14, radius ~1.05) and brighter
            // When just moving: normal size (length ~1.0, radius ~1.0)
            // When idle: smaller (length ~0.9, radius ~0.85)
            const conePulse = 1.0 + 0.08 * Math.sin(this.nowSec * 12.0);
            let radiusScale: number;
            let lengthScale: number;
            let targetOpacity: number;
            let targetColor: THREE.Color;

            if (isRegularBoost) {
                // Regular boost: larger and brighter blue cone (matching ShipJetEngine)
                radiusScale = 1.05;
                lengthScale = 1.0 + 0.14 + 0.06 * Math.sin(this.nowSec * 9.0); // ~1.14-1.20
                targetOpacity = 1.0;
                targetColor = new THREE.Color(0.28, 0.82, 1.0); // Brighter, hotter blue
            } else if (isMoving) {
                // Just moving (track boost or moving without regular boost): normal size
                radiusScale = 1.0;
                lengthScale = 1.0 + 0.06 * Math.sin(this.nowSec * 9.0); // ~1.0-1.06
                targetOpacity = 0.98;
                targetColor = new THREE.Color(0.2, 0.65, 1.0); // Standard blue
            } else {
                // Idle: smaller and dimmer
                radiusScale = 0.85;
                lengthScale = 0.9;
                targetOpacity = 0.85;
                targetColor = new THREE.Color(0.2, 0.65, 1.0); // Standard blue
            }

            this.jetConeMat.opacity = THREE.MathUtils.clamp(targetOpacity * conePulse, 0, 1);
            this.jetConeMat.color.copy(targetColor);
            this.jetConeMesh.scale.set(radiusScale, radiusScale, lengthScale);
            this.jetConeMesh.visible = true;

            // Inner core cone: visible when regular boost is active (matching ShipJetEngine)
            if (this.coreConeMesh && this.coreConeMat) {
                const coreTargetOpacity = isRegularBoost ? 1.0 : (isMoving ? 0.35 : 0.0);
                const corePulse = 0.98 + 0.12 * Math.sin(this.nowSec * 18.0);
                const coreOpacity = THREE.MathUtils.clamp(coreTargetOpacity * corePulse, 0, 1);
                this.coreConeMat.opacity = coreOpacity;
                this.coreConeMesh.visible = coreOpacity > 0.02;
                // Core is brighter when boosting
                if (isRegularBoost) {
                    this.coreConeMat.color.setRGB(0.45, 0.95, 1.0); // Brightest hot blue
                } else {
                    this.coreConeMat.color.setRGB(0.35, 0.85, 1.0); // Standard hot blue
                }
                this.coreConeMesh.scale.set(1.0, 1.0, isRegularBoost ? 1.2 : 1.0);
            }

            // Outer warm cone: completely hidden during boost (boost shows only blue-white)
            if (this.outerConeMesh && this.outerConeMat) {
                const outerTargetOpacity = isMoving && !isRegularBoost ? 0.28 : 0.0;
                const outerPulse = 1.0 + 0.08 * Math.sin(this.nowSec * 8.0);
                // Immediately set opacity to 0 when boost is active (no damping delay)
                const outerOpacity = isRegularBoost ? 0.0 : THREE.MathUtils.clamp(outerTargetOpacity * outerPulse, 0, 1);
                this.outerConeMat.opacity = outerOpacity;
                this.outerConeMesh.visible = isMoving && !isRegularBoost && outerOpacity > 0.02;
                if (isMoving && !isRegularBoost) this.outerConeMesh.scale.set(1.0, 1.0, 1.04);
            }
            return;
        }

        // Legacy fallback: gradient cone
        if (!this.engineGlowMesh || !this.engineGlowMat) return;
        const isMoving = this.ui.boost || this.ui.trackBoost;
        let targetOpacity = isMoving ? 0.9 : 0.18;
        let targetScale = isMoving ? 1.05 : 0.95;
        if (isMoving) {
            const pulse = 1.0 + 0.05 * Math.sin(this.nowSec * 12.0);
            targetOpacity *= THREE.MathUtils.clamp(0.95 + 0.05 * Math.sin(this.nowSec * 10.0), 0.9, 1.05);
            targetScale *= pulse;
        } else {
            targetOpacity *= 0.95 + 0.05 * Math.sin(this.nowSec * 6.0);
            targetScale *= 0.995 + 0.005 * Math.sin(this.nowSec * 5.0);
        }
        const damp = (current: number, target: number, k: number) => THREE.MathUtils.damp(current, target, k, dt);
        this.engineGlowOpacityCurrent = damp(this.engineGlowOpacityCurrent, targetOpacity, isMoving ? 8 : 4);
        this.engineGlowScaleCurrent = damp(this.engineGlowScaleCurrent, targetScale, isMoving ? 8 : 4);
        this.engineGlowMat.opacity = THREE.MathUtils.clamp(this.engineGlowOpacityCurrent, 0.08, 1.0);
        const s = this.engineGlowScaleCurrent;
        this.engineGlowMesh.scale.set(s, s, s);
        this.engineGlowMesh.visible = true;
    }

    private updateTrackBoost(dt: number) {
        if (!this.rocketTail) return;
        // Only update timer when track boost UI is active; immediately reset to 0 when inactive
        if (this.ui.trackBoost) {
            this.trackBoostTimer = BOOST_PAD.boostDuration;
        } else {
            this.trackBoostTimer = 0; // Immediately hide track boost when UI is off
        }
        // Hard guard: never show rocket tail unless Track Boost toggle is ON
        this.rocketTail.root.visible = !!this.ui.trackBoost;
        this.rocketTail.update(dt);
    }

    private updateDrift(dt: number) {
        if (!this.driftTrail || !this.driftState || !this.miniTrack) return;
        const active = this.ui.drift;
        this.driftState.isDrifting = active;
        // Keep trail centered under the ship in the viewer
        this.driftState.lateralOffset = 0;
        const mps = this.driftState.speedKmh / 3.6;
        const L = this.miniTrack.length;
        this.driftState.t = (this.driftState.t + (mps * dt) / L) % 1;
        this.driftTrail.update(dt, this.driftState);

        // Drive drift speed lines with same simulated state
        if (this.driftSpeedLines && this.speedLinesShipProxy) {
            this.speedLinesShipProxy.state.isDrifting = active;
            this.speedLinesShipProxy.state.speedKmh = this.driftState.speedKmh;
            this.speedLinesShipProxy.state.t = this.driftState.t;
            this.driftSpeedLines.update(dt);
        }
    }

    private updateDrafting(dt: number) {
        if (!this.draftingParticles || !this.draftingLines || !this.draftProxy) return;
        if (this.ui.draft) {
            this.draftingParticles.setVisible(true);
            this.draftingLines.setVisible(true);
            // Tie drafting visuals to simulated speed
            this.draftProxy.state.speedKmh = this.getSimulatedSpeedKmh();
        } else {
            this.draftingParticles.setVisible(false);
            this.draftingLines.setVisible(false);
        }
        this.draftingParticles.update(dt);
        this.draftingLines.update(dt);
    }

    private updateShield(dt: number) {
        if (!this.shield) return;
        this.shield.setActive(this.ui.shield);
        this.shield.update(dt);
    }

    private getSimulatedSpeedKmh(): number {
        // Boost states run near max speed; otherwise use drift/draft presets or base speed
        if (this.ui.boost || this.ui.trackBoost) return PHYSICS.maxSpeed * 0.92;
        const driftKmh = this.driftState?.speedKmh ?? 0;
        const draftKmh = this.draftProxy?.state.speedKmh ?? 0;
        const base = PHYSICS.baseSpeed;
        return Math.max(driftKmh, draftKmh, base);
    }

    private updateSimulatedWorldFlow(dt: number) {
        if (!this.envGroup) return;
        // Advance environment along the ship's forward to simulate motion
        const speedKmh = this.getSimulatedSpeedKmh();
        const mps = speedKmh / 3.6;
        this.envTravel += mps * dt;

        // Compute ship forward in world space (viewer ship faces +Z by default)
        const forward = new THREE.Vector3(0, 0, 1);
        if (this.viewerShip) forward.applyQuaternion(this.viewerShip.quaternion);

        // Wrap travel to keep grid nearby (use small loop distance)
        const loop = 10; // meters
        const wrapped = -(this.envTravel % loop);
        this.envGroup.position.copy(forward.multiplyScalar(wrapped));
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
                        // Also treat bright yellow (single-cone track tail color like 0xffdd55)
                        const isYellow = color.r > 0.9 && color.g > 0.75 && color.b < 0.5;
                        if (isOrangeColor || isWhiteCore) {
                            return true;
                        }
                        if (isYellow) {
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
                    // Track tail single-cone often uses bright yellow (e.g. 0xffdd55)
                    const isTrackTailYellow = color.r > 0.9 && color.g > 0.75 && color.b < 0.5;
                    if (isBoostColor || isTrackTailYellow) {
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


