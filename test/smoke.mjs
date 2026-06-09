// smoke.mjs — Headless-Test: Welt 20 Tage laufen lassen (ohne Browser, mit Fake-KI)
import { Sim, TPD } from '../js/systems.js';

// Fake-Gehirn: ruft sofort die Fallbacks auf
const fakeBrain = {
  connected: false,
  onStatus: null,
  requestThought(p) { p.currentThought = '(fallback)'; },
  requestDialogue(a, b, sim, done) { done(null, Math.random() < 0.7 ? 1 : -1, false); },
  requestWarDecision(l, v, t, sim, done) { done(Math.random() < 0.3, '', false); },
  requestRumor(p, ev, target, sim, done) { done('Gerücht über: ' + ev, false); },
  requestWhisperReaction(p, text, sim, done) { done('Reaktion auf: ' + text, false); },
};

const sim = new Sim(fakeBrain);
sim.start();

const DAYS = 20;
for (let t = 0; t < TPD * DAYS; t++) sim.update();

const v = sim.villages;
const out = {
  tage: DAYS,
  jahr: sim.year,
  bevölkerung: sim.people.length,
  dörfer: v.length,
  gebäudeFertig: v.reduce((s, x) => s + x.buildings.filter(b => b.progress >= 1).length, 0),
  vorräte: v.map(x => ({ dorf: x.name, essen: Math.floor(x.stock.food), holz: Math.floor(x.stock.wood) })),
  gerüchte: sim.rumors.length,
  chronikEinträge: sim.chronicle.length,
};
console.log(JSON.stringify(out, null, 2));
console.log('\n--- Letzte Chronik-Einträge ---');
for (const e of sim.chronicle.slice(-14)) console.log(`${e.time}: ${e.text}`);

// Plausibilitäts-Checks
const fail = [];
if (sim.villages.length < 1) fail.push('kein Dorf gegründet');
if (sim.people.length < 3) fail.push('Bevölkerung fast ausgestorben: ' + sim.people.length);
if (out.gebäudeFertig < 2) fail.push('kaum Gebäude fertig: ' + out.gebäudeFertig);
const nan = sim.people.find(p => !isFinite(p.x) || !isFinite(p.hunger) || !isFinite(p.health));
if (nan) fail.push('NaN bei Person ' + nan.name);
if (fail.length) { console.error('\n❌ PROBLEME: ' + fail.join(' | ')); process.exit(1); }
console.log('\n✅ Smoke-Test bestanden');
