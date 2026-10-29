/**
 * Seam test: every tile model laid edge to edge on a grid, to check how neighbouring tiles meet.
 * ?view=top looks straight down; ?view=game uses the board angle. ?zoom=<n> moves the camera closer.
 * ?focus=x,z aims at a grid cell. ?keys=a,b,c picks the models (in order, row by row, `cols` per row).
 * The page also writes a text report (#dump) of the meshes that reach the cell border, per model.
 */
import * as THREE from 'three';
import { clone as cloneModel } from 'three/addons/utils/SkeletonUtils.js';
import { loadBlockouts, loadBundle } from '/src/models.js';
import { useDesertSand } from '/src/seamlessGround.js';
import { GROUND_Y, GROUND_DEPTH } from '/src/scene.js';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 1600);
const H = Number(q.get('h') ?? 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.add(new THREE.HemisphereLight(0xdfe8e4, 0x2a2622, 1.3));
const sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { near: 0.5, far: 60, left: -12, right: 12, top: 12, bottom: -12 });
scene.add(sun, sun.target);

// The board's desert plane (scene.js), so tile-to-desert edges can be checked too. ?nodesert hides it.
if (!q.has('nodesert')) {
  // Drawn like the game's (scene.js): see-through pass, first, no depth writes, pushed back in depth.
  const material = useDesertSand(new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, ...GROUND_DEPTH }));
  const desert = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), material);
  desert.position.y = GROUND_Y;
  desert.renderOrder = -1;
  desert.receiveShadow = true;
  scene.add(desert);
}

const status = document.getElementById('status');
const dump = document.getElementById('dump');

const all = await loadBlockouts();
for (const [k, v] of await loadBundle('waste')) all.set(k, v);

const DEFAULT_KEYS = [
  'capital', 'settlement', 'farm', 'pump', 'station', 'refinery',
  'oasis', 'tarpit', 'labourcamp', 'cliffs', 'ruins', 'crater',
  'raider', 'bandit_raider', 'bandit_siphon', 'bandit_scav', 'bandit_smuggle', 'waste-mono',
];
const keys = q.get('keys')?.split(',') ?? DEFAULT_KEYS;
const cols = Number(q.get('cols') ?? 6);
const rows = Math.ceil(keys.length / cols);

keys.forEach((key, i) => {
  const source = all.get(key);
  if (!source) return;
  const x = (i % cols) - (cols - 1) / 2;
  const z = Math.floor(i / cols) - (rows - 1) / 2;
  const holder = new THREE.Group();
  holder.add(cloneModel(source));
  holder.position.set(x, 0, z);
  scene.add(holder);
});

// ?pieces: Wasteland pieces below the grid, each in a ring of plain-sand tiles (farms).
if (q.has('pieces')) {
  let x0 = -(cols - 1) / 2;
  const z0 = (rows - 1) / 2 + 2.5;
  for (const shape of (q.get('pieces') || 'l,t,o').split(',')) {
    const src = all.get(`waste-${shape}`);
    if (!src) continue;
    const { w, h } = src.userData.fit;
    const piece = cloneModel(src);
    const holder = new THREE.Group();
    holder.add(piece);
    holder.position.set(x0 + (w - 1) / 2, 0, z0 + (h - 1) / 2);
    scene.add(holder);
    for (let z = -1; z <= h; z++)
      for (let x = -1; x <= w; x++) {
        if (x >= 0 && x < w && z >= 0 && z < h) continue;
        const f = new THREE.Group();
        f.add(cloneModel(all.get('farm')));
        f.position.set(x0 + x, 0, z0 + z);
        scene.add(f);
      }
    x0 += w + 2;
  }
}

// Report: per model, every mesh whose bounds reach within 2% of the cell border, with its height range and
// material colour / texture, so a dark rim (a plate, a skirt, a trim) can be traced to its part.
const lines = [];
for (const key of keys) {
  const source = all.get(key);
  if (!source) continue;
  source.updateMatrixWorld(true);
  lines.push(`== ${key}`);
  source.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    const edge = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z);
    // ?low: every part lying on the ground (top below 0.02), instead of the ones reaching the cell border.
    if (q.has('low') ? b.max.y > 0.02 : edge < 0.48) return;
    const uv = o.geometry.attributes.uv;
    let uvr = '';
    if (uv) {
      let [u0, v0, u1, v1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < uv.count; i++) {
        u0 = Math.min(u0, uv.getX(i));
        u1 = Math.max(u1, uv.getX(i));
        v0 = Math.min(v0, uv.getY(i));
        v1 = Math.max(v1, uv.getY(i));
      }
      uvr = ` uv[${u0.toFixed(2)}..${u1.toFixed(2)}, ${v0.toFixed(2)}..${v1.toFixed(2)}]`;
    }
    const mats = [o.material].flat().map((m) => `${m.name}#${m.color.getHexString()}${m.map ? '+map' : ''}${uvr}`);
    const f = (v) => v.toFixed(3);
    lines.push(
      `  ${o.name} x[${f(b.min.x)},${f(b.max.x)}] y[${f(b.min.y)},${f(b.max.y)}] z[${f(b.min.z)},${f(b.max.z)}] tris=${(o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3} ${mats.join(' ')}`,
    );
  });
}
dump.textContent = lines.join('\n');

// ?gallery: the ground textures (sand, ground, pad parts) side by side instead of the board.
if (q.has('gallery')) {
  const seen = new Map();
  for (const key of keys) {
    all.get(key)?.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) {
        if (!/Sand|Ground|Pad/.test(m.name) || !m.map?.image || seen.has(m.map)) continue;
        seen.set(m.map, `${key}: ${m.name} ${m.map.image.width}×${m.map.image.height} ${m.normalMap ? 'NORMAL' : 'no normal'} rough ${m.roughness}`);
      }
    });
  }
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;inset:0;display:flex;flex-wrap:wrap;gap:6px;padding:6px;background:#222;overflow:hidden';
  for (const [t, label] of seen) {
    const c = document.createElement('canvas');
    c.width = c.height = 180;
    const ctx = c.getContext('2d');
    if (t.flipY === false) {
      ctx.translate(0, 180);
      ctx.scale(1, -1);
    }
    ctx.drawImage(t.image, 0, 0, 180, 180);
    const fig = document.createElement('div');
    fig.style.cssText = 'width:180px;font-size:10px;color:#ddd';
    fig.append(c, Object.assign(document.createElement('div'), { textContent: label }));
    box.append(fig);
  }
  document.body.append(box);
}

/** Aim the camera and render. Also callable from the console / a driver: setView('top', 2, '0.5,0'). */
function setView(view = 'game', zoom = 1, focus = '0,0') {
  const [fx, fz] = String(focus).split(',').map(Number);
  const target = new THREE.Vector3(fx, 0, fz);
  let camera;
  if (view === 'top') {
    const half = Math.max(cols, rows * (W / H)) / 2 / zoom + 0.2;
    camera = new THREE.OrthographicCamera(-half, half, half / (W / H), -half / (W / H), 0.1, 100);
    camera.position.set(target.x, 30, target.z);
    camera.up.set(0, 0, -1);
  } else {
    camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 300);
    const dist = 11 / zoom;
    const pitch = THREE.MathUtils.degToRad(58); // the board camera (controls.js)
    camera.position.set(target.x, dist * Math.sin(pitch), target.z + dist * Math.cos(pitch));
  }
  camera.lookAt(target);
  sun.position.copy(target).add(new THREE.Vector3(7, 16, 5));
  sun.target.position.copy(target);
  sun.target.updateMatrixWorld();
  renderer.render(scene, camera);
  renderer.render(scene, camera);
}
window.setView = setView;

setView(q.get('view') ?? 'game', Number(q.get('zoom') ?? 1), q.get('focus') ?? '0,0');
status.textContent = 'ready';
document.title = 'ready';
