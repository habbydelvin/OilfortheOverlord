/**
 * Low-detail building models for the zoomed-out view. When the camera is far back (where the map icons cover most
 * of the city), each mesh swaps its geometry for a simplified copy made here with meshoptimizer: same vertices,
 * materials and textures, a much shorter triangle list. Shadows and the fog's depth pass draw the light copies too.
 * Close up, the full geometry comes back. Only geometry swaps: placement, animation, hops and materials are untouched.
 */
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { breathe } from './models.js';

export const LOD = {
  mode: 'Auto', // Auto (by zoom), Off (always full), On (always light): Performance overlay A/B
  ratio: 0.1, // aim: a tenth of the triangles
  error: 0.05, // allowed shape change, as a share of each mesh's size (5%: at the switch zoom, about a pixel)
  minTriangles: 48, // smaller meshes stay as they are
  distance: 17, // camera distance where the light models take over (Performance overlay slider)
  hysteresis: 2, // camera units between switching to light and back, so it doesn't flicker at the threshold
};

const light = new WeakMap(); // full geometry -> light geometry
const full = new WeakMap(); // light geometry -> full geometry
const done = new WeakSet(); // full geometries already tried (kept even when simplification didn't pay off)
export const lodStats = { meshes: 0, before: 0, after: 0 };

function simplified(g) {
  const pos = g.attributes.position;
  if (!g.index || !pos || pos.isInterleavedBufferAttribute || pos.itemSize !== 3 || !(pos.array instanceof Float32Array)) return null;
  if (g.groups.length > 1 || g.morphAttributes.position) return null;
  const tris = g.index.count / 3;
  if (tris < LOD.minTriangles) return null;
  const indices = Uint32Array.from(g.index.array);
  const target = Math.max(12, Math.floor(tris * LOD.ratio)) * 3;
  let [out] = MeshoptSimplifier.simplify(indices, pos.array, 3, target, LOD.error, ['Prune']);
  // Shapes with many separate pieces (lattices, railings) resist: fall back to the sloppy pass at the same error.
  if (out.length > indices.length * LOD.ratio * 2.5) {
    const [sloppy] = MeshoptSimplifier.simplifySloppy(indices, pos.array, 3, null, target, LOD.error);
    if (sloppy.length && sloppy.length < out.length) out = sloppy;
  }
  if (!out.length || out.length > indices.length * 0.8) return null;
  const lod = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) lod.setAttribute(name, attr); // shared, not copied
  lod.setIndex(new THREE.BufferAttribute(out, 1));
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!g.boundingBox) g.computeBoundingBox();
  lod.boundingSphere = g.boundingSphere.clone(); // the full shape's bounds: never culls more than before
  lod.boundingBox = g.boundingBox.clone();
  lod.name = `${g.name || 'geometry'}:lod`;
  lodStats.meshes++;
  lodStats.before += tris;
  lodStats.after += out.length / 3;
  return lod;
}

/** Make the light copies for these models (Map key -> root), a slice at a time. Returns true if any was added. */
export async function buildLods(models) {
  await MeshoptSimplifier.ready;
  let added = false;
  for (const root of models.values()) {
    root.traverse((o) => {
      // Skinned parts (the batched smoke and flames) move by bone: their triangles must stay with their bones.
      if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material) || done.has(o.geometry) || full.has(o.geometry)) return;
      done.add(o.geometry);
      const lod = simplified(o.geometry);
      if (!lod) return;
      light.set(o.geometry, lod);
      full.set(lod, o.geometry);
      added = true;
    });
    await breathe();
  }
  return added;
}

/** Light (true) or full (false) geometry for everything under `root`. */
export function setLod(root, on) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const next = on ? light.get(o.geometry) : full.get(o.geometry);
    if (next) o.geometry = next;
  });
}

/** Whether the light models should show at this camera distance (`far`: where the icons are fully in). */
export function wantLod(distance, far, current) {
  if (LOD.mode === 'Off') return false;
  if (LOD.mode === 'On') return true;
  return current ? distance > far - LOD.hysteresis : distance >= far;
}
