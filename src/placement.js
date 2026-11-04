import * as THREE from 'three';
import { pieceOffsets, ROTATIONS } from './pieces.js';
import { inWorld, hexToWorld, hexesAround } from './grid.js';
import { hexPlane, hexPrism, hexOutline } from './hexGeometry.js';
import { hasBlockout } from './models.js';
import { ACTIONS, TERRAINS, cardDef, isBuilding, isCamp, applyTileGap, fitFull } from './tiles.js';
import { L, both, onLangChange } from './i18n.js';
import { blastExtra } from './arsenal.js';
import { footprint } from './war.js';

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

/**
 * Diagonal hatching for a footprint that can't go down (the shape of "no", not only its colour). Drawn once; white, so
 * the footprint material's colour tints it.
 */
let hatch = null;
function hatchTexture() {
  if (hatch || typeof document === 'undefined') return hatch;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#fff';
  g.lineWidth = 9;
  for (let k = -64; k <= 128; k += 22) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 64, 64);
    g.stroke();
  }
  hatch = new THREE.CanvasTexture(c);
  hatch.wrapS = hatch.wrapT = THREE.RepeatWrapping;
  hatch.repeat.set(2, 2);
  return hatch;
}

/** A cross over a cell that is in the way (two flat bars, lying on the tile). */
function crossMark(mat) {
  const g = new THREE.Group();
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.1).rotateX(-Math.PI / 2), mat);
    bar.rotation.y = a;
    bar.renderOrder = 6;
    g.add(bar);
  }
  return g;
}
/** A full-cell ghost part in a holder (the holder takes the offset; the part shrinks by the tile gap). */
function cellPart(geo, mat) {
  const holder = new THREE.Group();
  holder.add(applyTileGap(fitFull(new THREE.Mesh(geo, mat))));
  return holder;
}

/** Placement preview look (Game Debug → Placement preview), saved to localStorage. Read live every frame. */
export const PREVIEW_DEFAULTS = {
  frontierOpacity: 0.15, // pale hexagons on every empty cell next to your land (frontier.js)
  validOpacity: 0.4, // green footprint under the piece where it can go
  invalidOpacity: 0.4, // red footprint where it can't
  blockOpacity: 0.8, // the plain coloured stand-in blocks (tiles with a 3D model show the model as is)
};
export const PREVIEW_PARAMS = [
  { group: 'Placement preview' },
  { key: 'frontierOpacity', label: 'Open cell opacity', min: 0, max: 1, step: 0.01, hint: 'pale hexagons on empty cells next to your land' },
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
    this.blocks = new THREE.Group();
    this.feet = new THREE.Group();
    this.blocks.visible = this.feet.visible = false;
    scene.add(this.blocks, this.feet);

    this.blockGeo = hexPrism(0.3).translate(0, -0.15, 0);
    this.footGeo = hexPlane();
    this.blockMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.8, roughness: 0.8 });
    this.footMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false });
    // A solid rim on every footprint cell (a stable outline where it can go), and crosses on the cells in the way.
    this.rimGeo = hexOutline(0.94);
    this.rimMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
    this.crossMat = new THREE.MeshBasicMaterial({ color: BAD_COLOR, transparent: true, opacity: 0.95, depthWrite: false });
    this.crosses = new THREE.Group();
    this.crosses.visible = false;
    scene.add(this.crosses);
    // The reason text is cached per cell: rebuild it in the new language.
    onLangChange(() => {
      if (this.piece && this.cell) this.result = this.validate(this.cellsAt(this.cell));
    });
  }

  setPiece(piece) {
    this.#build(piece);
    this.blocks.traverse(toGhostLayer);
    this.feet.traverse(toGhostLayer);
    this.#cross(null);
  }

  /** Crosses over the cells that are in the way (null: none). */
  #cross(cells) {
    const key = cells?.map((c) => c.join(',')).join('|') ?? '';
    if (key === this.crossKey) return;
    this.crossKey = key;
    this.crosses.clear();
    for (const [x, z] of cells ?? []) {
      const m = crossMark(this.crossMat);
      const w = hexToWorld(x, z);
      m.position.set(w.x, 0.05, w.z);
      this.crosses.add(m);
    }
    this.crosses.traverse(toGhostLayer);
    this.crosses.visible = this.crosses.children.length > 0;
  }

  #build(piece) {
    // Same piece, new rotation: the ghost is rebuilt in the new orientation, then shown turned back by the
    // difference and eased forward to 0. One rotation step is a sixth of a turn clockwise on screen, which is -60°
    // about Y in three.js, so one step forward starts at +60°. Rotating again mid-swing adds to what is left.
    if (piece && piece === this.#last && piece.rot !== this.#lastRot) {
      let d = (piece.rot - this.#lastRot + ROTATIONS) % ROTATIONS;
      if (d > ROTATIONS / 2) d -= ROTATIONS;
      this.spin += d * ((2 * Math.PI) / ROTATIONS);
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
      if (piece.terrain === 'missile' || piece.terrain === 'missile2')
        this.offsets = footprint('missile', [0, 0], blastExtra(this.grid), this.grid);
      else
        this.offsets = action.size ? [[0, 0], [1, 0], [0, 1], [1, 1]] : hexesAround(0, 0, action.range);
      for (const [ox, oz] of this.offsets) {
        const f = cellPart(this.footGeo, this.footMat);
        const w = hexToWorld(ox, oz);
        f.position.set(w.x, 0.015, w.z);
        this.feet.add(f);
      }
      return;
    }
    this.offsets = pieceOffsets(piece);
    for (const [ox, oz] of this.offsets) {
      const rim = new THREE.LineSegments(this.rimGeo, this.rimMat);
      const w = hexToWorld(ox, oz);
      rim.position.set(w.x, 0.02, w.z);
      this.feet.add(rim);
    }
    const world = this.offsets.map(([ox, oz]) => hexToWorld(ox, oz)); // offsets on the board (cell offsets convert linearly)
    this.spinCentre.set(world.reduce((a, w) => a + w.x, 0) / world.length, 0, world.reduce((a, w) => a + w.z, 0) / world.length);
    const blockout = hasBlockout(piece.terrain) && this.factory?.models?.has(piece.terrain);
    // Wasteland previews as its whole-piece model (the one the piece will land as), centred on the piece's cells.
    const wholePiece = piece.terrain.startsWith('wasteland') ? this.factory?.previewPiece(piece.shape, piece.rot, piece.id) : null;
    if (wholePiece) {
      wholePiece.position.copy(this.spinCentre);
      this.blocks.add(wholePiece);
    }
    for (const w of world) {
      if (!wholePiece) {
        const b = blockout ? this.factory.preview(piece.terrain, piece.rot) : cellPart(this.blockGeo, this.blockMat);
        b.position.set(w.x, 0, w.z);
        if (!blockout) b.children[0].castShadow = true;
        this.blocks.add(b);
      }
      const f = cellPart(this.footGeo, this.footMat);
      f.position.set(w.x, 0.015, w.z);
      this.feet.add(f);
    }
  }

  cellsAt(cell) {
    if (this.piece?.terrain === 'missile' || this.piece?.terrain === 'missile2')
      return footprint('missile', cell, blastExtra(this.grid), this.grid);
    return this.offsets.map(([ox, oz]) => [cell[0] + ox, cell[1] + oz]);
  }

  /** The cells among `cells` holding a tile that Demolish may remove (not a Capital or a camp). */
  demolishable(cells) {
    return cells.filter(([x, z]) => {
      const cell = this.grid.get(x, z);
      return cell && cell.terrain !== 'capital' && !isCamp(cell.terrain);
    });
  }

  /** Buildings a player missile may destroy (not a Capital). */
  missileable(cells) {
    return cells.filter(([x, z]) => {
      const cell = this.grid.get(x, z);
      return cell && isBuilding(cell.terrain) && cell.terrain !== 'capital';
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
    if (this.piece?.terrain === 'missile' || this.piece?.terrain === 'missile2' || this.piece?.terrain === 'salvo') {
      if (!this.missileable(cells).length) return { ok: false, reason: L('No building to destroy here', '这里没有可摧毁的建筑') };
      return { ok: true, reason: '' };
    }
    if (this.piece?.terrain === 'decoy') return { ok: false, reason: L('Aim decoys at a rival city', '诱饵弹只能瞄准敌方城市') };
    if (this.piece?.terrain === 'overtime') {
      const cell = this.grid.get(...cells[0]);
      if (!cell || cell.terrain !== 'milfactory') return { ok: false, reason: L('Play this on a Military Factory', '请打在军事工厂上') };
      return { ok: true, reason: '' };
    }
    // The rules first, each refusal with its cause (code) and the cells in the way, so the feedback can point at them.
    const building = this.piece && isBuilding(this.piece.terrain);
    const off = cells.filter(([x, z]) => !inWorld(x, z));
    if (off.length) return { ok: false, code: 'edge', cells: off, reason: L('Edge of the world', '世界边缘') };
    const outside = cells.filter(([x, z]) => !this.grid.allowed(x, z));
    if (outside.length) return { ok: false, code: 'territory', cells: outside, reason: L('Outside your territory', '超出你的领地') };
    const sites = !this.grid.expansionMode && this.mysteries ? cells.filter(([x, z]) => this.mysteries.has(x, z)) : [];
    if (sites.length) return { ok: false, code: 'site', cells: sites, reason: L('Build next to a ? site to uncover it', '在“?”神秘地点旁建造即可揭开它') };
    const taken = [];
    let why = null;
    for (const [x, z] of cells) {
      const cell = this.grid.get(x, z);
      if (!cell) continue;
      const t = TERRAINS[cell.terrain];
      if (building && t.buildable) continue; // buildings may go on Wasteland / Ruins
      taken.push([x, z]);
      why ??= t.buildable
        ? both(() => L(`Only buildings can go on ${t.name}`, `只有建筑可以放在${t.name}上`))
        : both(() => L(`Can't build on ${t.name}`, `不能在${t.name}上建造`));
    }
    if (taken.length) return { ok: false, code: 'occupied', cells: taken, reason: why };
    // Every piece must touch existing land (cells it builds over count as touching).
    if (!cells.some(([x, z]) => this.grid.has(x, z) || this.grid.touchesIsland(x, z)))
      return { ok: false, code: 'disconnected', cells: [], reason: L('Pieces must touch your land', '板块必须与你的领地相连') };
    // Then any extra rule (the guided tutorial's: a lesson's cells). Pure: it only answers, the feedback is elsewhere.
    const guarded = this.guard?.(cells, this.piece);
    if (guarded) return { code: 'tutorial', cells: [], ...guarded };
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
      this.#cross(null);
      return;
    }
    const wasHidden = !this.blocks.visible;
    if (!this.cell || this.cell[0] !== cell[0] || this.cell[1] !== cell[1]) {
      this.cell = cell;
      if (this.piece?.terrain === 'missile' || this.piece?.terrain === 'missile2') {
        const abs = footprint('missile', cell, blastExtra(this.grid), this.grid);
        this.offsets = abs.map(([x, z]) => [x - cell[0], z - cell[1]]);
        this.feet.clear();
        for (const [ox, oz] of this.offsets) {
          const f = cellPart(this.footGeo, this.footMat);
          const w = hexToWorld(ox, oz);
          f.position.set(w.x, 0.015, w.z);
          this.feet.add(f);
        }
      }
      this.result = this.validate(this.cellsAt(cell));
    }

    const ok = this.result.ok;
    this.footMat.color.copy(ok ? OK_COLOR : BAD_COLOR);
    this.footMat.opacity = ok ? this.cfg.validOpacity : Math.max(this.cfg.invalidOpacity, 0.55);
    // Where it can't go the footprint is hatched (not only red), with crosses on whatever is in the way.
    const map = ok ? null : hatchTexture();
    if (this.footMat.map !== map) {
      this.footMat.map = map;
      this.footMat.needsUpdate = true;
    }
    this.rimMat.color.copy(ok ? OK_COLOR : BAD_COLOR);
    this.#cross(ok ? null : this.result.cells?.length ? this.result.cells : null);
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

    const at = hexToWorld(cell[0], cell[1]);
    this.feet.position.set(at.x, 0, at.z);
    goal.set(at.x, HOVER_Y + Math.sin(time * 3) * 0.05, at.z);
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
