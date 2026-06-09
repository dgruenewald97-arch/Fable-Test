// render.js — Canvas-Darstellung der Welt
import { T, TILE, MAP_W, MAP_H } from './world.js';
import { BUILDINGS } from './village.js';
import { clamp } from './util.js';

const TERRAIN_COLORS = {
  [T.WATER]: '#1b3a5c', [T.SAND]: '#cbb476', [T.GRASS]: '#5a8f4a',
  [T.FOREST]: '#39663a', [T.ROCK]: '#7d7d84', [T.FARM]: '#a98f4e',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.terrain = document.createElement('canvas');
    this.terrain.width = MAP_W * TILE;
    this.terrain.height = MAP_H * TILE;
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.resize();
  }

  resize() {
    const wrap = this.canvas.parentElement;
    this.canvas.width = wrap.clientWidth;
    this.canvas.height = wrap.clientHeight;
    const sx = this.canvas.width / (MAP_W * TILE);
    const sy = this.canvas.height / (MAP_H * TILE);
    this.scale = Math.min(sx, sy);
    this.ox = (this.canvas.width - MAP_W * TILE * this.scale) / 2;
    this.oy = (this.canvas.height - MAP_H * TILE * this.scale) / 2;
  }

  toWorld(cx, cy) {
    return { x: (cx - this.ox) / this.scale, y: (cy - this.oy) / this.scale };
  }

  drawTerrain(sim) {
    const tc = this.terrain.getContext('2d');
    const w = sim.world;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = w.idx(x, y);
        const t = w.tiles[i];
        tc.fillStyle = TERRAIN_COLORS[t];
        tc.fillRect(x * TILE, y * TILE, TILE, TILE);
        // dezente Variation
        if ((x * 7 + y * 13) % 5 === 0) {
          tc.fillStyle = 'rgba(255,255,255,0.03)';
          tc.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      }
    }
  }

  draw(sim, ui) {
    const ctx = this.ctx;
    const w = sim.world;
    if (sim.terrainDirty) { this.drawTerrain(sim); sim.terrainDirty = false; }

    ctx.fillStyle = '#0a1320';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.scale, this.scale);
    ctx.drawImage(this.terrain, 0, 0);

    // Ressourcen: Bäume, Beeren, Stein
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = w.idx(x, y);
        const px = x * TILE, py = y * TILE;
        if (w.tiles[i] === T.FOREST && w.wood[i] > 0.5) {
          const s = clamp(w.wood[i] / 16, 0.3, 1);
          ctx.fillStyle = '#2c5430';
          ctx.beginPath();
          ctx.moveTo(px + TILE / 2, py + TILE * (1 - s) * 0.5 + 1);
          ctx.lineTo(px + 2, py + TILE - 2);
          ctx.lineTo(px + TILE - 2, py + TILE - 2);
          ctx.closePath();
          ctx.fill();
        } else if (w.berry[i] > 0.5) {
          ctx.fillStyle = '#c84b6e';
          ctx.beginPath();
          ctx.arc(px + TILE * 0.35, py + TILE * 0.45, 1.6, 0, 7);
          ctx.arc(px + TILE * 0.65, py + TILE * 0.6, 1.6, 0, 7);
          ctx.fill();
        } else if (w.tiles[i] === T.ROCK && w.stone[i] > 0.5) {
          ctx.fillStyle = '#9b9ba6';
          ctx.fillRect(px + 3, py + 5, 4, 3);
          ctx.fillRect(px + 7, py + 3, 3, 4);
        }
      }
    }

    // Dorf-Territorium (dezent)
    for (const v of sim.villages) {
      ctx.beginPath();
      ctx.arc(v.cx, v.cy, TILE * 9, 0, 7);
      ctx.strokeStyle = v.color + '33';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Gebäude
    for (const v of sim.villages) {
      for (const b of v.buildings) {
        const def = BUILDINGS[b.type];
        const px = b.x * TILE, py = b.y * TILE;
        const sz = TILE * def.size;
        const off = (TILE - sz) / 2;
        if (b.progress < 1) {
          ctx.strokeStyle = def.color;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 2]);
          ctx.strokeRect(px + off, py + off, sz, sz);
          ctx.setLineDash([]);
          ctx.fillStyle = def.color + '66';
          ctx.fillRect(px + off, py + off + sz * (1 - b.progress), sz, sz * b.progress);
        } else if (b.type === 'feuer') {
          ctx.fillStyle = '#5a4632';
          ctx.fillRect(px + 3, py + 7, 6, 3);
          const fl = 2 + Math.sin(sim.tick * 0.2 + b.id) * 1.2;
          ctx.fillStyle = '#ffb340';
          ctx.beginPath();
          ctx.moveTo(px + 6, py + 7 - fl - 2);
          ctx.lineTo(px + 3.5, py + 8);
          ctx.lineTo(px + 8.5, py + 8);
          ctx.closePath();
          ctx.fill();
        } else if (b.type === 'brunnen') {
          ctx.fillStyle = def.color;
          ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, sz / 2, 0, 7); ctx.fill();
          ctx.fillStyle = '#23445e';
          ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, sz / 4, 0, 7); ctx.fill();
        } else {
          // Haus mit Dach
          ctx.fillStyle = def.color;
          ctx.fillRect(px + off, py + off + sz * 0.3, sz, sz * 0.7);
          ctx.fillStyle = b.type === 'tempel' ? '#e8dcff' : '#6e4a2e';
          ctx.beginPath();
          ctx.moveTo(px + TILE / 2, py + off - 1);
          ctx.lineTo(px + off - 1, py + off + sz * 0.38);
          ctx.lineTo(px + off + sz + 1, py + off + sz * 0.38);
          ctx.closePath();
          ctx.fill();
          if (b.type === 'farm') {
            ctx.strokeStyle = '#8a7430';
            ctx.lineWidth = 0.8;
            for (let k = 1; k < 4; k++) {
              ctx.beginPath();
              ctx.moveTo(px + off, py + off + sz * 0.3 + k * sz * 0.16);
              ctx.lineTo(px + off + sz, py + off + sz * 0.3 + k * sz * 0.16);
              ctx.stroke();
            }
          }
        }
      }
      // Dorfname
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = v.color;
      ctx.fillText(v.name, v.cx, v.cy - TILE * 1.6);
    }

    // Menschen
    for (const p of sim.people) {
      const r = p.isChild ? 2.2 : 3.2;
      // Schatten
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + r * 0.8, r, r * 0.4, 0, 0, 7); ctx.fill();
      // Körper (Dorf-Farbe)
      ctx.fillStyle = p.village ? p.village.color : '#cccccc';
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
      // Kopf
      ctx.fillStyle = '#e8c39e';
      ctx.beginPath(); ctx.arc(p.x, p.y - r * 1.1, r * 0.62, 0, 7); ctx.fill();
      // Status-Marker
      if (p.disease === 'sick') {
        ctx.fillStyle = '#7CFC00';
        ctx.beginPath(); ctx.arc(p.x + r + 1.5, p.y - r, 1.6, 0, 7); ctx.fill();
      }
      if (p.state === 'raid' || p.state === 'fight') {
        ctx.strokeStyle = '#ff4040'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 2, 0, 7); ctx.stroke();
      }
      if (p.state === 'sleep') {
        ctx.fillStyle = '#aaccff'; ctx.font = '6px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('z', p.x + r + 2, p.y - r - 2);
      }
      // Auswahlring
      if (ui.selected === p) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 4 + Math.sin(sim.tick * 0.15) * 1.2, 0, 7); ctx.stroke();
      }
    }

    // Sprechblasen
    ctx.font = '8.5px sans-serif';
    for (const p of sim.people) {
      if (!p.bubble || p.bubble.i >= p.bubble.lines.length) continue;
      const text = p.bubble.lines[p.bubble.i];
      const tw = Math.min(ctx.measureText(text).width + 10, 190);
      const lines = wrapText(ctx, text, 180);
      const bh = lines.length * 10 + 7;
      let bx = clamp(p.x - tw / 2, 4, MAP_W * TILE - tw - 4);
      let by = clamp(p.y - 16 - bh, 4, MAP_H * TILE);
      ctx.fillStyle = 'rgba(252,252,255,0.95)';
      roundRect(ctx, bx, by, tw, bh, 4);
      ctx.fill();
      ctx.fillStyle = '#1a2030';
      ctx.textAlign = 'left';
      lines.forEach((ln, k) => ctx.fillText(ln, bx + 5, by + 11 + k * 10));
    }

    // Nacht-Overlay
    const ph = sim.dayPhase;
    let dark = 0;
    if (ph < 0.16) dark = 0.55 * (1 - ph / 0.16);
    else if (ph > 0.82) dark = 0.55 * ((ph - 0.82) / 0.18);
    if (dark > 0.02) {
      ctx.fillStyle = `rgba(8, 12, 38, ${dark})`;
      ctx.fillRect(0, 0, MAP_W * TILE, MAP_H * TILE);
    }
    // Dürre-Tönung
    if (sim.droughtT > 0) {
      ctx.fillStyle = 'rgba(255, 160, 40, 0.10)';
      ctx.fillRect(0, 0, MAP_W * TILE, MAP_H * TILE);
    }

    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const wd of words) {
    const test = cur ? cur + ' ' + wd : wd;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = wd; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}
