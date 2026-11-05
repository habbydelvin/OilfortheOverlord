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
  const stats = { parts: 0, batches: 0 };
  const warmed = new WeakMap(); // material -> shader layouts already compiled by this instancer
  const depthMaterial = new THREE.MeshDepthMaterial();
  let enabled = true;
  let frame = 0;

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

  function collect(o, order = 0) {
    if (!o.visible) return;
    if (o.isGroup) order = o.renderOrder;
    // Match three.js's normal camera culling exactly. Off-camera parts keep their original shadow-only draws.
    if (order === 0 && eligible(o) && (!o.frustumCulled || o.intersectsFrustum(frustum)) && o.matrixWorld.determinant() > 0) {
      const key = keyOf(o);
      let p = pools.get(key);
      if (!p) pools.set(key, (p = { parts: [], mesh: null, capacity: 0, last: frame }));
      p.parts.push(o);
      p.last = frame;
    }
    for (const child of o.children) collect(child, order);
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
    group.add(p.mesh);
  }

  function begin(camera) {
    end();
    frame++;
    stats.parts = stats.batches = 0;
    if (!enabled) return;
    root.updateWorldMatrix(true, true); // fog's depth pass doesn't update the real parents' matrices
    camera.updateWorldMatrix(true, false);
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    collect(root);
    for (const p of pools.values()) {
      if (p.parts.length < 2) continue;
      allocate(p, p.parts[0]);
      const mesh = p.mesh;
      mesh.count = p.parts.length;
      mesh.visible = true;
      for (let i = 0; i < p.parts.length; i++) {
        const o = p.parts[i];
        mesh.setMatrixAt(i, o.matrixWorld);
        o.visible = false;
        hidden.push(o);
      }
      mesh.instanceMatrix.needsUpdate = true;
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
