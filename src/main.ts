import { Game } from './core/Game';

// Wait for DOM to be ready
function initGame() {
    const app = document.getElementById('app')!;
    const game = new Game(app);

}

// Try multiple approaches to ensure DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGame);
} else {
    // DOM is already ready
    initGame();
}


