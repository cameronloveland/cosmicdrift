import * as THREE from 'three';

export type Mp3Track = {
    path: string; // Full path relative to background-tracks (e.g. "Artist/Song.mp3")
    artist: string; // Artist/directory name
    song: string; // Song filename without extension
};

export class AudioSystem {
    private listener = new THREE.AudioListener();
    private audio = new THREE.Audio(this.listener);
    private boost = new THREE.Audio(this.listener);
    private boostPad = new THREE.Audio(this.listener);
    private wind = new THREE.Audio(this.listener);
    private radioMedia: HTMLAudioElement | null = null;
    private radioGain = 0.6;
    private mp3Media: HTMLAudioElement | null = null;
    private mp3Gain = 0.6;
    private mp3Tracks: Mp3Track[] = [];
    private mp3CurrentIndex = 0;
    private mp3OnEndedHandler: (() => void) | null = null;
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
        this.safeLoad('/audio/boost_pad.wav', (buffer) => {
            this.boostPad.setBuffer(buffer);
            this.boostPad.setLoop(false);
            this.boostPad.setVolume(0.65);
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

    triggerBoostPad() {
        if (this.boostPad.isPlaying) this.boostPad.stop();
        this.boostPad.play();
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

    // MP3 controls
    async scanMp3Tracks(): Promise<Mp3Track[]> {
        // Try to load a manifest file first (server-side generated)
        try {
            const manifestRes = await fetch('/audio/background-tracks/manifest.json');
            if (manifestRes.ok) {
                const manifest = await manifestRes.json() as { tracks: Array<{ path: string; artist: string; song: string }> };
                const tracks: Mp3Track[] = manifest.tracks.map(track => ({
                    path: track.path,
                    artist: track.artist,
                    song: track.song
                }));
                this.mp3Tracks = tracks;
                return tracks;
            }
        } catch {
            // Manifest not found, try known tracks
        }

        // Fallback: Try known tracks with artist structure
        // Format: { artist: string, path: string, song: string }[]
        const knownTracks = [
            { artist: 'NiKneT Art', path: 'NiKneT Art/Neon Reverie Electro Pop Synthwave Retro Ruturistic.mp3', song: 'Neon Reverie Electro Pop Synthwave Retro Ruturistic' },
            { artist: 'NiKneT Art', path: 'NiKneT Art/Midnight Circuit Electro Pop Synthwave Retro Futuristic.mp3', song: 'Midnight Circuit Electro Pop Synthwave Retro Futuristic' },
            { artist: 'UsefulPix', path: 'UsefulPix/Retro Synthwave.mp3', song: 'Retro Synthwave' },
            { artist: 'UsefulPix', path: 'UsefulPix/Synthwave Background Beats.mp3', song: 'Synthwave Background Beats' },
            { artist: 'Evgeny Bardyuzha', path: 'Evgeny Bardyuzha/Password Infinity.mp3', song: 'Password Infinity' },
            { artist: 'lofi dreams', path: 'lofi dreams/Midnight Run.mp3', song: 'Midnight Run' }
        ];

        // Use known tracks directly (paths are hardcoded, no verification needed)
        const validTracks: Mp3Track[] = knownTracks.map(track => ({
            path: track.path,
            artist: track.artist,
            song: track.song
        }));

        this.mp3Tracks = validTracks;
        return validTracks;
    }

    initMp3() {
        if (this.mp3Media) return;
        const el = document.createElement('audio');
        el.preload = 'auto';
        (el as any).playsInline = true;
        el.muted = false;
        el.volume = this.mp3Gain;
        el.style.display = 'none';
        document.body.appendChild(el);
        this.mp3Media = el;

        // Auto-advance to next track when current ends
        el.addEventListener('ended', () => {
            if (this.mp3OnEndedHandler) {
                this.mp3OnEndedHandler();
            } else {
                this.nextMp3();
            }
        });
    }

    loadMp3Track(index: number): boolean {
        if (this.mp3Tracks.length === 0 || index < 0 || index >= this.mp3Tracks.length) {
            return false;
        }

        this.initMp3();
        if (!this.mp3Media) return false;

        try {
            this.mp3Media.pause();
            this.mp3Media.src = `/audio/background-tracks/${this.mp3Tracks[index].path}`;
            this.mp3Media.load();
            this.mp3CurrentIndex = index;
            return true;
        } catch {
            return false;
        }
    }

    async playMp3(): Promise<boolean> {
        this.initMp3();
        if (!this.mp3Media) {
            console.error('MP3 media element not initialized');
            return false;
        }

        // Ensure we have tracks
        if (this.mp3Tracks.length === 0) {
            await this.scanMp3Tracks();
        }

        if (this.mp3Tracks.length === 0) {
            console.warn('No MP3 tracks available to play');
            return false;
        }

        // Check if a valid track is loaded by checking if src is a valid audio file path
        const hasValidSrc = this.mp3Media.src &&
            !this.mp3Media.src.endsWith('/') &&
            this.mp3Media.src !== window.location.href &&
            this.mp3Media.src.includes('/audio/background-tracks/');

        // If no valid track loaded, load first track
        if (!hasValidSrc) {
            const loaded = this.loadMp3Track(0);
            if (!loaded) {
                console.error('Failed to load MP3 track');
                return false;
            }

            // Wait for the track to be ready to play
            await new Promise<void>((resolve) => {
                if (!this.mp3Media) {
                    resolve();
                    return;
                }

                const timeout = setTimeout(() => {
                    this.mp3Media?.removeEventListener('canplay', onCanPlay);
                    this.mp3Media?.removeEventListener('error', onError);
                    console.warn('Timeout waiting for MP3 to be ready');
                    resolve(); // Resolve anyway to allow play attempt
                }, 3000); // 3 second timeout

                const onError = (e: Event) => {
                    clearTimeout(timeout);
                    this.mp3Media?.removeEventListener('canplay', onCanPlay);
                    this.mp3Media?.removeEventListener('error', onError);
                    console.error('Error loading MP3 track:', e);
                    resolve(); // Still resolve to allow play attempt
                };

                const onCanPlay = () => {
                    clearTimeout(timeout);
                    this.mp3Media?.removeEventListener('canplay', onCanPlay);
                    this.mp3Media?.removeEventListener('error', onError);
                    resolve();
                };

                this.mp3Media.addEventListener('canplay', onCanPlay, { once: true });
                this.mp3Media.addEventListener('error', onError, { once: true });

                // If already ready, resolve immediately
                if (this.mp3Media.readyState >= 2) {
                    clearTimeout(timeout);
                    this.mp3Media.removeEventListener('canplay', onCanPlay);
                    this.mp3Media.removeEventListener('error', onError);
                    resolve();
                }
            });
        } else {
            // Track is loaded, make sure it's ready
            if (this.mp3Media.readyState < 2) {
                // Wait for canplay if not ready
                await new Promise<void>((resolve) => {
                    if (!this.mp3Media) {
                        resolve();
                        return;
                    }
                    const timeout = setTimeout(() => resolve(), 1000);
                    const onCanPlay = () => {
                        clearTimeout(timeout);
                        this.mp3Media?.removeEventListener('canplay', onCanPlay);
                        resolve();
                    };
                    this.mp3Media.addEventListener('canplay', onCanPlay, { once: true });
                    if (this.mp3Media.readyState >= 2) {
                        clearTimeout(timeout);
                        this.mp3Media.removeEventListener('canplay', onCanPlay);
                        resolve();
                    }
                });
            }
        }

        try {
            await this.mp3Media.play();
            return true;
        } catch (e) {
            console.error('Failed to play MP3:', e);
            return false;
        }
    }

    pauseMp3() {
        this.mp3Media?.pause();
    }

    nextMp3() {
        if (this.mp3Tracks.length === 0) return;
        const nextIndex = (this.mp3CurrentIndex + 1) % this.mp3Tracks.length;
        const wasPlaying = this.mp3Media && !this.mp3Media.paused && !this.mp3Media.ended;
        this.loadMp3Track(nextIndex);
        if (wasPlaying) {
            this.playMp3();
        }
    }

    prevMp3() {
        if (this.mp3Tracks.length === 0) return;
        const prevIndex = (this.mp3CurrentIndex - 1 + this.mp3Tracks.length) % this.mp3Tracks.length;
        const wasPlaying = this.mp3Media && !this.mp3Media.paused && !this.mp3Media.ended;
        this.loadMp3Track(prevIndex);
        if (wasPlaying) {
            this.playMp3();
        }
    }

    getMp3Tracks(): Mp3Track[] {
        return [...this.mp3Tracks];
    }

    getCurrentMp3Track(): { index: number; name: string; artist: string; song: string } | null {
        if (this.mp3Tracks.length === 0 || this.mp3CurrentIndex < 0 || this.mp3CurrentIndex >= this.mp3Tracks.length) {
            return null;
        }
        const track = this.mp3Tracks[this.mp3CurrentIndex];
        return {
            index: this.mp3CurrentIndex,
            name: `${track.artist} - ${track.song}`,
            artist: track.artist,
            song: track.song
        };
    }

    isMp3Playing(): boolean {
        const el = this.mp3Media;
        return !!(el && !el.paused && !el.ended && el.currentTime > 0);
    }

    setMp3Volume(v: number) {
        this.mp3Gain = THREE.MathUtils.clamp(v, 0, 1);
        if (this.mp3Media) this.mp3Media.volume = this.mp3Gain;
    }

    setMp3OnEnded(handler: () => void) {
        this.mp3OnEndedHandler = handler;
    }
}


