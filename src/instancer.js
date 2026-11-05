import * as THREE from 'three';

const HOOKS = ['onBeforeRender', 'onAfterRender', 'onBeforeShadow', 'onAfterShadow'];

/**
 * A render-only view of the city. Copies sharing geometry and opaque materials draw together in every pass.
 * Source objects keep their transforms, animation rigs and materials; they are restored immediately after drawing.
 * Transparent/skinned parts and per-object effects keep their own draws and sorting.
 */
export function createInstancer(root, scene) {
  const group = new THREE.Group();
  group.name = 'city instances';
  scene.add(group);
  const pools = new Map();
  const hidden = [];
  const frustum = new THREE.Frustum();
  const projection = new THREE.Matrix4();
  const stats = { parts: 0, batches: 0, uploads: 0 };
  const nodes = new Map();
  let ordered = [];
  let topologyDirty = true;
  const warmed = new WeakMap(); // material -> shader layouts already compiled by this instancer
  const depthMaterial = new THREE.MeshDepthMaterial();
  let enabled = true;
  let frame = 0;

  // Observe structural edits once, rather than rediscovering every mesh/material every frame.
  function added(e) { watch(e.child); }
  function removed(e) { unwatch(e.child); }
  function watch(o) {
    if (nodes.has(o)) return;
    nodes.set(o, { object: o, visible: true, order: 0, pool: null, signature: '' });
    o.addEventListener('childadded', added);
    o.addEventListener('childremoved', removed);
    for (const c of o.children) watch(c);
    topologyDirty = true;
  }
  function unwatch(o) {
    o.removeEventListener('childadded', added);
    o.removeEventListener('childremoved', removed);
    nodes.delete(o);
    ordered = []; // a city may be closed for good; don't retain its detached hierarchy until another render
    for (const c of o.children) unwatch(c);
    topologyDirty = true;
  }
  watch(root);

  function eligible(o) {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || o.children.length) return false;
    if (o.layers.mask !== 1 || o.renderOrder !== 0 || o.morphTargetInfluences || o.customDepthMaterial || o.customDistanceMaterial) return false;
    if (HOOKS.some((k) => o[k] !== THREE.Object3D.prototype[k])) return false;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    return materials.every((m) => m?.isMeshStandardMaterial && !m.transparent && !m.transmission && m.opacity === 1);
  }

  function keyOf(o) {
    const materials = Array.isArray(o.material) ? `array:${o.material.map((m) => m.id).join(',')}` : o.material.id;
    return `${o.geometry.id}|${materials}|${+o.castShadow}${+o.receiveShadow}`;
  }

  function collect() {
    if (topologyDirty) {
      ordered = [];
      root.traverse((o) => ordered.push(nodes.get(o)));
      topologyDirty = false;
    }
    for (const rec of ordered) {
      const o = rec.object;
      const parent = nodes.get(o.parent);
      rec.visible = o.visible && (parent?.visible ?? true);
      rec.order = o.isGroup ? o.renderOrder : (parent?.order ?? 0);
      if (!rec.visible || rec.order !== 0 || !eligible(o)) continue;
      // Off-camera parts retain their original shadow-only draws.
      if ((o.frustumCulled && !o.intersectsFrustum(frustum)) || o.matrixWorld.determinant() <= 0) continue;
      const arrayChanged = Array.isArray(o.material) && (!rec.materials || rec.materials.length !== o.material.length || o.material.some((m, i) => rec.materials[i] !== m));
      if (rec.geometry !== o.geometry || rec.material !== o.material || arrayChanged || rec.cast !== o.castShadow || rec.receive !== o.receiveShadow) {
        rec.signature = keyOf(o);
        rec.geometry = o.geometry;
        rec.material = o.material;
        rec.materials = Array.isArray(o.material) ? [...o.material] : null;
        rec.cast = o.castShadow;
        rec.receive = o.receiveShadow;
        rec.pool = null;
      }
      let p = (rec.pool?.disposed ? null : rec.pool) ?? pools.get(rec.signature);
      if (!p) pools.set(rec.signature, (p = { parts: [], mesh: null, capacity: 0, last: frame }));
      rec.pool = p;
      p.parts.push(o);
      p.last = frame;
    }
  }

  function allocate(p, first) {
    if (p.capacity >= p.parts.length) return;
    p.mesh?.removeFromParent();
    p.mesh?.dispose(); // only the instance buffer; geometry/material are shared with the source
    p.capacity = Math.max(8, 2 ** Math.ceil(Math.log2(p.parts.length)));
    p.mesh = new THREE.InstancedMesh(first.geometry, first.material, p.capacity);
    p.mesh.name = `instances:${first.name}`;
    p.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    p.mesh.castShadow = first.castShadow;
    p.mesh.receiveShadow = first.receiveShadow;
    p.mesh.frustumCulled = false; // already culled per source, including the game's normal curvature behaviour
    p.mesh.boundingSphere = new THREE.Sphere(); // avoid computing an unused aggregate sort bound every frame
    p.mesh.matrixAutoUpdate = false;
    p.matrices = new Float64Array(p.capacity * 16);
    p.matrices.fill(NaN);
    group.add(p.mesh);
  }

  function begin(camera, matricesReady = false) {
    end();
    frame++;
    stats.parts = stats.batches = stats.uploads = 0;
    if (!enabled) return;
    if (!matricesReady) root.updateWorldMatrix(true, true); // depth passes don't update the real parents
    camera.updateWorldMatrix(true, false);
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    collect();
    for (const p of pools.values()) {
      if (p.parts.length < 2) continue;
      allocate(p, p.parts[0]);
      const mesh = p.mesh;
      mesh.material = p.parts[0].material; // an array used by a previous member may have been edited in place
      mesh.count = p.parts.length;
      mesh.visible = true;
      let firstDirty = Infinity;
      let lastDirty = -1;
      for (let i = 0; i < p.parts.length; i++) {
        const o = p.parts[i];
        const e = o.matrixWorld.elements;
        const start = i * 16;
        let changed = false;
        for (let j = 0; j < 16; j++) if (p.matrices[start + j] !== e[j]) { changed = true; break; }
        if (changed) {
          mesh.setMatrixAt(i, o.matrixWorld);
          p.matrices.set(e, start);
          firstDirty = Math.min(firstDirty, start);
          lastDirty = start + 16;
          stats.uploads++;
        }
        o.visible = false;
        hidden.push(o);
      }
      if (lastDirty >= 0) {
        // Include any upload still pending from a skipped pass; keep one bounded range per buffer.
        for (const range of mesh.instanceMatrix.updateRanges) {
          firstDirty = Math.min(firstDirty, range.start);
          lastDirty = Math.max(lastDirty, range.start + range.count);
        }
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(firstDirty, lastDirty - firstDirty);
        mesh.instanceMatrix.needsUpdate = true;
      }
      stats.parts += p.parts.length;
      stats.batches++;
    }
  }

  function end() {
    for (const o of hidden) o.visible = true;
    hidden.length = 0;
    for (const [key, p] of pools) {
      if (p.mesh) p.mesh.visible = false;
      p.parts.length = 0;
      if (frame - p.last > 120) {
        p.mesh?.removeFromParent();
        p.mesh?.dispose();
        pools.delete(key);
        p.disposed = true;
      }
    }
  }

  /** Compile both ordinary and instanced variants without ever attaching temporary models to the live scene. */
  async function warm(model, renderer, camera, materials = (m) => [m], fogDepthMaterial = null) {
    const hold = new THREE.Group();
    const pending = [];
    model.traverse((o) => {
      if (!eligible(o)) return;
      const layout = `${+o.receiveShadow}|${Object.keys(o.geometry.attributes).sort().join(',')}`;
      const variants = new Set((Array.isArray(o.material) ? o.material : [o.material]).flatMap(materials));
      if (fogDepthMaterial) variants.add(fogDepthMaterial);
      if (o.castShadow) variants.add(depthMaterial);
      for (const material of variants) {
        let keys = warmed.get(material);
        if (!keys) warmed.set(material, (keys = new Set()));
        const key = `${material.version}|${layout}`;
        if (keys.has(key)) continue;
        keys.add(key);
        pending.push([keys, key]);
        for (const mesh of [new THREE.Mesh(o.geometry, material), new THREE.InstancedMesh(o.geometry, material, 1)]) {
          mesh.receiveShadow = o.receiveShadow;
          hold.add(mesh);
        }
      }
    });
    try {
      await renderer.compileAsync(model, camera, scene);
      if (hold.children.length) await renderer.compileAsync(hold, camera, scene);
    } catch (error) {
      for (const [keys, key] of pending) keys.delete(key);
      throw error;
    } finally {
      for (const mesh of hold.children) if (mesh.isInstancedMesh) mesh.dispose();
    }
  }

  function dispose() {
    end();
    unwatch(root);
    for (const p of pools.values()) p.mesh?.dispose();
    pools.clear();
    depthMaterial.dispose();
    group.removeFromParent();
  }

  return {
    group, stats, begin, end, warm, dispose,
    get enabled() { return enabled; },
    set enabled(on) { enabled = on; },
  };
}
