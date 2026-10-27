import * as THREE from 'three';
import { pieceOffsets } from './pieces.js';
import { hasBlockout } from './models.js';
import { ACTIONS, TERRAINS, TILE, cardDef, isBuilding } from './tiles.js';

const OK_COLOR = new THREE.Color(0x8be39a);
const BAD_COLOR = new THREE.Color(0xe0563f);
const HOVER_Y = 0.5;

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
    const s = 1 - TILE.gap;

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
      const r = action.range;
      this.offsets = [];
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) this.offsets.push([dx, dz]);
      for (const [ox, oz] of this.offsets) {
        const f = new THREE.Mesh(this.footGeo, this.footMat);
        f.position.set(ox, 0.015, oz);
        this.feet.add(f);
      }
      return;
    }
    this.offsets = pieceOffsets(piece);
    const blockout = hasBlockout(piece.terrain) && this.factory?.models?.has(piece.terrain);
    for (const [ox, oz] of this.offsets) {
      const b = blockout ? this.factory.preview(piece.terrain) : new THREE.Mesh(this.blockGeo, this.blockMat);
      b.position.set(ox, 0, oz);
      b.castShadow = true;
      this.blocks.add(b);
      const f = new THREE.Mesh(this.footGeo, this.footMat);
      f.position.set(ox, 0.015, oz);
      this.feet.add(f);
    }
  }

  cellsAt(cell) {
    return this.offsets.map(([ox, oz]) => [cell[0] + ox, cell[1] + oz]);
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
      return { ok: true, reason: '' };
    }
    const building = this.piece && isBuilding(this.piece.terrain);
    if (cells.some(([x, z]) => !this.grid.inTerritory(x, z)))
      return { ok: false, reason: 'Outside your territory' };
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
    this.blocks.traverse((obj) => {
      const base = obj.material?.userData?.base;
      if (!base) return;
      obj.material.color.copy(base);
      if (!ok) obj.material.color.lerp(BAD_COLOR, 0.45);
    });

    this.feet.position.set(cell[0], 0, cell[1]);
    const goal = new THREE.Vector3(cell[0], HOVER_Y + Math.sin(time * 3) * 0.05, cell[1]);
    if (wasHidden) this.blocks.position.copy(goal);
    else this.blocks.position.lerp(goal, 1 - Math.exp(-22 * dt));

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 0.5);
      this.blocks.position.x += Math.sin(time * 70) * this.shake;
    }

    this.blocks.visible = this.feet.visible = true;
  }
}
