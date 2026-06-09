// brain.js — lokale KI (Ollama) als Gehirn der Bewohner
// Spricht die OpenAI-kompatible API (funktioniert auch mit LM Studio).
// Alles asynchron mit Prioritäts-Queue; regelbasierte Fallbacks halten
// die Welt am Leben, wenn das Modell nicht erreichbar oder ausgelastet ist.
import { pick, chance, JOB_LABEL } from './util.js';

const JOBHINT = p => JOB_LABEL[p.job] || 'Dorfbewohner';

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

  // Für kleine Modelle (3B): kurze System-Prompts, wenig Kontext, Beispiele.
  baseSystem(p, sim) {
    return `Du bist ${p.name}, ${Math.floor(p.age)} Jahre, ${p.traits.join(' und ')}. Du lebst in einem einfachen Dorf in alter Zeit. Antworte NUR auf Deutsch. Antworte NUR mit dem, was verlangt wird — keine Erklärungen, keine Anführungszeichen, kein Englisch.`;
  }

  contextOf(p, sim, maxMems = 2) {
    const parts = [];
    if (p.hunger > 60) parts.push('Du hast Hunger.');
    if (p.energy < 30) parts.push('Du bist erschöpft.');
    if (p.disease === 'sick') parts.push('Du bist krank und hast Fieber.');
    if (p.village && p.village.stock.food < p.village.pop) parts.push('Die Vorräte deines Dorfes sind knapp.');
    const mems = p.recentMemories(maxMems).map(m => `Du erinnerst dich: ${m.text}`);
    parts.push(...mems);
    if (p.whisper) parts.push(`Eine geheimnisvolle Stimme hat dir zugeflüstert: "${p.whisper}"`);
    return parts.join('\n');
  }

  // Antwort eines kleinen Modells aufräumen: Präfixe, Quotes, Markdown weg, ein Satz
  cleanLine(text, maxLen = 160) {
    let t = (text || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    t = t.replace(/^(Gedanke|Antwort|Satz|Ich denke|Reaktion|Gerücht)\s*:\s*/i, '');
    t = t.replace(/[*_#`]/g, '').replace(/^["'„»\s]+|["'“«\s]+$/g, '');
    // nach dem ersten Satzende abschneiden (lässt …, !, ? zu)
    const m = t.match(/^.+?[.!?…](?=\s|$)/);
    if (m && m[0].length > 12) t = m[0];
    return t.slice(0, maxLen);
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
      user: `${this.contextOf(p, sim)}\n\nSchreibe deinen aktuellen Gedanken. GENAU EIN kurzer Satz, Ich-Form.\nBeispiel: Ich hoffe, der Winter wird mild.\nDein Gedanke:`,
      maxTokens: 50,
      onResult: text => {
        const t = this.cleanLine(text);
        if (!t || t.length < 4) { p.currentThought = this.fallbackThought(p); p.thoughtIsAI = false; return; }
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
      system: `Du schreibst sehr kurze Dialoge zwischen Dorfbewohnern in alter Zeit. NUR Deutsch. Halte dich GENAU an das Format.`,
      user: `${a.name}: ${a.traits.join(', ')}, ${JOBHINT(a)}\n${b.name}: ${b.traits.join(', ')}, ${JOBHINT(b)}\n${relTxt} ${beliefTxt}\nLage: ${this.contextOf(a, sim, 1) || 'ein normaler Tag'}\n\nSchreibe 4 Dialogzeilen und eine Stimmungszeile. Format-Beispiel:\n${a.name}: Schöner Morgen heute.\n${b.name}: Ja, aber die Arbeit ruft.\n${a.name}: Hast du das Neueste gehört?\n${b.name}: Erzähl!\nSTIMMUNG: +1\n\n(STIMMUNG: +1 = freundlich, 0 = neutral, -1 = Streit)\nDein Dialog:`,
      maxTokens: 180,
      onResult: text => {
        const lines = text.split('\n').map(l => l.trim().replace(/[*_#`]/g, ''))
          .filter(l => /^[^:]{2,24}:\s?.+/.test(l) && !/^(STIMMUNG|Lage|Format)/i.test(l)).slice(0, 4);
        let mood = 0;
        const mm = text.match(/STIMMUNG\s*:?\s*([+-]?\s*\d)/i);
        if (mm) mood = Math.sign(parseInt(mm[1].replace(/\s/g, ''), 10) || 0);
        else if (/streit|wütend|zornig|hasse/i.test(text)) mood = -1;
        else mood = 1;
        done(lines.length >= 2 ? lines : null, mood, lines.length >= 2);
      },
      fallback: () => done(null, chance(0.7) ? 1 : 0, false),
    });
  }

  // Krieg/Frieden-Entscheidung des Anführers
  requestWarDecision(leader, ownV, targetV, sim, done) {
    this.enqueue({
      priority: 2,
      system: this.baseSystem(leader, sim),
      user: `Du bist Anführer des Dorfes ${ownV.name} (${ownV.pop} Einwohner). Das Nachbardorf ${targetV.name} ist euer Feind. ${this.contextOf(leader, sim, 1)}\n\nGreifst du ${targetV.name} an? Antworte in GENAU diesem Format:\nJA, weil <kurzer Grund>\noder\nNEIN, weil <kurzer Grund>\nDeine Antwort:`,
      maxTokens: 60,
      onResult: text => {
        const t = text.trim();
        const yes = /\bJA\b/i.test(t.slice(0, 20)) && !/\bNEIN\b/i.test(t.slice(0, 20));
        const rm = t.match(/weil\s+(.{4,140})/i);
        const reason = this.cleanLine(rm ? rm[1] : t.replace(/^[^,]*,?\s*/, ''), 140);
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
    const targetTxt = targetVillage ? ` Beschuldige das Dorf ${targetVillage.name}.` : '';
    this.enqueue({
      priority: 3,
      system: this.baseSystem(p, sim),
      user: `Es ist geschehen: ${eventText}.\n${angle}${targetTxt}\n\nErfinde das Gerücht, das du verbreitest. GENAU EIN dramatischer Satz.\nBeispiel: Die Götter haben uns gestraft, weil jemand den heiligen Stein berührt hat!\nDein Gerücht:`,
      maxTokens: 60,
      onResult: text => {
        const t = this.cleanLine(text, 180);
        if (!t || t.length < 8) {
          const tpl = targetVillage ? pick(FALLBACK_BLAME) : pick(FALLBACK_RUMORS);
          done(tpl.replace('{EVENT}', eventText).replace('{TARGET}', targetVillage ? targetVillage.name : ''), false);
          return;
        }
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
      user: `Eine übernatürliche Stimme in deinem Kopf hat gerade zu dir gesprochen: "${text}"\nWie reagierst du innerlich? GENAU EIN Satz, Ich-Form. Nimm die Stimme ernst${p.has('skeptisch') ? ', auch wenn du zweifelst' : ''}.\nBeispiel: Die Götter sprechen zu mir — ich muss handeln!\nDeine Reaktion:`,
      maxTokens: 60,
      onResult: out => {
        const t = this.cleanLine(out);
        if (!t || t.length < 4) { done(p.has('fromm') ? 'Die Götter haben zu mir gesprochen!' : 'Was war das für eine Stimme…?', false); return; }
        done(t, true);
      },
      fallback: () => done(p.has('fromm') ? 'Die Götter haben zu mir gesprochen! Ich muss gehorchen.' : 'Was war das?! Eine Stimme… in meinem Kopf…', false),
    });
  }
}
