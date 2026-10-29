import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildHiveCapital } from './capitalMesh.js';
import { loadBlockouts } from './models.js';

const BG = 0x1b1511;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 30);
camera.position.set(1.5, 1.6, 1.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.55, 0);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.8;
controls.minDistance = 0.4;
controls.maxDistance = 8;
controls.update();

// Same lighting setup as the game board (scene.js), scaled to one cell.
scene.add(new THREE.HemisphereLight(0xdfe8e4, 0x2a2622, 1.3));
const sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
sun.position.set(2.8, 6.4, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.01;
Object.assign(sun.shadow.camera, { near: 0.5, far: 15, left: -2, right: 2, top: 2, bottom: -2 });
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 12),
  new THREE.MeshStandardMaterial({ color: 0x3a2e24, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Board cell outline, so the footprint is easy to judge.
const cellOutline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
  new THREE.LineBasicMaterial({ color: 0x8a7a66 }),
);
cellOutline.rotation.x = -Math.PI / 2;
cellOutline.position.y = 0.002;
scene.add(cellOutline);

const t0 = performance.now();
const capital = buildHiveCapital();
const buildMs = performance.now() - t0;
scene.add(capital);

let tris = 0;
capital.traverse((o) => {
  if (o.isMesh) tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
});
document.getElementById('stats').textContent =
  `${Math.round(tris).toLocaleString()} tris · ${capital.children.length} draw calls · built in ${buildMs.toFixed(0)} ms`;

document.getElementById('spin').addEventListener('change', (e) => {
  controls.autoRotate = e.target.checked;
});

// Optional side-by-side with the Capital model the game uses.
let blockout = null;
let compareCell = null;
document.getElementById('compare').addEventListener('change', async (e) => {
  const on = e.target.checked;
  if (on && !blockout) {
    try {
      const models = await loadBlockouts();
      blockout = models.get('capital');
      blockout.position.x += 1.3;
      compareCell = cellOutline.clone();
      compareCell.position.x = 1.3;
      scene.add(blockout, compareCell);
    } catch (err) {
      console.error('Could not load the blockout', err);
      e.target.checked = false;
      return;
    }
  }
  if (blockout) blockout.visible = compareCell.visible = on;
  controls.target.set(on ? 0.65 : 0, 0.55, 0);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
