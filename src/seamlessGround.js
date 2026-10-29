import * as THREE from 'three';

/**
 * Seamless ground between neighbouring tiles.
 *
 * Plain sand (<Name>_Sand: one shared, tileable texture, 3 repeats per cell) is sampled in world space instead of
 * the tile's own UVs, so it runs on unbroken from one tile to the next, whatever the tile or piece rotation.
 * Painted grounds (<Name>Ground: oasis, tar pit, crater, ruins, cliffs, the Wasteland pieces; the Settlement pad)
 * fade into that same world-space sand along their outer edge, so every tile meets its neighbour on identical sand.
 * Edges between two cells of one Wasteland piece don't fade: the piece's own picture carries on across them.
 */
export const SEAM = {
  repeat: 3, // sand texture repeats per cell (the plain sand tiles' own UVs span -1.5..1.5)
  blend: 0.22, // width of the fade at a painted ground's edge, in cells
};

const SAND_NAME = /_Sand$/;
const GROUND_NAME = /Ground$|^Village\d+_Pad\d+$/;

/** The shared sand texture and normal map (all plain sand parts use the same file, shared by prepareTextures). */
const sand = { map: null, normalMap: null, normalScale: new THREE.Vector2(1, 1) };

/** Record the shared sand from the first plain sand part found. Call before patching any model. */
export function findSharedSand(roots) {
  if (sand.map) return;
  for (const root of roots) {
    root.traverse((o) => {
      if (sand.map || !o.isMesh) return;
      const m = [o.material].flat().find((x) => SAND_NAME.test(x?.name ?? '') && x.map);
      if (!m) return;
      sand.map = m.map;
      sand.normalMap = m.normalMap ?? null;
      if (m.normalScale) sand.normalScale.copy(m.normalScale);
    });
    if (sand.map) return;
  }
}

const patches = new WeakMap(); // material -> { mode, mask, grid }

/** Clones lose onBeforeCompile (ghost previews, below-ground copies): put the same patch on the copy. */
export function copySeam(from, to) {
  const p = patches.get(from);
  if (p) patch(to, p);
  return to;
}

const VERT_PARS = /* glsl */ `
varying vec2 vSeamWorld;
#ifdef SEAM_GROUND
  attribute vec2 seamCell;
  varying vec2 vSeamCell;
#endif
`;
const VERT_MAIN = /* glsl */ `
vSeamWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
#ifdef SEAM_GROUND
  vSeamCell = seamCell;
#endif
`;

const FRAG_PARS = /* glsl */ `
varying vec2 vSeamWorld;
uniform float uSeamRepeat;
#ifdef SEAM_GROUND
  varying vec2 vSeamCell;
  uniform sampler2D uSeamSand;
  uniform sampler2D uSeamSandN;
  uniform vec2 uSeamSandNScale;
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

// Plain sand: the tile's own map and normal map, at world-space UVs.
const SAND_MAP = /* glsl */ `
${SEAM_UV}
#ifdef USE_MAP
  diffuseColor *= texture2D( map, seamUv );
#endif
`;

// Painted ground: its own picture inside, the shared sand at the edge.
const GROUND_MAP = /* glsl */ `
${SEAM_UV}
float seamK = seamEdge();
#ifdef USE_MAP
  vec4 seamPaint = texture2D( map, vMapUv );
  diffuseColor *= mix( texture2D( uSeamSand, seamUv ), seamPaint, seamK );
#endif
`;

const GROUND_NORMAL = /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale;
  vec3 seamSandN = texture2D( uSeamSandN, seamUv ).xyz * 2.0 - 1.0;
  seamSandN.xy *= uSeamSandNScale;
  mat3 seamTbn = getTangentFrame( - vViewPosition, normal, seamUv );
  normal = normalize( mix( seamTbn * seamSandN, tbn * mapN, seamK ) );
#endif
`;

function patch(material, { mode, mask = 1, grid = [1, 1] }) {
  patches.set(material, { mode, mask, grid });
  const ground = mode === 'ground';
  material.defines = { ...material.defines, ...(ground ? { SEAM_GROUND: '' } : {}) };
  material.customProgramCacheKey = () => `seam-${mode}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSeamRepeat = { value: SEAM.repeat };
    if (ground) {
      Object.assign(shader.uniforms, {
        uSeamSand: { value: sand.map },
        uSeamSandN: { value: sand.normalMap ?? material.normalMap },
        uSeamSandNScale: { value: sand.normalScale },
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
        .replace('#include <normal_fragment_maps>', `${GROUND_NORMAL}\n#ifndef USE_NORMALMAP_TANGENTSPACE\n#include <normal_fragment_maps>\n#endif`);
    } else {
      // The tangent frame and the normal map also follow the world-space UVs.
      const begin = THREE.ShaderChunk.normal_fragment_begin.replace('vNormalMapUv', 'seamUv');
      const maps = THREE.ShaderChunk.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv )', 'texture2D( normalMap, seamUv )');
      frag = frag
        .replace('#include <map_fragment>', SAND_MAP)
        .replace('#include <normal_fragment_begin>', begin)
        .replace('#include <normal_fragment_maps>', maps);
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
  if (!sand.map) return 0;
  root.updateMatrixWorld(true);
  const [w, h] = grid;
  const size = footprint.getSize(new THREE.Vector3());
  const toCell = (p) => [((p.x - footprint.min.x) / size.x) * w, ((p.z - footprint.min.z) / size.z) * h];
  const done = new Set();
  const grounds = [];
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || !o.material.map || done.has(o.material)) return;
    const name = o.material.name ?? '';
    if (SAND_NAME.test(name)) {
      patch(o.material, { mode: 'sand' });
      done.add(o.material);
    } else if (GROUND_NAME.test(name)) grounds.push(o);
  });

  // Painted grounds: each vertex's position in cells, and which cells of the grid the ground covers.
  const v = new THREE.Vector3();
  let mask = 0;
  const tris = [];
  for (const o of grounds) {
    const pos = o.geometry.attributes.position;
    const cells = new Float32Array(pos.count * 2);
    const xz = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const [cx, cz] = toCell(v);
      cells[i * 2] = cx;
      cells[i * 2 + 1] = cz;
      xz.push(cx, cz);
    }
    o.geometry.setAttribute('seamCell', new THREE.BufferAttribute(cells, 2));
    const index = o.geometry.index;
    const n = index ? index.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
      tris.push([xz[a * 2], xz[a * 2 + 1], xz[b * 2], xz[b * 2 + 1], xz[c * 2], xz[c * 2 + 1]]);
    }
  }
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) if (tris.some((t) => inTriangle(x + 0.5, z + 0.5, t))) mask |= 1 << (z * 4 + x);
  if (w * h === 1) mask = 1;
  for (const o of grounds) {
    if (done.has(o.material)) continue;
    patch(o.material, { mode: 'ground', mask, grid });
    done.add(o.material);
  }
  return done.size;
}

function inTriangle(px, pz, [ax, az, bx, bz, cx, cz]) {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
