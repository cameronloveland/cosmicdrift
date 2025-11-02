import type { NewsItem } from './news';

type Action = 'race' | 'controls' | 'build-ship';

export class MainMenu {
    private root: HTMLElement;
    private newsTrack: HTMLElement;
    private viewport: HTMLElement;
    private callbacks: Record<Action, Array<() => void>> = {
        race: [],
        controls: [],
        'build-ship': []
    };
    private rafId: number | null = null;
    private scrolling = true;
    private scrollSpeed = 0.25; // px per frame (approx)
    private trackOffset = 0;

    constructor(opts: { news: NewsItem[] }) {
        const root = document.getElementById('mainMenu');
        const track = document.getElementById('newsTrack');
        const viewport = document.getElementById('menuViewport');
        if (!root || !track || !viewport) {
            throw new Error('MainMenu DOM containers missing');
        }
        this.root = root;
        this.newsTrack = track;
        this.viewport = viewport;

        this.bindMenuClicks();
        this.renderNews(opts.news);
        this.startNewsScroll();
    }

    on(action: Action, handler: () => void) {
        this.callbacks[action].push(handler);
    }

    show() { this.root.style.display = 'grid'; }
    hide() { this.root.style.display = 'none'; }

    setDisabled(items: Array<'multiplayer' | 'leaderboards'>) {
        items.forEach((key) => {
            const el = this.root.querySelector(`[data-action="${key}"]`);
            if (el) el.classList.add('disabled');
        });
    }

    showViewerOverlay(active: boolean) {
        if (active) {
            this.root.classList.add('viewer-active');
            this.viewport.style.display = 'block';
        } else {
            this.root.classList.remove('viewer-active');
            this.viewport.style.display = 'none';
        }
    }

    private bindMenuClicks() {
        const items = this.root.querySelector('#menuItems') as HTMLElement | null;
        if (!items) return;
        items.addEventListener('click', (e) => {
            const li = (e.target as HTMLElement).closest('.menu-item') as HTMLElement | null;
            if (!li) return;
            if (li.classList.contains('disabled')) return;
            const action = li.getAttribute('data-action') as Action | null;
            if (!action) return;
            this.callbacks[action].forEach((cb) => cb());
        });
    }

    private renderNews(items: NewsItem[]) {
        // Duplicate items to create a seamless scroll
        const list = [...items, ...items];
        this.newsTrack.innerHTML = '';
        list.forEach((n) => {
            const card = document.createElement('div');
            card.className = 'news-card';

            const img = document.createElement('img');
            img.src = n.image;
            img.alt = n.title;
            card.appendChild(img);

            const title = document.createElement('div');
            title.className = 'news-title';
            title.textContent = n.title;
            card.appendChild(title);

            const hover = document.createElement('div');
            hover.className = 'news-hover';
            hover.textContent = n.hoverText;
            card.appendChild(hover);

            card.addEventListener('mouseenter', () => this.scrolling = false);
            card.addEventListener('mouseleave', () => this.scrolling = true);

            this.newsTrack.appendChild(card);
        });
    }

    private startNewsScroll() {
        const step = () => {
            if (this.scrolling) {
                this.trackOffset -= this.scrollSpeed;
                // Wrap-around when fully shifted by half (since duplicated)
                const totalWidth = this.newsTrack.scrollWidth / 2;
                if (Math.abs(this.trackOffset) >= totalWidth) this.trackOffset = 0;
                (this.newsTrack.style as any).transform = `translateX(${this.trackOffset}px)`;
            }
            this.rafId = requestAnimationFrame(step);
        };
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(step);
    }

    dispose() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.newsTrack.innerHTML = '';
        this.callbacks = { race: [], controls: [], 'build-ship': [] };
    }
}


