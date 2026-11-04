/**
 * Boost hints: while you hover a card in the hand, the free tiles where that building would be boosted glow faintly,
 * brighter while you place the card: the same glow as a boosted building's tile (neonGlow.js createGlow), in the
 * colour of the building that gets boosted. For a building, the free tiles next to its boosters; for a booster, the
 * free tiles next to the buildings it boosts. While placing a booster, its area (the 6 tiles around the one under the
 * pointer) glows too and follows the pointer.
 */
import { NEON, LIFT, GLOW_OPACITY, createGlow } from './neonGlow.js';
import { DIRS, hexToWorld, hexesAround } from './grid.js';
import { BOOST } from './arsenal.js';

/** Card -> the tiles that make a free neighbouring cell a boosted spot for it, and the glow colour. */
const HINTS = {
  farm: { near: ['pump', 'oasis', 'capital'], colour: NEON.farm },
  station: { near: ['tarpit', 'capital', 'refinery'], colour: NEON.station },
  settlement: { near: ['labourcamp'], colour: NEON.settlement },
  pump: { near: ['farm'], colour: NEON.farm },
  oasis: { near: ['farm'], colour: NEON.farm },
  tarpit: { near: ['station'], colour: NEON.station },
  refinery: { near: ['station'], colour: NEON.station },
  labourcamp: { near: ['settlement'], colour: NEON.settlement },
  milfactory: { near: ['missilelab', 'warhead'], colour: NEON.milfactory },
  missilelab: { near: ['milfactory'], colour: NEON.missilelab },
  warhead: { near: ['milfactory'], colour: NEON.missilelab },
  // Launch Accelerator: launchers within its radius (not just next door).
  magazine: { near: ['booster'], colour: NEON.magazine, radius: () => BOOST.radius },
  decoyworks: { near: ['booster'], colour: NEON.magazine, radius: () => BOOST.radius },
  booster: { near: ['magazine', 'decoyworks'], colour: NEON.magazine, radius: () => BOOST.radius },
};
/** Booster card -> the colour of the buildings it boosts, for its area around the pointer while placing it. */
/** Action card -> glow every tile of this terrain (where the card is played). */
const TARGETS = {
  overtime: { terrain: 'milfactory', colour: NEON.milfactory },
};
const AREA = {
  pump: NEON.farm,
  oasis: NEON.farm,
  tarpit: NEON.station,
  refinery: NEON.station,
  labourcamp: NEON.settlement,
  missilelab: NEON.missilelab,
  warhead: NEON.missilelab,
};
const HOVER = 0.45; // glow strength while hovering the card (share of a one-booster building's glow)
const PLACING = 1; // while placing it
const FADE = 8; // how quickly the glows follow (per second)

export class BoostHints {
  #key = ''; // what the current hints are for (card + board), to recount only when it changes
  #glows = new Map(); // "x,z|colour" -> { glow, target, opacity }
  #area = { colour: null, glows: [], opacity: 0 }; // the placed booster's area, around the pointer

  constructor(scene) {
    this.scene = scene;
  }

  /**
   * Every frame. `terrain`: the card hovered or being placed (null for none); `placing`: true while placing it;
   * `cursor`: the cell [x, z] under the pointer (null for none).
   */
  update(dt, time, grid, terrain, placing, cursor = null, invalid = false) {
    const hint = HINTS[terrain];
    const target = TARGETS[terrain];
    const key = hint || target ? `${terrain}|${grid.cells.size}|${this.#boardStamp(grid)}` : '';
    if (key !== this.#key) {
      this.#key = key;
      this.#retarget(grid, hint, target);
    }
    const strength = placing ? PLACING : HOVER;
    const k = Math.min(1, dt * FADE);
    for (const [spot, h] of this.#glows) {
      const target = h.live ? strength : 0;
      h.opacity += (target - h.opacity) * k;
      if (!h.live && h.opacity < 0.003) {
        h.glow.dispose();
        this.#glows.delete(spot);
        continue;
      }
      h.glow.paint(h.opacity * GLOW_OPACITY, time + h.phase);
    }
    const areaColour = placing && cursor && AREA[terrain] ? (invalid ? 0xff4a4a : AREA[terrain]) : null;
    this.#updateArea(k, time, areaColour, cursor);
  }

  /** The booster's area: 6 glows on the tiles around the pointer's, moved along with it. */
  #updateArea(k, time, colour, cursor) {
    const area = this.#area;
    if (colour && colour !== area.colour) {
      for (const glow of area.glows) glow.dispose();
      area.glows = DIRS.map(() => {
        const glow = createGlow(colour, 'boost area');
        glow.setLevel(1);
        this.scene.add(glow.group);
        return glow;
      });
      area.colour = colour;
      area.opacity = 0;
    }
    if (!area.glows.length) return;
    area.opacity += ((colour ? PLACING : 0) - area.opacity) * k;
    const visible = area.opacity > 0.003;
    area.glows.forEach((glow, i) => {
      glow.group.visible = visible;
      if (!visible) return;
      if (colour) {
        const w = hexToWorld(cursor[0] + DIRS[i][0], cursor[1] + DIRS[i][1]);
        glow.group.position.set(w.x, LIFT, w.z);
      }
      glow.paint(area.opacity * GLOW_OPACITY, time + i * 17);
    });
  }

  /** Changes whenever a tile is placed, removed or replaced (a cheap fingerprint of the board). */
  #boardStamp(grid) {
    let h = 0;
    for (const c of grid.cells.values()) h = (h * 31 + c.x * 7 + c.z * 13 + c.terrain.length) | 0;
    return h;
  }

  /** Glows for the spots of this card (new ones fade in), the others fade out. */
  #retarget(grid, hint, target) {
    const spots = new Set();
    if (target) {
      for (const cell of grid.cells.values()) {
        if (cell.terrain === target.terrain) spots.add(`${cell.x},${cell.z}|${target.colour}`);
      }
    } else if (hint) {
      for (const cell of grid.cells.values()) {
        if (!hint.near.includes(cell.terrain) || cell.mesh?.userData.idle) continue; // an idle booster boosts nothing
        for (const [x, z] of hexesAround(cell.x, cell.z, hint.radius?.() ?? 1)) {
          if (!grid.has(x, z) && grid.allowed(x, z)) spots.add(`${x},${z}|${hint.colour}`);
        }
      }
    }
    for (const [spot, h] of this.#glows) h.live = spots.has(spot);
    for (const spot of spots) {
      if (this.#glows.has(spot)) continue;
      const [x, z] = spot.split('|')[0].split(',').map(Number);
      const glow = createGlow((target || hint).colour, 'boost hint');
      glow.setLevel(1);
      const w = hexToWorld(x, z);
      glow.group.position.set(w.x, LIFT, w.z);
      this.scene.add(glow.group);
      this.#glows.set(spot, { glow, live: true, opacity: 0, phase: Math.random() * 100 });
    }
  }
}
