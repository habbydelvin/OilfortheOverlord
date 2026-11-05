/**
 * The War Map's mark for a fallen Hive City (globeView.js): an impact crater, not the board's Toxic Crater tile.
 *
 * One shaped disc: a scorched bowl, a raised broken rim, and ejecta thinning out in rays across the sand, a little
 * wider than the city's hex. Its colour, normal and roughness maps are painted once from the same height field (so
 * the light catches the rim and the terraces), and its edge fades out into the planet. The disc bends down with the
 * planet's curve so it lies on the ball everywhere.
 */
import * as THREE from 'three';

const SIZE = 512; // texels across the textures
const BOWL = 0.42; // bowl radius (share of the disc's radius)
const RIM = 0.56; // rim crest
const SEGMENTS = 160; // around
const RINGS = 48; // outward

// Seeded value noise, tileable around the circle (angle) so the rays and the broken rim don't seam.
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => ((h & 1 ? -x : x) + (h & 2 ? -y : y));
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const noise = (x, y) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  };
  const fbm = (x, y, oct = 5) => {
    let sum = 0;
    let amp = 0.5;
    for (let o = 0; o < oct; o++) {
      sum += amp * noise(x, y);
      x = x * 2.03 + 17.1;
      y = y * 2.03 + 3.7;
      amp *= 0.5;
    }
    return sum;
  };
  return { noise, fbm };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Height (in disc radii) at polar position r (0..1), angle a; and how much ejecta lies there. */
function makeField(seed) {
  const { fbm } = makeNoise(seed);
  const rays = (a) => {
    // Sharp streaks: a handful of narrow peaks round the circle, of varied length.
    let v = 0;
    for (let i = 0; i < 9; i++) {
      const c = ((i * 2.39996 + seed) % (Math.PI * 2));
      const d = Math.abs(((a - c + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      v = Math.max(v, Math.exp(-d * d * 90) * (0.6 + 0.4 * Math.sin(i * 7.3)));
    }
    return v;
  };
  return (r, a) => {
    const x = Math.cos(a);
    const y = Math.sin(a);
    const wob = fbm(x * 2.2 + 5, y * 2.2 + 5, 3) * 0.07; // a slightly out-of-round crater
    const rr = r * (1 + wob);
    const grit = fbm(x * r * 9 + 1, y * r * 9 + 1, 5);
    // Bowl: a smooth dish to the floor, with a little central heap.
    let h = -0.2 * (1 - smooth(0, BOWL, rr) ** 1.6) * (rr < BOWL ? 1 : 0);
    h += rr < BOWL ? 0.05 * Math.exp(-((rr / (BOWL * 0.28)) ** 2)) : 0;
    // Rim: a sharp crest, steep inside, falling off gently outside, broken in places.
    const crest = rr < RIM ? smooth(BOWL * 0.75, RIM, rr) : 1 - smooth(RIM, 1, rr) ** 0.6;
    const broken = 0.75 + 0.35 * fbm(x * 3 + 9, y * 3 + 9, 3);
    h += 0.085 * crest * broken;
    // Terraces slumped down the inner wall.
    if (rr > BOWL * 0.55 && rr < RIM) h += 0.012 * Math.sin(rr * 70 + grit * 2);
    // Ejecta: lumpy blanket outside the rim, with rays.
    const blanket = rr > RIM ? (1 - smooth(RIM, 1, rr)) : 0;
    const ray = rays(a) * (rr > RIM * 0.9 ? 1 - smooth(RIM, 1.05, rr) * 0.6 : 0);
    h += (blanket * 0.6 + ray * 0.5) * 0.02 * (0.6 + grit);
    h += grit * 0.008 * (rr < 1 ? 1 : 0);
    // Fade to the ground at the edge.
    h *= 1 - smooth(0.86, 1, r);
    return { h, blanket, ray, grit, rr };
  };
}

/** Colour, normal, roughness and alpha textures for the field. */
function paint(field) {
  const n = SIZE;
  const H = new Float32Array(n * n);
  const info = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n * 2 - 1;
      const v = (j + 0.5) / n * 2 - 1;
      const r = Math.hypot(u, v);
      const f = field(Math.min(r, 1.2), Math.atan2(v, u));
      H[j * n + i] = r > 1 ? 0 : f.h;
      info.push(f);
    }
  }
  const col = new Uint8ClampedArray(n * n * 4);
  const nrm = new Uint8ClampedArray(n * n * 4);
  const rgh = new Uint8ClampedArray(n * n * 4);
  const at = (i, j) => H[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  const scale = n / 2; // height is in disc radii; texels per radius
  // The planet's palette (sandPlanet.js), burnt toward the centre.
  const sand = [0.9, 0.66, 0.4];
  const rust = [0.55, 0.26, 0.12];
  const ash = [0.13, 0.1, 0.09];
  const glass = [0.24, 0.16, 0.12];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const f = info[k];
      const u = (i + 0.5) / n * 2 - 1;
      const v = (j + 0.5) / n * 2 - 1;
      const r = Math.hypot(u, v);
      // Normal from the height slope.
      const dx = (at(i + 1, j) - at(i - 1, j)) * scale * 0.5;
      const dy = (at(i, j + 1) - at(i, j - 1)) * scale * 0.5;
      const len = Math.hypot(dx, dy, 1);
      nrm[k * 4] = (-dx / len * 0.5 + 0.5) * 255;
      nrm[k * 4 + 1] = (dy / len * 0.5 + 0.5) * 255; // texture v runs opposite to +z in the disc's uv
      nrm[k * 4 + 2] = (1 / len * 0.5 + 0.5) * 255;
      nrm[k * 4 + 3] = 255;
      // Colour: ash-black glassy floor, scorched walls, rust ejecta and rays, fading to sand.
      const t = f.rr;
      let c = sand.map((s, q) => s + (rust[q] - s) * Math.min(1, f.blanket * 1.2 + f.ray * 0.9));
      const scorch = 1 - smooth(BOWL * 0.6, RIM * 1.15, t);
      c = c.map((x, q) => x + (ash[q] - x) * scorch);
      const floor = 1 - smooth(0, BOWL * 0.7, t);
      c = c.map((x, q) => x + (glass[q] - x) * floor * 0.7);
      const shade = 0.82 + 0.3 * f.grit;
      c = c.map((x) => Math.min(1, x * shade));
      // The rim's crest catches a little pale dust.
      const crest = Math.exp(-(((t - RIM) / 0.035) ** 2));
      c = c.map((x) => x + (0.9 - x) * crest * 0.18);
      col[k * 4] = c[0] * 255;
      col[k * 4 + 1] = c[1] * 255;
      col[k * 4 + 2] = c[2] * 255;
      // Fade the outer blanket into the planet (the rays reach a little further).
      const edge = 1 - smooth(0.7 + f.ray * 0.2, 0.98, r);
      col[k * 4 + 3] = Math.max(0, Math.min(1, edge)) * 255;
      // Glassy floor a little shiny, the rest dull.
      const rough = 0.95 - floor * 0.4;
      rgh[k * 4] = rgh[k * 4 + 1] = rgh[k * 4 + 2] = rough * 255;
      rgh[k * 4 + 3] = 255;
    }
  }
  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.flipY = false;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: tex(col, true), normalMap: tex(nrm, false), roughnessMap: tex(rgh, false) };
}

let shared = null;
function assets() {
  if (shared) return shared;
  const field = makeField(7);
  // Disc of rings: the vertex heights from the field (the textures carry the fine detail).
  const pos = [];
  const uv = [];
  const idx = [];
  pos.push(0, field(0, 0).h, 0);
  uv.push(0.5, 0.5);
  for (let ring = 1; ring <= RINGS; ring++) {
    const r = (ring / RINGS) ** 1.15;
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      pos.push(x, field(r, a).h, z);
      uv.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    }
  }
  for (let s = 0; s < SEGMENTS; s++) idx.push(0, 1 + ((s + 1) % SEGMENTS), 1 + s);
  for (let ring = 1; ring < RINGS; ring++) {
    const a0 = 1 + (ring - 1) * SEGMENTS;
    const b0 = 1 + ring * SEGMENTS;
    for (let s = 0; s < SEGMENTS; s++) {
      const s1 = (s + 1) % SEGMENTS;
      idx.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const maps = paint(field);
  const mat = new THREE.MeshStandardMaterial({
    ...maps,
    normalScale: new THREE.Vector2(1.4, 1.4),
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  mat.userData.flat = true; // never the board's map-shape bend
  shared = { geo, mat };
  return shared;
}

/**
 * A crater `radius` across (planet units, its rim at ~0.56 of it), for a city group scaled by `scale`, on a planet
 * of radius `planetRadius`: the disc is built in the group's units and bends with the ball's curve.
 */
export function createGlobeCrater({ radius, scale, planetRadius }) {
  const { geo, mat } = assets();
  const local = radius / scale; // the group is scaled by `scale`
  const g = geo.clone();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * local;
    const z = p.getZ(i) * local;
    const d2 = (x * x + z * z) * scale * scale; // world distance², from the centre
    const sag = d2 / (2 * planetRadius) / scale; // the ball falls away under a flat disc
    // Never below the ball's surface (it would hide the bowl): the depth reads from the normal map and colours.
    const y = Math.max(p.getY(i), 0) * local;
    p.setXYZ(i, x, y + 0.02 / scale - sag, z);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'globe crater';
  mesh.renderOrder = 1;
  return mesh;
}
