import * as THREE from 'three';
import Stats from 'stats.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ChromaticAberrationEffect, VignetteEffect, SMAAEffect } from 'postprocessing';
import { CAMERA, POST, RENDER } from './constants';
import { Ship } from './Ship';
import { Track } from './Track';
import { UI } from './UI';
import { Environment } from './Environment';
import { ShipBoost } from './ShipBoost';
import { SpeedStars } from './SpeedStars';
import { AudioSystem } from './Audio';
import { WormholeTunnel } from './WormholeTunnel';
import { NPCShip } from './NPCShip';
import { RaceManager } from './RaceManager';
import { COLORS } from './constants';
import type { RaceState } from './types';

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
    private started = false;
    private paused = false;
    private freeFlying = false;

    // Free camera state
    private freeCamPos = new THREE.Vector3();
    private freeCamYaw = 0;
    private freeCamPitch = 0;
    private freeCamInput = { forward: false, back: false, left: false, right: false, up: false, down: false, sprint: false };
    private savedCamPos = new THREE.Vector3();
    private savedCamQuat = new THREE.Quaternion();

    private track!: Track;
    private ship!: Ship;
    private env!: Environment;
    private shipBoost!: ShipBoost;
    private speedStars!: SpeedStars;
    private wormholeTunnel!: WormholeTunnel;
    private ui!: UI;
    private audio!: AudioSystem;
    private npcShips: NPCShip[] = [];
    private raceManager!: RaceManager;
    private raceState: RaceState = 'NOT_STARTED';
    private radio = {
        on: true,
        stationIndex: 0,
        stations: [
            { name: 'Nightride FM', url: 'https://stream.nightride.fm/nightride.mp3' },
            { name: 'Nightwave Plaza', url: 'https://radio.plaza.one/mp3' },

        ] as { name: string; url: string; }[]
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

        this.ship = new Ship(this.track, this.camera);
        this.scene.add(this.ship.root);

        this.env = new Environment();
        this.scene.add(this.env.root);

        // Ensure environment encloses the whole track
        this.env.setStarfieldRadius(this.track.boundingRadius * 1.6);

        // Manual boost particle effect
        this.shipBoost = new ShipBoost(this.ship);
        this.scene.add(this.shipBoost.root);

        // Speed stars
        this.speedStars = new SpeedStars(this.ship, this.track);
        this.scene.add(this.speedStars.root);

        // Wormhole tunnels
        this.wormholeTunnel = new WormholeTunnel(this.track);
        this.scene.add(this.wormholeTunnel.root);

        this.ui = new UI();
        // Ensure pause menu is hidden on initialization
        this.ui.setPaused(false);

        this.audio = new AudioSystem();
        this.audio.attach(this.camera);
        // initialize radio stream source
        const initial = this.radio.stations[this.radio.stationIndex];
        this.audio.initRadio(initial.url);

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

        // Start screen interaction
        const start = document.getElementById('start');
        const begin = () => {
            if (this.started) return;

            // Hide splash screen
            start?.classList.remove('visible');
            start?.classList.add('hidden');

            // Show HUD
            this.ui.setStarted(true);
            this.ui.setHudVisible(true);

            // Create NPC ships now that game is starting
            const npc1 = new NPCShip(this.track, 'npc1', COLORS.neonCyan, 'aggressive', -6);
            const npc2 = new NPCShip(this.track, 'npc2', COLORS.neonMagenta, 'conservative', 6);

            this.npcShips = [npc1, npc2];
            this.scene.add(npc1.root);
            this.scene.add(npc2.root);

            // Register NPCs with race manager
            this.raceManager.addNPC('npc1');
            this.raceManager.addNPC('npc2');

            // Position all ships at starting line
            this.ship.state.t = -0.01; // Player at center
            this.npcShips[0].state.t = -0.011; // NPC1 behind and left
            this.npcShips[1].state.t = -0.009; // NPC2 ahead and right

            // Enable camera control so camera follows ship to staging area
            this.ship.setCameraControl(true);

            // Disable ship input during countdown
            this.ship.disableInput();

            // Start countdown sequence
            this.raceState = 'COUNTDOWN';
            this.startCountdownSequence();

            this.audio.start();
            // hide cursor only once the game actually starts
            this.renderer.domElement.style.cursor = 'none';
            // Autoplay radio on first user gesture
            this.playOrAdvance().then(() => { /* state/UI updated in helper */ });
            window.removeEventListener('keydown', handler);
            document.getElementById('beginBtn')?.removeEventListener('click', begin);
            start?.removeEventListener('pointerdown', begin);
            this.started = true;
            // remove the splash after transition to ensure it's gone
            setTimeout(() => start?.remove(), 450);
        };
        const handler = (e: KeyboardEvent) => {
            if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); begin(); }
        };
        window.addEventListener('keydown', handler);
        document.getElementById('beginBtn')?.addEventListener('click', begin);
        start?.addEventListener('pointerdown', begin);

        // Radio UI wiring
        this.ui.setRadioUi(this.radio.on, initial.name);
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
        this.ui.onRadioVolume((v) => this.audio.setRadioVolume(v));
        // Prev/Next station
        this.ui.onRadioPrev(async () => {
            this.radio.stationIndex = (this.radio.stationIndex - 1 + this.radio.stations.length) % this.radio.stations.length;
            const st = this.radio.stations[this.radio.stationIndex];
            this.audio.setRadioSource(st.url);
            this.ui.setRadioUi(this.radio.on, st.name);
            if (this.radio.on) await this.playOrAdvance(2);
            this.ui.setRadioUi(this.radio.on, st.name);
        });
        this.ui.onRadioNext(async () => {
            this.radio.stationIndex = (this.radio.stationIndex + 1) % this.radio.stations.length;
            const st = this.radio.stations[this.radio.stationIndex];
            this.audio.setRadioSource(st.url);
            this.ui.setRadioUi(this.radio.on, st.name);
            if (this.radio.on) await this.playOrAdvance(2);
            this.ui.setRadioUi(this.radio.on, st.name);
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

        if (e.code === 'KeyF' && down && this.started) {
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

            // Request pointer lock for unlimited mouse movement
            this.renderer.domElement.requestPointerLock();
        } else {
            // Exiting pause: restore camera state
            this.camera.position.copy(this.savedCamPos);
            this.camera.quaternion.copy(this.savedCamQuat);

            // Exit pointer lock and hide cursor
            document.exitPointerLock();
            this.renderer.domElement.style.cursor = 'none';
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
        const sprintMultiplier = 3; // 3x faster when sprinting
        const speed = baseSpeed * (this.freeCamInput.sprint ? sprintMultiplier : 1);

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
        this.fixedAccumulator += dt;
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
        if (!this.started) {
            this.ui.update(this.ship.state);
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
            this.env.update(dt);
            this.ui.update(this.ship.state);
            this.audio.setSpeed(this.ship.state.speedKmh);
            if (this.ship.state.boosting && !this.prevBoost) this.audio.triggerBoost();
            this.prevBoost = this.ship.state.boosting;
            return;
        }

        // Normal game mode
        this.ship.update(dt);
        this.shipBoost.update(dt);
        this.speedStars.update(dt);
        this.wormholeTunnel.update(dt);
        this.env.update(dt);
        this.ui.update(this.ship.state);
        this.audio.setSpeed(this.ship.state.speedKmh);
        if (this.ship.state.boosting && !this.prevBoost) this.audio.triggerBoost();
        this.prevBoost = this.ship.state.boosting;

        // Update NPCs during countdown and racing
        if (this.raceState === 'COUNTDOWN' || this.raceState === 'RACING') {
            this.npcShips.forEach(npc => {
                npc.update(dt, this.ship.state.t, this.ship.state.lapCurrent, this.ship.state.speedKmh);
            });
        }
    }

    private render() {
        this.composer.render();
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
            this.ship.enableInput();
            // Camera control already enabled in begin() function

            // Start all ships
            this.ship.startRace();
            this.npcShips.forEach(npc => npc.startRace());

            // Hide countdown after GO animation
            setTimeout(() => {
                this.ui.hideCountdown();
            }, 500);
        }, 3000);
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
    }

    private quitToMenu() {
        // Reload the page to reset everything to initial state
        window.location.reload();
    }
}


