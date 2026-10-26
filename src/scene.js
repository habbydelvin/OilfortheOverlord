import * as THREE from 'three';

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
  scene.add(new THREE.HemisphereLight(0xdfe8e4, 0x2a2622, 1.3));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { near: 0.5, far: 60 });
  scene.add(sun, sun.target);


  // Shift the projection centre so the look-at point sits in the middle of the
  // open play area (left of the 300px side panel, above the card hand).
  const PANEL_W = 300;
  const HAND_H = 170;
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
  }

  return { renderer, scene, camera, followTarget };
}
