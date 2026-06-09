// village.js — Dörfer: Gebäude, Vorräte, Jobverteilung
import { uid, pick, chance, genVillageName, clamp } from './util.js';
import { T, TILE } from './world.js';

export const BUILDINGS = {
  feuer:  { label: 'das Lagerfeuer',  cost: {},                    color: '#e8923a', size: 0.5 },
  huette: { label: 'eine Hütte',      cost: { wood: 18 },          color: '#9a6a43', size: 0.92 },
  farm:   { label: 'eine Farm',       cost: { wood: 12 },          color: '#c9b458', size: 1.0 },
  brunnen:{ label: 'einen Brunnen',   cost: { stone: 14 },         color: '#8fa8b8', size: 0.6 },
  heiler: { label: 'eine Heilerhütte',cost: { wood: 22 },          color: '#7fbf7f', size: 0.92 },
  tempel: { label: 'einen Tempel',    cost: { wood: 24, stone: 16 }, color: '#cfc4e8', size: 1.1 },
};

const VILLAGE_COLORS = ['#4fc3f7', '#ffb74d', '#aed581', '#f06292', '#ba68c8', '#fff176', '#4db6ac', '#ff8a65'];
let colorIdx = 0;

export class Village {
  constructor(tx, ty, world) {
    this.id = uid();
    this.name = genVillageName();
    this.color = VILLAGE_COLORS[colorIdx++ % VILLAGE_COLORS.length];
    this.tx = tx; this.ty = ty;
    this.cx = tx * TILE + TILE / 2;
    this.cy = ty * TILE + TILE / 2;
    this.members = [];
    this.buildings = [];
    this.stock = { food: 14, wood: 6, stone: 0 };
    this.relations = new Map(); // villageId -> -100..100
    this.leader = null;
    this.foundedYear = 0;
    this.warCooldown = 0;
    this.place(world, 'feuer', tx, ty);
  }

  relTo(v) { return this.relations.get(v.id) ?? 0; }
  bumpRel(v, d) {
    this.relations.set(v.id, clamp(this.relTo(v) + d, -100, 100));
  }

  get pop() { return this.members.length; }
  get adults() { return this.members.filter(p => p.isAdult); }

  countDone(type) { return this.buildings.filter(b => b.type === type && b.progress >= 1).length; }
  countAll(type) { return this.buildings.filter(b => b.type === type).length; }
  unfinished() { return this.buildings.find(b => b.progress < 1); }
  workableFarm() { return this.buildings.find(b => b.type === 'farm' && b.progress >= 1); }
  freeHut() {
    const huts = this.buildings.filter(b => b.type === 'huette' && b.progress >= 1);
    return huts.length ? pick(huts) : null;
  }

  place(world, type, tx, ty) {
    const def = BUILDINGS[type];
    const b = { id: uid(), type, label: def.label, x: tx, y: ty, progress: type === 'feuer' ? 1 : 0, hp: 100 };
    this.buildings.push(b);
    world.buildAt.set(tx + ',' + ty, b);
    return b;
  }

  removeBuilding(world, b) {
    world.buildAt.delete(b.x + ',' + b.y);
    const i = this.buildings.indexOf(b);
    if (i >= 0) this.buildings.splice(i, 1);
  }

  findBuildSpot(world) {
    return world.findNear(this.tx, this.ty, 9, (x, y, i) => {
      if (world.tiles[i] !== T.GRASS && world.tiles[i] !== T.SAND) return false;
      if (world.buildAt.has(x + ',' + y)) return false;
      // nicht direkt am Feuer kleben
      return Math.abs(x - this.tx) + Math.abs(y - this.ty) >= 2;
    });
  }

  canAfford(type) {
    const c = BUILDINGS[type].cost;
    return (c.wood || 0) <= this.stock.wood && (c.stone || 0) <= this.stock.stone;
  }

  pay(type) {
    const c = BUILDINGS[type].cost;
    this.stock.wood -= c.wood || 0;
    this.stock.stone -= c.stone || 0;
  }

  // tägliche Bau-Planung: was braucht das Dorf?
  planConstruction(world, sim) {
    if (this.unfinished()) return;
    const want = [];
    const hutCap = this.countAll('huette') * 3;
    if (this.pop > hutCap) want.push('huette');
    if (this.countAll('farm') < Math.ceil(this.pop / 7)) want.push('farm');
    if (this.pop >= 8 && this.countAll('brunnen') < 1) want.push('brunnen');
    if (this.pop >= 10 && this.countAll('heiler') < 1) want.push('heiler');
    if (this.pop >= 12 && this.countAll('tempel') < 1) want.push('tempel');
    for (const type of want) {
      if (!this.canAfford(type)) continue;
      const spot = this.findBuildSpot(world);
      if (!spot) continue;
      this.pay(type);
      this.place(world, type, spot.x, spot.y);
      sim.event(`🏗️ ${this.name} beginnt den Bau: ${BUILDINGS[type].label}.`, this);
      return;
    }
  }

  // Jobverteilung anhand Bedarf
  assignJobs() {
    const adults = this.adults;
    if (!adults.length) return;
    // Anführer: höchstes Charisma
    if (!this.leader || this.leader.dead || !adults.includes(this.leader)) {
      this.leader = adults.reduce((a, b) => (b.skills.charisma > a.skills.charisma ? b : a), adults[0]);
    }
    const n = adults.length;
    const wants = [];
    wants.push(['anfuehrer', 1]);
    const farms = this.countDone('farm');
    wants.push(['bauer', Math.min(farms, Math.ceil(n / 5))]);
    wants.push(['sammler', Math.max(1, Math.round(n * (farms ? 0.2 : 0.4)))]);
    wants.push(['holz', Math.max(1, Math.round(n * 0.22))]);
    wants.push(['baumeister', n >= 3 ? Math.max(1, Math.round(n * 0.15)) : 0]);
    if (this.countDone('heiler') > 0) wants.push(['heiler', 1]);
    if (n >= 7) wants.push(['wache', Math.round(n * 0.12)]);
    if (this.countDone('tempel') > 0) wants.push(['priester', 1]);

    const skillFor = (p, job) => ({
      bauer: p.skills.farm, sammler: p.skills.farm, holz: p.skills.wood,
      baumeister: p.skills.build, heiler: p.skills.heal, wache: p.skills.fight,
      priester: (p.has('fromm') ? 5 : 0) + p.skills.charisma, anfuehrer: p.skills.charisma,
    }[job] || 0);

    const pool = new Set(adults);
    // Anführer fix
    this.leader.job = 'anfuehrer';
    pool.delete(this.leader);
    for (const [job, count] of wants) {
      if (job === 'anfuehrer') continue;
      for (let k = 0; k < count && pool.size; k++) {
        let best = null, bs = -1;
        for (const p of pool) {
          const s = skillFor(p, job) + (p.job === job ? 1.5 : 0); // Job-Treue
          if (s > bs) { bs = s; best = p; }
        }
        best.job = job;
        pool.delete(best);
      }
    }
    for (const p of pool) p.job = 'sammler';
    for (const p of this.members) if (p.isChild) p.job = 'kind';
  }
}
