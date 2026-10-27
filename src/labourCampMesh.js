import * as THREE from 'three';

/**
 * Procedural mockup for the Labour Camp until a real model exists:
 * packed-dirt yard, two long corrugated barracks, a wire fence with corner posts,
 * a little watchtower and a stack of crates. Sits on the regular soil block (top at y = 0).
 */
const mats = {
  ground: new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x6f6a5c, roughness: 0.85, flatShading: true }),
  roof: new THREE.MeshStandardMaterial({ color: 0x7c5a3a, roughness: 0.6, metalness: 0.35, flatShading: true }),
  door: new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1, flatShading: true }),
  wire: new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 0.5, metalness: 0.6 }),
  crate: new THREE.MeshStandardMaterial({ color: 0xa8875a, roughness: 0.9, flatShading: true }),
};

const shadow = (m) => {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

/** A long hut with a gabled tin roof, lying along x. */
function barrack(len) {
  const g = new THREE.Group();
  const body = shadow(new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.2), mats.wall));
  body.position.y = 0.06;
  g.add(body);
  // Gabled tin roof: two sloped panels meeting at a ridge along x.
  for (const side of [-1, 1]) {
    const panel = shadow(new THREE.Mesh(new THREE.BoxGeometry(len + 0.04, 0.012, 0.13), mats.roof));
    panel.rotation.x = side * 0.5;
    panel.position.set(0, 0.155, side * 0.056);
    g.add(panel);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.005), mats.door);
  door.position.set(len / 2 - 0.08, 0.04, 0.101);
  g.add(door);
  return g;
}

export function buildLabourCamp(soilGeo, soilMat) {
  const g = new THREE.Group();
  g.add(shadow(new THREE.Mesh(soilGeo, soilMat)));

  const ground = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.12, 0.97), mats.ground));
  ground.position.y = -0.06;
  g.add(ground);

  // Two barracks side by side.
  const a = barrack(0.6);
  a.position.set(-0.08, 0, -0.2);
  const b = barrack(0.6);
  b.position.set(-0.08, 0, 0.12);
  g.add(a, b);

  // Fence: corner and mid posts with two wire strands around the yard.
  const r = 0.44;
  const postGeo = new THREE.BoxGeometry(0.025, 0.14, 0.025);
  for (const x of [-r, 0, r]) {
    for (const z of [-r, 0, r]) {
      if (x === 0 && z === 0) continue;
      const p = shadow(new THREE.Mesh(postGeo, mats.wood));
      p.position.set(x, 0.07, z);
      g.add(p);
    }
  }
  for (const y of [0.05, 0.11]) {
    for (const [w, d, x, z] of [
      [2 * r, 0.006, 0, -r],
      [2 * r, 0.006, 0, r],
      [0.006, 2 * r, -r, 0],
      [0.006, 2 * r, r, 0],
    ]) {
      const wire = new THREE.Mesh(new THREE.BoxGeometry(w, 0.006, d), mats.wire);
      wire.position.set(x, y, z);
      g.add(wire);
    }
  }

  // Watchtower in the front-right corner.
  const tx = 0.32;
  const tz = 0.32;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.34, 0.015), mats.wood));
    leg.position.set(tx + dx * 0.045, 0.17, tz + dz * 0.045);
    g.add(leg);
  }
  const deck = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.13), mats.wood));
  deck.position.set(tx, 0.36, tz);
  g.add(deck);
  const cap = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.07, 4), mats.roof));
  cap.position.set(tx, 0.43, tz);
  cap.rotation.y = Math.PI / 4;
  g.add(cap);

  // Stack of crates by the gate.
  for (const [x, y, z, s] of [
    [-0.32, 0.035, 0.34, 0.07],
    [-0.24, 0.035, 0.34, 0.07],
    [-0.28, 0.1, 0.34, 0.06],
  ]) {
    const c = shadow(new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mats.crate));
    c.position.set(x, y, z);
    c.rotation.y = x * 2;
    g.add(c);
  }

  return g;
}
