import type { NewsItem } from './news';

type Action = 'race' | 'controls' | 'build-ship' | 'restart' | 'quit';

export class MainMenu {
    private root: HTMLElement;
    private newsTrack: HTMLElement;
    private viewport: HTMLElement;
    private mode: 'main' | 'pause' = 'main';
    private callbacks: Record<Action, Array<() => void>> = {
        race: [],
        controls: [],
        'build-ship': [],
        restart: [],
        quit: []
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
        this.setMode('main');
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
            // Hide newsfeed when ship viewer is active
            const newsFeed = document.getElementById('newsFeed');
            if (newsFeed) {
                (newsFeed as HTMLElement).style.display = 'none';
            }
        } else {
            this.root.classList.remove('viewer-active');
            this.viewport.style.display = 'none';
            // Show newsfeed when ship viewer is inactive
            const newsFeed = document.getElementById('newsFeed');
            if (newsFeed) {
                (newsFeed as HTMLElement).style.display = 'flex';
            }
        }
    }

    setMode(mode: 'main' | 'pause') {
        if (this.mode === mode) return;
        this.mode = mode;
        // Update subtitle label
        const subtitle = this.root.querySelector('.menu-subtitle');
        if (subtitle) subtitle.textContent = mode === 'pause' ? 'PAUSE MENU' : 'MAIN MENU';
        this.renderMenuItems();
        // Ensure viewer overlay is off in pause mode
        if (mode === 'pause') this.showViewerOverlay(false);
    }

    private renderMenuItems() {
        const list = this.root.querySelector('#menuItems') as HTMLElement | null;
        if (!list) return;
        if (this.mode === 'pause') {
            list.innerHTML = [
                `<li class="menu-item" data-action="controls">CONTROLS</li>`,
                `<li class="menu-item" data-action="restart">RESTART RACE</li>`,
                `<li class="menu-item" data-action="quit">QUIT GAME</li>`
            ].join('');
        } else {
            list.innerHTML = [
                `<li class="menu-item" data-action="race">RACE</li>`,
                `<li class="menu-item" data-action="build-ship">SHIP</li>`,
                `<li class="menu-item" data-action="controls">CONTROLS</li>`,
                `<li class="menu-item disabled" data-action="multiplayer" aria-disabled="true">MULTIPLAYER</li>`,
                `<li class="menu-item disabled" data-action="leaderboards" aria-disabled="true">LEADERBOARDS</li>`
            ].join('');
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
        this.callbacks = { race: [], controls: [], 'build-ship': [], restart: [], quit: [] };
    }
}


