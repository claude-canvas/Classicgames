// main.js
// Entry point. Boots the game once the page has loaded.

window.addEventListener('load', () => {
  const canvas = document.getElementById('game-canvas');
  const game = new Game(canvas);
  game.start();
});
