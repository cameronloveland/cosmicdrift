import * as THREE from 'three';
import Stats from 'stats.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ChromaticAberrationEffect, VignetteEffect, SMAAEffect } from 'postprocessing';
import { CAMERA, POST, RENDER } from './constants';
import { Ship } from './Ship';
import { Track } from './Track';
import { UI } from './UI';
import { Environment } from './Environment';
import { Particles } from './Particles';
import { SpeedStars } from './SpeedStars';
import { AudioSystem } from './Audio';

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

    private track!: Track;
    private ship!: Ship;
    private env!: Environment;
    private particles!: Particles;
    private speedStars!: SpeedStars;
    private ui!: UI;
    private audio!: AudioSystem;
    private radio = {
        on: true,
        stationIndex: 0,
        stations: [
            { name: 'SomaFM Groove Salad', url: 'https://ice3.somafm.com/groovesalad-128-mp3' },
            { name: 'SomaFM Space Station', url: 'https://ice2.somafm.com/spacestation-128-mp3' },
            { name: 'Nightride FM', url: 'https://stream.nightride.fm/nightride.mp3' },
            { name: 'KEXP Seattle', url: 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3' }
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

        this.particles = new Particles(this.ship);
        this.scene.add(this.particles.root);

        this.speedStars = new SpeedStars(this.ship, this.track);
        this.scene.add(this.speedStars.root);

        this.ui = new UI();

        this.audio = new AudioSystem();
        this.audio.attach(this.camera);
        // initialize radio stream source
        const initial = this.radio.stations[this.radio.stationIndex];
        this.audio.initRadio(initial.url);

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
            start?.classList.remove('visible');
            start?.classList.add('hidden');
            this.ui.setStarted(true);
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

        this.ship.update(dt);
        this.particles.update(dt);
        this.speedStars.update(dt);
        this.env.update(dt);
        this.ui.update(this.ship.state);
        this.audio.setSpeed(this.ship.state.speedKmh);
        if (this.ship.state.boosting && !this.prevBoost) this.audio.triggerBoost();
        this.prevBoost = this.ship.state.boosting;
    }

    private render() {
        this.composer.render();
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
}


