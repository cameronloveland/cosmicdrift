import { Game } from './core/Game';

const app = document.getElementById('app')!;
const game = new Game(app);

// Expose for quick debugging in devtools
// @ts-expect-error
window.__game = game;


