import { Game } from './core/Game';

// Wait for DOM to be ready
function initGame() {
    const app = document.getElementById('app')!;
    const game = new Game(app);

    // Expose for quick debugging in devtools
    // @ts-expect-error
    window.__game = game;
}

// Try multiple approaches to ensure DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGame);
} else {
    // DOM is already ready
    initGame();
}


