// ui.js — Panels, Chronik, Gott-Werkzeuge, Einstellungen
import { dist, JOB_LABEL, clamp } from './util.js';
import { TILE } from './world.js';
import { Person } from './agents.js';

export class UI {
  constructor(sim, renderer, brain) {
    this.sim = sim;
    this.renderer = renderer;
    this.brain = brain;
    this.selected = null;   // Person | Village | null
    this.tool = null;       // 'meteor' | 'blitz' | null
    this.speed = 1;
    this.paused = false;
    this.$ = id => document.getElementById(id);
    this.bind();
    sim.onEvent = e => this.addChronicle(e);
    brain.onStatus = ok => this.renderKiStatus(ok);
  }

  bind() {
    const canvas = this.renderer.canvas;
    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      const { x, y } = this.renderer.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      this.onMapClick(x, y);
    });
    window.addEventListener('resize', () => this.renderer.resize());

    for (const [id, sp] of [['speed-1', 1], ['speed-4', 4], ['speed-16', 16]]) {
      this.$(id).addEventListener('click', () => {
        this.speed = sp; this.paused = false;
        this.markSpeed();
      });
    }
    this.$('speed-0').addEventListener('click', () => { this.paused = !this.paused; this.markSpeed(); });
    this.markSpeed();

    // Gott-Werkzeuge
    this.$('god-meteor').addEventListener('click', () => this.setTool('meteor', '☄️ Klicke auf die Karte, wo der Meteor einschlagen soll'));
    this.$('god-blitz').addEventListener('click', () => this.setTool('blitz', '⚡ Klicke auf einen Menschen, den der Blitz treffen soll'));
    this.$('god-seuche').addEventListener('click', () => this.sim.godPlague());
    this.$('god-duerre').addEventListener('click', () => this.sim.godDrought());
    this.$('god-prophet').addEventListener('click', () => this.sim.godProphet());
    this.$('god-whisper').addEventListener('click', () => this.whisper());

    // Einstellungen
    this.$('ki-status').addEventListener('click', () => this.$('settings').classList.toggle('open'));
    this.$('settings-close').addEventListener('click', () => this.$('settings').classList.remove('open'));
    this.$('settings-connect').addEventListener('click', async () => {
      this.brain.baseUrl = this.$('settings-url').value.trim().replace(/\/+$/, '');
      localStorage.setItem('genesis.url', this.brain.baseUrl);
      this.$('settings-info').textContent = 'Verbinde…';
      const ok = await this.brain.connect();
      this.renderModelSelect();
      this.$('settings-info').textContent = ok
        ? `Verbunden! ${this.brain.models.length} Modelle gefunden.`
        : 'Keine Verbindung. Läuft Ollama? (ollama serve) — und die Seite muss über http://localhost geöffnet sein.';
    });
    this.$('settings-url').value = this.brain.baseUrl;
    this.$('settings-model').addEventListener('change', e => {
      this.brain.model = e.target.value;
      localStorage.setItem('genesis.model', this.brain.model);
    });
  }

  setTool(tool, hint) {
    this.tool = this.tool === tool ? null : tool;
    this.$('god-hint').textContent = this.tool ? hint : '';
  }

  whisper() {
    if (!(this.selected instanceof Person)) {
      this.$('god-hint').textContent = '👁️ Wähle zuerst einen Menschen aus (anklicken), dem du etwas einflüstern willst.';
      return;
    }
    const text = prompt(`Was flüsterst du ${this.selected.name} ins Ohr?`,
      'Traue dem Anführer nicht. Er verbirgt etwas vor euch allen.');
    if (text) this.sim.godWhisper(this.selected, text.trim());
  }

  onMapClick(x, y) {
    if (this.tool === 'meteor') { this.sim.godMeteor(x, y); this.setTool(null); return; }
    let person = null, pd = 12;
    for (const p of this.sim.people) {
      const d = dist(p.x, p.y, x, y);
      if (d < pd) { pd = d; person = p; }
    }
    if (this.tool === 'blitz') {
      if (person) { this.sim.godLightning(person); this.setTool(null); }
      return;
    }
    if (person) { this.select(person); return; }
    for (const v of this.sim.villages) {
      if (dist(v.cx, v.cy, x, y) < TILE * 4) { this.select(v); return; }
    }
    this.select(null);
  }

  select(obj) {
    this.selected = obj;
    if (obj instanceof Person) this.brain.requestThought(obj, this.sim, 2);
    this.refreshInspector();
  }

  markSpeed() {
    for (const id of ['speed-0', 'speed-1', 'speed-4', 'speed-16']) this.$(id).classList.remove('on');
    this.$(this.paused ? 'speed-0' : 'speed-' + this.speed).classList.add('on');
  }

  renderKiStatus(ok) {
    const el = this.$('ki-status');
    el.textContent = ok ? `🟢 KI: ${this.brain.model.split(':')[0]}` : '🔴 KI offline (Fallback) — klicken';
    el.className = ok ? 'ki ok' : 'ki off';
  }

  renderModelSelect() {
    const sel = this.$('settings-model');
    sel.innerHTML = '';
    for (const m of this.brain.models) {
      const o = document.createElement('option');
      o.value = m; o.textContent = m;
      if (m === this.brain.model) o.selected = true;
      sel.appendChild(o);
    }
  }

  addChronicle(e) {
    const feed = this.$('chronicle');
    const div = document.createElement('div');
    div.className = 'chron-entry' + (e.imp >= 3 ? ' big' : '');
    div.innerHTML = `<span class="time">${e.time}</span> ${escapeHtml(e.text)}`;
    feed.prepend(div);
    while (feed.children.length > 120) feed.removeChild(feed.lastChild);
  }

  // regelmäßiges UI-Update
  refresh() {
    const s = this.sim;
    this.$('time').textContent = `${s.timeLabel()} ${s.isNight ? '🌙' : '☀️'}`;
    this.$('stat-pop').textContent = s.people.length;
    this.$('stat-villages').textContent = s.villages.length;
    this.$('stat-rumors').textContent = s.rumors.filter(r => r.text).length;
    const sick = s.people.filter(p => p.disease === 'sick').length;
    this.$('stat-sick').textContent = sick;
    this.$('stat-sick').parentElement.style.color = sick > 0 ? '#7CFC00' : '';
    this.refreshInspector();
  }

  refreshInspector() {
    const el = this.$('inspector');
    const sel = this.selected;
    if (!sel) { el.innerHTML = '<div class="empty">Klicke auf einen Menschen oder ein Dorf, um hineinzuschauen.<br><br>Du bist Gott. 👁️</div>'; return; }
    if (sel instanceof Person) {
      if (sel.dead) { this.selected = null; this.refreshInspector(); return; }
      el.innerHTML = this.personHtml(sel);
      // Beziehungs-Links klickbar machen
      el.querySelectorAll('[data-pid]').forEach(a => a.addEventListener('click', () => {
        const p = this.sim.personById(parseInt(a.dataset.pid, 10));
        if (p) this.select(p);
      }));
    } else {
      if (!this.sim.villages.includes(sel)) { this.selected = null; this.refreshInspector(); return; }
      el.innerHTML = this.villageHtml(sel);
      el.querySelectorAll('[data-pid]').forEach(a => a.addEventListener('click', () => {
        const p = this.sim.personById(parseInt(a.dataset.pid, 10));
        if (p) this.select(p);
      }));
    }
  }

  personHtml(p) {
    const s = this.sim;
    const bar = (label, v, color) =>
      `<div class="bar-row"><span>${label}</span><div class="bar"><div style="width:${clamp(v, 0, 100)}%;background:${color}"></div></div></div>`;
    const partner = p.partner ? s.personById(p.partner) : null;
    const rels = [...p.relations.entries()]
      .map(([id, score]) => ({ p: s.personById(id), score }))
      .filter(r => r.p && !r.p.dead)
      .sort((a, b) => b.score - a.score);
    const top = rels.slice(0, 3);
    const worst = rels.length > 3 ? rels[rels.length - 1] : null;
    const beliefs = p.beliefs.map(id => s.rumorById(id)).filter(r => r && r.text);
    const mems = [...p.memories].slice(-6).reverse();
    const sickTag = p.disease === 'sick' ? ' <span style="color:#7CFC00">🦠 krank</span>' : '';
    return `
      <h2>${p.name}${sickTag}</h2>
      <div class="meta">${Math.floor(p.age)} Jahre · ${JOB_LABEL[p.job]}${p.village ? ' · ' + p.village.name : ' · heimatlos'}</div>
      <div class="meta traits">${p.traits.join(' · ')}</div>
      <div class="thought">${p.thoughtIsAI ? '✨' : '💭'} <em>${escapeHtml(p.currentThought || '…')}</em></div>
      ${bar('Hunger', p.hunger, p.hunger > 70 ? '#e05555' : '#c9a045')}
      ${bar('Energie', p.energy, '#5b9bd5')}
      ${bar('Sozial', p.social, '#b07cc6')}
      ${bar('Gesundheit', p.health, p.health < 40 ? '#e05555' : '#6abf69')}
      ${partner ? `<div class="sec">❤️ Partner: <a data-pid="${partner.id}">${partner.name}</a></div>` : ''}
      ${top.length ? `<div class="sec"><b>Beziehungen</b>${top.map(r => `<div><a data-pid="${r.p.id}">${r.p.name}</a> <span class="${r.score >= 0 ? 'pos' : 'neg'}">${r.score > 0 ? '+' : ''}${Math.round(r.score)}</span></div>`).join('')}
        ${worst && worst.score < 0 ? `<div><a data-pid="${worst.p.id}">${worst.p.name}</a> <span class="neg">${Math.round(worst.score)}</span></div>` : ''}</div>` : ''}
      ${beliefs.length ? `<div class="sec"><b>Glaubt an</b>${beliefs.map(r => `<div class="belief">🗣️ „${escapeHtml(r.text)}“</div>`).join('')}</div>` : ''}
      <div class="sec"><b>Erinnerungen</b>${mems.map(m => `<div class="mem">· ${escapeHtml(m.text)}</div>`).join('') || '<div class="mem">noch keine</div>'}</div>`;
  }

  villageHtml(v) {
    const s = this.sim;
    const counts = {};
    for (const b of v.buildings) if (b.progress >= 1) counts[b.type] = (counts[b.type] || 0) + 1;
    const bLabels = { feuer: '🔥 Feuer', huette: '🛖 Hütten', farm: '🌾 Farmen', brunnen: '💧 Brunnen', heiler: '🌿 Heiler', tempel: '⛩️ Tempel' };
    const rels = s.villages.filter(o => o !== v).map(o =>
      `<div>${o.name} <span class="${v.relTo(o) >= 0 ? 'pos' : 'neg'}">${Math.round(v.relTo(o))}</span>${v.relTo(o) < -45 ? ' ⚔️' : ''}</div>`).join('');
    return `
      <h2><span style="color:${v.color}">●</span> ${v.name}</h2>
      <div class="meta">gegründet Jahr ${v.foundedYear} · ${v.pop} Einwohner</div>
      <div class="sec"><b>Vorräte</b>
        <div>🍖 Essen: ${Math.floor(v.stock.food)} · 🪵 Holz: ${Math.floor(v.stock.wood)} · 🪨 Stein: ${Math.floor(v.stock.stone)}</div></div>
      <div class="sec"><b>Gebäude</b><div>${Object.entries(counts).map(([t, n]) => `${bLabels[t]} ×${n}`).join(' · ') || 'nur ein Lagerplatz'}</div></div>
      ${v.leader ? `<div class="sec">👑 Anführer: <a data-pid="${v.leader.id}">${v.leader.name}</a></div>` : ''}
      ${rels ? `<div class="sec"><b>Verhältnis zu anderen Dörfern</b>${rels}</div>` : ''}
      <div class="sec"><b>Bewohner</b>${v.members.map(p => `<div><a data-pid="${p.id}">${p.name}</a> <span class="meta">(${Math.floor(p.age)}, ${JOB_LABEL[p.job]})</span></div>`).join('')}</div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
