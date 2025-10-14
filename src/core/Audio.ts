import * as THREE from 'three';

export class AudioSystem {
    private listener = new THREE.AudioListener();
    private audio = new THREE.Audio(this.listener);
    private boost = new THREE.Audio(this.listener);
    private wind = new THREE.Audio(this.listener);
    private analyser: THREE.AudioAnalyser | null = null;
    private loader = new THREE.AudioLoader();
    private started = false;

    attach(camera: THREE.Camera) {
        camera.add(this.listener);
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.loader.load('/audio/bgm.mp3', (buffer) => {
            this.audio.setBuffer(buffer);
            this.audio.setLoop(true);
            this.audio.setVolume(0.35);
            this.audio.play();
            this.analyser = new THREE.AudioAnalyser(this.audio, 32);
        });
        this.loader.load('/audio/wind.wav', (buffer) => {
            this.wind.setBuffer(buffer);
            this.wind.setLoop(true);
            this.wind.setVolume(0.0);
            this.wind.play();
        });
        this.loader.load('/audio/boost.wav', (buffer) => {
            this.boost.setBuffer(buffer);
            this.boost.setLoop(false);
            this.boost.setVolume(0.6);
        });
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
}


