import * as THREE from 'three';
import { pieceOffsets } from './pieces.js';
import { inWorld } from './grid.js';
import { hasBlockout } from './models.js';
import { ACTIONS, TERRAINS, cardDef, isBuilding, isCamp, applyTileGap, fitFull } from './tiles.js';
import { L, both, onLangChange } from './i18n.js';

const OK_COLOR = new THREE.Color(0x8be39a);
const BAD_COLOR = new THREE.Color(0xe0563f);
const HOVER_Y = 0.5;
/**
 * Render layer for the ghost. The main render skips it; main.js draws it in a second pass after everything
 * else (depth cleared), so the preview always shows on top of the fog of war and the tiles around it.
 */
export const GHOST_LAYER = 1;
const toGhostLayer = (o) => o.layers.set(GHOST_LAYER);
const goal = new THREE.Vector3(); // reused every frame
/** How fast a rotation swings into place (1/s): higher is snappier. ~0.15s to settle. */
const SPIN_RATE = 26;
/** A full-cell ghost part in a holder (the holder takes the offset; the part shrinks by the tile gap). */
function cellPart(geo, mat) {
  const holder = new THREE.Group();
  holder.add(applyTileGap(fitFull(new THREE.Mesh(geo, mat))));
  return holder;
}

/** Placement preview look (Game Debug → Placement preview), saved to localStorage. Read live every frame. */
export const PREVIEW_DEFAULTS = {
  frontierOpacity: 0.15, // pale squares on every empty cell next to your land (frontier.js)
  validOpacity: 0.4, // green footprint under the piece where it can go
  invalidOpacity: 0.4, // red footprint where it can't
  blockOpacity: 0.8, // the plain coloured stand-in blocks (tiles with a 3D model show the model as is)
};
export const PREVIEW_PARAMS = [
  { group: 'Placement preview' },
  { key: 'frontierOpacity', label: 'Open cell opacity', min: 0, max: 1, step: 0.01, hint: 'pale squares on empty cells next to your land' },
  { key: 'validOpacity', label: 'Valid footprint opacity', min: 0, max: 1, step: 0.01 },
  { key: 'invalidOpacity', label: 'Invalid footprint opacity', min: 0, max: 1, step: 0.01 },
  { key: 'blockOpacity', label: 'Stand-in block opacity', min: 0, max: 1, step: 0.01, hint: 'only tiles without a 3D model' },
];
const PREVIEW_KEY = 'oto.previewConfig';
export function loadPreviewConfig() {
  const cfg = { ...PREVIEW_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? '{}');
    for (const k of Object.keys(cfg)) if (typeof saved[k] === 'number') cfg[k] = saved[k];
  } catch {
    /* keep defaults */
  }
  return cfg;
}
export const savePreviewConfig = (cfg) => localStorage.setItem(PREVIEW_KEY, JSON.stringify(cfg));
export const clearPreviewConfig = () => localStorage.removeItem(PREVIEW_KEY);

/**
 * Ghost preview for the selected piece: floating blocks that follow the cursor
 * plus a footprint on the board showing exactly where it would land.
 */
export class Placement {
  piece = null;
  offsets = [];
  cell = null;
  result = { ok: false, reason: '' };
  shake = 0;
  spin = 0; // radians the ghost still has to turn (eases to 0), so a rotation swings instead of snapping
  base = new THREE.Vector3(); // eased hover position, before the spin and shake offsets
  spinCentre = new THREE.Vector3(); // centre of the piece's cells (local), the point it turns around
  #last = null; // piece and rotation last shown, to tell a rotation from a new piece
  #lastRot = 0;

  constructor(scene, grid, factory, cfg = { ...PREVIEW_DEFAULTS }) {
    this.cfg = cfg;
    this.grid = grid;
    this.factory = factory;
    const s = 1;

    this.blocks = new THREE.Group();
    this.feet = new THREE.Group();
    this.blocks.visible = this.feet.visible = false;
    scene.add(this.blocks, this.feet);

    this.blockGeo = new THREE.BoxGeometry(s, 0.3, s);
    this.footGeo = new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2);
    this.blockMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.8, roughness: 0.8 });
    this.footMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false });
    // The reason text is cached per cell: rebuild it in the new language.
    onLangChange(() => {
      if (this.piece && this.cell) this.result = this.validate(this.cellsAt(this.cell));
    });
  }

  setPiece(piece) {
    this.#build(piece);
    this.blocks.traverse(toGhostLayer);
    this.feet.traverse(toGhostLayer);
  }

  #build(piece) {
    // Same piece, new rotation: the ghost is rebuilt in the new orientation, then shown turned back by the
    // difference and eased forward to 0. rotateCells turns (x, z) -> (-z, x), which is -90° about Y in three.js,
    // so one step forward starts at +90°. Rotating again mid-swing adds to what is left.
    if (piece && piece === this.#last && piece.rot !== this.#lastRot) {
      let d = (piece.rot - this.#lastRot + 4) % 4;
      if (d === 3) d = -1;
      this.spin += d * (Math.PI / 2);
    } else {
      this.spin = 0;
    }
    this.#last = piece;
    this.#lastRot = piece?.rot ?? 0;
    this.piece = piece;
    this.tinted = null; // new ghost materials: re-tint on the next update
    this.blocks.clear();
    this.feet.clear();
    this.cell = null;
    if (!piece) {
      this.blocks.visible = this.feet.visible = false;
      return;
    }
    const action = ACTIONS[piece.terrain];
    if (action) {
      // Action cards: no blocks, just a footprint over the cells they affect.
      this.offsets = [];
      if (action.size) {
        for (let dx = 0; dx < action.size; dx++) for (let dz = 0; dz < action.size; dz++) this.offsets.push([dx, dz]);
      } else {
        const r = action.range;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) this.offsets.push([dx, dz]);
      }
      for (const [ox, oz] of this.offsets) {
        const f = cellPart(this.footGeo, this.footMat);
        f.position.set(ox, 0.015, oz);
        this.feet.add(f);
      }
      return;
    }
    this.offsets = pieceOffsets(piece);
    this.spinCentre.set(
      this.offsets.reduce((a, o) => a + o[0], 0) / this.offsets.length,
      0,
      this.offsets.reduce((a, o) => a + o[1], 0) / this.offsets.length,
    );
    const blockout = hasBlockout(piece.terrain) && this.factory?.models?.has(piece.terrain);
    // Wasteland previews as its whole-piece model, centred on the piece's cells.
    const wholePiece = piece.terrain.startsWith('wasteland') ? this.factory?.previewPiece(piece.shape, piece.rot) : null;
    if (wholePiece) {
      const xs = this.offsets.map((o) => o[0]);
      const zs = this.offsets.map((o) => o[1]);
      wholePiece.position.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
      this.blocks.add(wholePiece);
    }
    for (const [ox, oz] of this.offsets) {
      if (!wholePiece) {
        const b = blockout ? this.factory.preview(piece.terrain) : cellPart(this.blockGeo, this.blockMat);
        b.position.set(ox, 0, oz);
        if (!blockout) b.children[0].castShadow = true;
        this.blocks.add(b);
      }
      const f = cellPart(this.footGeo, this.footMat);
      f.position.set(ox, 0.015, oz);
      this.feet.add(f);
    }
  }

  cellsAt(cell) {
    return this.offsets.map(([ox, oz]) => [cell[0] + ox, cell[1] + oz]);
  }

  /** The cells among `cells` holding a tile that Demolish may remove (not a Capital or a camp). */
  demolishable(cells) {
    return cells.filter(([x, z]) => {
      const cell = this.grid.get(x, z);
      return cell && cell.terrain !== 'capital' && !isCamp(cell.terrain);
    });
  }

  validate(cells) {
    if (this.piece?.terrain === 'spark') {
      if (!cells.some(([x, z]) => this.grid.has(x, z))) return { ok: false, reason: L('No tiles in range', '范围内没有地块') };
      return { ok: true, reason: '' };
    }
    if (this.piece?.terrain === 'demolish') {
      const cell = this.grid.get(...cells[0]);
      if (!cell) return { ok: false, reason: L('Nothing to demolish here', '这里没有可拆除的东西') };
      if (cell.terrain === 'capital') return { ok: false, reason: L("A Capital can't be demolished", '首都不能被拆除') };
      if (isCamp(cell.terrain)) return { ok: false, reason: L('Send in the Militia to clear camps', '派遣民兵来清除营地') };
      return { ok: true, reason: '' };
    }
    if (this.piece?.terrain === 'demolish2') {
      if (!this.demolishable(cells).length) return { ok: false, reason: L('Nothing to demolish here', '这里没有可拆除的东西') };
      return { ok: true, reason: '' };
    }
    if (this.piece?.terrain === 'militia') {
      const cell = this.grid.get(...cells[0]);
      if (!cell || !isCamp(cell.terrain)) return { ok: false, reason: L('The militia only clears bandit and rebel camps', '民兵只能清除匪营和叛军营地') };
      return { ok: true, reason: '' };
    }
    // Optional extra rule (the tutorial: only the highlighted cells).
    const guarded = this.guard?.(cells, this.piece);
    if (guarded) return guarded;
    const building = this.piece && isBuilding(this.piece.terrain);
    if (cells.some(([x, z]) => !inWorld(x, z))) return { ok: false, reason: L('Edge of the world', '世界边缘') };
    if (cells.some(([x, z]) => !this.grid.allowed(x, z))) return { ok: false, reason: L('Outside your territory', '超出你的领地') };
    if (!this.grid.expansionMode && this.mysteries && cells.some(([x, z]) => this.mysteries.has(x, z)))
      return { ok: false, reason: L('Build next to a ? site to uncover it', '在“?”神秘地点旁建造即可揭开它') };
    for (const [x, z] of cells) {
      const cell = this.grid.get(x, z);
      if (!cell) continue;
      const t = TERRAINS[cell.terrain];
      if (building && t.buildable) continue; // buildings may go on Wasteland / Ruins
      if (t.buildable) return { ok: false, reason: both(() => L(`Only buildings can go on ${t.name}`, `只有建筑可以放在${t.name}上`)) };
      return { ok: false, reason: both(() => L(`Can't build on ${t.name}`, `不能在${t.name}上建造`)) };
    }
    // Every piece must touch existing land (cells it builds over count as touching).
    if (!cells.some(([x, z]) => this.grid.has(x, z) || this.grid.touchesIsland(x, z)))
      return { ok: false, reason: L('Pieces must touch your land', '板块必须与你的领地相连') };
    return { ok: true, reason: '' };
  }

  reject() {
    this.shake = 0.12;
  }

  /** cell: [x, z] under the cursor, or null to hide the ghost. */
  update(cell, dt, time) {
    if (!this.piece || !cell) {
      this.blocks.visible = this.feet.visible = false;
      this.cell = null;
      return;
    }
    const wasHidden = !this.blocks.visible;
    if (!this.cell || this.cell[0] !== cell[0] || this.cell[1] !== cell[1]) {
      this.cell = cell;
      this.result = this.validate(this.cellsAt(cell));
    }

    const ok = this.result.ok;
    this.footMat.color.copy(ok ? OK_COLOR : BAD_COLOR);
    this.footMat.opacity = ok ? this.cfg.validOpacity : this.cfg.invalidOpacity;
    this.blockMat.opacity = this.cfg.blockOpacity;
    this.blockMat.color.set(cardDef(this.piece.terrain).top);
    if (!ok) this.blockMat.color.lerp(BAD_COLOR, 0.55);
    this.blockMat.emissive.copy(ok ? OK_COLOR : BAD_COLOR).multiplyScalar(0.08);
    // Blockout ghosts keep the atlas. Only push them toward red when the spot is illegal.
    // (Only when legality flips: walking the ghost's materials every frame is wasted work.)
    if (this.tinted !== ok) this.blocks.traverse((obj) => {
      if (!obj.material) return;
      for (const m of [obj.material].flat()) {
        const base = m.userData?.base;
        if (!base) continue;
        m.color.copy(base);
        if (!ok) m.color.lerp(BAD_COLOR, 0.45);
      }
    });
    this.tinted = ok;

    this.feet.position.set(cell[0], 0, cell[1]);
    goal.set(cell[0], HOVER_Y + Math.sin(time * 3) * 0.05, cell[1]);
    if (wasHidden) this.base.copy(goal);
    else this.base.lerp(goal, 1 - Math.exp(-22 * dt));
    this.blocks.position.copy(this.base);

    // Turn around the centre of the cells: rotation about the group origin, plus (c - R·c) to keep c fixed.
    if (this.spin) {
      this.spin *= Math.exp(-SPIN_RATE * dt);
      if (Math.abs(this.spin) < 0.002) this.spin = 0;
    }
    this.blocks.rotation.y = this.spin;
    if (this.spin) {
      const c = this.spinCentre;
      const cos = Math.cos(this.spin);
      const sin = Math.sin(this.spin);
      // three.js Y rotation: x' = x cos + z sin, z' = -x sin + z cos
      this.blocks.position.x += c.x - (c.x * cos + c.z * sin);
      this.blocks.position.z += c.z - (-c.x * sin + c.z * cos);
    }

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 0.5);
      this.blocks.position.x += Math.sin(time * 70) * this.shake;
    }

    this.blocks.visible = this.feet.visible = true;
  }
}
