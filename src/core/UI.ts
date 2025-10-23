import { ShipState } from './types';
import { SpeedometerGauge } from './SpeedometerGauge';

export class UI {
    private speedometerGauge: SpeedometerGauge;
    private startEl = document.getElementById('start')!;
    private pauseMenuEl = document.getElementById('pauseMenu')!;
    private controlsMenuEl = document.getElementById('controlsMenu')!;
    private countdownEl = document.getElementById('countdown')!;
    private countdownTextEl = document.getElementById('countdownText')!;
    private radioRoot = document.getElementById('radio')!;
    private radioToggle = document.getElementById('radioToggle')! as HTMLButtonElement;
    private radioStation = document.getElementById('radioStation')! as HTMLDivElement;
    private radioVol = document.getElementById('radioVol')! as HTMLInputElement;
    private radioPrev = document.getElementById('radioPrev')! as HTMLButtonElement;
    private radioNext = document.getElementById('radioNext')! as HTMLButtonElement;

    constructor() {
        // Initialize speedometer gauge
        this.speedometerGauge = new SpeedometerGauge('speedometerCanvas');
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

    update(state: ShipState) {
        // Update speedometer gauge with all values including lap info
        this.speedometerGauge.setValues(state.speedKmh, state.boostLevel, state.flow, state.lapCurrent, state.lapTotal);

        // keep splash text steady; no jiggle
        if (!this.started) {
            (this.startEl.firstElementChild as HTMLElement).style.transform = 'none';
        }
    }

    onRadioToggle(handler: () => void) {
        this.radioToggle.addEventListener('click', handler);
    }

    onRadioPrev(handler: () => void) {
        this.radioPrev.addEventListener('click', handler);
    }

    onRadioNext(handler: () => void) {
        this.radioNext.addEventListener('click', handler);
    }

    onRadioVolume(handler: (v: number) => void) {
        this.radioVol.addEventListener('input', () => handler(parseFloat(this.radioVol.value)));
    }

    setRadioUi(isOn: boolean, stationName: string) {
        this.radioToggle.textContent = isOn ? 'ON' : 'OFF';
        this.radioToggle.classList.toggle('on', isOn);
        this.radioToggle.classList.toggle('off', !isOn);
        this.radioStation.textContent = stationName;
    }

    setRadioVolumeSlider(v: number) {
        this.radioVol.value = String(v);
    }

    setPaused(paused: boolean) {
        if (paused) {
            this.pauseMenuEl.classList.remove('hidden');
            this.pauseMenuEl.classList.add('visible');
        } else {
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

}


