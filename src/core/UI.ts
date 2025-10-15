import { ShipState } from './types';

export class UI {
    private speedEl = document.getElementById('speed')!;
    private lapEl = document.getElementById('lap')!;
    private boostBar = document.getElementById('boostBar')! as HTMLDivElement;
    private startEl = document.getElementById('start')!;
    private radioRoot = document.getElementById('radio')!;
    private radioToggle = document.getElementById('radioToggle')! as HTMLButtonElement;
    private radioStation = document.getElementById('radioStation')! as HTMLDivElement;
    private radioVol = document.getElementById('radioVol')! as HTMLInputElement;
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
        this.boostBar.style.width = `${Math.round(state.flow * 100)}%`;
        // pulse title subtly by flow if visible
        if (!this.started) {
            const t = performance.now() * 0.002;
            const s = 1 + Math.sin(t) * 0.02;
            (this.startEl.firstElementChild as HTMLElement).style.transform = `scale(${s})`;
        }
    }

    onRadioToggle(handler: () => void) {
        this.radioToggle.addEventListener('click', handler);
    }

    onRadioVolume(handler: (v: number) => void) {
        this.radioVol.addEventListener('input', () => handler(parseFloat(this.radioVol.value)));
    }

    setRadioUi(isPlaying: boolean, stationName: string) {
        this.radioToggle.textContent = isPlaying ? 'PAUSE' : 'PLAY';
        this.radioToggle.classList.toggle('playing', isPlaying);
        this.radioToggle.classList.toggle('paused', !isPlaying);
        this.radioStation.textContent = stationName;
    }

    setRadioVolumeSlider(v: number) {
        this.radioVol.value = String(v);
    }
}


