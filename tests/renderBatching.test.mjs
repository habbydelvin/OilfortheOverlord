import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInstancer } from '../src/instancer.js';
import { createShadowCache } from '../src/shadowCache.js';

function setup() {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 12;
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial();
  const a = new THREE.Mesh(geometry, material);
  const b = a.clone();
  a.castShadow = b.castShadow = true;
  a.position.x = -1;
  b.position.x = 1;
  root.add(a, b);
  return { scene, root, camera, a, b, batch: createInstancer(root, scene) };
}

test('render batches follow parent motion, preserve materials, and restore sources after every pass', () => {
  const { scene, root, camera, a, b, batch } = setup();
  root.position.y = 2;
  root.rotation.z = 0.2;
  batch.begin(camera);
  assert.equal(batch.stats.parts, 2);
  const mesh = batch.group.children.find(o => o.visible);
  assert.equal(mesh.count, 2);
  assert.equal(mesh.material, a.material);
  assert.equal(mesh.geometry, a.geometry);
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(1, matrix);
  matrix.elements.forEach((n, i) => assert.ok(Math.abs(n - b.matrixWorld.elements[i]) < 1e-6));
  assert.equal(a.visible, false);
  batch.end();
  assert.equal(a.visible, true);
  assert.equal(b.visible, true);
  assert.equal(mesh.visible, false);
  assert.equal(a.parent, root);
  batch.dispose();
  assert.equal(scene.children.includes(batch.group), false);
});

test('off-camera casters, hidden parents and per-object construction effects keep their original rendering', () => {
  const { root, camera, a, b, batch } = setup();
  const far = a.clone();
  far.position.x = 100;
  root.add(far);
  const construction = a.clone();
  construction.onBeforeRender = () => {};
  root.add(construction);
  const hidden = new THREE.Group();
  hidden.visible = false;
  hidden.add(a.clone());
  root.add(hidden);
  batch.begin(camera);
  assert.equal(batch.stats.parts, 2);
  assert.equal(far.visible, true); // still casts its off-camera shadow
  assert.equal(construction.visible, true);
  assert.equal(hidden.children[0].visible, true);
  batch.end();
  b.material = b.material.clone(); // idle/material changes must separate the next frame's batches
  batch.begin(camera);
  assert.equal(batch.stats.parts, 0);
  batch.end();
});

test('transparent, skinned and reflected models retain their individual draws', () => {
  const { root, camera, a, b, batch } = setup();
  a.material.transparent = true;
  batch.begin(camera);
  assert.equal(batch.stats.parts, 0);
  batch.end();
  a.material.transparent = false;
  b.scale.x = -1;
  root.add(new THREE.SkinnedMesh(a.geometry, a.material));
  batch.begin(camera);
  assert.equal(batch.stats.parts, 0);
  batch.end();
});

test('single materials and material arrays preserve their different geometry-group draw rules', () => {
  const { camera, a, b, batch } = setup();
  b.material = [a.material];
  batch.begin(camera);
  assert.equal(batch.stats.parts, 0);
  batch.end();
});

test('shader warm-up keeps all temporary objects detached even while compilation is pending', async () => {
  const { scene, root, camera, batch } = setup();
  const model = root.clone();
  const children = [...scene.children];
  let calls = 0;
  const renderer = { async compileAsync(object, cam, target) {
    calls++;
    assert.equal(target, scene);
    assert.equal(cam, camera);
    assert.equal(object.parent, null);
    await Promise.resolve();
    assert.deepEqual(scene.children, children);
  } };
  await batch.warm(model, renderer, camera);
  assert.equal(calls, 2);
});

test('shadow cache reuses static maps but refreshes motion, removal, material and light changes', () => {
  const { scene, camera, a, b } = setup();
  const sun = new THREE.DirectionalLight();
  sun.position.set(4, 8, 5);
  sun.castShadow = true;
  scene.add(sun, sun.target);
  sun.shadow.map = {}; // a previously allocated map
  const renderer = { shadowMap: { enabled: true, autoUpdate: true, type: THREE.PCFShadowMap } };
  const cache = createShadowCache(sun);
  const update = () => {
    sun.shadow.needsUpdate = false; // renderer consumes the request after each pass
    cache.update(scene, camera, renderer);
    return sun.shadow.needsUpdate;
  };
  assert.equal(update(), true);
  assert.equal(update(), false);
  a.position.y += 0.5;
  assert.equal(update(), true);
  assert.equal(update(), false);
  b.removeFromParent();
  assert.equal(update(), true);
  assert.equal(update(), false);
  a.material.visible = false;
  assert.equal(update(), true);
  sun.target.position.x += 1;
  assert.equal(update(), true);
  assert.equal(update(), false);
  sun.shadow.map = null;
  assert.equal(update(), true);
});

test('deforming casters keep full-rate shadows, and returning from a frozen pass refreshes the map', () => {
  const { scene, camera, a } = setup();
  const sun = new THREE.DirectionalLight();
  sun.position.set(4, 8, 5);
  scene.add(sun, sun.target);
  sun.shadow.map = {};
  const renderer = { shadowMap: { enabled: true, autoUpdate: true, type: THREE.PCFShadowMap } };
  const cache = createShadowCache(sun);
  const update = () => {
    sun.shadow.needsUpdate = false;
    cache.update(scene, camera, renderer);
    return sun.shadow.needsUpdate;
  };
  a.onBeforeShadow = () => {}; // per-draw deformation isn't represented by matrixWorld
  assert.equal(update(), true);
  assert.equal(update(), true);
  a.onBeforeShadow = THREE.Object3D.prototype.onBeforeShadow;
  update();
  assert.equal(update(), false);
  renderer.shadowMap.autoUpdate = false;
  update();
  renderer.shadowMap.autoUpdate = true;
  assert.equal(update(), true);
});
