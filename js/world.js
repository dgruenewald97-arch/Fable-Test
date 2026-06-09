// world.js — prozedurale Insel-Karte mit Ressourcen
import { makeNoise, clamp, RI, chance } from './util.js';

export const TILE = 12;
export const MAP_W = 104;
export const MAP_H = 68;

export const T = { WATER: 0, SAND: 1, GRASS: 2, FOREST: 3, ROCK: 4, FARM: 5 };

export class World {
  constructor(seed = RI(1, 1e9)) {
    this.seed = seed;
    const n = MAP_W * MAP_H;
    this.tiles = new Uint8Array(n);
    this.wood = new Float32Array(n);   // Holz in Waldkacheln
    this.berry = new Float32Array(n);  // Beeren auf Graskacheln
    this.stone = new Float32Array(n);  // Stein in Felskacheln
    this.buildAt = new Map();          // "x,y" -> building
    this.generate();
  }

  idx(x, y) { return y * MAP_W + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }
  type(x, y) { return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : T.WATER; }
  isLand(x, y) { return this.type(x, y) !== T.WATER; }
  isWalkable(x, y) { return this.isLand(x, y) && !this.buildAt.has(x + ',' + y); }

  generate() {
    const elev = makeNoise(this.seed);
    const moist = makeNoise(this.seed + 7777);
    const cx = MAP_W / 2, cy = MAP_H / 2;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        // radiale Insel-Maske
        const dx = (x - cx) / cx, dy = (y - cy) / cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const e = elev(x * 0.06, y * 0.06) - d * d * 0.65;
        const m = moist(x * 0.09, y * 0.09);
        const i = this.idx(x, y);
        if (e < 0.18) { this.tiles[i] = T.WATER; continue; }
        if (e < 0.23) { this.tiles[i] = T.SAND; continue; }
        if (e > 0.62) {
          this.tiles[i] = T.ROCK;
          this.stone[i] = 14 + m * 10;
        } else if (m > 0.56) {
          this.tiles[i] = T.FOREST;
          this.wood[i] = 8 + m * 8;
        } else {
          this.tiles[i] = T.GRASS;
          if (chance(0.18)) this.berry[i] = 4 + m * 5;
        }
      }
    }
  }

  // langsames Nachwachsen von Beeren & Wald
  regrow() {
    for (let k = 0; k < 60; k++) {
      const i = RI(0, this.tiles.length - 1);
      const t = this.tiles[i];
      if (t === T.GRASS && this.berry[i] > 0 && this.berry[i] < 9) this.berry[i] += 0.5;
      else if (t === T.FOREST && this.wood[i] < 16) this.wood[i] += 0.4;
      else if (t === T.GRASS && this.berry[i] === 0 && chance(0.04)) this.berry[i] = 1;
    }
  }

  // Spiralsuche: nächste Kachel mit Bedingung
  findNear(tx, ty, maxR, pred) {
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (this.inBounds(x, y) && pred(x, y, this.idx(x, y))) return { x, y };
        }
      }
    }
    return null;
  }

  // Bewertung als Siedlungsplatz: Wasser + Wald + fruchtbares Land in der Nähe
  siteScore(tx, ty) {
    if (!this.isLand(tx, ty) || this.type(tx, ty) === T.ROCK) return -1;
    let water = 0, forest = 0, grass = 0, rock = 0;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const t = this.type(tx + dx, ty + dy);
        if (t === T.WATER) water++;
        else if (t === T.FOREST) forest++;
        else if (t === T.GRASS) grass++;
        else if (t === T.ROCK) rock++;
      }
    }
    if (grass < 14) return -1; // Platz zum Bauen nötig
    return Math.min(water, 14) * 1.6 + Math.min(forest, 22) + grass * 0.55 + Math.min(rock, 8) * 0.8;
  }
}
