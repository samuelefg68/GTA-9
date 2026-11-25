import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const game = new Game();
const play = $('btn-play');

try {
  await game.init();
  play.disabled = false;
  play.textContent = 'JOGAR';
  play.addEventListener('click', () => game.start());
  $('btn-resume').addEventListener('click', () => game.resume());
  $('btn-restart').addEventListener('click', () => game.restart());
} catch (err) {
  console.error(err);
  play.textContent = 'Erro ao carregar — veja o console';
}