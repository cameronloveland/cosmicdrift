import { ShipState } from './types';

export class UI {
    private speedEl = document.getElementById('speed')!;
    private lapEl = document.getElementById('lap')!;
    private flowBar = document.getElementById('flowBar')! as HTMLDivElement;
    private startEl = document.getElementById('start')!;
    private started = false;

    setStarted(v: boolean) {
        this.started = v;
        if (v) this.startEl.classList.add('hidden');
    }

    update(state: ShipState) {
        const speed = Math.round(state.speedKmh);
        this.speedEl.textContent = `${speed} KM/H`;
        this.lapEl.textContent = `LAP 1/3`;
        this.flowBar.style.width = `${Math.round(state.flow * 100)}%`;
        // pulse title subtly by flow if visible
        if (!this.started) {
            const t = performance.now() * 0.002;
            const s = 1 + Math.sin(t) * 0.02;
            (this.startEl.firstElementChild as HTMLElement).style.transform = `scale(${s})`;
        }
    }
}


