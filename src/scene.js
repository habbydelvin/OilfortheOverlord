import * as THREE from 'three';

const BG = 0x2b3133;

/** Soft, tileable cloud texture drawn on a canvas (no external assets). */
function cloudTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#2a3032';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 40 + Math.random() * 140;
    const a = 0.05 + Math.random() * 0.08;
    // Draw with wrap-around copies so the texture tiles seamlessly.
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grd.addColorStop(0, `rgba(130,145,150,${a})`);
        grd.addColorStop(1, 'rgba(130,145,150,0)');
        g.fillStyle = grd;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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

  // Cloudy void far below the floating island.
  const clouds = cloudTexture();
  const cloudPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: clouds }),
  );
  cloudPlane.position.y = -4;
  scene.add(cloudPlane);

  // Invisible plane that only shows the island's drop shadow on the clouds.
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.28 }),
  );
  shadowPlane.position.y = -3.95;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

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
    clouds.offset.x += dt * 0.0025;
    clouds.offset.y += dt * 0.0012;
  }

  return { renderer, scene, camera, followTarget };
}
