/**
 * Boost hints: while you hover a card in the hand, the free tiles where that building would be boosted glow faintly,
 * brighter while you place the card: the same glow as a boosted building's tile (neonGlow.js createGlow), in the
 * colour of the building that gets boosted. For a building, the free tiles next to its boosters; for a booster, the
 * free tiles next to the buildings it boosts. While placing a booster, its area (the 4 tiles around the one under the
 * pointer) glows too and follows the pointer.
 */
import { NEON, LIFT, GLOW_OPACITY, createGlow } from './neonGlow.js';

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
};
/** Booster card -> the colour of the buildings it boosts, for its area around the pointer while placing it. */
const AREA = {
  pump: NEON.farm,
  oasis: NEON.farm,
  tarpit: NEON.station,
  refinery: NEON.station,
  labourcamp: NEON.settlement,
};
const HOVER = 0.45; // glow strength while hovering the card (share of a one-booster building's glow)
const PLACING = 1; // while placing it
const FADE = 8; // how quickly the glows follow (per second)
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

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
  update(dt, time, grid, terrain, placing, cursor = null) {
    const hint = HINTS[terrain];
    const key = hint ? `${terrain}|${grid.cells.size}|${this.#boardStamp(grid)}` : '';
    if (key !== this.#key) {
      this.#key = key;
      this.#retarget(grid, hint);
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
    this.#updateArea(k, time, placing && cursor ? AREA[terrain] : null, cursor);
  }

  /** The booster's area: 4 glows on the tiles around the pointer's, moved along with it. */
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
      if (colour) glow.group.position.set(cursor[0] + DIRS[i][0], LIFT, cursor[1] + DIRS[i][1]);
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
  #retarget(grid, hint) {
    const spots = new Set();
    if (hint) {
      for (const cell of grid.cells.values()) {
        if (!hint.near.includes(cell.terrain) || cell.mesh?.userData.idle) continue; // an idle booster boosts nothing
        for (const [dx, dz] of DIRS) {
          const x = cell.x + dx;
          const z = cell.z + dz;
          if (!grid.has(x, z) && grid.allowed(x, z)) spots.add(`${x},${z}|${hint.colour}`);
        }
      }
    }
    for (const [spot, h] of this.#glows) h.live = spots.has(spot);
    for (const spot of spots) {
      if (this.#glows.has(spot)) continue;
      const [x, z] = spot.split('|')[0].split(',').map(Number);
      const glow = createGlow(hint.colour, 'boost hint');
      glow.setLevel(1);
      glow.group.position.set(x, LIFT, z);
      this.scene.add(glow.group);
      this.#glows.set(spot, { glow, live: true, opacity: 0, phase: Math.random() * 100 });
    }
  }
}
