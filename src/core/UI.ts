import { ShipState } from './types';

export class UI {
    private speedEl = document.getElementById('speed')!;
    private lapEl = document.getElementById('lap')!;
    private flowBar = document.getElementById('flowBar')! as HTMLDivElement;
    private boostBar = document.getElementById('boostBar')! as HTMLDivElement;
    private startEl = document.getElementById('start')!;
    private pauseText = document.getElementById('pauseText')!;
    private radioRoot = document.getElementById('radio')!;
    private radioToggle = document.getElementById('radioToggle')! as HTMLButtonElement;
    private radioStation = document.getElementById('radioStation')! as HTMLDivElement;
    private radioVol = document.getElementById('radioVol')! as HTMLInputElement;
    private radioPrev = document.getElementById('radioPrev')! as HTMLButtonElement;
    private radioNext = document.getElementById('radioNext')! as HTMLButtonElement;
    private started = false;

    setStarted(v: boolean) {
        this.started = v;
        if (v) {
            this.startEl.classList.remove('visible');
            this.startEl.classList.add('hidden');
        }
    }

    update(state: ShipState) {
        const speed = Math.round(state.speedKmh);
        this.speedEl.textContent = `${speed} KM/H`;
        this.lapEl.textContent = `LAP ${state.lapCurrent}/${state.lapTotal}`;
        this.flowBar.style.width = `${Math.round(state.flow * 100)}%`;
        this.boostBar.style.width = `${Math.round(state.boostLevel * 100)}%`;
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
            this.pauseText.classList.remove('hidden');
            this.pauseText.classList.add('visible');
        } else {
            this.pauseText.classList.remove('visible');
            this.pauseText.classList.add('hidden');
        }
    }
}


