import * as THREE from 'three';
import { useDesertSand } from './seamlessGround.js';

/**
 * Procedural Decoy Builder and Launch Accelerator until real models exist, in the military set's look (Military
 * Factory, Recipe Lab, Warhead Institute): dark riveted steel with brass and rust-red bands, warm lit portholes,
 * black lattice towers, cream missiles, concrete pads with hazard stripes, crates and oil drums.
 * Each sits on the regular soil block (top at y = 0); `rot` turns the building (sixths of a turn, like the models).
 *
 *  - Decoy Builder: a vaulted assembly hall, a launch pad of chequered test-pattern decoys beside a lattice gantry,
 *    one more decoy on a trolley, paint drums.
 *  - Launch Accelerator: a mass-driver rail on A-frame legs, ringed with copper coils that glow and pulse blue,
 *    fed by a capacitor bank and a domed generator.
 */

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.15, flatShading: true, ...o });
const M = {
  concrete: std(0x8e8b83, { roughness: 1, metalness: 0 }),
  concreteDark: std(0x6f6d67, { roughness: 1, metalness: 0 }),
  steel: std(0x4c5157, { metalness: 0.35 }),
  steelDark: std(0x383c41, { metalness: 0.35 }),
  steelLight: std(0x63696f, { metalness: 0.35 }),
  iron: std(0x25272a, { metalness: 0.4, roughness: 0.6 }),
  brass: std(0xb8913f, { metalness: 0.75, roughness: 0.4, flatShading: false }),
  copper: std(0xb4622c, { metalness: 0.8, roughness: 0.35, flatShading: false }),
  rust: std(0x8a2e22, { roughness: 0.9 }),
  window: new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffa22a, emissiveIntensity: 1.1, roughness: 0.4 }),
  cream: std(0xe6d9b0, { roughness: 0.55, flatShading: false }),
  black: std(0x1e1f21, { roughness: 0.55, flatShading: false }),
  pale: std(0xeff0e4, { roughness: 0.5, flatShading: false }),
  wood: std(0x7a5232, { roughness: 1, metalness: 0 }),
  woodDark: std(0x5a3a22, { roughness: 1, metalness: 0 }),
  hazard: std(0xe0a82a, { roughness: 0.7, metalness: 0 }),
  drumRed: std(0x9a2a1e, { roughness: 0.6, metalness: 0.3 }),
  drumGrey: std(0x7c8086, { roughness: 0.6, metalness: 0.3 }),
  red: new THREE.MeshStandardMaterial({ color: 0xff3a22, emissive: 0xff2010, emissiveIntensity: 1.2 }),
  glow: new THREE.MeshStandardMaterial({ color: 0x9ae4ff, emissive: 0x2aa8ff, emissiveIntensity: 1.4, roughness: 0.3 }),
};

/** The accelerator's coils breathe: one pulse shared by every copy (set once per frame by whichever renders first). */
let pulseFrame = -1;
function pulse() {
  const t = performance.now() / 1000;
  const f = Math.floor(t * 60);
  if (f === pulseFrame) return;
  pulseFrame = f;
  M.glow.emissiveIntensity = 1.1 + 0.7 * (0.5 + 0.5 * Math.sin(t * 3.2));
}

const shadow = (m) => {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};
function add(parent, geo, mat, x = 0, y = 0, z = 0, ry = 0) {
  const m = shadow(new THREE.Mesh(geo, mat));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  return m;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- shared parts ----------

/**
 * Flat ground like the other buildings stand on: a thin cap of the shared desert sand on the soil block. The building group is lowered so its parts,
 * laid out on a 0.055 base, stand right on this ground.
 */
// The same world-space desert sand as every other building's ground (seamlessGround.js), so it runs on unbroken.
let GROUND = null;
function pad(g) {
  g.position.y = -0.05;
  GROUND ??= useDesertSand(new THREE.MeshStandardMaterial());
  const top = add(g, new THREE.CylinderGeometry(0.577, 0.577, 0.01, 6), GROUND, 0, 0.05, 0);
  top.castShadow = false;
  top.userData.ground = true; // (tools/card-snapshots.js hides it: the card shows the building alone)
}

/** Black lattice tower: 4 posts with X bracing, `h` tall, `w` wide, standing at (x, z). Returns its top height. */
function lattice(g, x, z, h, w, levels = 5) {
  const t = new THREE.Group();
  t.position.set(x, 0.055, z);
  g.add(t);
  const post = new THREE.BoxGeometry(0.012, h, 0.012);
  const s = w / 2;
  for (const [px, pz] of [[-s, -s], [s, -s], [-s, s], [s, s]]) add(t, post, M.iron, px, h / 2, pz);
  const step = h / levels;
  const diag = Math.hypot(w, step);
  const brace = new THREE.BoxGeometry(0.006, diag, 0.006);
  const ring = new THREE.BoxGeometry(w, 0.008, 0.008);
  for (let i = 0; i < levels; i++) {
    const y = step * (i + 0.5);
    for (let f = 0; f < 4; f++) {
      const face = new THREE.Group();
      face.rotation.y = (f * Math.PI) / 2;
      t.add(face);
      for (const sgn of [-1, 1]) {
        const b = add(face, brace, M.iron, 0, y, s);
        b.rotation.z = sgn * Math.atan2(w, step);
      }
      add(face, ring, M.iron, 0, step * (i + 1), s);
    }
  }
  add(t, new THREE.BoxGeometry(w + 0.03, 0.012, w + 0.03), M.steelDark, 0, h + 0.006, 0);
  return { group: t, top: h + 0.055 };
}

/** A stack of crates and a couple of drums at (x, z). */
function clutter(g, x, z, ry, seed) {
  const c = new THREE.Group();
  c.position.set(x, 0.055, z);
  c.rotation.y = ry;
  g.add(c);
  const r = rng(seed);
  const crate = new THREE.BoxGeometry(0.06, 0.05, 0.06);
  add(c, crate, M.wood, 0, 0.025, 0, r() * 0.4);
  add(c, crate, M.woodDark, 0.065, 0.025, 0.01, r() * 0.4);
  add(c, crate, M.wood, 0.03, 0.075, 0.005, r() * 0.6);
  const drum = new THREE.CylinderGeometry(0.022, 0.022, 0.055, 10);
  add(c, drum, M.drumRed, -0.06, 0.0275, 0.05);
  add(c, drum, M.drumGrey, -0.02, 0.0275, 0.08);
  for (const [dx, dz] of [[-0.06, 0.05], [-0.02, 0.08]]) add(c, new THREE.TorusGeometry(0.022, 0.003, 4, 12).rotateX(Math.PI / 2), M.iron, dx, 0.04, dz);
}

/** A lamp post with a warm lantern. */
function lamp(g, x, z) {
  add(g, new THREE.CylinderGeometry(0.006, 0.008, 0.26, 6), M.iron, x, 0.185, z);
  add(g, new THREE.BoxGeometry(0.028, 0.022, 0.028), M.window, x, 0.32, z);
  add(g, new THREE.BoxGeometry(0.036, 0.008, 0.036), M.iron, x, 0.334, z);
}

/** Ogive nose profile for LatheGeometry. */
function nose(r, len) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    pts.push(new THREE.Vector2(r * Math.sqrt(1 - u * u) * (1 - 0.05 * u), u * len));
  }
  pts[8].x = 0;
  return new THREE.LatheGeometry(pts, 14);
}

/**
 * A missile standing on its tail at the origin (+y up), `len` tall. chequer: the black-and-white test pattern a
 * decoy wears; otherwise the cream and black of the real thing.
 */
function missile(len, r, chequer = false) {
  const g = new THREE.Group();
  const body = len * 0.68;
  const rings = 4;
  const seg = body / rings;
  for (let i = 0; i < rings; i++) {
    for (let h = 0; h < 2; h++) {
      const geo = new THREE.CylinderGeometry(r, r, seg, 12, 1, false, h * Math.PI + (i % 2) * (Math.PI / 2), Math.PI);
      const mat = chequer ? ((i + h) % 2 ? M.black : M.pale) : h && i === 1 ? M.black : M.cream;
      add(g, geo, mat, 0, seg * (i + 0.5) + len * 0.06, 0);
    }
  }
  add(g, nose(r, len * 0.26), chequer ? M.pale : M.cream, 0, body + len * 0.06, 0);
  // Tail skirt and four fins.
  add(g, new THREE.CylinderGeometry(r, r * 0.8, len * 0.06, 12), M.black, 0, len * 0.03, 0);
  const fin = new THREE.BoxGeometry(0.004, len * 0.2, r * 1.3);
  for (let k = 0; k < 4; k++) {
    const holder = new THREE.Group();
    holder.rotation.y = (k * Math.PI) / 2 + Math.PI / 4;
    g.add(holder);
    const f = add(holder, fin, chequer ? M.black : M.cream, 0, len * 0.11, r * 1.2);
    f.rotation.x = 0.12;
  }
  return g;
}

/** A row of lit portholes along a face: n windows centred on (x, y, z), facing +z of the holder rotated by ry. */
function portholes(g, n, gap, x, y, z, ry = 0, r = 0.014) {
  const h = new THREE.Group();
  h.position.set(x, y, z);
  h.rotation.y = ry;
  g.add(h);
  const glass = new THREE.CircleGeometry(r, 10);
  const rim = new THREE.TorusGeometry(r, 0.004, 4, 12);
  for (let i = 0; i < n; i++) {
    const px = (i - (n - 1) / 2) * gap;
    const w = new THREE.Mesh(glass, M.window);
    w.position.set(px, 0, 0.002);
    h.add(w);
    add(h, rim, M.brass, px, 0, 0.003);
  }
}

/** A smokestack with a rust band and a brass collar. */
function stack(g, x, z, h, r) {
  add(g, new THREE.CylinderGeometry(r, r * 1.15, h, 10), M.steelDark, x, 0.055 + h / 2, z);
  add(g, new THREE.CylinderGeometry(r * 1.06, r * 1.06, h * 0.08, 10), M.rust, x, 0.055 + h * 0.8, z);
  add(g, new THREE.CylinderGeometry(r * 1.1, r * 1.1, h * 0.04, 10), M.brass, x, 0.055 + h * 0.62, z);
  add(g, new THREE.CylinderGeometry(r * 1.2, r * 1.05, 0.02, 10), M.iron, x, 0.055 + h, z);
}

// ---------- Decoy Builder ----------

export function buildDecoyWorks(soilGeo, soilMat, rot = 0) {
  const root = new THREE.Group();
  root.add(shadow(new THREE.Mesh(soilGeo, soilMat))).children.at(-1).userData.ground = true;
  const g = new THREE.Group();
  g.rotation.y = (-rot * Math.PI) / 3;
  root.add(g);
  pad(g, 11);

  // Assembly hall: riveted steel walls under a barrel vault with brass ribs, toward the back left.
  const hall = new THREE.Group();
  hall.position.set(-0.12, 0.055, -0.14);
  hall.rotation.y = 0.12;
  g.add(hall);
  const W = 0.44;
  const D = 0.26;
  const H = 0.13;
  add(hall, new THREE.BoxGeometry(W, H, D), M.steel, 0, H / 2, 0);
  add(hall, new THREE.BoxGeometry(W + 0.012, 0.025, D + 0.012), M.rust, 0, 0.0125, 0);
  // Barrel vault along the hall (its lower half sits inside the walls), banded with brass ribs.
  add(hall, new THREE.CylinderGeometry(D / 2, D / 2, W, 18).rotateZ(Math.PI / 2), M.steelLight, 0, H, 0);
  const rib = new THREE.TorusGeometry(D / 2 + 0.004, 0.005, 4, 24).rotateY(Math.PI / 2);
  for (let i = 0; i < 5; i++) add(hall, rib, M.brass, -W / 2 + 0.015 + (i * (W - 0.03)) / 4, H, 0);
  // Gable ends: a darker disc and a brass rim at each end.
  for (const s of [-1, 1]) {
    add(hall, new THREE.CylinderGeometry(D / 2 + 0.002, D / 2 + 0.002, 0.008, 18).rotateZ(Math.PI / 2), M.steelDark, s * (W / 2 + 0.004), H, 0);
  }
  // Front: big door with a hazard lintel, portholes either side, a sign.
  add(hall, new THREE.BoxGeometry(0.13, 0.11, 0.01), M.iron, 0.04, 0.055, D / 2 + 0.004);
  for (let k = 0; k < 6; k++) add(hall, new THREE.BoxGeometry(0.0225, 0.014, 0.012), k % 2 ? M.iron : M.hazard, 0.04 - 0.056 + k * 0.0225, 0.118, D / 2 + 0.006);
  for (let k = 0; k < 4; k++) add(hall, new THREE.BoxGeometry(0.125, 0.004, 0.012), M.steelDark, 0.04, 0.02 + k * 0.025, D / 2 + 0.006);
  portholes(hall, 3, 0.04, -0.14, 0.08, D / 2);
  portholes(hall, 1, 0.04, 0.16, 0.08, D / 2);
  add(hall, new THREE.BoxGeometry(0.11, 0.03, 0.006), M.rust, -0.14, 0.12, D / 2 + 0.004);
  add(hall, new THREE.BoxGeometry(0.09, 0.008, 0.007), M.pale, -0.14, 0.12, D / 2 + 0.006);
  // Side portholes and roof vents.
  portholes(hall, 4, 0.05, 0, 0.08, -D / 2, Math.PI);
  for (const vx of [-0.12, 0.08]) {
    add(hall, new THREE.BoxGeometry(0.05, 0.035, 0.05), M.steelDark, vx, H + D / 2 - 0.005, 0);
    add(hall, new THREE.BoxGeometry(0.06, 0.008, 0.06), M.iron, vx, H + D / 2 + 0.017, 0);
  }
  stack(g, -0.36, -0.02, 0.36, 0.028);
  // A pipe from the stack into the hall.
  const pipe = add(g, new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6), M.copper, -0.31, 0.2, -0.05);
  pipe.rotation.z = Math.PI / 2;

  // Launch pad: three chequered decoys standing ready beside a lattice gantry (front right).
  const pz = 0.16;
  const px = 0.18;
  add(g, new THREE.CylinderGeometry(0.15, 0.16, 0.02, 8), M.concreteDark, px, 0.065, pz);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    add(g, new THREE.BoxGeometry(0.04, 0.004, 0.012), k % 2 ? M.iron : M.hazard, px + Math.sin(a) * 0.145, 0.076, pz + Math.cos(a) * 0.145, a);
  }
  const spots = [[-0.06, -0.03], [0.06, -0.03], [0, 0.07]];
  for (const [dx, dz] of spots) {
    add(g, new THREE.CylinderGeometry(0.03, 0.034, 0.012, 8), M.iron, px + dx, 0.081, pz + dz);
    const m = missile(0.26, 0.024, true);
    m.position.set(px + dx, 0.087, pz + dz);
    m.rotation.y = dx * 9;
    g.add(m);
  }
  const tower = lattice(g, px + 0.0, pz - 0.13, 0.4, 0.06, 6);
  add(g, new THREE.SphereGeometry(0.011, 8, 6), M.red, px, tower.top + 0.02, pz - 0.13);
  // Gantry arm reaching over the decoys.
  add(g, new THREE.BoxGeometry(0.012, 0.012, 0.2), M.iron, px, 0.36, pz - 0.04);
  add(g, new THREE.CylinderGeometry(0.002, 0.002, 0.1, 4), M.iron, px, 0.31, pz + 0.05);

  // One more on a trolley by the hall door, and the paint drums it came from.
  const trolley = new THREE.Group();
  trolley.position.set(-0.08, 0.055, 0.2);
  trolley.rotation.y = -0.3;
  g.add(trolley);
  add(trolley, new THREE.BoxGeometry(0.28, 0.02, 0.07), M.steelDark, 0, 0.025, 0);
  for (const wx of [-0.1, 0.1]) for (const wz of [-0.035, 0.035]) add(trolley, new THREE.CylinderGeometry(0.014, 0.014, 0.01, 10).rotateX(Math.PI / 2), M.iron, wx, 0.014, wz);
  for (const cx of [-0.07, 0.07]) add(trolley, new THREE.BoxGeometry(0.02, 0.03, 0.06), M.wood, cx, 0.05, 0);
  const lying = missile(0.3, 0.026, true);
  lying.rotation.z = -Math.PI / 2;
  lying.position.set(-0.15, 0.085, 0);
  trolley.add(lying);
  clutter(g, 0.36, -0.12, 0.5, 4);
  lamp(g, -0.38, 0.22);
  return root;
}

// ---------- Launch Accelerator ----------

export function buildAccelerator(soilGeo, soilMat, rot = 0) {
  const root = new THREE.Group();
  root.add(shadow(new THREE.Mesh(soilGeo, soilMat))).children.at(-1).userData.ground = true;
  const g = new THREE.Group();
  // Laid out climbing toward +z, then turned side-on so the rail reads from the board camera.
  g.rotation.y = (-rot * Math.PI) / 3 + Math.PI / 3; // the rail runs corner to corner
  root.add(g);
  pad(g, 23);

  // The mass driver: a rail climbing from the back to the front, ringed with coils.
  const LEN = 0.7;
  const pitch = 0.5;
  const rail = new THREE.Group();
  rail.position.set(0.02, 0.1, -0.38);
  rail.rotation.x = -pitch; // climbs toward +z
  g.add(rail);
  // Two rails and a spine with a truss under it.
  for (const s of [-1, 1]) add(rail, new THREE.BoxGeometry(0.014, 0.018, LEN), M.steelLight, s * 0.035, 0.0, LEN / 2);
  add(rail, new THREE.BoxGeometry(0.05, 0.012, LEN), M.steelDark, 0, -0.03, LEN / 2);
  const n = 8;
  const brace = new THREE.BoxGeometry(0.006, 0.05, 0.006);
  for (let i = 0; i <= n; i++) {
    const z = (i / n) * LEN;
    for (const s of [-1, 1]) {
      const b = add(rail, brace, M.iron, s * 0.03, -0.015, z);
      b.rotation.x = i % 2 ? 0.6 : -0.6;
    }
  }
  // Coils: evenly spaced copper rings, each with a glowing blue ring beside it (they pulse together).
  const coil = new THREE.TorusGeometry(0.058, 0.011, 8, 22);
  const core = new THREE.TorusGeometry(0.06, 0.006, 6, 22);
  const clamp = new THREE.BoxGeometry(0.03, 0.018, 0.02);
  for (let i = 0; i < 5; i++) {
    const z = 0.18 + i * 0.115;
    add(rail, coil, M.copper, 0, 0, z);
    const c = add(rail, core, M.glow, 0, 0, z + 0.02);
    if (i === 0) c.onBeforeRender = pulse;
    add(rail, clamp, M.steelDark, 0, -0.058, z);
  }
  // Muzzle: a short brass-ringed collar.
  add(rail, new THREE.CylinderGeometry(0.05, 0.045, 0.03, 12, 1, true).rotateX(Math.PI / 2), M.steelDark, 0, 0, LEN);
  add(rail, new THREE.TorusGeometry(0.05, 0.007, 6, 20), M.brass, 0, 0, LEN + 0.015);
  // A missile on the sled at the breech, ready to go.
  const sled = add(rail, new THREE.BoxGeometry(0.06, 0.016, 0.1), M.iron, 0, 0.018, 0.08);
  sled.castShadow = true;
  const m = missile(0.26, 0.024, false);
  m.rotation.x = Math.PI / 2;
  m.position.set(0, 0.04, 0.0);
  rail.add(m);

  // A-frame legs from the pad up to the rail.
  const legAt = (t) => {
    const z = t * LEN;
    return new THREE.Vector3(0.02, 0.1 + Math.sin(pitch) * z - 0.035, -0.38 + Math.cos(pitch) * z);
  };
  for (const t of [0.35, 0.75]) {
    const top = legAt(t);
    for (const s of [-1, 1]) {
      const foot = new THREE.Vector3(top.x + s * 0.11, 0.055, top.z);
      const len = top.distanceTo(foot);
      const leg = add(g, new THREE.BoxGeometry(0.016, len, 0.016), M.iron, (top.x + foot.x) / 2, (top.y + foot.y) / 2, (top.z + foot.z) / 2);
      leg.rotation.z = Math.atan2(top.x - foot.x, top.y - foot.y) * -1;
      add(g, new THREE.BoxGeometry(0.04, 0.012, 0.04), M.steelDark, foot.x, 0.061, foot.z);
    }
    add(g, new THREE.BoxGeometry(0.22, 0.012, 0.014), M.iron, top.x, (top.y + 0.055) / 2, top.z);
  }

  // Capacitor bank: banded cylinders with glowing caps, left of the rail.
  const bank = new THREE.Group();
  bank.position.set(0.28, 0.055, -0.2);
  bank.rotation.y = -0.5;
  g.add(bank);
  add(bank, new THREE.BoxGeometry(0.2, 0.025, 0.09), M.concreteDark, 0, 0.0125, 0);
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.065;
    const h = 0.17;
    add(bank, new THREE.CylinderGeometry(0.027, 0.027, h, 12), M.steel, x, 0.025 + h / 2, 0);
    for (const y of [0.05, 0.12]) add(bank, new THREE.CylinderGeometry(0.029, 0.029, 0.01, 12), M.brass, x, 0.025 + y, 0);
    add(bank, new THREE.CylinderGeometry(0.018, 0.022, 0.016, 12), M.glow, x, 0.025 + h + 0.008, 0);
    add(bank, new THREE.CylinderGeometry(0.004, 0.004, 0.03, 6), M.copper, x, 0.025 + h + 0.03, 0);
  }

  // Generator: a small riveted dome with portholes (like the Warhead Institute's), back right.
  const gen = new THREE.Group();
  gen.position.set(0.24, 0.055, 0.2);
  g.add(gen);
  add(gen, new THREE.CylinderGeometry(0.12, 0.125, 0.012, 16), M.rust, 0, 0.006, 0);
  add(gen, new THREE.CylinderGeometry(0.11, 0.11, 0.09, 16), M.steel, 0, 0.057, 0);
  add(gen, new THREE.CylinderGeometry(0.113, 0.113, 0.01, 16), M.brass, 0, 0.1, 0);
  add(gen, new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.steelLight, 0, 0.1, 0);
  for (let k = 0; k < 8; k++) {
    const rib = add(gen, new THREE.TorusGeometry(0.112, 0.003, 3, 12, Math.PI / 2), M.steelDark, 0, 0.1, 0, (k * Math.PI) / 4);
    rib.rotation.x = 0;
    rib.rotation.order = 'YXZ';
    rib.rotation.z = Math.PI / 2;
  }
  add(gen, new THREE.CylinderGeometry(0.025, 0.03, 0.03, 10), M.steelDark, 0, 0.22, 0);
  add(gen, new THREE.SphereGeometry(0.014, 8, 6), M.glow, 0, 0.24, 0);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.012, 10), M.window);
    w.position.set(Math.sin(a) * 0.111, 0.06, Math.cos(a) * 0.111);
    w.rotation.y = a;
    gen.add(w);
  }
  add(gen, new THREE.BoxGeometry(0.05, 0.07, 0.01), M.iron, 0, 0.045, 0.11);

  // Cables snaking from the bank and the generator to the breech.
  const breech = new THREE.Vector3(0.02, 0.08, -0.32);
  const cable = (from, mid) => {
    const curve = new THREE.CatmullRomCurve3([from, mid, breech]);
    add(g, new THREE.TubeGeometry(curve, 16, 0.007, 5), M.iron);
  };
  cable(new THREE.Vector3(0.23, 0.07, -0.16), new THREE.Vector3(0.12, 0.058, -0.24));
  cable(new THREE.Vector3(0.3, 0.07, -0.24), new THREE.Vector3(0.14, 0.058, -0.34));
  cable(new THREE.Vector3(0.17, 0.07, 0.14), new THREE.Vector3(0.15, 0.058, -0.1));

  // Warning pylon and clutter.
  const tower = lattice(g, -0.3, -0.2, 0.3, 0.05, 4);
  add(g, new THREE.SphereGeometry(0.011, 8, 6), M.red, -0.3, tower.top + 0.015, -0.2);
  clutter(g, -0.3, 0.14, -0.4, 9);
  lamp(g, 0.4, -0.02);
  return root;
}
