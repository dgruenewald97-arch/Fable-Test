// systems.js — die Welt-Engine: Zeit, Dörfer, Krankheit, Krieg, Gerüchte, Gott
import { uid, R, RI, pick, chance, clamp, dist } from './util.js';
import { T, TILE, MAP_W, MAP_H, World } from './world.js';
import { Person } from './agents.js';
import { Village, BUILDINGS } from './village.js';

export const TPD = 1200;          // Ticks pro Tag
export const DAYS_PER_YEAR = 6;

export class Sim {
  constructor(brain) {
    this.world = new World();
    this.brain = brain;
    this.people = [];
    this.villages = [];
    this.foundingGroups = [];
    this.convos = [];
    this.raids = [];
    this.rumors = [];
    this.chronicle = [];
    this.tick = 0;
    this.droughtT = 0;
    this.terrainDirty = true;
    this.lastDay = -1;
  }

  get day() { return Math.floor(this.tick / TPD); }
  get year() { return Math.floor(this.day / DAYS_PER_YEAR) + 1; }
  get dayPhase() { return (this.tick % TPD) / TPD; }
  get isNight() { return this.dayPhase < 0.16 || this.dayPhase > 0.88; }

  timeLabel() { return `Jahr ${this.year}, Tag ${this.day % DAYS_PER_YEAR + 1}`; }

  event(text, village = null, imp = 1) {
    this.chronicle.push({ tick: this.tick, time: this.timeLabel(), text, villageId: village ? village.id : null, imp });
    if (this.chronicle.length > 250) this.chronicle.shift();
    if (this.onEvent) this.onEvent(this.chronicle[this.chronicle.length - 1]);
  }

  rumorById(id) { return this.rumors.find(r => r.id === id); }
  personById(id) { return this.people.find(p => p.id === id); }

  // ---------- Start: der Urknall ----------
  start() {
    // Startpunkt: brauchbares Land suchen
    let best = null, bs = -1;
    for (let i = 0; i < 400; i++) {
      const x = RI(10, MAP_W - 10), y = RI(8, MAP_H - 8);
      const s = this.world.siteScore(x, y);
      if (s > bs) { bs = s; best = { x, y }; }
    }
    const px = best.x * TILE, py = best.y * TILE;
    const founders = [];
    for (let i = 0; i < 8; i++) {
      const p = new Person(px + R(-30, 30), py + R(-30, 30));
      p.addMemory('Wir sind nach langer Wanderung in diesem fremden Land angekommen.', 9, 0);
      founders.push(p);
      this.people.push(p);
    }
    // Beziehungen unter Gründern
    for (const a of founders) for (const b of founders) if (a !== b) a.bumpRel(b.id, RI(5, 35));
    this.startFoundingGroup(founders, RI(Math.floor(TPD * 0.3), TPD));
    this.event('🌅 Acht Fremde betreten das unberührte Land. Die Geschichte beginnt.');
  }

  startFoundingGroup(members, searchTime = TPD) {
    const leader = members.reduce((a, b) => (b.skills.charisma > a.skills.charisma ? b : a), members[0]);
    for (const p of members) { p.state = 'settle_search'; p.village = null; p.job = 'keiner'; p.invFood += 5; }
    this.foundingGroups.push({ members, leader, timer: searchTime, driftX: R(-1, 1), driftY: R(-1, 1) });
  }

  updateFounding() {
    for (let gi = this.foundingGroups.length - 1; gi >= 0; gi--) {
      const g = this.foundingGroups[gi];
      g.members = g.members.filter(p => !p.dead);
      if (!g.members.length) { this.foundingGroups.splice(gi, 1); continue; }
      if (!g.members.includes(g.leader)) g.leader = g.members[0];
      const L = g.leader;
      g.timer--;

      // Anführer streift umher, Rest folgt
      if (chance(0.02)) { g.driftX = R(-1, 1); g.driftY = R(-1, 1); }
      L.moveToward(L.x + g.driftX * 50, L.y + g.driftY * 50, this.world);
      for (const p of g.members) {
        if (p !== L && dist(p.x, p.y, L.x, L.y) > 26) p.moveToward(L.x + R(-16, 16), L.y + R(-16, 16), this.world);
        // unterwegs aus dem Proviant essen
        if (p.hunger > 60 && p.invFood >= 1) { p.invFood -= 1; p.hunger = clamp(p.hunger - 70, 0, 100); }
      }

      // Platz bewerten (nicht zu nah an bestehenden Dörfern)
      if (this.tick % 24 === 0 || g.timer <= 0) {
        const tx = L.tileX, ty = L.tileY;
        const score = this.world.siteScore(tx, ty);
        const tooClose = this.villages.some(v => dist(L.x, L.y, v.cx, v.cy) < TILE * 22);
        if (!tooClose && (score > 40 || (g.timer <= 0 && score > 8))) {
          this.foundVillage(g.members, tx, ty);
          this.foundingGroups.splice(gi, 1);
        } else if (g.timer <= -TPD) {
          // Notfall: irgendwo siedeln
          const spot = this.world.findNear(tx, ty, 20, (x, y) => this.world.siteScore(x, y) > 5);
          if (spot) { this.foundVillage(g.members, spot.x, spot.y); this.foundingGroups.splice(gi, 1); }
        }
      }
    }
  }

  foundVillage(members, tx, ty) {
    const v = new Village(tx, ty, this.world);
    v.foundedYear = this.year;
    for (const p of members) {
      p.village = v;
      v.members.push(p);
      p.state = 'idle';
      p.addMemory(`Wir haben das Dorf ${v.name} gegründet. Hier beginnt unser neues Leben.`, 10, this.tick);
    }
    for (const other of this.villages) { v.relations.set(other.id, RI(-10, 15)); other.relations.set(v.id, RI(-10, 15)); }
    this.villages.push(v);
    v.assignJobs();
    this.event(`🏕️ Das Dorf ${v.name} wurde gegründet! (${members.length} Siedler)`, v, 3);
    this.terrainDirty = true;
    return v;
  }

  // ---------- Gespräche ----------
  tryStartConvo(p) {
    if (p.talkCooldown > 0) return false;
    let best = null, bd = 70;
    for (const q of this.people) {
      if (q === p || q.dead || !q.isAdult || q.talkCooldown > 0) continue;
      if (!['idle', 'wander', 'guard'].includes(q.state)) continue;
      const d = dist(p.x, p.y, q.x, q.y);
      if (d < bd) { bd = d; best = q; }
    }
    if (!best) return false;
    p.state = 'talk'; best.state = 'talk';
    p.talkT = 9999; best.talkT = 9999;
    p.talkPartner = best.id; best.talkPartner = p.id;
    const convo = { a: p, b: best, lines: null, li: -1, lt: 0, age: 0, mood: 0, gotAI: false, done: false };
    this.convos.push(convo);
    this.brain.requestDialogue(p, best, this, (lines, mood, isAI) => {
      if (convo.done) return;
      convo.mood = mood; convo.gotAI = isAI;
      if (lines && lines.length) { convo.lines = lines; convo.li = -1; convo.lt = 1; }
      else convo.age = 600; // gleich beenden
    });
    return true;
  }

  updateConvos() {
    for (let i = this.convos.length - 1; i >= 0; i--) {
      const c = this.convos[i];
      const { a, b } = c;
      if (a.dead || b.dead || a.state !== 'talk' || b.state !== 'talk') { this.finishConvo(c); this.convos.splice(i, 1); continue; }
      c.age++;
      if (c.lines) {
        c.lt--;
        if (c.lt <= 0) {
          c.li++;
          if (c.li >= c.lines.length) { this.finishConvo(c); this.convos.splice(i, 1); continue; }
          const line = c.lines[c.li];
          const name = line.split(':')[0].trim().toLowerCase();
          const speaker = name.startsWith(a.name.toLowerCase().slice(0, 4)) ? a : name.startsWith(b.name.toLowerCase().slice(0, 4)) ? b : (c.li % 2 === 0 ? a : b);
          speaker.bubble = { lines: [line.replace(/^[^:]+:\s*/, '')], i: 0, t: 230 };
          c.lt = 240;
        }
      } else if (c.age > 700) { this.finishConvo(c); this.convos.splice(i, 1); }
    }
  }

  finishConvo(c) {
    if (c.done) return;
    c.done = true;
    const { a, b, mood } = c;
    for (const p of [a, b]) {
      if (p.dead) continue;
      p.social = 100;
      p.talkCooldown = RI(900, 2200);
      if (p.state === 'talk') p.state = 'idle';
      p.talkPartner = null;
    }
    if (a.dead || b.dead) return;
    let d = mood > 0 ? RI(8, 16) : mood < 0 ? RI(-16, -7) : RI(-2, 5);
    // zwischen Singles springt eher ein Funke über
    if (mood >= 0 && !a.partner && !b.partner && a.gender !== b.gender && a.isAdult && b.isAdult) d += RI(4, 14);
    a.bumpRel(b.id, d); b.bumpRel(a.id, d);
    const snippet = c.gotAI && c.lines && c.lines.length ? ` Es ging um: "${c.lines[0].replace(/^[^:]+:\s*/, '').slice(0, 70)}"` : '';
    if (mood < 0) {
      a.addMemory(`Ich habe mich mit ${b.name} gestritten.${snippet}`, 5, this.tick);
      b.addMemory(`Streit mit ${a.name}.${snippet}`, 5, this.tick);
      if (chance(0.25)) this.event(`💢 ${a.name} und ${b.name} geraten in Streit.`, a.village);
    } else {
      a.addMemory(`Gutes Gespräch mit ${b.name}.${snippet}`, 2, this.tick);
      b.addMemory(`Gutes Gespräch mit ${a.name}.${snippet}`, 2, this.tick);
    }
    this.exchangeRumors(a, b);
    this.exchangeRumors(b, a);
  }

  // ---------- Gerüchte & Verschwörungen ----------
  spawnRumor(eventText, origin, targetVillage = null) {
    if (!origin || origin.dead) return;
    const rumor = {
      id: uid(), text: '', event: eventText,
      targetVillageId: targetVillage ? targetVillage.id : null,
      believers: new Set([origin.id]), born: this.tick, isAI: false,
    };
    this.rumors.push(rumor);
    if (this.rumors.length > 30) this.rumors.shift();
    origin.beliefs.push(rumor.id);
    this.brain.requestRumor(origin, eventText, targetVillage, this, (text, isAI) => {
      rumor.text = text; rumor.isAI = isAI;
      origin.currentThought = text; origin.thoughtIsAI = isAI;
      origin.addMemory(`Ich bin überzeugt: ${text}`, 7, this.tick);
      this.event(`🗣️ Ein Gerücht entsteht: „${text}“ (${origin.name})`, origin.village, 2);
    });
  }

  exchangeRumors(from, to) {
    for (const id of from.beliefs) {
      const r = this.rumorById(id);
      if (!r || !r.text || r.believers.has(to.id)) continue;
      if (!chance(0.55)) continue;
      const accept = to.has('abergläubisch') || to.has('fromm') ? 0.8 : to.has('skeptisch') ? 0.2 : 0.5;
      if (chance(accept)) {
        r.believers.add(to.id);
        to.beliefs.push(r.id);
        if (to.beliefs.length > 6) to.beliefs.shift();
        to.addMemory(`${from.name} hat mir erzählt: „${r.text}“ — ich glaube es.`, 5, this.tick);
        // Schuldzuweisungen vergiften die Beziehungen zwischen Dörfern
        if (r.targetVillageId && to.village && to.village.id !== r.targetVillageId) {
          const target = this.villages.find(v => v.id === r.targetVillageId);
          if (target) to.village.bumpRel(target, -3);
        }
      } else {
        to.addMemory(`${from.name} erzählt Unsinn über „${r.event}“. Ich glaube kein Wort.`, 2, this.tick);
      }
      break; // max. ein Gerücht pro Gespräch
    }
  }

  // ---------- Krankheit ----------
  startOutbreak(village = null, label = 'das Fieber') {
    const candidates = village ? village.members : this.people;
    const victim = pick(candidates.filter(p => !p.dead && p.disease === 'none'));
    if (!victim) return;
    victim.disease = 'sick'; victim.sickT = 0;
    victim.addMemory('Ich bin krank geworden. Mir ist heiß und schwindelig.', 7, this.tick);
    this.event(`🦠 ${label[0].toUpperCase() + label.slice(1)} bricht aus! ${victim.name} ist erkrankt.`, victim.village, 3);
    // Verschwörungstheorie: wer ist schuld?
    const witnesses = this.people.filter(p => !p.dead && p !== victim && (p.has('abergläubisch') || p.has('misstrauisch') || p.has('fromm')));
    if (witnesses.length) {
      const w = pick(witnesses);
      const otherV = this.villages.filter(v => v !== w.village);
      const blame = w.has('misstrauisch') && otherV.length && chance(0.6) ? pick(otherV) : null;
      this.spawnRumor(`eine Krankheit hat ${victim.name} befallen`, w, blame);
    }
  }

  spreadDisease() {
    for (const p of this.people) {
      if (p.disease !== 'sick') continue;
      for (const q of this.people) {
        if (q.disease !== 'none' || q.dead) continue;
        if (dist(p.x, p.y, q.x, q.y) < 26 && chance(0.010)) {
          q.disease = 'sick'; q.sickT = 0;
          q.addMemory('Jetzt hat es auch mich erwischt — das Fieber!', 7, this.tick);
        }
      }
      // Brunnen senkt Ansteckung im Dorf (symbolisch: Heilung beschleunigen)
      if (p.village && p.village.countDone('brunnen') > 0 && chance(0.001)) p.sickT += 150;
    }
  }

  // ---------- Krieg ----------
  warCheck() {
    for (const v of this.villages) {
      if (v.warCooldown > 0) { v.warCooldown--; continue; }
      if (!v.leader || v.leader.dead) continue;
      const enemy = this.villages.find(o => o !== v && v.relTo(o) < -45 && o.pop > 0);
      if (!enemy) continue;
      const warriors = v.adults.filter(p => p !== v.leader && p.skills.fight > 3.5 && p.disease !== 'sick' && p.state !== 'raid').slice(0, 6);
      if (warriors.length < 2) continue;
      v.warCooldown = 2; // nicht jeden Tag fragen
      this.brain.requestWarDecision(v.leader, v, enemy, this, (yes, reason, isAI) => {
        if (!yes) {
          if (isAI && reason) this.event(`🕊️ ${v.leader.name} (${v.name}) entscheidet gegen einen Angriff: „${reason}“`, v);
          return;
        }
        this.launchRaid(v, enemy, warriors.filter(p => !p.dead), reason);
      });
    }
  }

  launchRaid(attacker, defender, warriors, reason = '') {
    if (!warriors.length || !this.villages.includes(defender)) return;
    for (const p of warriors) { p.state = 'raid'; p.raidTarget = defender.id; }
    attacker.warCooldown = DAYS_PER_YEAR * 2;
    this.raids.push({ attacker, defender, warriors, state: 'march', fightT: 0, fleeDone: false });
    this.event(`⚔️ KRIEG! ${attacker.name} schickt ${warriors.length} Krieger gegen ${defender.name}!${reason ? ` Grund: „${reason}“` : ''}`, attacker, 3);
    attacker.leader && attacker.leader.addMemory(`Ich habe den Angriff auf ${defender.name} befohlen.`, 9, this.tick);
  }

  updateRaids() {
    for (let i = this.raids.length - 1; i >= 0; i--) {
      const r = this.raids[i];
      r.warriors = r.warriors.filter(p => !p.dead);
      if (!r.warriors.length) { this.raids.splice(i, 1); continue; }
      const D = r.defender;
      // Ziel existiert nicht mehr → umkehren
      if (r.state !== 'return' && !this.villages.includes(D)) {
        for (const p of r.warriors) p.state = 'return';
        r.state = 'return'; r.loot = r.loot || { food: 0, wood: 0 };
      }

      if (r.state === 'march') {
        let arrived = 0;
        for (const p of r.warriors) {
          if (p.moveToward(D.cx + R(-10, 10), D.cy + R(-10, 10), this.world) || dist(p.x, p.y, D.cx, D.cy) < TILE * 3.5) arrived++;
        }
        if (arrived >= Math.ceil(r.warriors.length * 0.6)) {
          r.state = 'fight'; r.fightT = 420;
          this.event(`🔥 Die Krieger aus ${r.attacker.name} fallen in ${D.name} ein!`, D, 3);
          // Zivilisten fliehen
          for (const p of D.members) {
            if (p.skills.fight <= 4 || p.isChild) { p.state = 'flee'; p.fleeT = 420; }
          }
        }
      } else if (r.state === 'fight') {
        r.fightT--;
        if (r.fightT % 30 === 0) {
          const defenders = D.members.filter(p => !p.dead && p.isAdult && p.skills.fight > 4 && dist(p.x, p.y, D.cx, D.cy) < TILE * 8);
          const att = pick(r.warriors);
          const def = defenders.length ? pick(defenders) : null;
          if (def && att) {
            // Heimvorteil für Verteidiger
            const pa = att.skills.fight * R(0.6, 1.4);
            const pd = def.skills.fight * R(0.75, 1.6);
            const loser = pa > pd ? def : att;
            loser.health -= R(28, 50);
            if (loser.health <= 0) this.kill(loser, 'kampf');
          }
        }
        if (r.fightT <= 0 || !D.members.length) {
          // Beute & Zerstörung
          const foodLoot = Math.floor(D.stock.food * 0.45);
          const woodLoot = Math.floor(D.stock.wood * 0.3);
          D.stock.food -= foodLoot; D.stock.wood -= woodLoot;
          r.loot = { food: foodLoot, wood: woodLoot };
          const burnable = D.buildings.filter(b => b.type !== 'feuer' && b.progress >= 1);
          if (burnable.length && chance(0.5)) {
            const b = pick(burnable);
            D.removeBuilding(this.world, b);
            this.event(`🔥 ${b.label[0].toUpperCase() + b.label.slice(1)} in ${D.name} wurde niedergebrannt!`, D, 3);
            this.terrainDirty = true;
          }
          r.attacker.bumpRel(D, -30); D.bumpRel(r.attacker, -40);
          for (const p of D.members) p.addMemory(`${r.attacker.name} hat uns überfallen. Das vergesse ich nie.`, 9, this.tick);
          if (D.leader && !D.leader.dead && chance(0.7)) this.spawnRumor(`der Überfall durch ${r.attacker.name}`, D.leader, r.attacker);
          this.event(`💰 Die Krieger aus ${r.attacker.name} ziehen mit Beute ab (${foodLoot} Essen, ${woodLoot} Holz).`, D, 2);
          r.state = 'return';
        }
      } else if (r.state === 'return') {
        let home = 0;
        for (const p of r.warriors) {
          if (p.moveToward(r.attacker.cx, r.attacker.cy, this.world) || dist(p.x, p.y, r.attacker.cx, r.attacker.cy) < TILE * 2.5) home++;
        }
        if (home >= r.warriors.length) {
          r.attacker.stock.food += r.loot ? r.loot.food : 0;
          r.attacker.stock.wood += r.loot ? r.loot.wood : 0;
          for (const p of r.warriors) {
            p.state = 'idle'; p.raidTarget = null;
            p.addMemory(`Ich habe im Überfall auf ${D.name} gekämpft und überlebt.`, 8, this.tick);
          }
          this.raids.splice(i, 1);
        }
      }
    }
  }

  // ---------- Tod ----------
  kill(p, cause) {
    if (p.dead) return;
    p.dead = true;
    const causes = {
      krankheit: 'erlag der Krankheit', hunger: 'ist verhungert', kampf: 'fiel im Kampf',
      alter: 'starb an Altersschwäche', blitz: 'wurde von Gottes Blitz getroffen', meteor: 'starb im Feuer des Meteors',
    };
    this.event(`💀 ${p.name} (${Math.floor(p.age)}) ${causes[cause] || 'ist gestorben'}.`, p.village, 2);
    const idx = this.people.indexOf(p);
    if (idx >= 0) this.people.splice(idx, 1);
    if (p.village) {
      const vi = p.village.members.indexOf(p);
      if (vi >= 0) p.village.members.splice(vi, 1);
      if (p.village.leader === p) p.village.leader = null;
    }
    // Trauer & Rache
    for (const q of this.people) {
      if (q.relTo(p.id) > 45 || q.partner === p.id || q.parents.includes(p.id)) {
        q.addMemory(`${p.name} ist tot. Der Schmerz zerreißt mich.`, 9, this.tick);
        q.social = Math.min(q.social, 30);
      }
      if (q.partner === p.id) q.partner = null;
    }
    if (cause === 'krankheit' && chance(0.35)) {
      const sus = this.people.filter(q => !q.dead && (q.has('abergläubisch') || q.has('misstrauisch')));
      if (sus.length) {
        const w = pick(sus);
        const others = this.villages.filter(v => v !== w.village);
        this.spawnRumor(`${p.name} starb an der Krankheit`, w, w.has('misstrauisch') && others.length && chance(0.5) ? pick(others) : null);
      }
    }
  }

  abandonVillage(v, reason) {
    for (const b of [...v.buildings]) v.removeBuilding(this.world, b);
    const i = this.villages.indexOf(v);
    if (i >= 0) this.villages.splice(i, 1);
    this.terrainDirty = true;
    this.event(`🏚️ ${v.name} ist ${reason}. Nur Ruinen bleiben zurück.`, null, 3);
  }

  // ---------- Tagesablauf ----------
  daily() {
    for (const p of [...this.people]) {
      p.age += 1 / DAYS_PER_YEAR;
      if (p.age > 58 && chance((p.age - 58) * 0.005)) this.kill(p, 'alter');
    }

    // sterbende Dörfer: leere auflösen, winzige wandern ab
    for (const v of [...this.villages]) {
      if (v.pop === 0) { this.abandonVillage(v, 'ausgestorben'); continue; }
      if (v.pop < 3 && this.villages.length > 1) {
        const refuge = this.villages.filter(o => o !== v && o.pop > 0 && o.relTo(v) > -40)
          .sort((a, b) => b.relTo(v) - a.relTo(v))[0];
        if (refuge && chance(0.5)) {
          for (const p of [...v.members]) {
            p.village = refuge; refuge.members.push(p);
            p.addMemory(`${v.name} war verloren. Wir haben Zuflucht in ${refuge.name} gefunden.`, 9, this.tick);
          }
          v.members.length = 0;
          this.abandonVillage(v, 'verlassen — die Letzten flohen nach ' + refuge.name);
        }
      }
    }

    for (const v of this.villages) {
      if (!v.members.length) continue;
      v.assignJobs();
      v.planConstruction(this.world, this);

      // Dorfgemeinschaft: man kennt sich (langsamer Beziehungsaufbau im Alltag)
      for (const p of v.members) {
        const other = pick(v.members);
        if (other && other !== p) p.bumpRel(other.id, 2);
      }

      // Verlieben
      const singles = v.adults.filter(p => !p.partner && p.age < 52);
      for (const a of singles) {
        const match = singles.find(b => b !== a && b.gender !== a.gender && !b.partner && a.relTo(b.id) > 28 && b.relTo(a.id) > 22);
        if (match && chance(0.5)) {
          a.partner = match.id; match.partner = a.id;
          a.bumpRel(match.id, 30); match.bumpRel(a.id, 30);
          a.addMemory(`${match.name} und ich sind jetzt ein Paar. Mein Herz singt.`, 9, this.tick);
          match.addMemory(`${a.name} und ich gehören jetzt zusammen.`, 9, this.tick);
          this.event(`❤️ ${a.name} und ${match.name} (${v.name}) haben sich verliebt!`, v, 2);
        }
      }

      // Geburten
      if (this.people.length < 55 && v.stock.food > v.pop * 1.1 && v.countDone('huette') > 0) {
        for (const a of v.members) {
          if (a.gender !== 'w' || !a.partner || !a.isAdult || a.age > 46) continue;
          const father = this.personById(a.partner);
          if (!father || father.dead) continue;
          if (chance(0.12)) {
            const baby = new Person(v.cx + R(-10, 10), v.cy + R(-10, 10), { age: 0, parents: [a.id, father.id] });
            baby.village = v; v.members.push(baby); this.people.push(baby);
            baby.bumpRel(a.id, 80); baby.bumpRel(father.id, 80);
            a.bumpRel(baby.id, 90); father.bumpRel(baby.id, 90);
            a.addMemory(`Unser Kind ${baby.name} ist geboren!`, 10, this.tick);
            father.addMemory(`Ich bin Vater geworden — ${baby.name}!`, 10, this.tick);
            this.event(`👶 ${a.name} und ${father.name} bekommen ein Kind: ${baby.name}! (${v.name})`, v, 2);
            break;
          }
        }
      }

      // Hungersnot-Gerücht
      if (v.stock.food < 2 && v.pop > 4 && chance(0.3)) {
        const w = pick(v.members.filter(p => p.isAdult));
        if (w) this.spawnRumor(`die große Hungersnot in ${v.name}`, w, null);
      }

      // Dorf-Spaltung: zu groß oder zerstritten → Auswanderer gründen neues Dorf
      if (v.pop >= 16 && this.villages.length + this.foundingGroups.length < 6 && chance(0.25)) {
        const rebel = v.adults.find(p => p !== v.leader && (p.has('ehrgeizig') || p.relTo(v.leader?.id) < -20));
        if (rebel) {
          const group = [rebel];
          for (const p of v.adults) {
            if (p !== rebel && p !== v.leader && group.length < 6 && p.relTo(rebel.id) > 10) group.push(p);
          }
          if (group.length >= 3) {
            for (const p of group) {
              const mi = v.members.indexOf(p);
              if (mi >= 0) v.members.splice(mi, 1);
              p.addMemory(`Wir haben ${v.name} verlassen, um etwas Eigenes aufzubauen.`, 9, this.tick);
            }
            this.startFoundingGroup(group, TPD);
            this.event(`🚶 ${rebel.name} verlässt ${v.name} mit ${group.length - 1} Gefolgsleuten — sie suchen neues Land!`, v, 3);
          }
        }
      }

      // Beziehungs-Drift zwischen Dörfern: Neid bei Knappheit
      for (const o of this.villages) {
        if (o === v) continue;
        if (v.stock.food < v.pop * 0.5 && o.stock.food > o.pop * 2) v.bumpRel(o, -2);
        else if (chance(0.15)) v.bumpRel(o, 1); // langsame Entspannung
      }
    }

    // Grenzzwischenfälle: Reibung zwischen Dörfern erzeugt Konflikte
    if (this.villages.length >= 2 && chance(0.10)) {
      const a = pick(this.villages), b = pick(this.villages.filter(x => x !== a));
      if (a && b && a.pop > 2 && b.pop > 2) {
        const pa = pick(a.adults), pb = pick(b.adults);
        if (pa && pb) {
          const kind = pick(['jagd', 'diebstahl', 'beleidigung']);
          const dmg = RI(6, 16);
          a.bumpRel(b, -dmg); b.bumpRel(a, -dmg);
          pa.bumpRel(pb.id, -25); pb.bumpRel(pa.id, -25);
          const texts = {
            jagd: `🏹 Streit um Jagdgründe: ${pa.name} (${a.name}) und ${pb.name} (${b.name}) geraten aneinander!`,
            diebstahl: `🥷 ${pb.name} aus ${b.name} wird beschuldigt, Vorräte aus ${a.name} gestohlen zu haben!`,
            beleidigung: `🗯️ ${pb.name} aus ${b.name} hat ${pa.name} vor allen Leuten gedemütigt. ${a.name} ist empört!`,
          };
          this.event(texts[kind], a, 2);
          pa.addMemory(`Zwischenfall mit ${pb.name} aus ${b.name}. Diese Leute sind nicht zu trauen.`, 7, this.tick);
          pb.addMemory(`Ärger mit ${pa.name} aus ${a.name}.`, 6, this.tick);
          if (kind === 'diebstahl' && b.stock.food > 4) { b.stock.food -= 4; a.stock.food += 4; }
          if (chance(0.4)) this.spawnRumor(`der Zwischenfall mit den Leuten aus ${b.name}`, pa, b);
        }
      }
    }

    // zufälliger Krankheitsausbruch
    if (this.people.length > 14 && chance(0.025)) this.startOutbreak();

    // Aussterben verhindern: neue Wanderer erreichen die Insel
    if (this.people.length < 4 && !this.foundingGroups.length) {
      const edge = this.world.findNear(RI(10, MAP_W - 10), RI(6, MAP_H - 6), 30, (x, y) => this.world.isLand(x, y));
      if (edge) {
        const group = [];
        for (let i = 0; i < 6; i++) {
          const p = new Person(edge.x * TILE + R(-20, 20), edge.y * TILE + R(-20, 20));
          p.addMemory('Wir sind über das Meer gekommen, auf der Suche nach einer neuen Heimat.', 9, this.tick);
          group.push(p); this.people.push(p);
        }
        this.startFoundingGroup(group, TPD);
        this.event('⛵ Fremde erreichen die Insel — neues Leben zieht ein.');
      }
    }

    this.warCheck();
  }

  // ---------- Gott-Aktionen ----------
  godMeteor(px, py) {
    this.event(`☄️ EIN METEOR SCHLÄGT EIN! Der Himmel brennt.`, null, 3);
    for (const p of [...this.people]) {
      const d = dist(p.x, p.y, px, py);
      if (d < 55) this.kill(p, 'meteor');
      else if (d < 120) { p.health -= 35; p.addMemory('Feuer fiel vom Himmel! Ich bin dem Tod entkommen.', 10, this.tick); }
      else p.addMemory('Ein brennender Stern stürzte vom Himmel. Was bedeutet das?', 8, this.tick);
    }
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const x = tx + dx, y = ty + dy;
      if (!this.world.inBounds(x, y) || dx * dx + dy * dy > 25) continue;
      const i = this.world.idx(x, y);
      if (this.world.tiles[i] === T.FOREST) { this.world.tiles[i] = T.GRASS; this.world.wood[i] = 0; }
      this.world.berry[i] = 0;
      const b = this.world.buildAt.get(x + ',' + y);
      if (b) { const v = this.villages.find(vv => vv.buildings.includes(b)); if (v) v.removeBuilding(this.world, b); }
    }
    this.terrainDirty = true;
    const w = pick(this.people.filter(p => !p.dead));
    if (w) this.spawnRumor('ein Meteor ist vom Himmel gestürzt', w, null);
  }

  godPlague() { this.startOutbreak(this.villages.length ? pick(this.villages) : null, 'eine Seuche'); }

  godDrought() {
    this.droughtT = TPD * 2;
    this.event('☀️ DÜRRE! Die Sonne verbrennt das Land, die Ernten verdorren.', null, 3);
    for (const p of this.people) p.addMemory('Eine furchtbare Dürre hat begonnen. Das Land verdorrt.', 7, this.tick);
    const w = pick(this.people.filter(p => p.has('fromm') || p.has('abergläubisch')));
    if (w) this.spawnRumor('eine große Dürre verdorrt das Land', w, null);
  }

  godLightning(p) {
    if (!p || p.dead) return;
    this.kill(p, 'blitz');
    for (const q of this.people) {
      if (dist(q.x, q.y, p.x, p.y) < 150) q.addMemory(`Ein Blitz aus heiterem Himmel hat ${p.name} erschlagen! Die Götter sind zornig.`, 10, this.tick);
    }
    const w = pick(this.people.filter(q => !q.dead && q.has('fromm')));
    if (w) this.spawnRumor(`${p.name} wurde vom Blitz erschlagen`, w, null);
  }

  godProphet() {
    const candidates = this.people.filter(p => !p.dead && p.isAdult);
    if (!candidates.length) return;
    const prophet = pick(candidates);
    prophet.traits = [...new Set([...prophet.traits, 'fromm', 'charismatisch'])].slice(0, 4);
    this.event(`🔮 ${prophet.name} hat eine Vision und verkündet sie als Prophet!`, prophet.village, 3);
    prophet.addMemory('Ich hatte eine gewaltige Vision. Ich muss sie allen verkünden!', 10, this.tick);
    this.spawnRumor('eine gewaltige Vision über das Ende und einen Neuanfang', prophet, null);
  }

  godWhisper(p, text) {
    if (!p || p.dead) return;
    this.event(`👁️ Gott flüstert ${p.name} etwas zu…`, p.village, 2);
    this.brain.requestWhisperReaction(p, text, this, (reaction) => {
      p.currentThought = reaction; p.thoughtIsAI = true;
      p.bubble = { lines: [reaction], i: 0, t: 320 };
      p.addMemory(`Eine Stimme sprach zu mir: "${text}" — ${reaction}`, 10, this.tick);
      if (chance(0.6)) this.spawnRumor(`eine Stimme aus dem Nichts sprach: "${text}"`, p, null);
    });
  }

  // ---------- Haupt-Tick ----------
  update() {
    this.tick++;
    if (this.droughtT > 0) this.droughtT--;

    this.updateFounding();
    this.updateConvos();
    this.updateRaids();

    for (const p of [...this.people]) p.update(this);

    if (this.tick % 12 === 0) this.spreadDisease();
    if (this.tick % 30 === 0 && this.droughtT <= 0) this.world.regrow();
    if (this.droughtT > 0 && this.tick % 40 === 0) {
      // Dürre frisst Beeren
      const i = RI(0, this.world.berry.length - 1);
      this.world.berry[i] = Math.max(0, this.world.berry[i] - 2);
    }

    const d = this.day;
    if (d !== this.lastDay) { this.lastDay = d; this.daily(); }
  }
}
