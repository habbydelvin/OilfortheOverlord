/**
 * The main screen: the planet from mid distance (its own copy of the War Map's planet, with the star, nebula and
 * the other planets behind it), the Mothership drifting out from behind the camera toward the planet, and the menu
 * over it all: the title, then Continue (greyed out for now), Start and Options.
 *
 * The ship is the Mothership (models.js, converted like every model by tools/convert-models.mjs), placed in camera
 * space every frame, so its path holds on screen whatever the planet does behind it. It arrives with the extra
 * models; until then the sky is empty.
 */
import * as THREE from 'three';
import { clone as cloneModel } from 'three/addons/utils/SkeletonUtils.js';

/**
 * The Mothership's flight, in camera space as shares of the camera's distance to the planet's centre (x right,
 * y up, z toward the camera). It starts just behind the camera on the right, so it slides into view from over the
 * player's shoulder, and heads for the planet, very slowly.
 */
const SHIP = {
  size: 0.3, // its length
  from: { x: 0.2, y: -0.08, z: -0.25 }, // at the camera, to the right: its stern fills the corner, then it pulls away
  to: { x: 0.03, y: 0.02, z: -0.92 }, // near the planet's face
  duration: 300, // seconds for the whole way (it keeps drifting the whole time the menu is up)
};
const NOSE = new THREE.Vector3(1, 0, 0); // the model's nose is +x (its tail engine at -x)

export function createTitleScreen({ root, scene, camera, getModel, onStart, onOptions }) {
  const holder = new THREE.Group(); // placed and turned in camera space every frame
  holder.name = 'title ship';
  let ship = null;
  let mixer = null;
  let length = 1;
  let t = 0;
  let active = false;

  /** The Mothership once its model is in: a copy, centred on the holder, its Idle (hover, propellers, plumes) playing. */
  function build() {
    const source = getModel();
    if (!source) return;
    ship = cloneModel(source);
    mixer = new THREE.AnimationMixer(ship);
    for (const clip of source.animations) mixer.clipAction(clip).play();
    mixer.update(0);
    ship.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(ship);
    length = Math.max(box.max.x - box.min.x, 1e-6);
    const pivot = new THREE.Group();
    pivot.position.copy(box.getCenter(new THREE.Vector3())).negate(); // its centre on the holder (the hover stays)
    pivot.add(ship);
    ship.traverse((o) => (o.frustumCulled = false)); // close to the camera, partly off screen: never culled away
    holder.add(pivot);
  }

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const back = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const look = new THREE.Matrix4();
  const toCamera = (p, d, out) =>
    out.copy(camera.position).addScaledVector(right, p.x * d).addScaledVector(up, p.y * d).addScaledVector(back, p.z * d);

  let departing = false;

  function update(dt) {
    if (!active) return;
    t += dt;
    if (!ship) build();
    if (!ship) return;
    mixer.update(dt);
    if (departing) return; // left where it was in the world: the camera flies on without it
    camera.updateMatrixWorld();
    camera.matrixWorld.extractBasis(right, up, back);
    const d = camera.position.length(); // distance to the planet's centre: everything scales with it
    toCamera(SHIP.from, d, from);
    toCamera(SHIP.to, d, to);
    const k = Math.min(1, t / SHIP.duration);
    holder.position.lerpVectors(from, to, k * (2 - k)); // eases off toward the end
    // Nose along the flight, level with the camera's up.
    heading.subVectors(to, from).normalize();
    look.lookAt(new THREE.Vector3(), heading, up); // -z of the look frame along the heading
    holder.quaternion.setFromRotationMatrix(look).multiply(new THREE.Quaternion().setFromUnitVectors(NOSE, new THREE.Vector3(0, 0, -1)));
    holder.scale.setScalar((SHIP.size * d) / length);
  }

  function show() {
    active = true;
    departing = false;
    t = 0;
    scene.add(holder);
    root.classList.remove('hidden', 'departing');
    document.body.classList.add('title-screen');
  }

  /** Start pressed: the menu fades and the ship stays put in the world while the camera dives past it. */
  function depart() {
    departing = true;
    root.classList.add('departing');
  }

  function hide() {
    active = false;
    departing = false;
    root.classList.remove('departing');
    holder.removeFromParent();
    root.classList.add('hidden');
    document.body.classList.remove('title-screen');
  }
  root.querySelector('#btnStart').addEventListener('click', (e) => {
    e.currentTarget.blur();
    onStart();
  });
  root.querySelector('#btnOptions').addEventListener('click', (e) => {
    e.currentTarget.blur();
    onOptions();
  });

  return {
    /** Debug: jump to `seconds` into the flight. */
    seek(seconds) {
      t = seconds;
    },
    show,
    depart,
    hide,
    update,
    get active() {
      return active;
    },
  };
}
