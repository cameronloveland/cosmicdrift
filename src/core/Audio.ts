import * as THREE from 'three';

export class AudioSystem {
    private listener = new THREE.AudioListener();
    private audio = new THREE.Audio(this.listener);
    private boost = new THREE.Audio(this.listener);
    private wind = new THREE.Audio(this.listener);
    private radioMedia: HTMLAudioElement | null = null;
    private radioGain = 0.6;
    private analyser: THREE.AudioAnalyser | null = null;
    private loader = new THREE.AudioLoader();
    private started = false;

    attach(camera: THREE.Camera) {
        camera.add(this.listener);
    }

    start() {
        if (this.started) return;
        this.started = true;
        // Load optional local SFX only if present and valid audio
        this.safeLoad('/audio/bgm.mp3', (buffer) => {
            this.audio.setBuffer(buffer);
            this.audio.setLoop(true);
            this.audio.setVolume(0.35);
            this.audio.play();
            this.analyser = new THREE.AudioAnalyser(this.audio, 32);
        });
        this.safeLoad('/audio/wind.wav', (buffer) => {
            this.wind.setBuffer(buffer);
            this.wind.setLoop(true);
            this.wind.setVolume(0.0);
            this.wind.play();
        });
        this.safeLoad('/audio/boost.wav', (buffer) => {
            this.boost.setBuffer(buffer);
            this.boost.setLoop(false);
            this.boost.setVolume(0.6);
        });
    }

    private async safeLoad(url: string, onLoad: (buffer: AudioBuffer) => void) {
        try {
            const res = await fetch(url, { method: 'HEAD' });
            if (!res.ok) return; // asset absent; skip silently
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            if (!ct.startsWith('audio/')) return; // not audio -> skip to avoid decode error
        } catch {
            return; // network/HEAD blocked -> skip
        }
        this.loader.load(url, onLoad, undefined, () => { /* ignore decode errors */ });
    }

    setSpeed(speedKmh: number) {
        const v = THREE.MathUtils.clamp((speedKmh - 80) / 180, 0, 1);
        this.wind.setVolume(v * 0.6);
    }

    triggerBoost() {
        if (this.boost.isPlaying) this.boost.stop();
        this.boost.play();
    }

    getRms(): number {
        if (!this.analyser) return 0.5 + 0.5 * Math.sin(performance.now() * 0.004);
        const data = this.analyser.getAverageFrequency();
        return data / 256; // approx 0..1
    }

    // Radio controls
    initRadio(streamUrl: string) {
        if (this.radioMedia) return;
        const el = document.createElement('audio');
        el.src = streamUrl;
        el.preload = 'auto';
        (el as any).playsInline = true;
        el.muted = false;
        el.volume = this.radioGain;
        el.style.display = 'none';
        document.body.appendChild(el);
        this.radioMedia = el;
        // Start loading immediately
        el.load();
    }

    setRadioSource(streamUrl: string) {
        if (!this.radioMedia) {
            this.initRadio(streamUrl);
            return;
        }
        try { this.radioMedia.pause(); } catch { }
        this.radioMedia.src = streamUrl;
        this.radioMedia.load();
    }

    preloadRadio(streamUrl: string) {
        if (!this.radioMedia) {
            this.initRadio(streamUrl);
        }
        // Force preloading
        if (this.radioMedia) {
            this.radioMedia.src = streamUrl;
            this.radioMedia.preload = 'auto';
            this.radioMedia.load();
        }
    }

    async playRadio(): Promise<boolean> {
        try {
            //return false;
            await this.radioMedia?.play();
            return true;
        } catch (e) {
            return false;
        }
    }

    pauseRadio() {
        this.radioMedia?.pause();
    }

    setRadioVolume(v: number) {
        this.radioGain = THREE.MathUtils.clamp(v, 0, 1);
        if (this.radioMedia) this.radioMedia.volume = this.radioGain;
        // HTMLAudioElement volume is enough; avoid extra graph to reduce CORS issues
    }

    onRadioEvent<K extends keyof HTMLMediaElementEventMap>(type: K, handler: (this: HTMLMediaElement, ev: HTMLMediaElementEventMap[K]) => any) {
        if (!this.radioMedia) return () => { };
        const el = this.radioMedia;
        el.addEventListener(type, handler as any);
        return () => el.removeEventListener(type, handler as any);
    }

    isRadioPlaying(): boolean {
        const el = this.radioMedia;
        return !!(el && !el.paused && !el.ended && el.currentTime > 0);
    }
}


