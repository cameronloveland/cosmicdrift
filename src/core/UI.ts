import { ShipState } from './types';
import { SpeedometerGauge } from './SpeedometerGauge';
import { MinimapGauge } from './MinimapGauge';
import { Track } from './Track';

export class UI {
    private speedometerGauge: SpeedometerGauge;
    private minimapGauge: MinimapGauge | null = null;
    private startEl = document.getElementById('start')!;
    private pauseMenuEl = document.getElementById('pauseMenu')!;
    private controlsMenuEl = document.getElementById('controlsMenu')!;
    private countdownEl = document.getElementById('countdown')!;
    private countdownTextEl = document.getElementById('countdownText')!;
    private radioToggle = document.getElementById('radioToggle')! as HTMLDivElement;
    private radioStation = document.getElementById('radioStation')! as HTMLDivElement;
    private radioVol: HTMLInputElement | null = null; // Legacy - may not exist
    private volumeFill: HTMLDivElement | null = null; // Legacy - may not exist
    private unifiedVol = document.getElementById('unifiedVol')! as HTMLInputElement;
    private unifiedVolumeFill = document.getElementById('unifiedVolumeFill')! as HTMLDivElement;
    private radioTab = document.getElementById('radioTab')! as HTMLDivElement;
    private mp3Tab = document.getElementById('mp3Tab')! as HTMLDivElement;
    private radioMode = document.getElementById('radioMode')! as HTMLDivElement;
    private mp3Mode = document.getElementById('mp3Mode')! as HTMLDivElement;
    private mp3PlayPauseBtn = document.getElementById('mp3PlayPauseBtn')! as HTMLDivElement;
    private mp3PrevBtn = document.getElementById('mp3PrevBtn')! as HTMLDivElement;
    private mp3NextBtn = document.getElementById('mp3NextBtn')! as HTMLDivElement;
    private mp3TrackName = document.getElementById('mp3TrackName')! as HTMLDivElement;
    private mp3TrackList = document.getElementById('mp3TrackList')! as HTMLDivElement;
    private debugGameTimeEl = document.getElementById('debugGameTime')!;
    private debugStarsAheadEl = document.getElementById('debugStarsAhead')!;
    private debugStarsBehindEl = document.getElementById('debugStarsBehind')!;
    private debugDistantStarsEl = document.getElementById('debugDistantStars')!;
    private debugTotalStarsEl = document.getElementById('debugTotalStars')!;
    private debugShipSpeedEl = document.getElementById('debugShipSpeed')!;
    private boostLabel: HTMLDivElement;
    private flowLabel: HTMLDivElement;
    private instructionLabel: HTMLDivElement;
    private raceInfoEl: HTMLElement | null = null;
    private racePositionEl: HTMLElement | null = null;
    private lastLapTimeEl: HTMLElement | null = null;
    private pausedLabelEl: HTMLElement | null = null;

    constructor() {
        // Initialize speedometer gauge
        this.speedometerGauge = new SpeedometerGauge('speedometerCanvas');

        // Get label elements
        this.boostLabel = document.querySelector('.speedometer-container .boost-label')! as HTMLDivElement;
        this.flowLabel = document.querySelector('.speedometer-container .flow-label')! as HTMLDivElement;
        this.instructionLabel = document.querySelector('.speedometer-container .instruction-label')! as HTMLDivElement;

        // Get race info elements
        this.raceInfoEl = document.getElementById('raceInfo');
        this.racePositionEl = document.getElementById('racePosition');
        this.lastLapTimeEl = document.getElementById('lastLapTime');
        this.pausedLabelEl = document.getElementById('pausedLabel');

        // Log if elements are not found (for debugging)
        if (!this.raceInfoEl) {
            console.warn('raceInfo element not found in DOM');
        }
        if (!this.racePositionEl) {
            console.warn('racePosition element not found in DOM');
        }
        if (!this.lastLapTimeEl) {
            console.warn('lastLapTime element not found in DOM');
        }
    }

    private started = false;

    setStarted(v: boolean) {
        this.started = v;
        if (v) {
            this.startEl.classList.remove('visible');
            this.startEl.classList.add('hidden');
        }
    }

    setHudVisible(visible: boolean) {
        const speedometerContainer = document.querySelector('.speedometer-container');
        if (speedometerContainer) {
            if (visible) {
                speedometerContainer.classList.remove('hidden');
                speedometerContainer.classList.add('visible');
            } else {
                speedometerContainer.classList.remove('visible');
                speedometerContainer.classList.add('hidden');
            }
        }
    }

    update(state: ShipState, focusRefillActive: boolean, focusRefillProgress: number, boostRechargeDelay: number = 0) {
        // Update speedometer gauge with all values including lap info
        this.speedometerGauge.setValues(state.speedKmh, state.boostLevel, state.flow, state.lapCurrent, state.lapTotal);

        // Update focus refill state
        this.speedometerGauge.setFocusRefill(focusRefillActive, focusRefillProgress);

        // Update label visibility
        // Show BOOST label when boost is active
        if (state.boosting) {
            this.boostLabel.classList.remove('hidden');
            // When flow is maxed, raise BOOST higher
            if (state.flow >= 0.95) {
                this.boostLabel.classList.add('higher');
            } else {
                this.boostLabel.classList.remove('higher');
            }
        } else {
            this.boostLabel.classList.add('hidden');
            this.boostLabel.classList.remove('higher');
        }

        // Show MAX FLOW label when flow is nearly full
        if (state.flow >= 0.95) {
            this.flowLabel.classList.remove('hidden');
            this.instructionLabel.classList.remove('hidden');
        } else {
            this.flowLabel.classList.add('hidden');
            this.instructionLabel.classList.add('hidden');
        }

        // keep splash text steady; no jiggle
        if (!this.started) {
            (this.startEl.firstElementChild as HTMLElement).style.transform = 'none';
        }
    }

    onRadioToggle(handler: () => void) {
        this.radioToggle.addEventListener('click', handler);
    }


    onRadioVolume(handler: (v: number) => void) {
        // Legacy handler for radio-only volume (if still needed)
        // Try to get radioVol element if it exists (it may not after refactoring)
        const radioVolEl = document.getElementById('radioVol');
        if (radioVolEl) {
            this.radioVol = radioVolEl as HTMLInputElement;
            this.radioVol.addEventListener('input', () => {
                const value = parseFloat(this.radioVol!.value);
                if (this.volumeFill) {
                    this.updateVolumeFill(value);
                }
                handler(value);
            });
        }
    }

    onUnifiedVolume(handler: (v: number) => void) {
        this.unifiedVol.addEventListener('input', () => {
            const value = parseFloat(this.unifiedVol.value);
            this.updateUnifiedVolumeFill(value);
            handler(value);
        });
    }

    setUnifiedVolumeSlider(v: number) {
        this.unifiedVol.value = String(v);
        this.updateUnifiedVolumeFill(v);
    }

    private updateUnifiedVolumeFill(v: number) {
        this.unifiedVolumeFill.style.width = `${v * 100}%`;
    }

    setRadioUi(isOn: boolean, stationName: string) {
        this.radioToggle.classList.toggle('on', isOn);
        this.radioStation.textContent = stationName;

        // Hide/show volume control based on radio state
        const volumeControl = this.radioMode.querySelector('.volume-control');
        if (volumeControl) {
            if (isOn) {
                volumeControl.classList.remove('hidden');
            } else {
                volumeControl.classList.add('hidden');
            }
        }
    }

    // Tab switching
    onTabSwitch(handler: (mode: 'radio' | 'mp3') => void) {
        this.radioTab.addEventListener('click', () => handler('radio'));
        this.mp3Tab.addEventListener('click', () => handler('mp3'));
    }

    setActiveTab(mode: 'radio' | 'mp3') {
        // Remove active class from both modes first
        this.radioMode.classList.remove('active');
        this.mp3Mode.classList.remove('active');

        if (mode === 'radio') {
            this.radioTab.classList.add('active');
            this.mp3Tab.classList.remove('active');
            this.radioMode.classList.add('active');
        } else {
            this.mp3Tab.classList.add('active');
            this.radioTab.classList.remove('active');
            this.mp3Mode.classList.add('active');
        }
    }

    // MP3 controls
    onMp3Control(control: 'play' | 'pause' | 'prev' | 'next' | 'track', handler: () => void) {
        if (control === 'play' || control === 'pause') {
            this.mp3PlayPauseBtn.addEventListener('click', handler);
        } else if (control === 'prev') {
            this.mp3PrevBtn.addEventListener('click', handler);
        } else if (control === 'next') {
            this.mp3NextBtn.addEventListener('click', handler);
        }
    }

    onMp3TrackClick(handler: (index: number) => void) {
        // Will be set up after track list is populated
        this.mp3TrackList.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('mp3-track-item')) {
                const index = parseInt(target.getAttribute('data-index') || '0', 10);
                handler(index);
            }
        });
    }

    updateMp3TrackList(tracks: Array<{ artist: string; song: string }>, currentIndex: number) {
        this.mp3TrackList.innerHTML = '';
        tracks.forEach((track, index) => {
            const item = document.createElement('div');
            item.className = 'mp3-track-item';
            if (index === currentIndex) {
                item.classList.add('active');
            }
            item.setAttribute('data-index', index.toString());
            item.textContent = `${track.artist} - ${track.song}`;
            this.mp3TrackList.appendChild(item);
        });
    }

    updateMp3Controls(playing: boolean, trackName: string) {
        this.mp3TrackName.textContent = trackName || '-';
        this.mp3PlayPauseBtn.textContent = playing ? '⏸' : '▶';
        if (playing) {
            this.mp3PlayPauseBtn.classList.add('active');
        } else {
            this.mp3PlayPauseBtn.classList.remove('active');
        }
    }

    onMp3Volume(handler: (v: number) => void) {
        // Legacy handler - now uses unified volume
        // Keep for backwards compatibility but route to unified
        this.onUnifiedVolume(handler);
    }

    setMp3VolumeSlider(v: number) {
        // Legacy setter - now uses unified volume
        this.setUnifiedVolumeSlider(v);
    }

    setRadioVolumeSlider(v: number) {
        // Legacy method - now routes to unified volume
        this.setUnifiedVolumeSlider(v);
    }

    private updateVolumeFill(v: number) {
        if (this.volumeFill) {
            this.volumeFill.style.width = `${v * 100}%`;
        }
    }

    setPaused(paused: boolean) {
        // Do not show the legacy pause menu. Only toggle the blue PAUSED label.
        if (this.pausedLabelEl) {
            if (paused) {
                this.pausedLabelEl.classList.remove('hidden');
                this.pausedLabelEl.classList.add('visible');
            } else {
                this.pausedLabelEl.classList.remove('visible');
                this.pausedLabelEl.classList.add('hidden');
            }
        }
        // Always hide old pause menu
        if (this.pauseMenuEl) {
            this.pauseMenuEl.classList.remove('visible');
            this.pauseMenuEl.classList.add('hidden');
        }
    }

    onRestartClick(handler: () => void) {
        const restartBtn = document.getElementById('restartBtn')! as HTMLButtonElement;
        restartBtn.addEventListener('click', handler);
    }

    onQuitClick(handler: () => void) {
        const quitBtn = document.getElementById('quitBtn')! as HTMLButtonElement;
        quitBtn.addEventListener('click', handler);
    }

    onControlsClick(handler: () => void) {
        const controlsBtn = document.getElementById('controlsBtn')! as HTMLButtonElement;
        controlsBtn.addEventListener('click', handler);
    }

    onBackToPauseClick(handler: () => void) {
        const backBtn = document.getElementById('backToPauseBtn')! as HTMLButtonElement;
        backBtn.addEventListener('click', handler);
    }

    showControlsMenu() {
        this.pauseMenuEl.classList.remove('visible');
        this.pauseMenuEl.classList.add('hidden');
        this.controlsMenuEl.classList.remove('hidden');
        this.controlsMenuEl.classList.add('visible');
    }

    showPauseMenu() {
        this.controlsMenuEl.classList.remove('visible');
        this.controlsMenuEl.classList.add('hidden');
        this.pauseMenuEl.classList.remove('hidden');
        this.pauseMenuEl.classList.add('visible');
    }

    showCountdown(number: number) {
        this.countdownTextEl.textContent = number.toString();
        this.countdownTextEl.classList.remove('go');
        this.countdownEl.classList.remove('hidden');
        this.countdownEl.classList.add('visible');
    }

    showGo() {
        this.countdownTextEl.textContent = 'GO!';
        this.countdownTextEl.classList.add('go');
        this.countdownEl.classList.remove('hidden');
        this.countdownEl.classList.add('visible');
    }

    hideCountdown() {
        this.countdownEl.classList.remove('visible');
        this.countdownEl.classList.add('hidden');
    }

    updateDebugOverlay(gameTime: number, starsAhead: number, starsBehind: number, distantStars: number, totalStars: number, shipSpeed: number) {
        if (this.debugGameTimeEl) {
            this.debugGameTimeEl.textContent = gameTime.toFixed(1);
        }
        if (this.debugStarsAheadEl) {
            this.debugStarsAheadEl.textContent = starsAhead.toString();
        }
        if (this.debugStarsBehindEl) {
            this.debugStarsBehindEl.textContent = starsBehind.toString();
        }
        if (this.debugDistantStarsEl) {
            this.debugDistantStarsEl.textContent = distantStars.toString();
        }
        if (this.debugTotalStarsEl) {
            this.debugTotalStarsEl.textContent = totalStars.toString();
        }
        if (this.debugShipSpeedEl) {
            this.debugShipSpeedEl.textContent = shipSpeed.toFixed(1);
        }
    }

    updateRaceInfo(position: number, lastLapTime: number, totalRacers: number) {
        // Ensure elements are found (retry if needed)
        if (!this.racePositionEl) {
            this.racePositionEl = document.getElementById('racePosition');
        }
        if (!this.lastLapTimeEl) {
            this.lastLapTimeEl = document.getElementById('lastLapTime');
        }
        if (!this.raceInfoEl) {
            this.raceInfoEl = document.getElementById('raceInfo');
        }

        // Ensure race info container is visible
        if (this.raceInfoEl && this.raceInfoEl.classList.contains('hidden')) {
            this.raceInfoEl.classList.remove('hidden');
            this.raceInfoEl.classList.add('visible');
        }

        if (this.racePositionEl) {
            // Ensure position is valid (handle undefined, null, NaN)
            const safePosition = (position !== undefined && position !== null && !isNaN(position))
                ? Math.floor(Math.max(1, position))
                : 1;
            const safeTotal = (totalRacers !== undefined && totalRacers !== null && !isNaN(totalRacers))
                ? Math.floor(Math.max(1, totalRacers))
                : 5;
            const formatted = this.formatPosition(safePosition, safeTotal);

            // Always update the text content directly (don't check if it changed)
            this.racePositionEl.textContent = formatted;
        }

        if (this.lastLapTimeEl) {
            if (lastLapTime > 0) {
                this.lastLapTimeEl.textContent = this.formatTime(lastLapTime);
            } else {
                this.lastLapTimeEl.textContent = '-';
            }
        }
    }

    setRaceInfoVisible(visible: boolean) {
        // Ensure element is found (retry if needed)
        if (!this.raceInfoEl) {
            this.raceInfoEl = document.getElementById('raceInfo');
        }
        if (!this.racePositionEl) {
            this.racePositionEl = document.getElementById('racePosition');
        }
        if (!this.lastLapTimeEl) {
            this.lastLapTimeEl = document.getElementById('lastLapTime');
        }

        if (this.raceInfoEl) {
            if (visible) {
                this.raceInfoEl.classList.remove('hidden');
                this.raceInfoEl.classList.add('visible');
                // Don't overwrite existing values - let updateRaceInfo maintain them
                // Only initialize if elements are completely empty
                if (this.racePositionEl && (!this.racePositionEl.textContent || this.racePositionEl.textContent.trim() === '')) {
                    this.racePositionEl.textContent = '1/5';
                }
                if (this.lastLapTimeEl && (!this.lastLapTimeEl.textContent || this.lastLapTimeEl.textContent.trim() === '')) {
                    this.lastLapTimeEl.textContent = '-';
                }
            } else {
                this.raceInfoEl.classList.remove('visible');
                this.raceInfoEl.classList.add('hidden');
            }
        }
    }

    private formatPosition(position: number, totalRacers: number): string {
        return `${position}/${totalRacers}`;
    }

    private formatTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
    }

    initializeMinimap(track: Track) {
        if (!this.minimapGauge) {
            try {
                this.minimapGauge = new MinimapGauge('minimapCanvas', track);
            } catch (error) {
                console.warn('Failed to initialize minimap:', error);
            }
        }
    }

    updateMinimap(playerState: ShipState, npcStates: Array<{ state: ShipState; color: string }>) {
        if (this.minimapGauge) {
            this.minimapGauge.updateShips(playerState, npcStates);
        }
    }

    setMinimapVisible(visible: boolean) {
        const minimapContainer = document.querySelector('.minimap-container');
        if (minimapContainer) {
            if (visible) {
                minimapContainer.classList.remove('hidden');
                minimapContainer.classList.add('visible');
            } else {
                minimapContainer.classList.remove('visible');
                minimapContainer.classList.add('hidden');
            }
        } else {
            console.warn('Minimap container not found in DOM');
        }
    }

}


