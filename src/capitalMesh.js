import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural hive city for the Capital tile: a square industrial plinth,
 * four stacked gothic tiers, a central spire, flying buttresses and a few
 * docked ships. Authored in a 10-unit space, then scaled to one board cell.
 * Geometry is merged per material, so the whole city is five draw calls.
 */

const AUTHOR_SPAN = 10.25; // widest part (bottom lip) in authoring units

export const CAPITAL_COLORS = {
  stone: 0x8f949b,
  trim: 0x747981,
  dark: 0x2a2d33,
  metal: 0x5b5f66,
  glow: 0xffb347,
};

function createMaterials() {
  return {
    stone: new THREE.MeshStandardMaterial({ color: CAPITAL_COLORS.stone, roughness: 0.88 }),
    trim: new THREE.MeshStandardMaterial({ color: CAPITAL_COLORS.trim, roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: CAPITAL_COLORS.dark, roughness: 0.95 }),
    metal: new THREE.MeshStandardMaterial({ color: CAPITAL_COLORS.metal, roughness: 0.55, metalness: 0.45 }),
    glow: new THREE.MeshStandardMaterial({
      color: CAPITAL_COLORS.glow,
      emissive: 0xff8f26,
      emissiveIntensity: 1.4,
      roughness: 0.6,
    }),
  };
}

/** Small seeded RNG so the city looks the same on every load. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

/**
 * @param {object} [opts]
 * @param {number} [opts.size=0.97] footprint width in world units (one board cell by default)
 * @param {number} [opts.seed=1337] seed for building placement
 * @returns {THREE.Group} base sits on y = 0, footprint centred on the origin, front faces +z
 */
export function buildHiveCapital({ size = 0.97, seed = 1337 } = {}) {
  const rand = mulberry32(seed);
  const R = (a, b) => a + (b - a) * rand();
  const parts = { stone: [], trim: [], dark: [], metal: [], glow: [] };

  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  /** Place a fresh geometry. Yaw (ry) is applied last, so rx/rz tilt in the local frame. */
  function put(mat, geo, x, y, z, ry = 0, rx = 0, rz = 0, parent = null) {
    eul.set(rx, ry, rz, 'YXZ');
    quat.setFromEuler(eul);
    m4.compose(pos.set(x, y, z), quat, one);
    if (parent) m4.premultiply(parent);
    geo.applyMatrix4(m4);
    parts[mat].push(geo);
  }

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, seg = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  const cone = (r, h, seg = 6) => new THREE.ConeGeometry(r, h, seg);
  const polar = (r, a) => [Math.sin(a) * r, Math.cos(a) * r];
  const frame = (x, y, z, ry, s = 1) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
      new THREE.Vector3(s, s, s),
    );

  /** Round-topped window: a slab plus a half-buried disc. Local +z faces out. */
  function arch(mat, x, y0, z, ry, w, h, t = 0.05, parent = null) {
    const bh = Math.max(h - w / 2, 0.01);
    put(mat, box(w, bh, t), x, y0 + bh / 2, z, ry, 0, 0, parent);
    put(mat, cyl(w / 2, w / 2, t, 8), x, y0 + bh, z, ry, Math.PI / 2, 0, parent);
  }

  function ship(x, y, z, ry, s = 1) {
    const f = frame(x, y, z, ry, s);
    put('metal', box(0.22, 0.12, 0.8), 0, 0, 0, 0, 0, 0, f);
    put('trim', cone(0.11, 0.32, 4), 0, 0, 0.56, 0, Math.PI / 2, Math.PI / 4, f);
    put('trim', box(0.62, 0.03, 0.24), 0, -0.02, -0.12, 0, 0, 0, f);
    put('metal', box(0.11, 0.14, 0.22), 0, 0.12, -0.22, 0, 0, 0, f);
    put('trim', box(0.03, 0.14, 0.14), 0, 0.2, -0.32, 0, 0, 0, f);
    for (const sx of [-0.07, 0.07]) put('glow', cyl(0.045, 0.045, 0.05, 8), sx, 0, -0.41, 0, Math.PI / 2, 0, f);
  }

  // ---------------------------------------------------------------- plinth
  const BH = 1.0;
  const DECK = BH + 0.05;
  put('stone', box(10, BH, 10), 0, BH / 2, 0);
  put('trim', box(10.25, 0.12, 10.25), 0, 0.06, 0);
  put('trim', box(10.2, 0.12, 10.2), 0, BH - 0.01, 0);
  for (const cx of [-5, 5]) for (const cz of [-5, 5]) put('trim', box(0.42, BH + 0.12, 0.42), cx, (BH + 0.12) / 2, cz);

  const BAYS = 6;
  const bayW = 10 / BAYS;
  for (let s = 0; s < 4; s++) {
    const th = (s * Math.PI) / 2;
    const at = (lx, lz) => [lx * Math.cos(th) + lz * Math.sin(th), -lx * Math.sin(th) + lz * Math.cos(th)];

    for (let i = 1; i < BAYS; i++) {
      const [x, z] = at(-5 + i * bayW, 5.03);
      put('trim', box(0.16, BH - 0.12, 0.1), x, BH / 2, z, th);
    }
    for (let i = 0; i < BAYS; i++) {
      const lx = -5 + (i + 0.5) * bayW;
      if (i === 1 || i === 4) {
        // machinery bay: vent housing, two fans and a riser pipe
        let [x, z] = at(lx, 5.08);
        put('metal', box(0.95, 0.5, 0.16), x, 0.45, z, th);
        [x, z] = at(lx - 0.2, 5.17);
        put('dark', cyl(0.16, 0.16, 0.04, 12), x, 0.45, z, th, Math.PI / 2);
        [x, z] = at(lx + 0.22, 5.17);
        put('dark', cyl(0.13, 0.13, 0.04, 12), x, 0.45, z, th, Math.PI / 2);
        [x, z] = at(lx + 0.62, 5.1);
        put('metal', cyl(0.07, 0.07, BH - 0.14, 8), x, BH / 2, z, th);
        [x, z] = at(lx - 0.62, 5.1);
        put('metal', cyl(0.06, 0.06, BH - 0.14, 8), x, BH / 2, z, th);
      } else {
        let [x, z] = at(lx, 5.02);
        arch('trim', x, 0.2, z, th, 0.8, 0.7, 0.06);
        [x, z] = at(lx, 5.07);
        arch('dark', x, 0.26, z, th, 0.58, 0.58, 0.05);
      }
    }

    // deck: pipes running in from the edge, low machine blocks, squat buildings
    for (const lx of [-0.75, -0.5, 0.5, 0.75]) {
      const [x, z] = at(lx, 4.5);
      put('metal', cyl(0.07, 0.07, 0.9, 8), x, DECK + 0.07, z, th, Math.PI / 2);
    }
    for (const lx of [-2.3, 2.3]) {
      let [x, z] = at(lx, 4.4);
      const h = R(0.35, 0.55);
      put('stone', box(0.75, h, 0.6), x, DECK + h / 2, z, th);
      put('trim', cone(0.52, 0.25, 4), x, DECK + h + 0.125, z, th + Math.PI / 4);
      [x, z] = at(lx, 4.71);
      arch('dark', x, DECK + 0.05, z, th, 0.22, h * 0.6, 0.02);
      [x, z] = at(lx + (lx > 0 ? -0.75 : 0.75), 4.6);
      put('metal', box(0.4, 0.18, 0.4), x, DECK + 0.09, z, th);
    }
  }

  // landing pads in the corners (two with ships)
  const padSpots = [
    [-3.95, 3.95],
    [3.95, 3.95],
    [3.95, -3.95],
    [-3.95, -3.95],
  ];
  padSpots.forEach(([px, pz], i) => {
    put('trim', cyl(0.95, 1.0, 0.12, 8), px, DECK + 0.06, pz, Math.PI / 8);
    put('dark', cyl(0.72, 0.72, 0.15, 8), px, DECK + 0.075, pz, Math.PI / 8);
    put('stone', cyl(0.55, 0.55, 0.18, 8), px, DECK + 0.09, pz, Math.PI / 8);
    if (i === 0 || i === 2) ship(px, DECK + 0.22, pz, Math.atan2(px, pz) + Math.PI * 0.75, 1.1);
    else put('metal', box(0.5, 0.25, 0.5), px, DECK + 0.25, pz, Math.PI / 4);
  });

  // raised deck plates on a half-unit grid
  for (let tries = 0; tries < 70; tries++) {
    const x = Math.round(R(-4.5, 4.5) * 2) / 2;
    const z = Math.round(R(-4.5, 4.5) * 2) / 2;
    if (Math.hypot(x, z) < 4.6) continue;
    if (padSpots.some(([px, pz]) => Math.hypot(x - px, z - pz) < 1.3)) continue;
    put('trim', box(R(0.3, 0.8), 0.05, R(0.3, 0.8)), x, DECK + 0.015, z);
  }

  // ---------------------------------------------------------------- tiers
  const TIERS = [
    { r: 4.0, h: 1.35 },
    { r: 3.15, h: 1.3 },
    { r: 2.3, h: 1.25 },
    { r: 1.5, h: 1.15 },
  ];
  const SPIRE_R = 0.95;
  const BUTTRESS_ANGLES = Array.from({ length: 8 }, (_, k) => Math.PI / 8 + (k * Math.PI) / 4);
  const SHIP_ANGLES = [1.0, 2.75, 4.35];
  const NEEDLE_ANGLE = 0;

  let y = DECK;
  TIERS.forEach((t, ti) => {
    t.y0 = y;
    t.y1 = y + t.h;
    put('stone', cyl(t.r, t.r, t.h, 40), 0, y + t.h / 2, 0);
    put('trim', cyl(t.r + 0.06, t.r + 0.06, 0.1, 40), 0, y + 0.05, 0);
    put('trim', cyl(t.r + 0.1, t.r + 0.1, 0.08, 40), 0, t.y1 - 0.025, 0);
    put('trim', cyl(t.r + 0.05, t.r + 0.05, 0.12, 40, true), 0, t.y1 + 0.06, 0);

    const n = ti === 0 ? 48 : Math.round((TAU * t.r) / 0.55);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const [px, pz] = polar(t.r + 0.02, a + Math.PI / n);
      put('trim', box(0.08, t.h - 0.16, 0.06), px, y + t.h / 2, pz, a + Math.PI / n);
      if (ti === 0 && k % 6 === 0) {
        const [gx, gz] = polar(t.r + 0.07, a);
        arch('trim', gx, y, gz, a, 0.56, 0.86, 0.05);
        const [dx, dz] = polar(t.r + 0.12, a);
        arch('dark', dx, y, dz, a, 0.42, 0.75, 0.05);
      } else {
        const [wx, wz] = polar(t.r + 0.015, a);
        arch(rand() < 0.18 ? 'glow' : 'dark', wx, y + t.h * 0.3, wz, a, 0.16, t.h * 0.45, 0.04);
      }
    }

    // rooftop blocks on the ring between this tier and the next one in
    const inner = (TIERS[ti + 1]?.r ?? SPIRE_R) + 0.12;
    const outer = t.r - 0.14;
    const band = outer - inner;
    const mid = (inner + outer) / 2;
    const count = Math.round((TAU * mid) / 0.42);
    const near = (a, list, tol) => list.some((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < tol);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU + R(-0.05, 0.05);
      if (near(a, BUTTRESS_ANGLES, 0.14)) continue;
      if (ti === 0 && near(a, [...SHIP_ANGLES, NEEDLE_ANGLE], 0.3)) continue;
      const w = R(0.18, 0.36);
      const d = R(0.16, Math.min(0.42, band - 0.05));
      const h = R(0.14, 0.55) * (ti === 3 ? 0.8 : 1);
      const r = R(inner + d / 2, outer - d / 2);
      const [bx, bz] = polar(r, a);
      const base = t.y1;
      put('stone', box(w, h, d), bx, base + h / 2, bz, a);
      const [fx, fz] = polar(r + d / 2 + 0.01, a);
      put(rand() < 0.25 ? 'glow' : 'dark', box(w * 0.55, h * 0.35, 0.012), fx, base + h * 0.55, fz, a);
      const roll = rand();
      if (roll < 0.3) {
        put('trim', cone(Math.max(w, d) * 0.72, R(0.1, 0.2), 4), bx, base + h + 0.07, bz, a + Math.PI / 4);
      } else if (roll < 0.5) {
        put('trim', cone(0.05, R(0.25, 0.45), 4), bx, base + h + 0.17, bz, a + Math.PI / 4);
      } else if (roll < 0.65) {
        put('metal', cyl(0.04, 0.05, 0.22, 8), bx + R(-0.05, 0.05), base + h + 0.11, bz, 0);
      } else if (roll < 0.75) {
        const dome = new THREE.SphereGeometry(Math.min(w, d) * 0.45, 10, 6, 0, TAU, 0, Math.PI / 2);
        put('trim', dome, bx, base + h, bz, a);
      }
    }
    y = t.y1;
  });

  // ships docked on the first ring, nose along the ring
  for (const a of SHIP_ANGLES) {
    const [sx, sz] = polar(3.58, a);
    put('metal', box(0.3, 0.06, 0.5), sx, TIERS[0].y1 + 0.03, sz, a);
    ship(sx, TIERS[0].y1 + 0.13, sz, a + Math.PI / 2, 0.95);
  }

  // ---------------------------------------------------------------- spire
  const STAGES = [
    { r: SPIRE_R, h: 1.5 },
    { r: 0.72, h: 1.4 },
    { r: 0.52, h: 1.2 },
    { r: 0.36, h: 1.0 },
  ];
  y = TIERS[3].y1;
  for (const st of STAGES) {
    put('stone', cyl(st.r, st.r, st.h, 8), 0, y + st.h / 2, 0, Math.PI / 8);
    put('trim', cyl(st.r + 0.06, st.r + 0.06, 0.08, 8), 0, y + st.h - 0.025, 0, Math.PI / 8);
    const apothem = st.r * Math.cos(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const fa = (k * Math.PI) / 4;
      const ca = fa + Math.PI / 8;
      const [wx, wz] = polar(apothem + 0.012, fa);
      arch(k % 2 ? 'dark' : 'glow', wx, y + st.h * 0.2, wz, fa, st.r * 0.32, st.h * 0.55, 0.03);
      const [cx, cz] = polar(st.r + 0.02, ca);
      put('trim', box(0.07, st.h, 0.07), cx, y + st.h / 2, cz, ca);
      put('trim', cone(0.05, 0.32, 4), cx, y + st.h + 0.16, cz, ca + Math.PI / 4);
    }
    y += st.h;
  }
  put('stone', cone(0.36, 3.0, 8), 0, y + 1.5, 0, Math.PI / 8);
  put('trim', cyl(0.2, 0.2, 0.08, 8), 0, y + 1.5, 0, Math.PI / 8);
  put('metal', cone(0.04, 0.7, 6), 0, y + 3.25, 0);

  // ---------------------------------------------------------------- buttresses
  const TOWER_R = 4.32;
  const BEAM_Y = TIERS[2].y0 + TIERS[2].h * 0.7;
  const TOWER_H = BEAM_Y - DECK + 0.25;
  for (const a of BUTTRESS_ANGLES) {
    const [tx, tz] = polar(TOWER_R, a);
    put('stone', box(0.36, TOWER_H, 0.36), tx, DECK + TOWER_H / 2, tz, a);
    for (const by of [1.1, 2.3, TOWER_H]) put('trim', box(0.44, 0.07, 0.44), tx, DECK + by, tz, a);
    const [sx, sz] = polar(TOWER_R + 0.185, a);
    put('dark', box(0.08, 0.5, 0.01), sx, DECK + 1.6, sz, a);
    put('dark', box(0.08, 0.5, 0.01), sx, DECK + 2.8, sz, a);
    put('trim', cone(0.2, 0.95, 4), tx, DECK + TOWER_H + 0.5, tz, a + Math.PI / 4);
    for (const [ox, oz] of [
      [-0.16, -0.16],
      [0.16, -0.16],
      [-0.16, 0.16],
      [0.16, 0.16],
    ]) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      put('trim', cone(0.045, 0.3, 4), tx + ox * c + oz * s, DECK + TOWER_H + 0.18, tz - ox * s + oz * c, a);
    }

    // flying buttress: beam into the third tier, half-arch underneath
    const span = TOWER_R - TIERS[2].r;
    const [mx, mz] = polar(TIERS[2].r + span / 2, a);
    put('stone', box(0.16, 0.14, span), mx, BEAM_Y, mz, a);
    put('trim', new THREE.TorusGeometry(span / 2, 0.055, 5, 18, Math.PI), mx, BEAM_Y - span / 2, mz, a - Math.PI / 2);
  }

  // needle tower rising off the first ring at the front
  {
    const [nx, nz] = polar(3.58, NEEDLE_ANGLE);
    const base = TIERS[0].y1;
    const h = 4.4;
    put('stone', box(0.3, h, 0.3), nx, base + h / 2, nz, NEEDLE_ANGLE);
    for (const by of [1.1, 2.2, 3.3, h]) put('trim', box(0.38, 0.06, 0.38), nx, base + by, nz, NEEDLE_ANGLE);
    for (const by of [0.4, 1.5, 2.6]) {
      const [wx, wz] = polar(3.58 + 0.155, NEEDLE_ANGLE);
      arch('glow', wx, base + by, wz, NEEDLE_ANGLE, 0.1, 0.4, 0.01);
    }
    put('trim', cone(0.17, 1.1, 4), nx, base + h + 0.55, nz, NEEDLE_ANGLE + Math.PI / 4);
  }

  // ---------------------------------------------------------------- merge
  const materials = createMaterials();
  const city = new THREE.Group();
  city.name = 'HiveCapital';
  for (const [key, geos] of Object.entries(parts)) {
    if (!geos.length) continue;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, materials[key]);
    mesh.name = `capital_${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    city.add(mesh);
  }
  city.scale.setScalar(size / AUTHOR_SPAN);
  return city;
}
