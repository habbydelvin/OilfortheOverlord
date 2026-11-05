import * as THREE from 'three';

/** Reuse a sun's map only when every relevant caster and the light are unchanged. Moving shadows stay full-rate. */
export function createShadowCache(sun) {
  const previous = new Map();
  const lightState = new THREE.Matrix4();
  const projection = new THREE.Matrix4();
  const view = new THREE.Matrix4();
  let valid = false;
  let epoch = 0;
  let settings = '';
  const stats = { updated: true };

  function dynamicCaster(o, camera) {
    if (!o.visible) return false;
    if (o.castShadow && o.layers.test(camera.layers) && (o.isSkinnedMesh || o.isInstancedMesh || o.morphTargetInfluences ||
      o.customDepthMaterial || o.onBeforeShadow !== THREE.Object3D.prototype.onBeforeShadow)) return true;
    return o.children.some((c) => dynamicCaster(c, camera));
  }

  function update(scene, camera, renderer, matricesReady = false) {
    const shadow = sun.shadow;
    if (!renderer.shadowMap.enabled || !renderer.shadowMap.autoUpdate) {
      valid = false;
      return;
    }
    if (!matricesReady) scene.updateMatrixWorld();
    // Animated cities cannot reuse this map. Avoid allocating material/geometry signatures for every caster.
    if (dynamicCaster(scene, camera)) {
      shadow.autoUpdate = false;
      shadow.needsUpdate = true;
      stats.updated = true;
      valid = false;
      if (previous.size) previous.clear();
      return;
    }
    sun.shadow.updateMatrices(sun, camera);
    const key = `${renderer.shadowMap.type}|${shadow.mapSize.x},${shadow.mapSize.y}`;
    let changed = !valid || !shadow.map || settings !== key || !lightState.equals(sun.matrixWorld) ||
      !projection.equals(shadow.camera.projectionMatrix) || !view.equals(shadow.camera.matrixWorld);
    settings = key;
    lightState.copy(sun.matrixWorld);
    projection.copy(shadow.camera.projectionMatrix);
    view.copy(shadow.camera.matrixWorld);
    epoch++;
    const frustum = shadow.getFrustum();
    scene.traverseVisible((o) => {
      if (!o.castShadow || !o.layers.test(camera.layers) || !(o.isMesh || o.isLine || o.isPoints)) return;
      if (o.frustumCulled && !o.intersectsFrustum(frustum)) return;
      // Vertex deformation and custom callbacks can change a silhouette without changing the object's matrix.
      if (o.isSkinnedMesh || o.isInstancedMesh || o.morphTargetInfluences || o.customDepthMaterial ||
        o.onBeforeShadow !== THREE.Object3D.prototype.onBeforeShadow) changed = true;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      const materialKey = materials.map((m) => `${m.id}:${m.version}:${+m.visible}:${m.opacity}:${m.alphaTest}:${m.side}`).join('|');
      if (materials.some((m) => m.isShaderMaterial || m.displacementMap || m.alphaTest > 0 || m.alphaHash)) changed = true;
      let old = previous.get(o);
      if (!old) {
        old = { matrix: new THREE.Matrix4() };
        previous.set(o, old);
        changed = true;
      }
      const geometry = o.geometry;
      const version = `${geometry.id}:${geometry.attributes.position.version}:${geometry.index?.version}:${geometry.drawRange.start}:${geometry.drawRange.count}`;
      if (!old.matrix.equals(o.matrixWorld) || old.material !== materialKey || old.geometry !== version) changed = true;
      old.matrix.copy(o.matrixWorld);
      old.material = materialKey;
      old.geometry = version;
      old.epoch = epoch;
    });
    for (const [o, old] of previous) if (old.epoch !== epoch) {
      previous.delete(o);
      changed = true;
    }
    shadow.autoUpdate = false;
    shadow.needsUpdate ||= changed;
    stats.updated = shadow.needsUpdate;
    valid = true;
  }

  return { update, stats, invalidate() { valid = false; } };
}
