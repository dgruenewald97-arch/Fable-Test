// agents.js — Menschen: Bedürfnisse, Verhalten, Gedächtnis, Beziehungen
import { uid, R, RI, pick, chance, clamp, dist, genPersonName, pickTraits, JOB_LABEL } from './util.js';
import { T, TILE, MAP_W, MAP_H } from './world.js';

export class Person {
  constructor(x, y, opts = {}) {
    this.id = uid();
    this.gender = opts.gender || pick(['m', 'w']);
    this.name = opts.name || genPersonName(this.gender);
    this.age = opts.age ?? R(17, 38);
    this.traits = opts.traits || pickTraits();
    this.skills = opts.skills || {
      farm: R(1, 7), wood: R(1, 7), build: R(1, 7),
      fight: R(1, 7), heal: R(1, 6), charisma: R(1, 9),
    };
    this.x = x; this.y = y;
    this.village = null;
    this.job = 'keiner';
    this.state = 'idle';
    this.dest = null; this.destAction = null;
    this.workTile = null;
    this.carry = { food: 0, wood: 0, stone: 0 };
    this.invFood = 1;

    this.hunger = R(15, 40);
    this.energy = R(60, 95);
    this.social = R(40, 90);
    this.health = 100;

    this.disease = 'none'; // none | sick | immune
    this.sickT = 0;
    this.healerNear = false;

    this.partner = null;   // Person-Id
    this.parents = opts.parents || [];
    this.relations = new Map(); // id -> score (-100..100)
    this.beliefs = [];          // Gerücht-Ids
    this.memories = [];
    this.currentThought = '';
    this.thoughtIsAI = false;
    this.bubble = null;         // {lines:[], i, t}
    this.talkPartner = null;
    this.talkT = 0;
    this.talkCooldown = 0;
    this.raidTarget = null;
    this.fleeT = 0;
    this.whisper = null;        // Gottes Einflüsterung
    this.dead = false;
  }

  get isAdult() { return this.age >= 15; }
  get isChild() { return this.age < 15; }
  get speed() {
    let s = 0.62;
    if (this.isChild) s *= 0.8;
    if (this.disease === 'sick') s *= 0.65;
    if (this.hunger > 90) s *= 0.7;
    return s;
  }
  get tileX() { return Math.floor(this.x / TILE); }
  get tileY() { return Math.floor(this.y / TILE); }

  has(trait) { return this.traits.includes(trait); }

  relTo(id) { return this.relations.get(id) ?? 0; }
  bumpRel(id, d) { this.relations.set(id, clamp(this.relTo(id) + d, -100, 100)); }

  addMemory(text, imp, tick) {
    this.memories.push({ t: tick, text, imp });
    if (this.memories.length > 42) {
      let mi = 0;
      for (let i = 1; i < this.memories.length - 20; i++)
        if (this.memories[i].imp < this.memories[mi].imp) mi = i;
      this.memories.splice(mi, 1);
    }
  }
  recentMemories(n = 5) {
    return [...this.memories].sort((a, b) => (b.imp + b.t * 0.0001) - (a.imp + a.t * 0.0001)).slice(0, n);
  }

  describe() {
    const v = this.village ? `aus dem Dorf ${this.village.name}` : 'ohne festes Dorf';
    return `${this.name} (${Math.floor(this.age)} Jahre, ${JOB_LABEL[this.job]}, ${v}; Charakter: ${this.traits.join(', ')})`;
  }

  // ---------- Bewegung ----------
  moveToward(px, py, world) {
    const d = dist(this.x, this.y, px, py);
    if (d < 3) return true;
    let ang = Math.atan2(py - this.y, px - this.x);
    const sp = this.speed;
    // Wasser/Gebäude ausweichen: Winkel probieren
    for (const off of [0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
      const a = ang + off;
      const nx = this.x + Math.cos(a) * sp * TILE * 0.8;
      const ny = this.y + Math.sin(a) * sp * TILE * 0.8;
      const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
      if (world.isLand(tx, ty)) {
        this.x = clamp(this.x + Math.cos(a) * sp, TILE, (MAP_W - 1) * TILE);
        this.y = clamp(this.y + Math.sin(a) * sp, TILE, (MAP_H - 1) * TILE);
        return false;
      }
    }
    return false;
  }

  goto(px, py, action) {
    this.dest = { x: px, y: py };
    this.destAction = action;
    this.state = 'goto';
  }

  // ---------- Haupt-Update (1 Tick) ----------
  update(sim) {
    const w = sim.world;

    // Bedürfnis-Drift
    this.hunger = clamp(this.hunger + 0.045, 0, 100);
    this.social = clamp(this.social - (this.has('gesellig') ? 0.034 : 0.022), 0, 100);
    if (this.state === 'sleep') this.energy = clamp(this.energy + 0.30, 0, 100);
    else this.energy = clamp(this.energy - 0.045, 0, 100);

    // Gesundheit
    if (this.hunger > 95) this.health -= 0.012;
    if (this.disease === 'sick') {
      this.sickT++;
      this.health -= this.healerNear ? 0.004 : 0.009;
      const dur = this.healerNear ? 2200 : 3400;
      if (this.sickT > dur) { this.disease = 'immune'; this.addMemory('Ich habe die Krankheit überlebt.', 8, sim.tick); }
    } else if (this.health < 100 && this.hunger < 75) this.health += 0.006;
    this.healerNear = false;
    if (this.health <= 0) { sim.kill(this, this.disease === 'sick' ? 'krankheit' : 'hunger'); return; }

    // Hunger-Notbremse: Arbeit/Wache/Schlaf unterbrechen, wenn Essen verfügbar ist
    if (this.hunger > 80 && (this.invFood >= 1 || (this.village && this.village.stock.food >= 1))) {
      const busy = ['gather_food', 'gather_wood', 'gather_stone', 'farm', 'build', 'guard', 'heal', 'wander', 'sleep'];
      if (busy.includes(this.state) || (this.state === 'goto' && this.destAction !== 'eat')) {
        this.state = 'idle'; this.dest = null;
      }
    }

    if (this.talkCooldown > 0) this.talkCooldown--;
    if (this.fleeT > 0) {
      this.fleeT--;
      if (this.fleeT === 0 && this.state === 'flee') this.state = 'idle';
    }
    if (this.bubble) {
      this.bubble.t--;
      if (this.bubble.t <= 0) {
        this.bubble.i++;
        if (this.bubble.i >= this.bubble.lines.length) this.bubble = null;
        else this.bubble.t = 200;
      }
    }

    switch (this.state) {
      case 'idle': this.think(sim); break;
      case 'goto': {
        if (!this.dest) { this.state = 'idle'; break; }
        this.gotoT = (this.gotoT || 0) + 1;
        if (this.moveToward(this.dest.x, this.dest.y, w)) {
          this.state = this.destAction || 'idle';
          this.dest = null; this.gotoT = 0;
        } else if (this.gotoT > 1600) { // festgelaufen → aufgeben
          this.state = 'idle'; this.dest = null; this.gotoT = 0;
        }
        break;
      }
      case 'sleep': {
        if (this.energy >= 99 || (!sim.isNight && this.energy > 65)) this.state = 'idle';
        break;
      }
      case 'eat': {
        // richtig satt essen (bis zu 2 Portionen)
        for (let k = 0; k < 2 && this.hunger > 20; k++) {
          if (this.village && this.village.stock.food >= 1) this.village.stock.food -= 1;
          else if (this.invFood >= 1) this.invFood -= 1;
          else break;
          this.hunger = clamp(this.hunger - 70, 0, 100);
        }
        this.state = 'idle';
        break;
      }
      case 'gather_food': this.doGather(sim, 'food'); break;
      case 'gather_wood': this.doGather(sim, 'wood'); break;
      case 'gather_stone': this.doGather(sim, 'stone'); break;
      case 'deliver': {
        if (!this.village) { this.state = 'idle'; break; }
        if (this.moveToward(this.village.cx, this.village.cy, w)) {
          this.village.stock.food += this.carry.food;
          this.village.stock.wood += this.carry.wood;
          this.village.stock.stone += this.carry.stone;
          this.carry = { food: 0, wood: 0, stone: 0 };
          this.state = 'idle';
        }
        break;
      }
      case 'farm': {
        const f = this.village && this.village.workableFarm();
        if (!f) { this.state = 'idle'; break; }
        const fx = f.x * TILE + TILE / 2, fy = f.y * TILE + TILE / 2;
        if (dist(this.x, this.y, fx, fy) > TILE * 1.4) this.moveToward(fx, fy, w);
        else this.village.stock.food += 0.011 * (1 + this.skills.farm * 0.10) * (sim.droughtT > 0 ? 0.12 : 1);
        if (sim.isNight) this.state = 'idle';
        break;
      }
      case 'build': {
        const b = this.village && this.village.unfinished();
        if (!b) { this.state = 'idle'; break; }
        const bx = b.x * TILE + TILE / 2, by = b.y * TILE + TILE / 2;
        if (dist(this.x, this.y, bx, by) > TILE * 1.6) this.moveToward(bx, by, w);
        else {
          b.progress += 0.0016 * (1 + this.skills.build * 0.12);
          if (b.progress >= 1) {
            b.progress = 1;
            sim.event(`🔨 ${this.name} hat ${b.label} in ${this.village.name} fertiggestellt.`, this.village);
            this.addMemory(`Ich habe ${b.label} fertig gebaut. Ich bin stolz.`, 6, sim.tick);
            this.state = 'idle';
          }
        }
        break;
      }
      case 'heal': {
        const sick = this.village && this.village.members.find(p => p.disease === 'sick' && !p.dead);
        if (!sick) { this.state = 'idle'; break; }
        if (dist(this.x, this.y, sick.x, sick.y) > TILE * 1.5) this.moveToward(sick.x, sick.y, w);
        else sick.healerNear = true;
        break;
      }
      case 'guard': {
        if (!this.village) { this.state = 'idle'; break; }
        const a = sim.tick * 0.004 + this.id;
        const gx = this.village.cx + Math.cos(a) * TILE * 5;
        const gy = this.village.cy + Math.sin(a) * TILE * 5;
        this.moveToward(gx, gy, w);
        if (sim.isNight && this.energy < 35) this.state = 'idle';
        break;
      }
      case 'talk': {
        this.talkT--;
        if (this.talkT <= 0) {
          this.state = 'idle';
          this.talkPartner = null;
        }
        break;
      }
      case 'flee': {
        if (this.village) {
          const ang = Math.atan2(this.y - this.village.cy, this.x - this.village.cx) || R(0, 6.28);
          this.moveToward(this.x + Math.cos(ang) * 40, this.y + Math.sin(ang) * 40, w);
        }
        break;
      }
      case 'raid': case 'fight': case 'return':
        // wird von sim.updateRaids gesteuert
        break;
      case 'settle_search':
        // wird von sim.updateFounding gesteuert
        break;
      case 'wander': {
        if (!this.dest) {
          const r = this.village ? TILE * 9 : TILE * 16;
          const ox = (this.village ? this.village.cx : this.x) + R(-r, r);
          const oy = (this.village ? this.village.cy : this.y) + R(-r, r);
          this.dest = { x: ox, y: oy };
        }
        if (this.moveToward(this.dest.x, this.dest.y, w) || chance(0.004)) {
          this.dest = null; this.state = 'idle';
        }
        break;
      }
      default: this.state = 'idle';
    }
  }

  // ---------- Entscheidungslogik ("Tatendrang") ----------
  think(sim) {
    const w = sim.world;

    // großer Hunger geht vor allem anderen
    if (this.hunger > 62) {
      if (this.invFood >= 1) { this.state = 'eat'; return; }
      if (this.village && this.village.stock.food >= 1) {
        this.goto(this.village.cx, this.village.cy, 'eat'); return;
      }
      if (this.hunger > 75 || !sim.isNight) { this.workTile = null; this.state = 'gather_food'; return; }
    }

    // Schlafen nachts
    if (sim.isNight && this.energy < 75) {
      const hut = this.village && this.village.freeHut();
      if (hut) this.goto(hut.x * TILE + TILE / 2, hut.y * TILE + TILE / 2, 'sleep');
      else if (this.village) this.goto(this.village.cx + R(-14, 14), this.village.cy + R(-14, 14), 'sleep');
      else this.state = 'sleep';
      return;
    }
    if (this.energy < 12) { this.state = 'sleep'; return; }

    // Reden bei sozialem Bedürfnis
    if (this.social < 55 && this.talkCooldown <= 0 && this.isAdult) {
      if (sim.tryStartConvo(this)) return;
    }

    // Tagesjob
    if (!sim.isNight && this.isAdult) {
      switch (this.job) {
        case 'sammler': this.workTile = null; this.state = 'gather_food'; return;
        case 'holz': this.workTile = null; this.state = 'gather_wood'; return;
        case 'bauer':
          if (this.village && this.village.workableFarm()) { this.state = 'farm'; return; }
          this.workTile = null; this.state = 'gather_food'; return;
        case 'baumeister':
          if (this.village && this.village.unfinished()) { this.state = 'build'; return; }
          // Steine holen, wenn gebraucht
          if (this.village && this.village.stock.stone < 10) { this.workTile = null; this.state = 'gather_stone'; return; }
          this.workTile = null; this.state = 'gather_wood'; return;
        case 'heiler':
          if (this.village && this.village.members.some(p => p.disease === 'sick')) { this.state = 'heal'; return; }
          this.workTile = null; this.state = 'gather_food'; return;
        case 'wache': this.state = 'guard'; return;
        case 'priester':
          if (chance(0.3) && sim.tryStartConvo(this)) return;
          this.state = 'wander'; return;
        case 'anfuehrer':
          if (chance(0.4) && sim.tryStartConvo(this)) return;
          this.state = 'wander'; return;
      }
    }
    this.state = 'wander';
  }

  doGather(sim, kind) {
    const w = sim.world;
    const cap = 5;
    if (this.carry[kind] >= cap) {
      if (this.village) this.state = 'deliver';
      else { // ohne Dorf: selbst essen
        if (kind === 'food') { this.invFood += this.carry.food; this.carry.food = 0; }
        this.state = 'idle';
      }
      return;
    }
    if (!this.workTile) {
      const pred = kind === 'food'
        ? (x, y, i) => w.berry[i] > 0.5
        : kind === 'wood'
          ? (x, y, i) => w.tiles[i] === T.FOREST && w.wood[i] > 0.5
          : (x, y, i) => w.tiles[i] === T.ROCK && w.stone[i] > 0.5;
      const from = this.village ? { x: Math.floor(this.village.cx / TILE), y: Math.floor(this.village.cy / TILE) } : { x: this.tileX, y: this.tileY };
      this.workTile = w.findNear(from.x, from.y, 34, pred);
      if (!this.workTile) { this.state = 'wander'; return; }
    }
    const tx = this.workTile.x * TILE + TILE / 2, ty = this.workTile.y * TILE + TILE / 2;
    if (dist(this.x, this.y, tx, ty) > TILE * 1.2) { this.moveToward(tx, ty, w); return; }
    const i = w.idx(this.workTile.x, this.workTile.y);
    const skill = kind === 'food' ? this.skills.farm : kind === 'wood' ? this.skills.wood : this.skills.build;
    const rate = 0.016 * (1 + skill * 0.10);
    const src = kind === 'food' ? w.berry : kind === 'wood' ? w.wood : w.stone;
    if (src[i] <= 0.2) {
      if (kind === 'wood' && w.tiles[i] === T.FOREST) { w.tiles[i] = T.GRASS; sim.terrainDirty = true; }
      this.workTile = null;
      return;
    }
    src[i] -= rate;
    this.carry[kind] += rate;
  }
}
