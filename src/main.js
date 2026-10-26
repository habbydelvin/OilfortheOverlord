import './ui.css';
import * as THREE from 'three';
import { createScene } from './scene.js';
import { CameraRig } from './controls.js';
import { Grid } from './grid.js';
import { TileFactory } from './tiles.js';
import { Frontier } from './frontier.js';
import { Placement } from './placement.js';
import { Hand } from './hand.js';

const HAND_SIZE = 5;
const SEED_TERRAIN = 'meadow';
const MILESTONES = [5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 500, 750, 1000];

// ---------- setup ----------
const { renderer, scene, camera, followTarget } = createScene(document.getElementById('app'));
const rig = new CameraRig(camera, renderer.domElement);
const grid = new Grid();
const factory = new TileFactory();
const tiles = new THREE.Group();
scene.add(tiles);
const frontier = new Frontier(scene);
const placement = new Placement(scene, grid);
const hand = new Hand(document.getElementById('hand'), HAND_SIZE, (piece) => placement.setPiece(piece));

const $ = (id) => document.getElementById(id);
const anims = [];
let piecesPlaced = 0;
let lastMilestone = 0;

// ---------- tiles ----------
function addTile(x, z, terrain, delay = 0) {
  const mesh = factory.create(terrain);
  mesh.position.set(x, 0, z);
  mesh.visible = false;
  tiles.add(mesh);
  grid.set(x, z, { terrain, mesh });
  anims.push({ mesh, t: -delay, dur: 0.38 });
}

function updateDropAnims(dt) {
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    a.t += dt;
    if (a.t < 0) continue;
    a.mesh.visible = true;
    const p = Math.min(a.t / a.dur, 1);
    const fall = 1 - Math.pow(1 - p, 3);
    a.mesh.position.y = (1 - fall) * 1.4;
    // little squash on landing
    const squash = p > 0.7 ? Math.sin(((p - 0.7) / 0.3) * Math.PI) * 0.12 : 0;
    a.mesh.scale.set(1 + squash * 0.4, 1 - squash, 1 + squash * 0.4);
    if (p >= 1) {
      a.mesh.position.y = 0;
      a.mesh.scale.set(1, 1, 1);
      anims.splice(i, 1);
    }
  }
}

// ---------- HUD ----------
let toastTimer = 0;
function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = kind), 1600);
}

function milestoneFor(n) {
  for (let i = 0; i < MILESTONES.length; i++) {
    if (n < MILESTONES[i]) return { index: i, prev: i ? MILESTONES[i - 1] : 1, next: MILESTONES[i] };
  }
  const step = 500;
  const next = Math.floor(n / step) * step + step;
  return { index: MILESTONES.length + (next - 1000) / step - 1, prev: next - step, next };
}

function updateHUD() {
  const n = grid.size;
  const m = milestoneFor(n);
  $('milestoneLabel').textContent = `island sandbox · milestone ${m.index + 1}`;
  $('milestoneFill').style.width = `${((n - m.prev) / (m.next - m.prev)) * 100}%`;
  $('milestoneCount').textContent = `${n} / ${m.next}`;
  $('pieceCount').textContent = `${piecesPlaced} piece${piecesPlaced === 1 ? '' : 's'} placed`;
  const big = $('islandSize');
  big.textContent = n;
  big.classList.remove('pop');
  void big.offsetWidth; // restart animation
  big.classList.add('pop');
  if (m.index > lastMilestone) toast(`Milestone reached: ${m.prev} tiles`, 'good');
  lastMilestone = m.index;
}

// ---------- input ----------
const pointer = new THREE.Vector2();
let pointerInside = false;
const raycaster = new THREE.Raycaster();
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();

renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerInside = true;
});
renderer.domElement.addEventListener('pointerleave', () => (pointerInside = false));
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 2) hand.rotate(1);
});

function hoveredCell() {
  if (!pointerInside) return null;
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(boardPlane, hit)) return null;
  return [Math.round(hit.x), Math.round(hit.z)];
}

function tryPlace() {
  const piece = hand.piece;
  if (!piece) {
    toast('Pick a piece from your hand (1–5)');
    return;
  }
  const cell = hoveredCell();
  if (!cell) return;
  const cells = placement.cellsAt(cell);
  const result = placement.validate(cells);
  if (!result.ok) {
    placement.reject();
    toast(result.reason, 'bad');
    return;
  }
  cells.forEach(([x, z], i) => addTile(x, z, piece.terrain, i * 0.05));
  piecesPlaced++;
  hand.consume();
  frontier.rebuild(grid);
  updateHUD();
}

rig.onClick = tryPlace;

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= String(HAND_SIZE)) {
    const i = Number(k) - 1;
    hand.select(hand.selected === i ? -1 : i);
  } else if (k === 'r') hand.rotate(e.shiftKey ? -1 : 1);
  else if (k === 'f') hand.rotate(-1);
  else if (k === 'escape') hand.select(-1);
  else if (k === 'c') rig.focus(...grid.centroid());
});

$('btnReroll').addEventListener('click', () => {
  hand.reroll();
  toast('New hand drawn');
});
$('btnReset').addEventListener('click', resetIsland);

// ---------- lifecycle ----------
function resetIsland() {
  tiles.clear();
  grid.clear();
  anims.length = 0;
  piecesPlaced = 0;
  lastMilestone = 0;
  addTile(0, 0, SEED_TERRAIN);
  frontier.rebuild(grid);
  hand.reroll();
  rig.focus(0, 0);
  updateHUD();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const time = now / 1000;

  rig.update(dt);
  followTarget(rig.target, rig.distance, dt);
  updateDropAnims(dt);
  frontier.update(dt, time);
  placement.update(rig.isDragging ? null : hoveredCell(), dt, time);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resetIsland();
requestAnimationFrame(frame);

// Handy for debugging in the console.
window.tileIsland = { grid, hand, placement, rig };
