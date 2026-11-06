/**
 * The main screen: the planet from mid distance (its own copy of the War Map's planet, with the star, nebula and
 * the other planets behind it), three Motherships crossing from the right toward the planet in the distance, and the menu
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
 * y up, z toward the camera). They come in from the far right, in the distance and seen side on, and head for the
 * planet, very slowly, leaving short yellow engine trails.
 */
const SHIP = {
  size: 0.07, // the lead ship's length
  from: { x: 0.29, y: 0.065, z: -0.55 }, // just past the right edge, in the distance
  to: { x: 0.15, y: 0.04, z: -0.65 }, // nearing the planet, seen side on the whole way
  duration: 300, // seconds for the whole way (it keeps drifting the whole time the menu is up)
};
// The other two fly in formation: offsets in ship lengths (x along the nose, y up, z toward the camera).
const FORMATION = [
  [0, 0, 0],
  [-1.3, 0.5, -0.8],
  [-1.5, -0.45, 0.6],
];
const TRAIL = { length: 2.2, width: 0.014 }; // the yellow trail behind each propeller, in ship lengths
// Dropping out of hyperspace into their places, one after another: a streak braking hard, then a flash.
const ARRIVE = {
  delay: 0.6, // seconds before the first one
  stagger: 0.45, // between ships
  time: 1.1, // the braking streak
  distance: 14, // ship lengths it covers while braking
  stretch: 9, // how long the streak is drawn at the start (× its length)
};
// The planet's own sun (sandPlanet.js createSandPlanet), so the ships are lit and shadowed like the planet.
const SUN = new THREE.Vector3(0.62, 0.42, 0.66).normalize();

/**
 * The ships painted in the planet's style (title copies only): the model's colours graded into the planet's warm
 * palette, the light in soft painted bands from the planet's sun with the same soft terminator and deep night side,
 * and the planet's warm dusty haze on the rims. Window lights and other glows stay as they are.
 */
const PAINT_GLSL = /* glsl */ `
  {
    vec3 N = normalize(normal);
    vec3 V = normalize(vViewPosition);
    vec3 L = normalize((viewMatrix * vec4(uPaintSun, 0.0)).xyz);
    // The planet's palette: the model's shade picks a tone from rust to sand, its own hue kept a little.
    vec3 base = diffuseColor.rgb;
    float lum = dot(base, vec3(0.299, 0.587, 0.114));
    float tone = clamp(pow(lum, 0.45) * 1.15, 0.0, 1.0);
    vec3 warm = mix(vec3(0.16, 0.06, 0.03), vec3(0.42, 0.2, 0.08), smoothstep(0.0, 0.45, tone));
    warm = mix(warm, vec3(0.74, 0.47, 0.25), smoothstep(0.4, 0.8, tone));
    warm = mix(warm, vec3(0.86, 0.66, 0.42), smoothstep(0.75, 1.0, tone));
    base = mix(base, warm * (0.75 + 0.6 * lum), 0.8);
    // Soft painted bands, on the planet's terminator.
    float ndl = dot(N, L);
    float light = smoothstep(-0.12, 0.75, ndl);
    float band = (floor(light * 3.0) + smoothstep(0.35, 0.65, fract(light * 3.0))) / 3.0;
    light = mix(light, band, 0.6);
    vec3 painted = base * (0.05 + 1.5 * light);
    // The planet's haze on the rims, bright on the sunward side.
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    painted = mix(painted, vec3(0.95, 0.72, 0.48) * (0.05 + 0.9 * smoothstep(-0.2, 0.6, ndl)), rim * 0.75);
    outgoingLight = painted + totalEmissiveRadiance;
  }
  #include <opaque_fragment>`;
const paintedCache = new Map();
function paintedMaterial(m) {
  if (!m.isMeshStandardMaterial) return m;
  let p = paintedCache.get(m);
  if (p) return p;
  p = m.clone();
  p.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintSun = { value: SUN };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPaintSun;')
      .replace('#include <opaque_fragment>', PAINT_GLSL);
  };
  p.customProgramCacheKey = () => 'title-ship-painted';
  paintedCache.set(m, p);
  return p;
}
const NOSE = new THREE.Vector3(1, 0, 0); // the model's nose is +x (its tail engine at -x)

export function createTitleScreen({ root, scene, camera, getModel, planetRadius = 0, onStart, onContinue = () => {}, canContinue = () => false, onOptions }) {
  const holder = new THREE.Group(); // placed and turned in camera space every frame
  holder.name = 'title ship';
  let ship = null; // the lead ship
  const mixers = [];
  let length = 1;
  let t = 0;
  let active = false;

  /** A thin yellow streak behind a ship's tail, fading out along its length (glows: additive). */
  const trailMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(1.0, 0.78, 0.25) }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade;
      varying vec2 vUv;
      void main() {
        float along = vUv.x;                         // 0 far end .. 1 at the engine
        float across = 1.0 - abs(vUv.y * 2.0 - 1.0); // 1 on the centre line
        float a = pow(along, 1.6) * smoothstep(0.0, 0.9, across) * uFade;
        gl_FragColor = vec4(uColor * a * 1.4, a);
      }`,
  });
  trailMat.userData.flat = true; // never the board's map-shape bend
  const trailGeo = new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0);
  // Hyperspace: the blue-white streak behind an arriving ship, and the flash as it drops out.
  const flashTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.15, 'rgba(200,225,255,0.9)');
    grad.addColorStop(0.45, 'rgba(120,170,255,0.25)');
    grad.addColorStop(1, 'rgba(80,120,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const ships = []; // per ship: its slot, place, streak, flash, trails and own materials
  let arriveAt = 0; // when the arrival started (t)

  /** The three Motherships once the model is in: copies in formation, each with its Idle (hover, propellers, plumes). */
  function build() {
    const source = getModel();
    if (!source) return;
    FORMATION.forEach(([fx, fy, fz], i) => {
      const copy = cloneModel(source);
      const mixer = new THREE.AnimationMixer(copy);
      for (const clip of source.animations) {
        const action = mixer.clipAction(clip).play();
        action.time = i * 3.7; // out of step, so they don't bob together
      }
      mixer.update(0);
      mixers.push(mixer);
      copy.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(copy);
      if (i === 0) {
        ship = copy;
        length = Math.max(box.max.x - box.min.x, 1e-6);
      }
      const slot = new THREE.Group();
      slot.position.set(fx * length, fy * length, fz * length);
      const pivot = new THREE.Group();
      pivot.position.copy(box.getCenter(new THREE.Vector3())).negate(); // its centre on the slot (the hover stays)
      pivot.add(copy);
      copy.traverse((o) => {
        o.frustumCulled = false;
        if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(paintedMaterial) : paintedMaterial(o.material);
      });
      slot.add(pivot);
      holder.add(slot);
      const streakMat = trailMat.clone();
      streakMat.uniforms.uColor.value = new THREE.Color(0.65, 0.8, 1.0);
      const streak = new THREE.Mesh(trailGeo, streakMat);
      streak.frustumCulled = false;
      holder.add(streak); // in the formation's frame, not stretched with the ship
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      flash.material.userData.flat = true;
      flash.frustumCulled = false;
      holder.add(flash);
      const fade = trailMat.clone();
      const entry = { slot, place: slot.position.clone(), streak, flash, fade, i };
      ships.push(entry);
      // A trail streaming back from each propeller.
      slot.updateMatrixWorld(true);
      const toSlot = slot.matrixWorld.clone().invert();
      const at = new THREE.Vector3();
      copy.traverse((o) => {
        if (!/_Prop[LR]?\w*\d*$|_PropTail$/.test(o.name)) return;
        o.getWorldPosition(at).applyMatrix4(toSlot);
        const trail = new THREE.Mesh(trailGeo, entry.fade);
        trail.scale.set(TRAIL.length * length, TRAIL.width * length, 1);
        trail.position.copy(at);
        trail.frustumCulled = false;
        slot.add(trail);
      });
    });
    arriveAt = t;
  }

  /** Each ship's drop out of hyperspace: braking along its heading into its place, streak, flash, trails fading in. */
  function arrive() {
    for (const s of ships) {
      const start = arriveAt + ARRIVE.delay + s.i * ARRIVE.stagger;
      const a = Math.min(1, Math.max(0, (t - start) / ARRIVE.time));
      const e = 1 - Math.pow(1 - a, 4); // fast, braking hard at the end
      const rest = 1 - e;
      s.slot.visible = t >= start;
      // From far behind (the ship's -x), drawn long while it's fast, then snapping to its shape.
      s.slot.position.copy(s.place).setX(s.place.x - rest * ARRIVE.distance * length);
      s.slot.scale.set(1 + rest * rest * ARRIVE.stretch, 1 - 0.4 * rest, 1);
      s.streak.visible = s.slot.visible && rest > 0.01;
      s.streak.position.copy(s.slot.position);
      s.streak.scale.set((0.5 + rest * ARRIVE.stretch * 1.4) * length, 0.06 * length * (0.4 + rest), 1);
      s.streak.material.uniforms.uFade.value = Math.min(1, rest * 3);
      // The flash: up as it lands, then dying away.
      const since = t - (start + ARRIVE.time * 0.75);
      const glow = since < 0 ? Math.max(0, 1 + since / 0.12) : Math.exp(-since * 4);
      s.flash.visible = glow > 0.01;
      s.flash.position.copy(s.place);
      s.flash.scale.setScalar(length * (0.6 + 1.6 * glow));
      s.flash.material.opacity = glow;
      // The yellow propeller trails come on once it's out.
      s.fade.uniforms.uFade.value = Math.min(1, Math.max(0, (t - start - ARRIVE.time * 0.8) / 0.8));
    }
  }

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const back = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const ray = new THREE.Vector3();
  const look = new THREE.Matrix4();
  const toCamera = (p, d, out) =>
    out.copy(camera.position).addScaledVector(right, p.x * d).addScaledVector(up, p.y * d).addScaledVector(back, p.z * d);

  let departing = false;

  function update(dt) {
    if (!active) return;
    t += dt;
    if (!ship) build();
    if (!ship) return;
    for (const m of mixers) m.update(dt);
    arrive();
    // Departing too: they keep their place on screen (moving with the camera), so the dive never flies into them.
    camera.updateMatrixWorld();
    camera.matrixWorld.extractBasis(right, up, back);
    const d = camera.position.length(); // distance to the planet's centre: everything scales with it
    toCamera(SHIP.from, d, from);
    toCamera(SHIP.to, d, to);
    const k = Math.min(1, t / SHIP.duration);
    holder.position.lerpVectors(from, to, k * (2 - k)); // eases off toward the end
    // Nose along the flight, level with the camera's up: seen side on.
    heading.subVectors(to, from).normalize();
    look.lookAt(new THREE.Vector3(), heading, up); // -z of the look frame along the heading
    holder.quaternion.setFromRotationMatrix(look).multiply(new THREE.Quaternion().setFromUnitVectors(NOSE, new THREE.Vector3(0, 0, -1)));
    let size = (SHIP.size * d) / length;
    // Always in front of the planet: if the formation would reach its surface (late in the flight, or as the camera
    // dives in), it comes closer to the camera and smaller by the same share, so on screen nothing changes.
    if (planetRadius > 0) {
      ray.subVectors(holder.position, camera.position);
      const dist = ray.length();
      ray.divideScalar(dist);
      // Where the ray to the formation first meets the planet (camera outside it: the near hit).
      const b = camera.position.dot(ray);
      const c = camera.position.lengthSq() - planetRadius * planetRadius;
      const disc = b * b - c;
      const reach = dist + SHIP.size * d * 2.2; // the formation's depth (three ships spread round the lead)
      const limit = disc > 0 ? -b - Math.sqrt(disc) : Infinity; // distance to the surface along the ray
      // Off the planet's disc: keep it nearer than the planet's centre plane all the same (it can't pass behind).
      const safe = Math.min(limit, camera.position.length() - planetRadius * 0.15) * 0.92;
      if (reach > safe) {
        const k = Math.max(0.02, safe / reach);
        holder.position.copy(camera.position).addScaledVector(ray, dist * k);
        size *= k;
      }
    }
    holder.scale.setScalar(size);
  }

  function show() {
    active = true;
    departing = false;
    t = 0;
    arriveAt = 0; // they drop in again each time the menu comes up
    scene.add(holder);
    root.classList.remove('hidden', 'departing');
    document.body.classList.add('title-screen');
    continueBtn.disabled = !canContinue();
  }

  /** Start pressed: the menu fades; the ships hold their place on screen while the camera dives (the clouds take them). */
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
  // Continue: greyed out until there's a saved game (main.js saves as you play), then back into it.
  const continueBtn = root.querySelector('#btnContinue');
  continueBtn.addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (canContinue()) onContinue();
  });
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
      arriveAt = 0;
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
