import * as THREE from 'three';
import { key } from './grid.js';


/** Translucent slots marking every empty cell next to your land (where pieces can attach). */
export class Frontier {
  slots = new Map(); // key -> { mesh, age }

  /** cfg.frontierOpacity is read live (Game Debug → Placement preview → Open cell opacity). */
  constructor(scene, cfg = { frontierOpacity: 0.15 }) {
    this.cfg = cfg;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geo = new THREE.PlaneGeometry(0.97, 0.97).rotateX(-Math.PI / 2);
    this.baseMat = new THREE.MeshBasicMaterial({
      color: 0xa9bac8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
  }

  rebuild(grid) {
    const keys = grid.openKeys();
    for (const [k, slot] of this.slots) {
      if (!keys.has(k)) {
        this.group.remove(slot.mesh);
        slot.mesh.material.dispose();
        this.slots.delete(k);
      }
    }
    for (const k of keys) {
      if (this.slots.has(k)) continue;
      const [x, z] = k.split(',').map(Number);
      const mesh = new THREE.Mesh(this.geo, this.baseMat.clone());
      mesh.position.set(x, -0.04, z);
      this.group.add(mesh);
      this.slots.set(k, { mesh, age: 0 });
    }
  }

  has(x, z) {
    return this.slots.has(key(x, z));
  }

  update(dt, time) {
    for (const slot of this.slots.values()) {
      slot.age += dt;
      const fade = Math.min(slot.age / 0.6, 1);
      const pulse = 1 + Math.sin(time * 1.6 + slot.mesh.position.x * 0.7 + slot.mesh.position.z * 0.5) * 0.12;
      slot.mesh.material.opacity = this.cfg.frontierOpacity * fade * pulse;
    }
  }
}
