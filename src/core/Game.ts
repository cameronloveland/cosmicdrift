import * as THREE from 'three';
import Stats from 'stats.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ChromaticAberrationEffect, VignetteEffect, SMAAEffect } from 'postprocessing';
import { CAMERA, POST, RENDER } from './constants';
import { Ship } from './Ship';
import { Track } from './Track';
import { UI } from './UI';
import { Environment } from './Environment';
import { ShipBoost } from './ShipBoost';
import { ShipSpeedStars } from './ShipSpeedStars';
import { AudioSystem } from './Audio';
import { WormholeTunnel } from './WormholeTunnel';
import { NPCShip } from './NPCShip';
import { RaceManager } from './RaceManager';
import { ShootingStars } from './ShootingStars';
// import { Comets } from './Comets'; // Temporarily disabled
import { COLORS } from './constants';
import type { RaceState } from './types';
import { MainMenu } from './MainMenu';
import { NEWS_ITEMS } from './news';
import { ShipViewer } from './ShipViewer';

export class Game {
    private container: HTMLElement;
    private renderer: THREE.WebGLRenderer;
    private composer!: EffectComposer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private stats: Stats;
    private clock: THREE.Clock;
    private fixedAccumulator = 0;
    private readonly fixedDelta = 1 / RENDER.targetFPS;
    private pixelRatio = Math.min(window.devicePixelRatio, RENDER.maxPixelRatio);
    private prevBoost = false;
    private prevBoostPadEntry = false;
    private started = false;
    private paused = false;
    private freeFlying = false;

    // Free camera state
    private freeCamPos = new THREE.Vector3();
    private freeCamYaw = 0;
    private freeCamPitch = 0;
    private freeCamInput = { forward: false, back: false, left: false, right: false, up: false, down: false, sprint: false };
    private freeCamSprintSpeed = 1; // accumulates over time when sprinting
    private savedCamPos = new THREE.Vector3();
    private savedCamQuat = new THREE.Quaternion();

    private track!: Track;
    private ship!: Ship;
    private env!: Environment;
    private shipBoost!: ShipBoost;
    private speedStars!: ShipSpeedStars;
    private wormholeTunnel!: WormholeTunnel;
    private shootingStars!: ShootingStars;
    // private comets!: Comets; // Temporarily disabled
    private ui!: UI;
    private audio!: AudioSystem;
    private npcShips: NPCShip[] = [];
    private npcShipBoosts: ShipBoost[] = [];
    private raceManager!: RaceManager;
    private raceState: RaceState = 'NOT_STARTED';
    private mode: 'MENU' | 'RACE' | 'VIEWER' = 'MENU';
    private mainMenu!: MainMenu;
    private shipViewer: ShipViewer | null = null;
    // Attract mode
    private menuNpcShips: NPCShip[] = [];
    private menuNpcBoosts: ShipBoost[] = [];
    private menuPacerT = 0;
    private menuPacerSpeedKmh = 180;

    // Camera intro state
    private cameraIntroActive = false;
    private cameraIntroTime = 0;

    // Background darkening for tunnels
    private tunnelDarkenTarget = 0; // 0 = normal, 1 = almost black
    private tunnelDarkenCurrent = 0; // smoothly interpolated value

    private radio = {
        on: false, // Start off - only plays when radio tab is active
        stationIndex: 0,
        stations: [
            { name: 'Nightride FM', url: 'https://stream.nightride.fm/nightride.mp3' },
            { name: 'Nightwave Plaza', url: 'https://radio.plaza.one/mp3' },

        ] as { name: string; url: string; }[]
    };

    private mp3Mode = {
        active: true, // Default to MP3 mode
        playing: false,
        currentTrackIndex: 0
    };

    constructor(container: HTMLElement) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x07051a, 0.0008);

        this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
        this.camera.position.set(0, 2, 6);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setClearColor(0x050314, 1);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(this.renderer.domElement);

        this.stats = new Stats();
        this.stats.showPanel(0);
        Object.assign(this.stats.dom.style, { position: 'absolute', left: 'unset', right: '0px' });
        document.body.appendChild(this.stats.dom);

        this.clock = new THREE.Clock();

        this.setup();
        this.onResize();
        window.addEventListener('resize', () => this.onResize());

        // Pause and free camera controls
        window.addEventListener('keydown', (e) => this.onPauseKey(e, true));
        window.addEventListener('keyup', (e) => this.onPauseKey(e, false));
        window.addEventListener('mousemove', (e) => this.onFreeCamMouseMove(e));

        this.loop();
    }

    private setup() {
        // Lights
        const hemi = new THREE.HemisphereLight(0x6e5cd6, 0x0a082a, 0.5);
        this.scene.add(hemi);

        // Systems
        this.track = new Track();
        this.scene.add(this.track.root);

        // Verify track initialization
        if (this.track.curve && this.track.curve.points && this.track.curve.points.length > 0) {
            console.log('Track initialized successfully with', this.track.curve.points.length, 'control points');
        } else {
            console.error('Track initialization failed - curve not ready');
            // Wait a frame for track to fully initialize
            setTimeout(() => {
                if (this.track.curve && this.track.curve.points && this.track.curve.points.length > 0) {
                    console.log('Track initialized on retry with', this.track.curve.points.length, 'control points');
                } else {
                    console.error('Track still not ready after retry');
                }
            }, 0);
        }

        this.ship = new Ship(this.track, this.camera);
        this.scene.add(this.ship.root);

        this.env = new Environment();
        this.scene.add(this.env.root);

        // Ensure environment encloses the whole track
        const starfieldRadius = this.track.boundingRadius * 1.6;
        this.env.setStarfieldRadius(starfieldRadius);

        // Manual boost particle effect
        this.shipBoost = new ShipBoost(this.ship);
        this.scene.add(this.shipBoost.root);

        // Speed stars
        this.speedStars = new ShipSpeedStars(this.ship, this.track);
        this.scene.add(this.speedStars.root);

        // Wormhole tunnels
        this.wormholeTunnel = new WormholeTunnel(this.track);
        this.scene.add(this.wormholeTunnel.root);

        // Shooting stars
        this.shootingStars = new ShootingStars();
        this.shootingStars.setStarfieldRadius(starfieldRadius);
        this.scene.add(this.shootingStars.root);

        // Comets - temporarily disabled
        // this.comets = new Comets();
        // this.scene.add(this.comets.root);

        // Start line holographic wall is now built into Track.buildStartLine()
        // No separate particle system needed

        this.ui = new UI();
        // Ensure pause menu is hidden on initialization
        this.ui.setPaused(false);

        this.audio = new AudioSystem();
        this.audio.attach(this.camera);
        // initialize radio stream source
        const initial = this.radio.stations[this.radio.stationIndex];
        this.audio.initRadio(initial.url);
        // Scan and initialize MP3 tracks (load but don't play until user gesture)
        this.audio.scanMp3Tracks().then((tracks) => {
            if (tracks.length > 0 && this.mp3Mode.active) {
                this.audio.loadMp3Track(0);
                this.updateMp3UI();
            }
        });

        // Initialize race manager
        this.raceManager = new RaceManager();

        // NPCs will be created when game starts, not on initial load

        // Post FX
        this.composer = new EffectComposer(this.renderer);
        const renderPass = new RenderPass(this.scene, this.camera);
        const bloom = new BloomEffect({ intensity: POST.bloomStrength, luminanceThreshold: POST.bloomThreshold, luminanceSmoothing: 0.2, radius: POST.bloomRadius });
        const chroma = new ChromaticAberrationEffect();
        const vignette = new VignetteEffect();
        const effects = new EffectPass(this.camera, bloom, chroma, vignette);
        this.composer.addPass(renderPass);
        this.composer.addPass(effects);

        if (POST.enableSMAA) {
            const smaa = new SMAAEffect();
            const smaaPass = new EffectPass(this.camera, smaa);
            this.composer.addPass(smaaPass);
        }

        // Replace splash interaction with a cyberpunk main menu
        const start = document.getElementById('start');
        start?.classList.add('hidden');
        this.mainMenu = new MainMenu({ news: NEWS_ITEMS });
        this.mainMenu.setDisabled(['multiplayer', 'leaderboards']);
        this.mainMenu.on('race', () => this.startFromMenu());
        this.mainMenu.on('controls', () => {
            // Show the existing controls overlay
            const controls = document.getElementById('controlsMenu');
            if (controls) {
                controls.classList.remove('hidden');
                controls.classList.add('visible');
                // Wire back button to return to main menu instead of pause menu
                const backBtn = document.getElementById('backToPauseBtn');
                if (backBtn) {
                    backBtn.onclick = () => {
                        controls.classList.remove('visible');
                        controls.classList.add('hidden');
                    };
                }
            }
        });
        this.mainMenu.on('build-ship', () => {
            // Activate the ship viewer in the right viewport
            const mount = document.getElementById('menuViewport')!;
            if (!this.shipViewer) {
                this.shipViewer = new ShipViewer(mount);
            }
            this.shipViewer.start();
            this.mainMenu.showViewerOverlay(true);
            this.mode = 'VIEWER';
        });

        // Tab switching
        this.ui.onTabSwitch((mode) => {
            if (mode === 'radio') {
                this.mp3Mode.active = false;
                // Pause MP3 when switching to radio
                this.audio.pauseMp3();
                this.mp3Mode.playing = false;
                // Start radio when switching to radio tab
                if (this.started) {
                    // Only autoplay if game has started (user gesture occurred)
                    this.radio.on = true;
                    this.playOrAdvance().then(() => {
                        this.ui.setRadioUi(this.radio.on, this.radio.stations[this.radio.stationIndex].name);
                    });
                } else {
                    // Game hasn't started yet, just prepare
                    this.radio.on = false;
                    this.ui.setRadioUi(false, initial.name);
                }
            } else {
                this.mp3Mode.active = true;
                // Pause radio when switching to MP3
                this.audio.pauseRadio();
                this.radio.on = false;
                this.ui.setRadioUi(false, initial.name);
                // Autoplay MP3 when switching to MP3 tab
                const tracks = this.audio.getMp3Tracks();
                if (tracks.length > 0) {
                    if (this.started || !this.audio.isMp3Playing()) {
                        // Load track if not already loaded
                        const current = this.audio.getCurrentMp3Track();
                        if (!current) {
                            this.audio.loadMp3Track(0);
                        }
                        this.audio.playMp3().then((ok) => {
                            this.mp3Mode.playing = ok;
                            this.updateMp3UI();
                        });
                    }
                }
            }
            this.ui.setActiveTab(mode);
        });

        // Set default tab (MP3)
        this.ui.setActiveTab('mp3');

        // Radio UI wiring (starts off since MP3 is default)
        this.ui.setRadioUi(false, initial.name);
        this.ui.setRadioVolumeSlider(0.6);

        this.ui.onRadioToggle(async () => {
            const st = this.radio.stations[this.radio.stationIndex];
            if (!this.radio.on) {
                await this.playOrAdvance();
            } else {
                this.audio.pauseRadio();
                this.radio.on = false;
                this.ui.setRadioUi(false, st.name);
            }
        });
        // Unified volume control (controls both radio and MP3)
        this.ui.onUnifiedVolume((v) => {
            this.audio.setRadioVolume(v);
            this.audio.setMp3Volume(v);
        });
        this.ui.setUnifiedVolumeSlider(0.6);

        // Legacy radio volume handler (if still needed)
        this.ui.onRadioVolume((v) => this.audio.setRadioVolume(v));

        // MP3 controls
        this.ui.onMp3Control('play', () => {
            const isPlaying = this.audio.isMp3Playing();
            if (isPlaying) {
                this.audio.pauseMp3();
                this.mp3Mode.playing = false;
                this.updateMp3UI();
            } else {
                // Ensure we have tracks loaded
                const tracks = this.audio.getMp3Tracks();
                if (tracks.length === 0) {
                    // Try to scan tracks if we don't have any
                    this.audio.scanMp3Tracks().then((scannedTracks) => {
                        if (scannedTracks.length > 0) {
                            const current = this.audio.getCurrentMp3Track();
                            if (!current) {
                                this.audio.loadMp3Track(0);
                            }
                            this.audio.playMp3().then((ok) => {
                                this.mp3Mode.playing = ok;
                                this.updateMp3UI();
                            }).catch((err) => {
                                console.error('Failed to play MP3:', err);
                                this.mp3Mode.playing = false;
                                this.updateMp3UI();
                            });
                        } else {
                            console.warn('No MP3 tracks found');
                            this.updateMp3UI();
                        }
                    }).catch((err) => {
                        console.error('Failed to scan MP3 tracks:', err);
                        this.updateMp3UI();
                    });
                } else {
                    // Ensure track is loaded
                    const current = this.audio.getCurrentMp3Track();
                    if (!current) {
                        this.audio.loadMp3Track(0);
                    }
                    this.audio.playMp3().then((ok) => {
                        this.mp3Mode.playing = ok;
                        this.updateMp3UI();
                    }).catch((err) => {
                        console.error('Failed to play MP3:', err);
                        this.mp3Mode.playing = false;
                        this.updateMp3UI();
                    });
                }
            }
        });

        this.ui.onMp3Control('prev', () => {
            this.audio.prevMp3();
            this.mp3Mode.currentTrackIndex = this.audio.getCurrentMp3Track()?.index ?? 0;
            this.mp3Mode.playing = this.audio.isMp3Playing();
            this.updateMp3UI();
        });

        this.ui.onMp3Control('next', () => {
            this.audio.nextMp3();
            this.mp3Mode.currentTrackIndex = this.audio.getCurrentMp3Track()?.index ?? 0;
            this.mp3Mode.playing = this.audio.isMp3Playing();
            this.updateMp3UI();
        });

        this.ui.onMp3TrackClick((index) => {
            this.audio.loadMp3Track(index);
            this.mp3Mode.currentTrackIndex = index;
            this.audio.playMp3().then((ok) => {
                this.mp3Mode.playing = ok;
                this.updateMp3UI();
            });
        });

        // MP3 volume now handled by unified volume control above

        // MP3 auto-advance handler
        this.audio.setMp3OnEnded(() => {
            this.audio.nextMp3();
            this.mp3Mode.currentTrackIndex = this.audio.getCurrentMp3Track()?.index ?? 0;
            this.mp3Mode.playing = true;
            this.updateMp3UI();
        });

        // Pause menu button handlers
        this.ui.onRestartClick(() => {
            this.restart();
        });

        this.ui.onQuitClick(() => {
            this.quitToMenu();
        });

        this.ui.onControlsClick(() => {
            this.ui.showControlsMenu();
        });

        this.ui.onBackToPauseClick(() => {
            this.ui.showPauseMenu();
        });
        // If current station errors, auto-advance
        this.audio.onRadioEvent('error', () => {
            this.radio.stationIndex = (this.radio.stationIndex + 1) % this.radio.stations.length;
            const st = this.radio.stations[this.radio.stationIndex];
            this.audio.setRadioSource(st.url);
            if (this.radio.on) this.audio.playRadio();
            this.ui.setRadioUi(this.radio.on, st.name);
        });
        this.audio.onRadioEvent('canplay', () => {
            const st = this.radio.stations[this.radio.stationIndex];
            if (this.radio.on) this.ui.setRadioUi(true, st.name);
        });
        this.audio.onRadioEvent('playing', () => {
            const st = this.radio.stations[this.radio.stationIndex];
            if (this.radio.on) this.ui.setRadioUi(true, st.name);
        });
        this.audio.onRadioEvent('stalled', () => {
            if (!this.radio.on) return;
            const st = this.radio.stations[this.radio.stationIndex];
            this.audio.setRadioSource(st.url);
            this.audio.playRadio();
        });
    }

    private onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.pixelRatio = Math.min(window.devicePixelRatio, RENDER.maxPixelRatio);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(w, h);
        this.composer?.setSize(w, h);
        this.track?.updateResolution(w, h);
    }

    private onPauseKey(e: KeyboardEvent, down: boolean) {
        if (e.code === 'Escape' && down && this.started) {
            this.togglePause();
        }

        // Free flight mode toggle with '-' key
        if (e.code === 'Minus' && down && this.started) {
            this.toggleFreeFlying();
        }

        // Free camera movement (only when paused or free flying)
        if (!this.paused && !this.freeFlying) return;
        if (e.code === 'KeyW') this.freeCamInput.forward = down;
        if (e.code === 'KeyS') this.freeCamInput.back = down;
        if (e.code === 'KeyA') this.freeCamInput.left = down;
        if (e.code === 'KeyD') this.freeCamInput.right = down;
        if (e.code === 'Space') this.freeCamInput.up = down;
        if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.freeCamInput.down = down;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.freeCamInput.sprint = down;
    }

    private onFreeCamMouseMove(e: MouseEvent) {
        if (!this.paused && !this.freeFlying) return;
        const dx = e.movementX;
        const dy = e.movementY;
        if (dx === 0 && dy === 0) return;

        // Full 360 mouse look
        this.freeCamYaw -= dx * 0.003;
        this.freeCamPitch = THREE.MathUtils.clamp(this.freeCamPitch - dy * 0.003, -Math.PI / 2, Math.PI / 2);
    }

    private togglePause() {
        this.paused = !this.paused;
        this.ui.setPaused(this.paused);

        if (this.paused) {
            // Entering pause: save camera state and init free cam
            this.savedCamPos.copy(this.camera.position);
            this.savedCamQuat.copy(this.camera.quaternion);
            this.freeCamPos.copy(this.camera.position);

            // Extract yaw/pitch from current camera rotation
            const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
            this.freeCamYaw = euler.y;
            this.freeCamPitch = euler.x;

            // Clear ship input to avoid stuck keys
            this.ship.clearInput();

            // Do not auto-enable pointer lock so user can interact with the menu.
            // They can enable free-fly pointer look by pressing '-' (freeFlying) or clicking canvas.

            // Slide in main menu + news feed
            try {
                this.mainMenu.show();
                document.getElementById('mainMenu')?.classList.add('enter');
                document.getElementById('newsFeed')?.classList.add('enter');
            } catch {}
        } else {
            // Exiting pause: restore camera state
            this.camera.position.copy(this.savedCamPos);
            this.camera.quaternion.copy(this.savedCamQuat);

            // Exit pointer lock and hide cursor
            document.exitPointerLock();
            this.renderer.domElement.style.cursor = 'none';

            // Slide out main menu + news feed
            try {
                document.getElementById('mainMenu')?.classList.remove('enter');
                document.getElementById('newsFeed')?.classList.remove('enter');
                // hide after transition to allow slide-out
                setTimeout(() => this.mainMenu.hide(), 650);
            } catch {}
        }
    }

    private toggleFreeFlying() {
        this.freeFlying = !this.freeFlying;

        if (this.freeFlying) {
            // Entering free fly: save camera state and init free cam
            this.savedCamPos.copy(this.camera.position);
            this.savedCamQuat.copy(this.camera.quaternion);
            this.freeCamPos.copy(this.camera.position);

            // Extract yaw/pitch from current camera rotation
            const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
            this.freeCamYaw = euler.y;
            this.freeCamPitch = euler.x;

            // Clear ship input to avoid stuck keys
            this.ship.clearInput();

            // Reset sprint speed
            this.freeCamSprintSpeed = 1;

            // Disable ship camera control
            this.ship.setCameraControl(false);

            // Request pointer lock for unlimited mouse movement
            this.renderer.domElement.requestPointerLock();
        } else {
            // Exiting free fly: restore camera state
            this.camera.position.copy(this.savedCamPos);
            this.camera.quaternion.copy(this.savedCamQuat);

            // Re-enable ship camera control
            this.ship.setCameraControl(true);

            // Exit pointer lock and hide cursor
            document.exitPointerLock();
            this.renderer.domElement.style.cursor = 'none';
        }
    }

    private updateFreeCamera(dt: number) {
        const baseSpeed = 20; // units per second
        const sprintAcceleration = 2; // speed multiplier per second when sprinting
        const maxSprintSpeed = 50; // maximum speed multiplier

        // Accumulate sprint speed when shift is held
        if (this.freeCamInput.sprint) {
            this.freeCamSprintSpeed = Math.min(this.freeCamSprintSpeed + sprintAcceleration * dt, maxSprintSpeed);
        } else {
            // Decay sprint speed when not sprinting
            this.freeCamSprintSpeed = Math.max(1, this.freeCamSprintSpeed - sprintAcceleration * dt);
        }

        const speed = baseSpeed * this.freeCamSprintSpeed;

        const forward = new THREE.Vector3(0, 0, -1);
        const right = new THREE.Vector3(1, 0, 0);
        const up = new THREE.Vector3(0, 1, 0);

        // Build rotation from yaw/pitch
        const qYaw = new THREE.Quaternion().setFromAxisAngle(up, this.freeCamYaw);
        const qPitch = new THREE.Quaternion().setFromAxisAngle(right, this.freeCamPitch);
        const rotation = qYaw.multiply(qPitch);

        // Apply rotation to direction vectors
        forward.applyQuaternion(rotation);
        right.applyQuaternion(rotation);

        // Move camera based on input
        if (this.freeCamInput.forward) this.freeCamPos.addScaledVector(forward, speed * dt);
        if (this.freeCamInput.back) this.freeCamPos.addScaledVector(forward, -speed * dt);
        if (this.freeCamInput.right) this.freeCamPos.addScaledVector(right, speed * dt);
        if (this.freeCamInput.left) this.freeCamPos.addScaledVector(right, -speed * dt);
        if (this.freeCamInput.up) this.freeCamPos.addScaledVector(up, speed * dt);
        if (this.freeCamInput.down) this.freeCamPos.addScaledVector(up, -speed * dt);

        // Apply to camera
        this.camera.position.copy(this.freeCamPos);
        this.camera.quaternion.copy(rotation);
    }

    private loop = () => {
        requestAnimationFrame(this.loop);
        this.stats.begin();

        const dt = this.clock.getDelta();

        // Clamp dt to prevent catch-up issues when the game first loads
        // Cap at 2 frames worth of time to prevent spiky first frames
        const clampedDt = Math.min(dt, this.fixedDelta * 2);

        this.fixedAccumulator += clampedDt;
        const maxSteps = 5;
        let steps = 0;
        while (this.fixedAccumulator >= this.fixedDelta && steps < maxSteps) {
            this.update(this.fixedDelta);
            this.fixedAccumulator -= this.fixedDelta;
            steps++;
        }

        this.render();
        this.stats.end();
    };

    private update(dt: number) {
        // Always update background effects for visual magic on splash screen
        this.shootingStars.update(dt);
        // this.comets.update(dt); // Temporarily disabled
        this.env.update(dt);


        if (!this.started) {
            if (this.mode === 'MENU') this.updateAttractMode(dt);
            this.ui.update(this.ship.state, this.ship.getFocusRefillActive(), this.ship.getFocusRefillProgress(), this.ship.getBoostRechargeDelay());
            return;
        }

        if (this.paused) {
            this.updateFreeCamera(dt);
            return;
        }

        if (this.freeFlying) {
            // Free fly mode: update both free camera and game state
            this.updateFreeCamera(dt);
            this.ship.update(dt);
            this.shipBoost.update(dt);
            this.speedStars.update(dt);
            this.wormholeTunnel.update(dt);
            this.shootingStars.update(dt);
            // this.comets.update(dt); // Temporarily disabled
            this.env.update(dt);
            this.ui.update(this.ship.state, this.ship.getFocusRefillActive(), this.ship.getFocusRefillProgress(), this.ship.getBoostRechargeDelay());
            this.audio.setSpeed(this.ship.state.speedKmh);
            if (this.ship.state.boosting && !this.prevBoost) this.audio.triggerBoost();
            this.prevBoost = this.ship.state.boosting;
            if (this.ship.state.onBoostPadEntry && !this.prevBoostPadEntry) this.audio.triggerBoostPad();
            this.prevBoostPadEntry = this.ship.state.onBoostPadEntry;
            return;
        }

        // Handle camera intro animation
        if (this.cameraIntroActive) {
            this.cameraIntroTime += dt;
            this.updateCameraIntro(dt);

            // Check if intro is complete
            if (this.cameraIntroTime >= 3.0) {
                this.cameraIntroActive = false;
                this.ship.setCameraControl(true);
            }
        }

        // Update player ship during countdown, racing, and after finish (for visuals)
        if (this.raceState === 'COUNTDOWN' || this.raceState === 'RACING' || this.raceState === 'FINISHED') {
            // Update gate fade-out during countdown and race
            const currentTime = this.clock.getElapsedTime();
            this.track.updateGateFade(currentTime);

            this.ship.update(dt);
            this.shipBoost.update(dt);
            this.speedStars.update(dt);
            this.wormholeTunnel.update(dt);
            this.shootingStars.update(dt); // Ensure shooting stars continue during race
            this.env.update(dt);
            this.ui.update(this.ship.state, this.ship.getFocusRefillActive(), this.ship.getFocusRefillProgress(), this.ship.getBoostRechargeDelay());

            // Update debug overlay
            // TODO FIX THIS CAUSES WEIRD INTRO CAMERA JERK 
            // const starStats = this.speedStars.getStarStats();
            // const gameTime = this.clock.getElapsedTime();
            // this.ui.updateDebugOverlay(gameTime, starStats.ahead, starStats.behind, starStats.distant, starStats.total, this.ship.state.speedKmh);

            // Update NPCs FIRST so their state is current when calculating positions
            this.npcShips.forEach(npc => {
                npc.update(dt, this.ship.state.t, this.ship.state.lapCurrent, this.ship.state.speedKmh, this.npcShips);
            });

            // Update NPC boost effects (same as player ship)
            this.npcShipBoosts.forEach(boost => boost.update(dt));

            // Update race position and lap time info (after NPCs have been updated)
            this.raceManager.updatePlayerState(this.ship.state);
            // Update NPC states so positions can be calculated accurately
            this.npcShips.forEach(npc => {
                this.raceManager.updateNPCState(npc.racerId, npc.state);
            });

            // Check if player has finished the race
            if (this.raceState === 'RACING' && this.ship.state.lapCurrent >= this.ship.state.lapTotal) {
                this.raceManager.finishRace();
                this.raceState = 'FINISHED';
                // Disable ship input when race is finished
                this.ship.disableInput();
                console.log('Race finished! Final position and time will be shown.');
            }

            // Calculate and update race positions
            const raceResults = this.raceManager.getRaceResults();
            console.log(`Player position: ${raceResults.playerPosition}/${this.npcShips.length + 1} | t: ${this.ship.state.t?.toFixed(4)} | lap: ${this.ship.state.lapCurrent}`);
            this.ui.updateRaceInfo(raceResults.playerPosition, this.ship.state.lastLapTime ?? 0, this.npcShips.length + 1);

            this.audio.setSpeed(this.ship.state.speedKmh);
            if (this.ship.state.boosting && !this.prevBoost) this.audio.triggerBoost();
            this.prevBoost = this.ship.state.boosting;
            if (this.ship.state.onBoostPadEntry && !this.prevBoostPadEntry) this.audio.triggerBoostPad();
            this.prevBoostPadEntry = this.ship.state.onBoostPadEntry;

            // Update tunnel background darkening
            this.updateTunnelBackground(dt);
        }
    }

    private render() {
        this.composer.render();
    }

    // Start the actual race from the new main menu
    public startFromMenu() {
        if (this.started) return;

        // Slide out menu + news feed, then hide
        try {
            const menuEl = document.getElementById('mainMenu');
            const newsEl = document.getElementById('newsFeed');
            menuEl?.classList.remove('enter');
            newsEl?.classList.remove('enter');
            setTimeout(() => {
                this.mainMenu.hide();
                if (newsEl) (newsEl as HTMLElement).style.display = 'none';
            }, 650);
        } catch { /* ignore */ }
        if (this.shipViewer) {
            this.shipViewer.stop();
            this.mainMenu.showViewerOverlay(false);
        }

        // Show HUD
        this.ui.setStarted(true);
        this.ui.setHudVisible(true);

        // Create four NPCs
        const npc1 = new NPCShip(this.track, 'npc1', COLORS.neonRed, 'aggressive', -8);
        const npc2 = new NPCShip(this.track, 'npc2', COLORS.neonMagenta, 'aggressive', 8);
        const npc3 = new NPCShip(this.track, 'npc3', COLORS.neonYellow, 'conservative', -4);
        const npc4 = new NPCShip(this.track, 'npc4', COLORS.neonPurple, 'conservative', 4);

        this.npcShips = [npc1, npc2, npc3, npc4];
        this.scene.add(npc1.root);
        this.scene.add(npc2.root);
        this.scene.add(npc3.root);
        this.scene.add(npc4.root);

        this.npcShipBoosts = [new ShipBoost(npc1), new ShipBoost(npc2), new ShipBoost(npc3), new ShipBoost(npc4)];
        this.npcShipBoosts.forEach(b => this.scene.add(b.root));

        // Register with race manager
        this.raceManager.addNPC('npc1');
        this.raceManager.addNPC('npc2');
        this.raceManager.addNPC('npc3');
        this.raceManager.addNPC('npc4');

        // Place ships behind start line
        const startT = -12 / this.track.length;
        this.ship.state.t = startT;
        this.ship.state.lateralOffset = 0;
        this.npcShips[0].state.t = startT;
        this.npcShips[1].state.t = startT;
        this.npcShips[2].state.t = startT;
        this.npcShips[3].state.t = startT;
        this.ship.updatePositionAndCamera(0);
        this.npcShips.forEach(n => n.updateVisualPosition());

        // Camera intro
        this.ship.setCameraControl(false);
        this.cameraIntroActive = true;
        this.cameraIntroTime = 0;

        // Disable input during countdown
        this.ship.disableInput();
        this.npcShips.forEach(n => n.setCountdownMode(true));

        // Countdown sequence
        this.raceState = 'COUNTDOWN';
        const currentTime = this.clock.getElapsedTime();
        this.track.startGateFade(currentTime);
        this.startCountdownSequence();

        this.audio.start();
        this.renderer.domElement.style.cursor = 'none';

        // Autoplay MP3 if possible
        if (this.mp3Mode.active) {
            const tracks = this.audio.getMp3Tracks();
            if (tracks.length > 0 && !this.audio.isMp3Playing()) {
                this.audio.playMp3().then((ok) => { this.mp3Mode.playing = ok; this.updateMp3UI(); });
            }
        } else if (this.radio.on) {
            this.playOrAdvance();
        }

        this.started = true;
        this.mode = 'RACE';
    }

    // Basic attract mode: a few NPC ships circulate and the camera follows the first
    private updateAttractMode(dt: number) {
        // Ensure setup
        if (this.menuNpcShips.length === 0) {
            const n1 = new NPCShip(this.track, 'menu1', COLORS.neonMagenta, 'aggressive', -6);
            const n2 = new NPCShip(this.track, 'menu2', COLORS.neonYellow, 'conservative', 0);
            const n3 = new NPCShip(this.track, 'menu3', COLORS.neonPurple, 'aggressive', 6);
            this.menuNpcShips = [n1, n2, n3];
            this.menuNpcShips.forEach(n => { this.scene.add(n.root); n.startRace(); });
            this.menuNpcBoosts = [new ShipBoost(n1), new ShipBoost(n2), new ShipBoost(n3)];
            this.menuNpcBoosts.forEach(b => this.scene.add(b.root));
            this.menuPacerT = -12 / this.track.length;
        }

        // Advance a simple pacer along the track to feed NPC AI
        const mps = (this.menuPacerSpeedKmh / 3.6);
        this.menuPacerT += (mps * dt) / this.track.length;
        if (this.menuPacerT > 1) this.menuPacerT -= 1;

        // Update NPCs
        this.menuNpcShips.forEach(npc => npc.update(dt, this.menuPacerT, 1, this.menuPacerSpeedKmh, this.menuNpcShips));
        this.menuNpcBoosts.forEach(b => b.update(dt));

        // Follow the lead NPC (first)
        const lead = this.menuNpcShips[0];
        const pos = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const binormal = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        this.track.getPointAtT(lead.state.t, pos);
        this.track.getFrenetFrame(lead.state.t, normal, binormal, tangent);
        const forward = tangent.clone().normalize();
        const up = normal.clone().normalize();
        const chasePos = new THREE.Vector3()
            .copy(pos)
            .addScaledVector(binormal, lead.state.lateralOffset)
            .addScaledVector(up, 3.0)
            .addScaledVector(forward, -10.0);
        this.camera.position.lerp(chasePos, 1 - Math.pow(0.0001, dt));
        const lookAt = new THREE.Vector3().copy(pos).addScaledVector(forward, 8).addScaledVector(up, 0.2);
        this.camera.up.copy(up);
        this.camera.lookAt(lookAt);
    }

    private startCountdownSequence() {
        // 3-2-1-GO countdown sequence
        this.ui.showCountdown(3);

        setTimeout(() => {
            this.ui.showCountdown(2);
        }, 1000);

        setTimeout(() => {
            this.ui.showCountdown(1);
        }, 2000);

        setTimeout(() => {
            this.ui.showGo();
            // Start the race
            this.raceState = 'RACING';
            this.raceManager.startRacing(); // Initialize race time tracking
            // Gate should already be faded out by now (fade started during countdown)
            this.ship.enableInput();
            // Camera control already enabled in begin() function

            // Start all ships
            this.ship.startRace();
            this.npcShips.forEach(npc => npc.startRace());

            // Show race info display
            this.ui.setRaceInfoVisible(true);

            // Hide countdown after GO animation
            setTimeout(() => {
                this.ui.hideCountdown();
            }, 500);
        }, 3000);
    }

    private updateCameraIntro(dt: number) {
        // Calculate animation progress (0 to 1 over 3 seconds)
        const progress = Math.min(this.cameraIntroTime / 3.0, 1.0);

        // Get ship starting position and frame from track (12m behind start line)
        const startT = -12 / this.track.length; // Ships are 12 meters behind start line
        const startPos = new THREE.Vector3();
        const startNormal = new THREE.Vector3();
        const startBinormal = new THREE.Vector3();
        const startTangent = new THREE.Vector3();

        this.track.getPointAtT(startT, startPos);
        this.track.getFrenetFrame(startT, startNormal, startBinormal, startTangent);

        // Calculate center point of all ships (average position)
        const centerPos = new THREE.Vector3();
        centerPos.copy(startPos);
        centerPos.addScaledVector(startBinormal, this.ship.state.lateralOffset);

        // Add NPC positions to center calculation
        this.npcShips.forEach(npc => {
            const npcPos = new THREE.Vector3();
            this.track.getPointAtT(npc.state.t, npcPos);
            npcPos.addScaledVector(startBinormal, npc.state.lateralOffset);
            centerPos.add(npcPos);
        });
        centerPos.divideScalar(this.npcShips.length + 1); // Average of all ships

        // Camera path: start far behind and above, end behind ships in chase-cam position
        const startOffset = new THREE.Vector3()
            .copy(startTangent)
            .multiplyScalar(-30) // Far behind for dramatic sweep
            .addScaledVector(startNormal, 20); // High above

        const endOffset = new THREE.Vector3()
            .copy(startTangent)
            .multiplyScalar(-15) // Behind ships (chase-cam position)
            .addScaledVector(startNormal, 10) // Chase-cam height
            .addScaledVector(startBinormal, 0); // Centered behind ships

        // Smooth easing (cubic ease-in-out)
        const easedProgress = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        // Interpolate camera position
        const cameraPos = new THREE.Vector3()
            .copy(centerPos)
            .addScaledVector(startOffset, 1 - easedProgress)
            .addScaledVector(endOffset, easedProgress);

        // Position camera
        this.camera.position.copy(cameraPos);

        // Look at center of ships
        this.camera.lookAt(centerPos);

        // Align camera up with track normal for natural orientation
        this.camera.up.copy(startNormal);
    }

    private async playOrAdvance(maxTries = this.radio.stations.length) {
        // Try current station; on failure, advance up to maxTries
        for (let i = 0; i < maxTries; i++) {
            const st = this.radio.stations[this.radio.stationIndex];
            this.audio.setRadioSource(st.url);
            const ok = await this.audio.playRadio();
            if (ok) {
                this.radio.on = true;
                this.ui.setRadioUi(true, st.name);
                return true;
            }
            this.radio.stationIndex = (this.radio.stationIndex + 1) % this.radio.stations.length;
        }
        this.radio.on = false;
        const st = this.radio.stations[this.radio.stationIndex];
        this.ui.setRadioUi(false, st.name);
        return false;
    }

    private updateMp3UI() {
        const trackInfo = this.audio.getCurrentMp3Track();
        const tracks = this.audio.getMp3Tracks();
        const isPlaying = this.audio.isMp3Playing();

        this.ui.updateMp3Controls(isPlaying, trackInfo?.name || '-');
        if (tracks.length > 0 && trackInfo) {
            // Convert tracks to display format with artist and song
            const displayTracks = tracks.map(t => ({ artist: t.artist, song: t.song }));
            this.ui.updateMp3TrackList(displayTracks, trackInfo.index);
            this.mp3Mode.currentTrackIndex = trackInfo.index;
        }
        this.mp3Mode.playing = isPlaying;
    }

    private updateTunnelBackground(dt: number) {
        // Set target darkening based on tunnel state
        this.tunnelDarkenTarget = this.ship.state.inTunnel ? 1 : 0;

        // Smoothly interpolate to target
        const lerpSpeed = 4.0; // how fast the transition happens
        this.tunnelDarkenCurrent = THREE.MathUtils.lerp(
            this.tunnelDarkenCurrent,
            this.tunnelDarkenTarget,
            lerpSpeed * dt
        );

        // Get base colors (original space background colors)
        const bgStartBase = new THREE.Color(0x0a0324);
        const bgMidBase = new THREE.Color(0x050314);
        const bgEndBase = new THREE.Color(0x030211);
        const fogColorBase = new THREE.Color(0x07051a);
        const clearColorBase = new THREE.Color(0x050314);

        // Get dark colors (almost black for tunnels)
        const bgStartDark = new THREE.Color(0x000001);
        const bgMidDark = new THREE.Color(0x000000);
        const bgEndDark = new THREE.Color(0x000000);
        const fogColorDark = new THREE.Color(0x000000);
        const clearColorDark = new THREE.Color(0x000000);

        // Interpolate colors based on tunnel darkness
        const currentBgStart = bgStartBase.clone().lerp(bgStartDark, this.tunnelDarkenCurrent);
        const currentBgMid = bgMidBase.clone().lerp(bgMidDark, this.tunnelDarkenCurrent);
        const currentBgEnd = bgEndBase.clone().lerp(bgEndDark, this.tunnelDarkenCurrent);
        const currentFogColor = fogColorBase.clone().lerp(fogColorDark, this.tunnelDarkenCurrent);
        const currentClearColor = clearColorBase.clone().lerp(clearColorDark, this.tunnelDarkenCurrent);

        // Update HTML background gradient
        const gradient = document.querySelector('html')?.style;
        if (gradient) {
            const hex1 = currentBgStart.getHexString().padStart(6, '0');
            const hex2 = currentBgMid.getHexString().padStart(6, '0');
            const hex3 = currentBgEnd.getHexString().padStart(6, '0');
            gradient.background = `radial-gradient(ellipse at center, #${hex1} 0%, #${hex2} 60%, #${hex3} 100%)`;
        }

        // Update fog color
        this.scene.fog = new THREE.FogExp2(currentFogColor.getHex(), 0.0008);

        // Update renderer clear color
        this.renderer.setClearColor(currentClearColor.getHex(), 1);
    }

    private restart() {
        // Reset ship to starting position
        this.ship.reset();

        // Reset game state
        this.paused = false;
        this.ui.setPaused(false);

        // Clear any free camera state
        this.freeFlying = false;
        this.ship.setCameraControl(true);

        // Exit pointer lock and hide cursor
        document.exitPointerLock();
        this.renderer.domElement.style.cursor = 'none';

        // Reset tunnel background
        this.tunnelDarkenCurrent = 0;
        this.tunnelDarkenTarget = 0;
    }

    private quitToMenu() {
        // Reload the page to reset everything to initial state
        window.location.reload();
    }
}


