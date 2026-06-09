// util.js — Zufall, Noise, Namen, Vokabular
let _uid = 1;
export const uid = () => _uid++;
export const R = (a, b) => a + Math.random() * (b - a);
export const RI = (a, b) => Math.floor(R(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const chance = p => Math.random() < p;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

// deterministisches Value-Noise
export function makeNoise(seed) {
  const hash = (x, y) => {
    let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const smooth = t => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
  }
  return (x, y, oct = 4) => {
    let v = 0, amp = 1, freq = 1, max = 0;
    for (let o = 0; o < oct; o++) {
      v += noise(x * freq, y * freq) * amp;
      max += amp; amp *= 0.5; freq *= 2;
    }
    // Oktaven-Mittel drückt alles Richtung 0.5 — Kontrast wieder aufspreizen
    return clamp((v / max - 0.5) * 1.9 + 0.5, 0, 1);
  };
}

const M_NAMES = ['Albrecht','Bruno','Conrad','Dieter','Emil','Falk','Gerold','Hagen','Ingo','Jorin','Karl','Lothar','Magnus','Norbert','Odo','Ralf','Sigurd','Tassilo','Ulrich','Veit','Wolf','Anselm','Bertram','Gunnar','Erwin','Helmut','Otto','Friedrich'];
const F_NAMES = ['Ada','Berta','Clara','Dorothea','Elsa','Frieda','Gerda','Hilda','Ida','Johanna','Klara','Lene','Mathilde','Nora','Ottilie','Runa','Selma','Thea','Ulla','Wilma','Agnes','Edith','Greta','Helga','Irmgard','Liesel'];
const V_PRE = ['Eichen','Fluss','Stein','Wolfs','Birken','Nebel','Sonnen','Raben','Linden','Moor','Hirsch','Adler','Tannen','Mühl','Salz','Bären'];
const V_SUF = ['heim','dorf','furt','bach','stedt','hagen','feld','brück','walde','hof','grund'];

const usedNames = new Set();
export function genPersonName(gender) {
  const pool = gender === 'm' ? M_NAMES : F_NAMES;
  for (let i = 0; i < 40; i++) {
    const n = pick(pool);
    if (!usedNames.has(n)) { usedNames.add(n); return n; }
  }
  return pick(pool) + ' ' + RI(2, 9) + '.';
}
const usedVillages = new Set();
export function genVillageName() {
  for (let i = 0; i < 60; i++) {
    const n = pick(V_PRE) + pick(V_SUF);
    if (!usedVillages.has(n)) { usedVillages.add(n); return n; }
  }
  return pick(V_PRE) + pick(V_SUF);
}

export const TRAITS = ['mutig','ängstlich','fleißig','faul','fromm','skeptisch','neugierig','misstrauisch','gesellig','einzelgängerisch','aggressiv','friedfertig','ehrgeizig','bescheiden','abergläubisch','charismatisch'];
export function pickTraits() {
  const t = new Set();
  while (t.size < 3) t.add(pick(TRAITS));
  return [...t];
}

export const JOB_LABEL = {
  sammler: 'Sammler', holz: 'Holzfäller', bauer: 'Bauer', baumeister: 'Baumeister',
  heiler: 'Heiler', wache: 'Wache', priester: 'Priester', anfuehrer: 'Anführer', kind: 'Kind', keiner: 'ohne Aufgabe'
};
