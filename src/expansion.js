import * as THREE from 'three';
import { PLOT, key, plotOf, plotCenter } from './grid.js';

const GOLD = 0xf2c14e;

/**
 * When the territory is full, the locked 3×3 plots on its sides light up.
 * Clicking one unlocks it.
 */
export class Expansion {
  options = new Map(); // plot key -> { px, pz, group, fill, edge, plus, age }
  hovered = null;

  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const s = PLOT - 0.12;
    this.fillGeo = new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2);
    this.edgeGeo = new THREE.EdgesGeometry(this.fillGeo);
    this.plusGeoA = new THREE.BoxGeometry(1.1, 0.06, 0.26);
    this.plusGeoB = new THREE.BoxGeometry(0.26, 0.06, 1.1);
  }

  get active() {
    return this.options.size > 0;
  }

  show(grid) {
    this.clear();
    for (const k of grid.expansionOptions()) {
      const [px, pz] = k.split(',').map(Number);
      const group = new THREE.Group();
      group.position.set(plotCenter(px), 0, plotCenter(pz));

      const fill = new THREE.Mesh(
        this.fillGeo,
        new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0, depthWrite: false }),
      );
      fill.position.y = -0.03;
      const edge = new THREE.LineSegments(
        this.edgeGeo,
        new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0 }),
      );
      edge.position.y = -0.02;
      const plusMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0 });
      const plus = new THREE.Group();
      plus.add(new THREE.Mesh(this.plusGeoA, plusMat), new THREE.Mesh(this.plusGeoB, plusMat));
      // Outline and "+" draw after the fog-of-war clouds (which skip depth writes), so they sit on top.
      // The fill stays underneath and tints the thinned clouds' ground.
      edge.renderOrder = 10;
      plus.children.forEach((m) => (m.renderOrder = 10));

      group.add(fill, edge, plus);
      this.group.add(group);
      this.options.set(k, { px, pz, group, fill, edge, plus, plusMat, age: 0 });
    }
  }

  clear() {
    for (const o of this.options.values()) {
      o.fill.material.dispose();
      o.edge.material.dispose();
      o.plusMat.dispose();
    }
    this.group.clear();
    this.options.clear();
    this.hovered = null;
  }

  /** The expansion option under a hovered cell, if any. */
  optionAt(cell) {
    if (!cell) return null;
    return this.options.get(key(plotOf(cell[0]), plotOf(cell[1]))) ?? null;
  }

  update(cell, dt, time) {
    this.hovered = this.optionAt(cell);
    for (const o of this.options.values()) {
      o.age += dt;
      const fade = Math.min(o.age / 0.5, 1);
      const hot = o === this.hovered;
      const pulse = 0.5 + 0.5 * Math.sin(time * 3 + o.px * 1.3 + o.pz * 0.7);
      o.fill.material.opacity = fade * (hot ? 0.38 : 0.1 + pulse * 0.08);
      o.edge.material.opacity = fade * (hot ? 1 : 0.55 + pulse * 0.3);
      o.plusMat.opacity = fade * (hot ? 1 : 0.7);
      o.plus.position.y = 0.25 + Math.sin(time * 2.5 + o.px) * 0.06 + (hot ? 0.15 : 0);
      o.plus.rotation.y += dt * (hot ? 2.5 : 0.6);
    }
  }
}
