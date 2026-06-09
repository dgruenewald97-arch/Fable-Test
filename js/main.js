// main.js — Startpunkt und Hauptschleife
import { Brain } from './brain.js';
import { Sim } from './systems.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { pick, chance } from './util.js';

const brain = new Brain();
const sim = new Sim(brain);
const renderer = new Renderer(document.getElementById('map'));
const ui = new UI(sim, renderer, brain);

sim.start();
brain.connect().then(ok => {
  ui.renderModelSelect();
  if (!ok) document.getElementById('settings').classList.add('open');
});

// KI-Gedanken-Taktung (Echtzeit, unabhängig vom Sim-Tempo):
// bevorzugt die ausgewählte Person, sonst wichtige/auffällige Leute
setInterval(() => {
  if (ui.paused || !sim.people.length) return;
  let p = null;
  if (ui.selected && ui.selected.currentThought !== undefined && !ui.selected.dead && chance(0.6)) {
    p = ui.selected;
  } else {
    const important = sim.people.filter(q =>
      q.job === 'anfuehrer' || q.job === 'priester' || q.disease === 'sick' || q.beliefs.length > 0);
    p = (important.length && chance(0.6)) ? pick(important) : pick(sim.people);
  }
  if (p && p.isAdult !== false) brain.requestThought(p, sim);
}, 4500);

// Hauptschleife
function loop() {
  if (!ui.paused) {
    for (let i = 0; i < ui.speed; i++) sim.update();
  }
  renderer.draw(sim, ui);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Panels seltener aktualisieren als die Karte
setInterval(() => ui.refresh(), 400);

window.GENESIS = { sim, brain, ui }; // für Neugierige in der Konsole
