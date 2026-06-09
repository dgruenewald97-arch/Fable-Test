// brain.js — lokale KI (Ollama) als Gehirn der Bewohner
// Spricht die OpenAI-kompatible API (funktioniert auch mit LM Studio).
// Alles asynchron mit Prioritäts-Queue; regelbasierte Fallbacks halten
// die Welt am Leben, wenn das Modell nicht erreichbar oder ausgelastet ist.
import { pick, chance } from './util.js';

const FALLBACK_THOUGHTS = {
  hunger: ['Mein Magen knurrt schon wieder…', 'Ich brauche dringend etwas zu essen.', 'Hoffentlich gibt es heute genug Beeren.'],
  tired: ['Ich bin so müde…', 'Heute Nacht schlafe ich wie ein Stein.'],
  sick: ['Mir ist so heiß… ich glaube, ich habe Fieber.', 'Diese Krankheit macht mich fertig.'],
  social: ['Ich sollte mal wieder mit jemandem reden.', 'Es ist einsam hier draußen.'],
  work: ['Die Arbeit macht sich nicht von allein.', 'Ein ehrlicher Tag Arbeit ist gut für die Seele.', 'Wenn ich fleißig bin, geht es dem Dorf gut.'],
  default: ['Was für ein Tag.', 'Der Himmel ist heute schön.', 'Ich frage mich, was die Zukunft bringt.', 'Manchmal denke ich über alles nach.'],
};

const FALLBACK_RUMORS = [
  'Ich habe gehört, dass {EVENT} kein Zufall war…',
  'Man erzählt sich, die Götter hätten {EVENT} geschickt, weil jemand gefrevelt hat.',
  'Jemand hat mir zugeflüstert, dass hinter {EVENT} mehr steckt, als man uns sagt.',
];
const FALLBACK_BLAME = [
  'Ich bin sicher: {TARGET} steckt hinter {EVENT}!',
  'Es heißt, die Leute aus {TARGET} hätten {EVENT} verursacht. Trauen darf man denen nicht.',
];

export class Brain {
  constructor() {
    this.baseUrl = localStorage.getItem('genesis.url') || 'http://localhost:11434';
    this.model = localStorage.getItem('genesis.model') || '';
    this.connected = false;
    this.models = [];
    this.queue = [];
    this.busy = false;
    this.stats = { ok: 0, fail: 0 };
    this.onStatus = null; // UI-Callback
  }

  setStatus(connected) {
    this.connected = connected;
    if (this.onStatus) this.onStatus(connected);
  }

  async connect() {
    try {
      const r = await fetch(this.baseUrl + '/api/tags', { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      this.models = (j.models || []).map(m => m.name);
      if (!this.models.length) { this.setStatus(false); return false; }
      if (!this.model || !this.models.includes(this.model)) {
        // 3B-Modell bevorzugen, sonst erstes
        this.model = this.models.find(m => /3b/i.test(m)) || this.models[0];
      }
      localStorage.setItem('genesis.model', this.model);
      this.setStatus(true);
      return true;
    } catch (e) {
      this.setStatus(false);
      return false;
    }
  }

  // priority: 1 = hoch (Gott/Dialog), 2 = Entscheidungen, 3 = Gedanken/Gerüchte
  enqueue(task) {
    if (!this.connected) { task.fallback(); return; }
    // Queue klein halten — Welt darf nicht auf die KI warten
    if (this.queue.length >= 7) {
      const lowIdx = this.queue.findIndex(t => t.priority >= 3);
      if (lowIdx >= 0 && task.priority < 3) {
        this.queue[lowIdx].fallback();
        this.queue.splice(lowIdx, 1);
      } else { task.fallback(); return; }
    }
    this.queue.push(task);
    this.queue.sort((a, b) => a.priority - b.priority);
    this.pump();
  }

  async pump() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const task = this.queue.shift();
    try {
      const text = await this.chat(task.system, task.user, task.maxTokens || 90);
      this.stats.ok++;
      task.onResult(text);
    } catch (e) {
      this.stats.fail++;
      if (this.stats.fail > 3 && this.stats.ok === 0) this.setStatus(false);
      task.fallback();
    }
    this.busy = false;
    if (this.queue.length) setTimeout(() => this.pump(), 60);
  }

  async chat(system, user, maxTokens) {
    const r = await fetch(this.baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: maxTokens,
        temperature: 0.9,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('leere Antwort');
    return text;
  }

  baseSystem(p, sim) {
    return `Du bist ${p.describe()}. Du lebst in einer einfachen, frühen Welt (Jahr ${sim.year}) ohne moderne Technik. Antworte immer auf Deutsch, knapp und in deiner Rolle.`;
  }

  contextOf(p, sim) {
    const parts = [];
    if (p.hunger > 60) parts.push('Du hast Hunger.');
    if (p.energy < 30) parts.push('Du bist erschöpft.');
    if (p.disease === 'sick') parts.push('Du bist krank und hast Fieber.');
    if (p.village && p.village.stock.food < p.village.pop) parts.push('Die Vorräte deines Dorfes sind knapp.');
    const mems = p.recentMemories(4).map(m => '- ' + m.text);
    if (mems.length) parts.push('Deine Erinnerungen:\n' + mems.join('\n'));
    if (p.whisper) parts.push(`Eine geheimnisvolle innere Stimme hat dir zugeflüstert: "${p.whisper}"`);
    return parts.join('\n');
  }

  fallbackThought(p) {
    if (p.disease === 'sick') return pick(FALLBACK_THOUGHTS.sick);
    if (p.hunger > 65) return pick(FALLBACK_THOUGHTS.hunger);
    if (p.energy < 25) return pick(FALLBACK_THOUGHTS.tired);
    if (p.social < 30) return pick(FALLBACK_THOUGHTS.social);
    if (['sammler', 'holz', 'bauer', 'baumeister'].includes(p.job) && chance(0.5)) return pick(FALLBACK_THOUGHTS.work);
    return pick(FALLBACK_THOUGHTS.default);
  }

  // ---------- öffentliche Denk-Funktionen ----------
  requestThought(p, sim, priority = 3) {
    this.enqueue({
      priority,
      system: this.baseSystem(p, sim),
      user: `${this.contextOf(p, sim)}\n\nSchreibe deinen aktuellen Gedanken: GENAU EIN kurzer Satz in Ich-Form. Nur den Gedanken, nichts anderes.`,
      maxTokens: 60,
      onResult: text => {
        const t = text.split('\n')[0].replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 160);
        p.currentThought = t; p.thoughtIsAI = true;
        p.addMemory('Gedanke: ' + t, 2, sim.tick);
        if (p.whisper) { p.addMemory(`Die innere Stimme sprach zu mir: "${p.whisper}"`, 9, sim.tick); p.whisper = null; }
      },
      fallback: () => { p.currentThought = this.fallbackThought(p); p.thoughtIsAI = false; },
    });
  }

  requestDialogue(a, b, sim, done) {
    const rel = a.relTo(b.id);
    const relTxt = rel > 40 ? 'Ihr mögt euch sehr.' : rel < -30 ? 'Ihr könnt euch nicht leiden.' : 'Ihr kennt euch flüchtig.';
    const beliefs = a.beliefs.map(id => sim.rumorById(id)).filter(Boolean).slice(-1);
    const beliefTxt = beliefs.length ? `${a.name} glaubt: "${beliefs[0].text}"` : '';
    this.enqueue({
      priority: 2,
      system: `Du schreibst kurze Dialoge zwischen einfachen Dorfbewohnern in einer frühen Welt. Immer auf Deutsch.`,
      user: `Person A: ${a.describe()}\nPerson B: ${b.describe()}\n${relTxt} ${beliefTxt}\nAktuelle Lage: ${this.contextOf(a, sim) || 'ein normaler Tag'}\n\nSchreibe einen kurzen Dialog mit GENAU 4 Zeilen im Format "NAME: Satz". Danach eine letzte Zeile "STIMMUNG: +1" (freundlich), "STIMMUNG: 0" (neutral) oder "STIMMUNG: -1" (streit).`,
      maxTokens: 200,
      onResult: text => {
        const lines = text.split('\n').map(l => l.trim()).filter(l => /^[^:]{2,24}:\s?.+/.test(l) && !/^STIMMUNG/i.test(l)).slice(0, 4);
        let mood = 0;
        const mm = text.match(/STIMMUNG:\s*([+-]?\d)/i);
        if (mm) mood = Math.sign(parseInt(mm[1], 10) || 0);
        done(lines.length ? lines : null, mood, true);
      },
      fallback: () => done(null, chance(0.7) ? 1 : 0, false),
    });
  }

  // Krieg/Frieden-Entscheidung des Anführers
  requestWarDecision(leader, ownV, targetV, sim, done) {
    this.enqueue({
      priority: 2,
      system: this.baseSystem(leader, sim),
      user: `Du bist Anführer von ${ownV.name} (${ownV.pop} Einwohner, Vorräte: ${Math.floor(ownV.stock.food)} Essen). Das Verhältnis zum Dorf ${targetV.name} ist feindselig. ${this.contextOf(leader, sim)}\n\nSollen deine Krieger ${targetV.name} überfallen? Bedenke Risiko und deinen Charakter. Antworte mit GENAU einer Zeile: zuerst "JA" oder "NEIN", dann ein Komma und eine kurze Begründung.`,
      maxTokens: 70,
      onResult: text => {
        const yes = /^\s*"?\s*JA\b/i.test(text);
        const reason = text.replace(/^[^,]*,?\s*/, '').slice(0, 140);
        done(yes, reason, true);
      },
      fallback: () => {
        const yes = leader.has('aggressiv') ? chance(0.5) : leader.has('friedfertig') ? chance(0.06) : chance(0.2);
        done(yes, '', false);
      },
    });
  }

  // Gerücht / Verschwörungstheorie aus Ereignis erzeugen
  requestRumor(p, eventText, targetVillage, sim, done) {
    const angle = p.has('fromm') || p.has('abergläubisch')
      ? 'Du deutest es als Zeichen der Götter oder dunkler Mächte.'
      : p.has('misstrauisch')
        ? 'Du vermutest eine Verschwörung — jemand steckt dahinter.'
        : 'Du spekulierst wild, wer oder was dahintersteckt.';
    const targetTxt = targetVillage ? ` Wenn du jemanden beschuldigst, dann das Dorf ${targetVillage.name}.` : '';
    this.enqueue({
      priority: 3,
      system: this.baseSystem(p, sim),
      user: `Folgendes ist geschehen: ${eventText}\n${angle}${targetTxt}\n\nErfinde das Gerücht, das du nun verbreitest: GENAU EIN Satz in wörtlicher Rede, dramatisch und glaubhaft für einfache Leute. Nur der Satz.`,
      maxTokens: 70,
      onResult: text => {
        const t = text.split('\n')[0].replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 180);
        done(t, true);
      },
      fallback: () => {
        const tpl = targetVillage ? pick(FALLBACK_BLAME) : pick(FALLBACK_RUMORS);
        done(tpl.replace('{EVENT}', eventText).replace('{TARGET}', targetVillage ? targetVillage.name : ''), false);
      },
    });
  }

  // Reaktion auf Gottes Einflüsterung
  requestWhisperReaction(p, text, sim, done) {
    p.whisper = text;
    this.enqueue({
      priority: 1,
      system: this.baseSystem(p, sim),
      user: `${this.contextOf(p, sim)}\n\nEine übernatürliche Stimme in deinem Kopf hat gerade zu dir gesprochen: "${text}"\nWie reagierst du innerlich? GENAU EIN Satz in Ich-Form. Nimm die Stimme ernst${p.has('skeptisch') ? ', auch wenn du zweifelst' : ''}.`,
      maxTokens: 70,
      onResult: out => {
        const t = out.split('\n')[0].replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 160);
        done(t, true);
      },
      fallback: () => done(p.has('fromm') ? 'Die Götter haben zu mir gesprochen! Ich muss gehorchen.' : 'Was war das?! Eine Stimme… in meinem Kopf…', false),
    });
  }
}
