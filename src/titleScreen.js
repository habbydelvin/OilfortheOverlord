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
import { ftlJump, stopFtlJumps, FTL_HIT } from './sfx.js';

/**
 * The Mothership's flight, in camera space as shares of the camera's distance to the planet's centre (x right,
 * y up, z toward the camera). They come in from the far right, in the distance and seen side on, and head for the
 * planet, very slowly, leaving short yellow engine trails.
 */
const SHIP = {
  size: 0.07, // the lead ship's length
  from: { x: 0.13, y: 0.065, z: -0.55 }, // in view on the right, so all three drop out of warp on screen // just past the right edge, in the distance
  to: { x: 0.06, y: 0.04, z: -0.65 }, // nearing the planet, seen side on the whole way
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
  delay: 1.7, // seconds before the first one (room for the FTL sound's build-up before its hit)
  stagger: 0.45, // between ships
  time: 1.1, // the braking streak
  distance: 14, // ship lengths the lead covers while braking (it can come in from off screen)
  wingDistance: 3.5, // the other two: a short dash, so they drop out of warp in view
  stretch: 12, // how long a ship is drawn at the start of its dash (× its length), back from its nose
  flashIn: 0.06, // seconds for the light to flare as it appears
  flare: 9, // the exit flare's length (× the ship's length)
  wakeOut: 0.55, // seconds for the warp wake to dissolve once it's stopped
};

/**
 * The warp wake (after Star Trek Beyond's warp): a bow wave of churning, blue-cyan warped space wrapped round the
 * ship, pinched at the nose and opening out behind it, flowing backward, with thin streaks of light racing through.
 * Soft everywhere (no rim, no hard edge); additive, so it only adds light.
 */
const WAKE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const WAKE_FRAG = /* glsl */ `
uniform float uTime, uPower, uSeed;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.07 + 13.1; a *= 0.5; }
  return s;
}
void main() {
  // u: round the wake (wraps), v: from the nose (0) back along it (1).
  float u = vUv.x, v = vUv.y;
  float flow = uTime * 2.6;
  // Churning warped space: noise stretched along the flight and flowing back, folded by a second, slower swirl.
  vec2 q = vec2(u * 7.0 + uSeed, v * 2.2 - flow);
  q.x += fbm(vec2(u * 3.0, v * 1.5 - flow * 0.4) + uSeed) * 2.4;
  float n = fbm(q);
  float churn = smoothstep(0.38, 0.9, n);
  churn *= churn; // wisps rather than slabs
  // Thin streaks of light racing back through it: each a soft line (a gaussian across it, smoothed to the pixel),
  // a bright head trailing off into a long fading tail, every one at its own speed and brightness.
  float streak = 0.0;
  for (int k = 0; k < 2; k++) {
    float lanes = k == 0 ? 38.0 : 61.0;
    float lu = u * lanes + uSeed + float(k) * 0.37;
    float lane = floor(lu);
    float on = step(0.72, hash(vec2(lane, 7.0 + float(k))));
    float d = abs(fract(lu) - 0.5); // distance from the lane's centre line
    float w = 0.09 + 0.5 * fwidth(lu); // at least a pixel wide: no stair steps
    float across = exp(-(d * d) / (w * w));
    float speed = 1.2 + hash(vec2(lane, 2.0)) * 1.8;
    float ph = fract(v * 0.9 - flow * speed * 0.6 + hash(vec2(lane, 5.0)));
    float tail = 0.28 + hash(vec2(lane, 9.0)) * 0.4; // how long it trails
    float head = smoothstep(1.0, 0.985, ph); // a soft front, not a cut
    float along = head * exp(-(1.0 - ph) / tail * 3.0) * smoothstep(0.0, 0.05, ph);
    streak += on * across * along * (0.6 + 0.4 * hash(vec2(lane, 11.0)));
  }
  // Soft at the nose and dissolving behind; a little fuller where the shell is seen edge on (no hard rim).
  float along = smoothstep(0.0, 0.12, v) * (1.0 - smoothstep(0.45, 1.0, v));
  float side = 0.45 + 0.55 * pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 1.2);
  float a = (churn * 0.75 + streak * 0.9) * along * side * uPower;
  vec3 deep = vec3(0.05, 0.28, 0.55);
  vec3 cyan = vec3(0.45, 0.85, 1.0);
  vec3 col = mix(deep, cyan, churn) + vec3(0.9, 0.95, 1.0) * streak;
  gl_FragColor = vec4(col * a, a);
}`;

/** The wake's shape: a bow wave round the x axis, its tip at +x (the nose), opening out behind (unit length). */
function wakeGeometry() {
  const pts = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps; // 0 at the tip, 1 at the open end
    pts.push(new THREE.Vector2(Math.max(1e-3, Math.sqrt(k)), -k)); // radius grows like a parabola
  }
  // Lathed round y, then turned so its axis lies along x with the tip toward +x.
  return new THREE.LatheGeometry(pts, 64).rotateZ(-Math.PI / 2);
}

/**
 * The exit flare: a thin horizontal streak of light through the point where a ship drops out of warp (the way a camera
 * lens catches a sudden bright light), white-hot in the middle, blue at the ends. Additive: it only adds light.
 */
const FLARE_FRAG = /* glsl */ `
uniform float uPower;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0; // 0 centre .. 1 tips
  float y = abs(vUv.y - 0.5) * 2.0;
  float core = exp(-y * y * 30.0) * pow(1.0 - x, 2.2);
  float halo = exp(-y * y * 6.0) * pow(1.0 - x, 5.0) * 0.5;
  float a = (core + halo) * uPower;
  vec3 col = mix(vec3(0.55, 0.75, 1.0), vec3(1.0), pow(1.0 - x, 3.0));
  gl_FragColor = vec4(col * a, a);
}`;
const FLARE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
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
  const wakeGeo = wakeGeometry();
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
      // The exit flare: a long thin streak of light along the flight, through the ship (in the formation's frame).
      const flareMat = new THREE.ShaderMaterial({
        uniforms: { uPower: { value: 0 } },
        vertexShader: FLARE_VERT,
        fragmentShader: FLARE_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      flareMat.userData.flat = true;
      const flare = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flareMat);
      flare.frustumCulled = false;
      flare.renderOrder = 5;
      holder.add(flare);
      // The warp wake round the hull (in the slot, so it stretches with the ship at speed).
      const shipSize = box.getSize(new THREE.Vector3());
      const wakeMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uSeed: { value: i * 3.17 } },
        vertexShader: WAKE_VERT,
        fragmentShader: WAKE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      wakeMat.userData.flat = true;
      const wake = new THREE.Mesh(wakeGeo, wakeMat);
      const wr = Math.max(shipSize.y, shipSize.z, shipSize.x * 0.18) * 0.95; // its widest, behind the ship
      wake.scale.set(shipSize.x * 1.9, wr, wr); // tip just ahead of the nose, open well behind the stern
      wake.position.x = shipSize.x * 0.62;
      wake.frustumCulled = false;
      wake.renderOrder = 4;
      slot.add(wake);
      const entry = { slot, place: slot.position.clone(), streak, flash, fade, flare, wake, half: shipSize.x / 2, i, jumped: false };
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
      // The FTL sound starts early so its hit lands on this ship's flash (skipped if that moment is long past).
      const soundAt = start + ARRIVE.time * 0.75 - FTL_HIT;
      if (!s.jumped && t >= soundAt) {
        s.jumped = true;
        if (t - soundAt < 0.25) ftlJump();
      }
      const a = Math.min(1, Math.max(0, (t - start) / ARRIVE.time));
      const e = 1 - Math.pow(1 - a, 4); // fast, braking hard at the end
      const rest = 1 - e;
      s.slot.visible = t >= start;
      // From behind (the ship's -x), drawn long while it's fast, then snapping to its shape. The stretch reaches back
      // from the nose, so the ship streaks out behind itself.
      const dash = s.i === 0 ? ARRIVE.distance : ARRIVE.wingDistance;
      const stretch = 1 + rest * rest * ARRIVE.stretch;
      s.slot.position.copy(s.place).setX(s.place.x - rest * dash * length - (stretch - 1) * s.half);
      s.slot.scale.set(stretch, 1 - 0.45 * Math.min(1, rest * 1.5), 1);
      s.streak.visible = s.slot.visible && rest > 0.01;
      s.streak.position.copy(s.slot.position);
      s.streak.scale.set((0.5 + rest * ARRIVE.stretch * 1.4) * length, 0.06 * length * (0.4 + rest), 1);
      s.streak.material.uniforms.uFade.value = Math.min(1, rest * 3);
      // The light: it flares the moment the ship appears and rides with it while it brakes, then dies away.
      const age = t - start;
      const stopped = t - (start + ARRIVE.time);
      const glow = age < 0 ? 0 : Math.min(1, age / ARRIVE.flashIn) * (stopped < 0 ? 1 : Math.exp(-stopped * 3.5));
      s.flash.visible = glow > 0.01;
      s.flash.position.copy(s.slot.position);
      s.flash.scale.setScalar(length * (0.9 + 1.4 * glow + rest * 0.8));
      s.flash.material.opacity = glow;
      // The exit flare: flashes across at once, shrinks as the ship slows, and is gone soon after it stops.
      const flare = glow * (0.35 + 0.65 * rest);
      s.flare.visible = flare > 0.01;
      s.flare.position.copy(s.slot.position);
      s.flare.scale.set(length * ARRIVE.flare * (0.35 + 0.65 * rest + 0.3 * glow), length * 0.09, 1);
      s.flare.material.uniforms.uPower.value = flare * 1.6;
      // The warp wake: there from the moment it appears, dissolving once it has stopped.
      const wake = age < 0 ? 0 : Math.min(1, age / ARRIVE.flashIn) * (stopped < 0 ? 1 : Math.max(0, 1 - stopped / ARRIVE.wakeOut));
      s.wake.visible = wake > 0.01;
      s.wake.material.uniforms.uPower.value = wake * (1.1 + 0.7 * rest);
      s.wake.material.uniforms.uTime.value = t;
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
    out.copy(eye).addScaledVector(right, p.x * d).addScaledVector(up, p.y * d).addScaledVector(back, p.z * d);

  let departing = false;
  let frozen = false; // the camera frame is held (diving in): the ships stop following the camera
  const eye = new THREE.Vector3();

  function update(dt) {
    if (!active) return;
    t += dt;
    if (!ship) build();
    if (!ship) return;
    for (const m of mixers) m.update(dt);
    arrive();
    // Placed from the camera's view, except while the camera dives in: then they stay put in the world (the frame
    // is frozen at the moment Start was pressed) and the camera flies past them.
    if (!frozen) {
      camera.updateMatrixWorld();
      camera.matrixWorld.extractBasis(right, up, back);
      eye.copy(camera.position);
    }
    const d = eye.length(); // distance to the planet's centre: everything scales with it
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
    if (planetRadius > 0 && !frozen) {
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
    frozen = false;
    t = 0;
    arriveAt = 0; // they drop in again each time the menu comes up
    for (const s of ships) s.jumped = false;
    scene.add(holder);
    root.classList.remove('hidden', 'departing');
    document.body.classList.add('title-screen');
    continueBtn.disabled = !canContinue();
  }

  /** Start pressed: the menu fades; the ships stay where they are in space while the camera dives past them. */
  function depart() {
    departing = true;
    frozen = true;
    root.classList.add('departing');
  }

  function hide() {
    stopFtlJumps();
    active = false;
    departing = false;
    frozen = false;
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
      for (const s of ships) s.jumped = true; // no burst of jump sounds after a seek
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
