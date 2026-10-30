import * as THREE from 'three';
import { SAND, sandTexture, useDesertSand } from './seamlessGround.js';

const BG = 0x000000;

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 25, 70);

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 300);

  // Lighting: cool sky fill + warm key light that casts shadows.
  const sky = new THREE.HemisphereLight(0xdfe8e4, 0x2a2622, 1.3);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
  // Layer 1 is the placement ghost's own pass (placement.js GHOST_LAYER): it needs the same lights, and still
  // casts its shadow on the board.
  sky.layers.enable(1);
  sun.layers.enable(1);
  sun.shadow.camera.layers.enable(1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { near: 0.5, far: 60 });
  scene.add(sun, sun.target);

  const ground = createGround(renderer);
  scene.add(ground);

  // Shift the projection centre so the look-at point sits in the middle of the
  // open play area (left of the 300px side panel, above the card hand).
  const PANEL_W = 300;
  const HAND_H = 250; // visible height of the hand cards
  function fitViewport() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.setViewOffset(w, h, PANEL_W / 2, HAND_H / 2, w, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  fitViewport();
  window.addEventListener('resize', fitViewport);

  const sunOffset = new THREE.Vector3(7, 16, 5);
  let shadowExtent = 0;

  /** Keep the sun + shadow frustum centred on whatever the camera is looking at. */
  function followTarget(target, distance, dt) {
    sun.position.copy(target).add(sunOffset);
    sun.target.position.copy(target);
    sun.target.updateMatrixWorld();
    const extent = Math.ceil(distance * 0.9);
    if (extent !== shadowExtent) {
      shadowExtent = extent;
      Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
      sun.shadow.camera.updateProjectionMatrix();
    }
    scene.fog.near = distance + 4;
    scene.fog.far = distance + 45;
    // The ground follows the camera so it never runs out. It moves in whole
    // texture tiles, so the sand stays put relative to the board.
    ground.position.x = Math.round(target.x / GROUND.tile) * GROUND.tile;
    ground.position.z = Math.round(target.z / GROUND.tile) * GROUND.tile;
    // Fade to the black background around the look-at point. The radius grows with zoom,
    // so the screen edges (behind the HUD and help text) stay dark.
    const fade = ground.material.alphaMap;
    const reach = (GROUND.fadeRadius * distance) / GROUND.size; // fade radius as a share of the plane
    fade.repeat.setScalar(1 / (2 * reach));
    fade.offset.set(
      0.5 - fade.repeat.x * (0.5 + (target.x - ground.position.x) / GROUND.size),
      0.5 - fade.repeat.y * (0.5 - (target.z - ground.position.z) / GROUND.size),
    );
  }

  return { renderer, scene, camera, sun, followTarget };
}

/**
 * Sand ground under the board. The plot overlays (frontier slots, plot fills) are see-through and draw after it
 * (it has renderOrder -1 and writes no depth), so they show on top even where they sit lower.
 * Wide enough to reach past the fog at full zoom-out (fog ends at distance + 45, max distance 48).
 * Its sand (texture, tint, scale) is SAND in seamlessGround.js, shared with the tiles' ground. It sits just under
 * the tiles' ground (y = 0): any deeper and the step shows as a shadow line along the edge of the board.
 */
export const GROUND_Y = -0.008;
/**
 * That's close enough to the tiles' ground (and the slight dips in it, like the tar pool at -0.005) for the depth
 * test to mix them up when zoomed out. Pushed back in depth, the sand plane always loses to a tile's ground.
 */
export const GROUND_DEPTH = { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 };
const GROUND = {
  y: GROUND_Y,
  size: 240,
  tile: SAND.tile, // the plane moves in whole texture repeats
  fadeRadius: 0.75, // sand fades out by camera distance × this, measured from the look-at point
};

/** Radial alpha: solid in the middle, clear before the edge (the map clamps, so outside stays clear). */
function createFadeTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2 - 2);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.45, '#fff');
  g.addColorStop(0.8, '#555');
  g.addColorStop(1, '#000');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function createGround(renderer) {
  sandTexture().anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND.size, GROUND.size).rotateX(-Math.PI / 2),
    useDesertSand(
      new THREE.MeshStandardMaterial({
        alphaMap: createFadeTexture(),
        transparent: true,
        depthWrite: false,
        ...GROUND_DEPTH,
      }),
    ),
  );
  ground.name = 'ground';
  ground.position.y = GROUND.y;
  ground.receiveShadow = true;
  // Draw first among see-through objects, so the plot overlays (which also skip depth writes) land on top.
  ground.renderOrder = -1;
  return ground;
}
