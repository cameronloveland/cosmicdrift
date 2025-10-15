import * as THREE from 'three';
import Stats from 'stats.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ChromaticAberrationEffect, VignetteEffect } from 'postprocessing';
import { CAMERA, POST, RENDER } from './constants';
import { Ship } from './Ship';
import { Track } from './Track';
import { UI } from './UI';
import { Environment } from './Environment';
import { Particles } from './Particles';
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
    private ui!: UI;
    private audio!: AudioSystem;
    private radio = { playing: false, stationName: 'Nightride FM', url: 'https://stream.nightride.fm/nightride.mp3' };

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

        this.ui = new UI();

        this.audio = new AudioSystem();
        this.audio.attach(this.camera);
        // initialize radio stream source
        this.audio.initRadio(this.radio.url);

        // Post FX
        this.composer = new EffectComposer(this.renderer);
        const renderPass = new RenderPass(this.scene, this.camera);
        const bloom = new BloomEffect({ intensity: POST.bloomStrength, luminanceThreshold: POST.bloomThreshold, luminanceSmoothing: 0.2, radius: POST.bloomRadius });
        const chroma = new ChromaticAberrationEffect();
        const vignette = new VignetteEffect();
        const effects = new EffectPass(this.camera, bloom, chroma, vignette);
        this.composer.addPass(renderPass);
        this.composer.addPass(effects);

        // Start screen interaction
        const start = document.getElementById('start');
        const begin = () => {
            if (this.started) return;
            start?.classList.remove('visible');
            start?.classList.add('hidden');
            this.ui.setStarted(true);
            this.audio.start();
            // try to autoplay radio once user interacted
            this.audio.playRadio().then((ok) => {
                this.radio.playing = ok;
                this.ui.setRadioUi(this.radio.playing, this.radio.stationName);
            });
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
        this.ui.setRadioUi(false, this.radio.stationName);
        this.ui.setRadioVolumeSlider(0.6);
        this.ui.onRadioToggle(async () => {
            if (this.radio.playing) {
                this.audio.pauseRadio();
                this.radio.playing = false;
            } else {
                const ok = await this.audio.playRadio();
                this.radio.playing = ok;
            }
            this.ui.setRadioUi(this.radio.playing, this.radio.stationName);
        });
        this.ui.onRadioVolume((v) => this.audio.setRadioVolume(v));
        // Swap station if the default fails (basic fallback)
        const fallbackStations = [
            { name: 'Nightride FM', url: 'https://stream.nightride.fm/nightride.mp3' },
            { name: 'Radio Paradise', url: 'https://stream.radioparadise.com/aac-320' },
            { name: 'KEXP Seattle', url: 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3' }
        ];
        // If audio element errors, try next station
        (this as any).audio['radioMedia']?.addEventListener?.('error', () => {
            const idx = fallbackStations.findIndex(s => s.url === this.radio.url);
            const next = fallbackStations[(idx + 1) % fallbackStations.length];
            this.radio.url = next.url;
            this.radio.stationName = next.name;
            this.audio.setRadioSource(this.radio.url);
            this.ui.setRadioUi(this.radio.playing, this.radio.stationName);
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
        this.env.update(dt);
        this.ui.update(this.ship.state);
        this.audio.setSpeed(this.ship.state.speedKmh);
        if (this.ship.state.boosting && !this.prevBoost) this.audio.triggerBoost();
        this.prevBoost = this.ship.state.boosting;
    }

    private render() {
        this.composer.render();
    }
}


