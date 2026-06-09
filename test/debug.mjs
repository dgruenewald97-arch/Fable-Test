// debug.mjs — Zustands-Zensus: was tun die Leute den ganzen Tag?
import { Sim, TPD } from '../js/systems.js';

const fakeBrain = {
  connected: false, onStatus: null,
  requestThought(p) {},
  requestDialogue(a, b, sim, done) { done(null, 1, false); },
  requestWarDecision(l, v, t, sim, done) { done(false, '', false); },
  requestRumor(p, ev, target, sim, done) { done('x', false); },
  requestWhisperReaction(p, t, s, done) { done('x', false); },
};

const sim = new Sim(fakeBrain);
sim.start();

const census = {}; // job -> state -> ticks
for (let t = 0; t < TPD * 8; t++) {
  sim.update();
  if (t % 7 === 0) {
    for (const p of sim.people) {
      const j = p.job, s = p.state;
      census[j] = census[j] || {};
      census[j][s] = (census[j][s] || 0) + 1;
    }
  }
}
for (const [job, states] of Object.entries(census)) {
  const total = Object.values(states).reduce((a, b) => a + b, 0);
  const top = Object.entries(states).sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s}:${Math.round(n / total * 100)}%`).join(' ');
  console.log(job.padEnd(12), top);
}
const v = sim.villages[0];
if (v) console.log('\nVorräte:', JSON.stringify(v.stock), '| Gebäude:', v.buildings.map(b => b.type + '@' + b.progress.toFixed(2)).join(', '));
const lj = sim.people.find(p => p.job === 'holz');
if (lj) console.log('Holzfäller-Beispiel:', lj.name, 'state=', lj.state, 'carry=', JSON.stringify(lj.carry), 'workTile=', JSON.stringify(lj.workTile), 'pos=', Math.round(lj.x / 12) + ',' + Math.round(lj.y / 12));
