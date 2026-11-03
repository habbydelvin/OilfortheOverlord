import * as THREE from 'three';

/**
 * Procedural Intercept Network until a real model exists: a low olive-drab bunker of sloped armour on a rubble
 * base, with a twin-barrel CIWS turret on top. Sits on the regular soil block (top at y = 0).
 *
 * The root's userData.ciws = { turret, pivot, muzzles } lets the attack phase aim and fire it (missiles.js
 * fireCIWS): `turret` turns (yaw), `pivot` lifts the barrels (pitch, -x raises them), `muzzles` are the two
 * barrel tips. Forward is +z.
 */
const mats = {
  rubble: new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 1, flatShading: true }),
  stone: new THREE.MeshStandardMaterial({ color: 0x9a958a, roughness: 1, flatShading: true }),
  hull: new THREE.MeshStandardMaterial({ color: 0x5d6a3e, roughness: 0.75, metalness: 0.15, flatShading: true }),
  hullDark: new THREE.MeshStandardMaterial({ color: 0x46512d, roughness: 0.8, metalness: 0.15, flatShading: true }),
  hullLight: new THREE.MeshStandardMaterial({ color: 0x72804c, roughness: 0.7, metalness: 0.15, flatShading: true }),
  steel: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.85 }),
  bore: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc0281c, roughness: 0.4, emissive: 0x400806 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb89a50, roughness: 0.45, metalness: 0.7 }),
  rust: new THREE.MeshStandardMaterial({ color: 0x6a3a22, roughness: 1 }),
};

const shadow = (m) => {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
  const m = shadow(new THREE.Mesh(geo, mat));
  m.position.set(x, y, z);
  return m;
};

/** Rivet heads around an octagon of radius r at height y. */
function rivets(g, r, y, n = 16) {
  const geo = new THREE.SphereGeometry(0.009, 6, 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 8;
    g.add(mesh(geo, mats.hullDark, Math.sin(a) * r, y, Math.cos(a) * r));
  }
}

/** A sloped armour plate leaning against the hull, facing angle `a` (radians around y). */
function plate(g, a, w, h, lean, dist, y) {
  const holder = new THREE.Group();
  holder.rotation.y = a;
  const p = mesh(new THREE.BoxGeometry(w, h, 0.035), mats.hull, 0, y, dist);
  p.rotation.x = lean;
  holder.add(p);
  const edge = mesh(new THREE.BoxGeometry(w + 0.01, 0.012, 0.04), mats.hullDark, 0, y + (h / 2) * Math.cos(lean), dist - (h / 2) * Math.sin(lean));
  edge.rotation.x = lean;
  holder.add(edge);
  g.add(holder);
  return holder;
}

/** Small winged emblem on the front plate. */
function emblem(parent) {
  const e = new THREE.Group();
  e.add(mesh(new THREE.BoxGeometry(0.028, 0.03, 0.006), mats.brass));
  for (const s of [-1, 1]) {
    const wing = mesh(new THREE.BoxGeometry(0.05, 0.014, 0.006), mats.brass, s * 0.034, 0.006, 0);
    wing.rotation.z = s * 0.35;
    e.add(wing);
  }
  parent.add(e);
  return e;
}

export function buildInterceptBunker(soilGeo, soilMat) {
  const g = new THREE.Group();
  g.add(shadow(new THREE.Mesh(soilGeo, soilMat)));

  // Rubble base: a hexagon of gravel, a few loose stones and scrap.
  const base = mesh(new THREE.CylinderGeometry(0.54, 0.56, 0.05, 6), mats.rubble, 0, 0.012, 0);
  g.add(base);
  const stoneGeo = new THREE.DodecahedronGeometry(0.025, 0);
  const rand = mulberry(7);
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = 0.36 + rand() * 0.15;
    const s = mesh(stoneGeo, rand() < 0.5 ? mats.stone : mats.rubble, Math.sin(a) * r, 0.04, Math.cos(a) * r);
    s.scale.setScalar(0.6 + rand() * 0.9);
    s.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    g.add(s);
  }
  for (const [x, z, r] of [
    [-0.36, 0.22, 0.4],
    [0.3, 0.34, -0.8],
  ]) {
    const scrap = mesh(new THREE.BoxGeometry(0.12, 0.012, 0.018), mats.rust, x, 0.045, z);
    scrap.rotation.y = r;
    g.add(scrap);
  }

  // Hull: two stepped octagonal tiers of sloped armour.
  const lower = mesh(new THREE.CylinderGeometry(0.27, 0.38, 0.13, 8), mats.hull, 0, 0.1, 0);
  lower.rotation.y = Math.PI / 8;
  g.add(lower);
  rivets(g, 0.33, 0.1);
  const upper = mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.07, 8), mats.hullLight, 0, 0.2, 0);
  upper.rotation.y = Math.PI / 8;
  g.add(upper);
  rivets(g, 0.225, 0.2, 12);

  // Sloped plates on the front corners and a back side box, as on the bunker in the reference.
  plate(g, Math.PI * 0.2, 0.22, 0.16, -0.55, 0.36, 0.09);
  const front = plate(g, -Math.PI * 0.12, 0.2, 0.15, -0.6, 0.37, 0.085);
  const em = emblem(front);
  em.position.set(0, 0.1, 0.37 - 0.022);
  em.rotation.x = -0.6;
  em.position.z += 0.0;
  const box = mesh(new THREE.BoxGeometry(0.16, 0.12, 0.12), mats.hull, -0.25, 0.13, -0.2);
  box.rotation.y = 0.6;
  g.add(box);
  g.add(mesh(new THREE.BoxGeometry(0.17, 0.012, 0.13), mats.hullDark, -0.25, 0.195, -0.2)).rotation.y = 0.6;

  // A pipe running down one face.
  const pipe = new THREE.Group();
  pipe.rotation.y = -Math.PI * 0.55;
  const run = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), mats.hullDark, 0, 0.11, 0.31);
  run.rotation.x = 0.55;
  pipe.add(run);
  pipe.add(mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), mats.hullDark, 0, 0.05, 0.355));
  g.add(pipe);

  // Turret: turns on its ring; the barrels lift on the pivot.
  const turret = new THREE.Group();
  turret.position.y = 0.235;
  g.add(turret);
  const ring = mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.02, 16), mats.hullDark, 0, 0.005, 0);
  turret.add(ring);
  const head = mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.09, 8), mats.hull, 0, 0.06, 0);
  head.rotation.y = Math.PI / 8;
  turret.add(head);
  rivets(turret, 0.135, 0.06, 12);
  const hatch = mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.018, 16), mats.hullLight, -0.02, 0.112, -0.03);
  turret.add(hatch);
  turret.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.022, 12), mats.hullDark, -0.02, 0.12, -0.03));
  turret.add(mesh(new THREE.BoxGeometry(0.1, 0.006, 0.012), mats.hullDark, -0.02, 0.124, -0.03));

  const pivot = new THREE.Group();
  pivot.position.set(0, 0.06, 0.1);
  turret.add(pivot);
  pivot.add(mesh(new THREE.BoxGeometry(0.13, 0.065, 0.07), mats.hullDark, 0, 0, 0.01));
  const muzzles = [];
  const barrelGeo = new THREE.CylinderGeometry(0.017, 0.017, 0.15, 10).rotateX(Math.PI / 2);
  const shroudGeo = new THREE.CylinderGeometry(0.027, 0.027, 0.05, 10).rotateX(Math.PI / 2);
  const boreGeo = new THREE.CircleGeometry(0.011, 10);
  for (const s of [-1, 1]) {
    const x = s * 0.034;
    pivot.add(mesh(shroudGeo, mats.steel, x, 0, 0.06));
    pivot.add(mesh(new THREE.SphereGeometry(0.01, 8, 6), mats.red, x, 0.026, 0.05));
    pivot.add(mesh(barrelGeo, mats.steel, x, 0, 0.13));
    const bore = new THREE.Mesh(boreGeo, mats.bore);
    bore.position.set(x, 0, 0.2055);
    pivot.add(bore);
    const tip = new THREE.Object3D();
    tip.position.set(x, 0, 0.21);
    pivot.add(tip);
    muzzles.push(tip);
  }
  g.userData.ciws = { turret, pivot, muzzles };
  return g;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The CIWS rig inside a tile mesh (or null). */
export function findCiws(root) {
  let out = null;
  root?.traverse((o) => {
    if (!out && o.userData.ciws) out = o.userData.ciws;
  });
  return out;
}
