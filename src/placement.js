import * as THREE from 'three';
import { pieceOffsets } from './pieces.js';
import { inWorld } from './grid.js';
import { hasBlockout } from './models.js';
import { ACTIONS, TERRAINS, cardDef, isBuilding, isCamp, applyTileGap, fitFull } from './tiles.js';

const OK_COLOR = new THREE.Color(0x8be39a);
const BAD_COLOR = new THREE.Color(0xe0563f);
const HOVER_Y = 0.5;
const goal = new THREE.Vector3(); // reused every frame
/** A full-cell ghost part in a holder (the holder takes the offset; the part shrinks by the tile gap). */
function cellPart(geo, mat) {
  const holder = new THREE.Group();
  holder.add(applyTileGap(fitFull(new THREE.Mesh(geo, mat))));
  return holder;
}

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

  constructor(scene, grid, factory) {
    this.grid = grid;
    this.factory = factory;
    const s = 1;

    this.blocks = new THREE.Group();
    this.feet = new THREE.Group();
    this.blocks.visible = this.feet.visible = false;
    scene.add(this.blocks, this.feet);

    this.blockGeo = new THREE.BoxGeometry(s, 0.3, s);
    this.footGeo = new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2);
    this.blockMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.82, roughness: 0.8 });
    this.footMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false });
  }

  setPiece(piece) {
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
      if (!cells.some(([x, z]) => this.grid.has(x, z))) return { ok: false, reason: 'No tiles in range' };
      return { ok: true, reason: '' };
    }
    if (this.piece?.terrain === 'demolish') {
      const cell = this.grid.get(...cells[0]);
      if (!cell) return { ok: false, reason: 'Nothing to demolish here' };
      if (cell.terrain === 'capital') return { ok: false, reason: "A Capital can't be demolished" };
      if (isCamp(cell.terrain)) return { ok: false, reason: 'Send in the Militia to clear bandits' };
      return { ok: true, reason: '' };
    }
    if (this.piece?.terrain === 'demolish2') {
      if (!this.demolishable(cells).length) return { ok: false, reason: 'Nothing to demolish here' };
      return { ok: true, reason: '' };
    }
    if (this.piece?.terrain === 'militia') {
      const cell = this.grid.get(...cells[0]);
      if (!cell || !isCamp(cell.terrain)) return { ok: false, reason: 'The militia only clears bandit camps' };
      return { ok: true, reason: '' };
    }
    const building = this.piece && isBuilding(this.piece.terrain);
    if (cells.some(([x, z]) => !inWorld(x, z))) return { ok: false, reason: 'Edge of the world' };
    if (cells.some(([x, z]) => !this.grid.allowed(x, z))) return { ok: false, reason: 'Outside your territory' };
    if (!this.grid.expansionMode && this.mysteries && cells.some(([x, z]) => this.mysteries.has(x, z)))
      return { ok: false, reason: 'Build next to a ? site to uncover it' };
    for (const [x, z] of cells) {
      const cell = this.grid.get(x, z);
      if (!cell) continue;
      const t = TERRAINS[cell.terrain];
      if (building && t.buildable) continue; // buildings may go on Wasteland / Ruins
      if (t.buildable) return { ok: false, reason: `Only buildings can go on ${t.name}` };
      return { ok: false, reason: `Can't build on ${t.name}` };
    }
    // Every piece must touch existing land (cells it builds over count as touching).
    if (!cells.some(([x, z]) => this.grid.has(x, z) || this.grid.touchesIsland(x, z)))
      return { ok: false, reason: 'Pieces must touch your land' };
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
    if (wasHidden) this.blocks.position.copy(goal);
    else this.blocks.position.lerp(goal, 1 - Math.exp(-22 * dt));

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 0.5);
      this.blocks.position.x += Math.sin(time * 70) * this.shake;
    }

    this.blocks.visible = this.feet.visible = true;
  }
}
