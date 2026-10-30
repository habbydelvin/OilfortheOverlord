import * as THREE from 'three';

/**
 * Seamless ground: the desert around the board and the ground of every tile are one continuous sand.
 *
 * The desert sand (SAND) is sampled in world space, on the board's sand plane and on the tiles' plain sand parts
 * (<Name>_Sand) alike, so it runs on unbroken from the desert onto a tile and from one tile to the next, whatever
 * the tile or piece rotation. Painted grounds (<Name>Ground: oasis, tar pit, crater, ruins, cliffs, the Wasteland
 * pieces; the Settlement pad) fade into that same sand along their outer edge, so every tile meets its neighbours
 * on identical sand. Edges between two cells of one Wasteland piece don't fade: the piece's picture carries on.
 */
export const SAND = {
  url: '/textures/sand08.jpg?v=20261027-1602', // bump when the texture file changes, so browsers drop the cached copy
  tile: 4, // world units per texture repeat (just over one 3×3 plot)
  // The board lights (hemisphere 1.3 + sun 2.2, ACES) push the painted sand to bright orange.
  // This tint brings it back to about the texture's own muted brown.
  tint: 0xe4e4e6,
  roughness: 1,
};

export const SEAM = {
  blend: 0.22, // width of the fade at a painted ground's edge, in cells
  // Hue difference from the picture's own sand (0 = same hue) where a painted pixel starts / stops counting as a
  // coloured feature that keeps its paint. Below the first value it's plain sand and becomes desert sand.
  key: [0.12, 0.3],
};

const SAND_NAME = /_Sand$/;
const GROUND_NAME = /Ground$|^Village\d+_Pad\d+$/;
// Painted decals inside a tile, on a sand-coloured background (the camps' fire pit scorch).
const DECAL_NAME = /_AshScorch$/;

let sandMap = null;
/** The desert sand texture, loaded once and shared by the board plane and every tile. */
export function sandTexture() {
  if (!sandMap) {
    sandMap = new THREE.TextureLoader().load(SAND.url);
    sandMap.colorSpace = THREE.SRGBColorSpace;
    sandMap.wrapS = sandMap.wrapT = THREE.RepeatWrapping;
    sandMap.anisotropy = 8;
  }
  return sandMap;
}

/** Turn a material into the desert sand: same texture, tint and finish, at world-space UVs. */
export function useDesertSand(material) {
  material.map = sandTexture();
  material.normalMap = null;
  material.color.set(SAND.tint);
  material.roughness = SAND.roughness;
  material.metalness = 0;
  patch(material, { mode: 'sand' });
  return material;
}

/**
 * A painted ground's own sand colour, in linear RGB (the space the shader works in): the per-channel median of a
 * 64 × 64 copy. Sand covers most of every painted ground, so features (water, tar) don't pull it off.
 */
const paintSands = new WeakMap(); // texture -> THREE.Vector3
function paintSand(texture) {
  if (paintSands.has(texture)) return paintSands.get(texture);
  const fallback = new THREE.Vector3(0.5, 0.4, 0.25);
  const img = texture?.image;
  if (!img?.width) return fallback;
  const n = 64;
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  ctx.canvas.width = ctx.canvas.height = n;
  ctx.drawImage(img, 0, 0, n, n);
  const px = ctx.getImageData(0, 0, n, n).data;
  const median = [0, 1, 2].map((c) => {
    const values = [];
    for (let i = c; i < px.length; i += 4) values.push(px[i]);
    values.sort((a, b) => a - b);
    return values[values.length >> 1] / 255;
  });
  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const sand = new THREE.Vector3(...median.map((v) => Math.max(toLinear(v), 1e-3)));
  paintSands.set(texture, sand);
  return sand;
}

const patches = new WeakMap(); // material -> { mode, mask, grid }

/** Clones lose onBeforeCompile (ghost previews, below-ground copies): put the same patch on the copy. */
export function copySeam(from, to) {
  const p = patches.get(from);
  if (p) patch(to, p);
  return to;
}

// SEAM_GROUND: a painted ground (or decal) keyed to the desert sand. SEAM_EDGE: it also fades out at the tile edge.
const VERT_PARS = /* glsl */ `
varying vec2 vSeamWorld;
#ifdef SEAM_EDGE
  attribute vec2 seamCell;
  varying vec2 vSeamCell;
#endif
`;
const VERT_MAIN = /* glsl */ `
vSeamWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
#ifdef SEAM_EDGE
  vSeamCell = seamCell;
#endif
`;

const FRAG_PARS = /* glsl */ `
varying vec2 vSeamWorld;
uniform float uSeamRepeat;
#ifdef SEAM_GROUND
  uniform sampler2D uSeamSand;
  uniform vec3 uSeamTint;
  uniform float uSeamRoughness;
  uniform vec3 uSeamPaintSand;
  uniform vec2 uSeamKey;
#endif
#ifdef SEAM_EDGE
  varying vec2 vSeamCell;
  uniform vec2 uSeamGrid;
  uniform int uSeamMask;
  uniform float uSeamBlend;
  bool seamOcc( vec2 c ) {
    if ( c.x < 0.0 || c.y < 0.0 || c.x >= uSeamGrid.x || c.y >= uSeamGrid.y ) return false;
    int bit = int( c.y ) * 4 + int( c.x );
    return ( ( uSeamMask >> bit ) & 1 ) != 0;
  }
  // 0 on the piece's outer edge, 1 from uSeamBlend cells inside it.
  float seamEdge() {
    vec2 c = clamp( floor( vSeamCell ), vec2( 0.0 ), uSeamGrid - 1.0 );
    vec2 f = vSeamCell - c;
    float d = 1.0;
    if ( ! seamOcc( c + vec2( -1.0, 0.0 ) ) ) d = min( d, f.x );
    if ( ! seamOcc( c + vec2( 1.0, 0.0 ) ) ) d = min( d, 1.0 - f.x );
    if ( ! seamOcc( c + vec2( 0.0, -1.0 ) ) ) d = min( d, f.y );
    if ( ! seamOcc( c + vec2( 0.0, 1.0 ) ) ) d = min( d, 1.0 - f.y );
    // Inner corners of L / T / S shapes: both sides belong to the piece, the diagonal cell doesn't.
    if ( ! seamOcc( c + vec2( -1.0, -1.0 ) ) ) d = min( d, length( f ) );
    if ( ! seamOcc( c + vec2( 1.0, -1.0 ) ) ) d = min( d, length( vec2( 1.0 - f.x, f.y ) ) );
    if ( ! seamOcc( c + vec2( -1.0, 1.0 ) ) ) d = min( d, length( vec2( f.x, 1.0 - f.y ) ) );
    if ( ! seamOcc( c + vec2( 1.0, 1.0 ) ) ) d = min( d, length( 1.0 - f ) );
    return smoothstep( 0.0, uSeamBlend, max( d, 0.0 ) );
  }
#endif
`;

const SEAM_UV = /* glsl */ `vec2 seamUv = vec2( vSeamWorld.x, - vSeamWorld.y ) * uSeamRepeat;`;

// Desert sand: the map at world-space UVs.
const SAND_MAP = /* glsl */ `
${SEAM_UV}
#ifdef USE_MAP
  diffuseColor *= texture2D( map, seamUv );
#endif
`;

/*
 * Painted ground. Its plain sand becomes the desert sand, keeping the painted light and shade (ripples, tracks,
 * cracks, stains) as a ratio to the picture's own sand colour (uSeamPaintSand). Coloured features (water, grass,
 * toxic sludge) differ in hue, not just brightness, and keep their painted colour. At the outer edge everything
 * fades to the plain desert sand. The painted grounds' own colour is white, so the desert tint matches the plane.
 */
const GROUND_MAP = /* glsl */ `
${SEAM_UV}
#ifdef SEAM_EDGE
  float seamK = seamEdge();
#else
  float seamK = 1.0;
#endif
float seamOwn = seamK;
#ifdef USE_MAP
  vec4 seamPaint = texture2D( map, vMapUv );
  vec3 seamDesert = texture2D( uSeamSand, seamUv ).rgb * uSeamTint;
  vec3 seamRatio = clamp( seamPaint.rgb / uSeamPaintSand, 0.0, 3.0 );
  float seamLum = max( ( seamRatio.r + seamRatio.g + seamRatio.b ) / 3.0, 1e-3 );
  float seamFeature = smoothstep( uSeamKey.x, uSeamKey.y, length( seamRatio / seamLum - 1.0 ) );
  vec3 seamKeyed = mix( seamDesert * seamRatio, seamPaint.rgb, seamFeature );
  diffuseColor.rgb *= mix( seamDesert, seamKeyed, seamK );
  diffuseColor.a *= seamPaint.a;
  seamOwn = seamK * seamFeature; // how much of the painted ground's own finish is left
#endif
`;

// The desert sand has its own roughness: plain sand takes it, the painted features keep theirs.
const GROUND_ROUGHNESS = /* glsl */ `
roughnessFactor = mix( uSeamRoughness, roughnessFactor, seamOwn );
`;
const GROUND_NORMAL = /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale;
  normal = normalize( mix( normal, tbn * mapN, seamK ) );
#endif
`;

/** mode: 'sand' (plain desert sand), 'ground' (painted ground, fades out at the tile edge), 'decal' (painted, no fade). */
function patch(material, { mode, mask = 1, grid = [1, 1] }) {
  patches.set(material, { mode, mask, grid });
  const ground = mode !== 'sand';
  material.defines = { ...material.defines, ...(ground ? { SEAM_GROUND: '' } : {}), ...(mode === 'ground' ? { SEAM_EDGE: '' } : {}) };
  material.customProgramCacheKey = () => `seam-${mode}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSeamRepeat = { value: 1 / SAND.tile };
    if (ground) {
      Object.assign(shader.uniforms, {
        uSeamSand: { value: sandTexture() },
        uSeamTint: { value: new THREE.Color(SAND.tint) },
        uSeamRoughness: { value: SAND.roughness },
        uSeamPaintSand: { value: paintSand(material.map) },
        uSeamKey: { value: new THREE.Vector2(...SEAM.key) },
        uSeamGrid: { value: new THREE.Vector2(...grid) },
        uSeamMask: { value: mask },
        uSeamBlend: { value: SEAM.blend },
      });
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    let frag = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_PARS}`);
    if (ground) {
      frag = frag
        .replace('#include <map_fragment>', GROUND_MAP)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${GROUND_ROUGHNESS}`)
        .replace('#include <normal_fragment_maps>', `${GROUND_NORMAL}\n#ifndef USE_NORMALMAP_TANGENTSPACE\n#include <normal_fragment_maps>\n#endif`);
    } else {
      frag = frag.replace('#include <map_fragment>', SAND_MAP);
    }
    shader.fragmentShader = frag;
  };
  material.needsUpdate = true;
}

/**
 * Patch a model's sand and ground materials. Call before the cell fit, with the root as storeFootprint left it.
 * footprint: the root-space Box3 of the model's cells; grid: [w, h] cells it spans (pieces up to 4 × 4).
 * Returns the number of materials patched.
 */
export function makeSeamless(root, footprint, grid = [1, 1]) {
  root.updateMatrixWorld(true);
  const [w, h] = grid;
  const done = new Set();
  const grounds = [];
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || !o.material.map || done.has(o.material)) return;
    const name = o.material.name ?? '';
    if (SAND_NAME.test(name)) {
      useDesertSand(o.material);
      dropBorderWalls(o, cellCoords(o, footprint, w, h));
      done.add(o.material);
    } else if (DECAL_NAME.test(name)) {
      paintSand(o.material.map);
      patch(o.material, { mode: 'decal' });
      done.add(o.material);
    } else if (GROUND_NAME.test(name)) grounds.push(o);
  });

  // Painted grounds: each vertex's position in cells, and which cells of the grid the ground covers.
  // (Runs while models load during play: typed arrays and early exits keep it to a few ms per model.)
  const full = w * h === 1 ? 1 : (() => {
    let m = 0;
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) m |= 1 << (z * 4 + x);
    return m;
  })();
  let mask = w * h === 1 ? 1 : 0;
  for (const o of grounds) {
    const cells = cellCoords(o, footprint, w, h);
    dropBorderWalls(o, cells);
    o.geometry.setAttribute('seamCell', new THREE.BufferAttribute(cells, 2));
    if (mask !== full) mask = coverMask(o.geometry, cells, w, h, mask, full);
  }
  for (const o of grounds) {
    if (done.has(o.material)) continue;
    paintSand(o.material.map); // measured now, while loading, rather than on the first frame it's drawn
    patch(o.material, { mode: 'ground', mask, grid });
    done.add(o.material);
  }
  return done.size;
}

/** Each vertex's position in cells of the footprint's grid (x, z pairs), straight from the world matrix. */
function cellCoords(o, footprint, w, h) {
  const pos = o.geometry.attributes.position;
  const e = o.matrixWorld.elements;
  const sx = w / (footprint.max.x - footprint.min.x);
  const sz = h / (footprint.max.z - footprint.min.z);
  const out = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    out[i * 2] = (e[0] * x + e[4] * y + e[8] * z + e[12] - footprint.min.x) * sx;
    out[i * 2 + 1] = (e[2] * x + e[6] * y + e[10] * z + e[14] - footprint.min.z) * sz;
  }
  return out;
}

/** Add to `mask` the cells (bit z * 4 + x) whose centre lies inside one of the triangles; stops once all are found. */
function coverMask(g, cells, w, h, mask, full) {
  const index = g.index?.array;
  const n = index ? index.length : g.attributes.position.count;
  for (let i = 0; i + 2 < n && mask !== full; i += 3) {
    const a = index ? index[i] : i;
    const b = index ? index[i + 1] : i + 1;
    const c = index ? index[i + 2] : i + 2;
    const ax = cells[a * 2], az = cells[a * 2 + 1];
    const bx = cells[b * 2], bz = cells[b * 2 + 1];
    const cx = cells[c * 2], cz = cells[c * 2 + 1];
    // Only the cell centres inside the triangle's bounding box can be inside it.
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5));
    const x1 = Math.min(w - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
    const z0 = Math.max(0, Math.ceil(Math.min(az, bz, cz) - 0.5));
    const z1 = Math.min(h - 1, Math.floor(Math.max(az, bz, cz) - 0.5));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const bit = 1 << (z * 4 + x);
        if (!(mask & bit) && inTriangle(x + 0.5, z + 0.5, ax, az, bx, bz, cx, cz)) mask |= bit;
      }
    }
  }
  return mask;
}

/**
 * The ground parts are thin slabs. Where a tile borders open desert, the slab's side wall shows from the board
 * camera as a dark line along the tile's edge. Remove the walls standing on a cell border (every corner on the
 * same cell line); the desert sits just below, so nothing opens up behind them.
 */
function dropBorderWalls(o, cells) {
  const g = o.geometry;
  const count = g.attributes.position.count;
  const src = g.index?.array;
  const n = src ? src.length : count;
  const eps = 0.01;
  const onLine = (a, b, c, k) => {
    const v = cells[a * 2 + k];
    return Math.abs(v - Math.round(v)) < eps && Math.abs(cells[b * 2 + k] - v) < eps && Math.abs(cells[c * 2 + k] - v) < eps;
  };
  const kept = count > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  let k = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = src ? src[i] : i;
    const b = src ? src[i + 1] : i + 1;
    const c = src ? src[i + 2] : i + 2;
    if (onLine(a, b, c, 0) || onLine(a, b, c, 1)) continue;
    kept[k++] = a;
    kept[k++] = b;
    kept[k++] = c;
  }
  if (k === n) return;
  g.setIndex(new THREE.BufferAttribute(kept.slice(0, k), 1));
  g.clearGroups();
}

function inTriangle(px, pz, ax, az, bx, bz, cx, cz) {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
