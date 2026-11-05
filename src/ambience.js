/**
 * Board ambience, ported from Wayberth's traffic audio:
 *  - background traffic: one recorded hum (two detuned, low-passed copies) that thickens with the ships in flight
 *  - nearby engines: up to VOICES engine loops on the flying ships closest to the camera's look-at point,
 *    panned and pitched by their speed
 *  - rain: a calm rain loop underneath
 * No horns, crashes, sea or wind. Everything fades out as the camera zooms out (ZOOM_FULL → ZOOM_SILENT), and while
 * the board is not shown (globe, rival view) or the tab is hidden. Volume follows the SFX slider.
 *
 * Files: public/audio/ambience/ (see CREDITS.md). Its own AudioContext, opened by unlockAmbience() from the same
 * gesture that unlocks the effects.
 */
import { getSfxVolume, SFX_VOLUME_DEFAULT } from './sfx.js';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}audio/ambience/`;
const FILES = { bed: 'traffic-bed.m4a', idle: 'engine-idle.m4a', cruise: 'engine-1000.m4a', rain: 'ambience-rain.m4a' };
const LOOP_TRIM = 0.06; // skip AAC padding at each end of a loop

/** Rig distance at or below which ambience is at full level, and at or above which it is silent. */
export const ZOOM_FULL = 16;
export const ZOOM_SILENT = 34;
const MASTER = 0.5; // at the default SFX volume
const BED_GAIN = 0.55;
const RAIN_GAIN = 0.22;
const ENGINE_GAIN = 0.5;
const VOICES = 2;
const HEAR_RADIUS = 6; // world units from the look-at point where a ship's engine fades out
const BED_FULL_SHIPS = 10; // ships in flight for a full traffic bed

let ctx = null;
let out = null;
let bedGain = null;
let rainGain = null;
let engineBus = null;
const buffers = {};
const voices = [];
let started = false;
const lastPos = new Map();

/** 0..1 zoom gate: 1 when close, 0 when zoomed out. */
export function zoomGate(distance) {
  if (distance <= ZOOM_FULL) return 1;
  if (distance >= ZOOM_SILENT) return 0;
  const t = (ZOOM_SILENT - distance) / (ZOOM_SILENT - ZOOM_FULL);
  return t * t * (3 - 2 * t);
}

function loop(buffer, dest, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  if (buffer.duration > LOOP_TRIM * 4) {
    src.loopStart = LOOP_TRIM;
    src.loopEnd = buffer.duration - LOOP_TRIM;
  }
  src.playbackRate.value = rate;
  src.connect(dest);
  src.start(ctx.currentTime, LOOP_TRIM + Math.random() * Math.max(0, buffer.duration - LOOP_TRIM * 3));
  return src;
}

async function load() {
  await Promise.all(Object.entries(FILES).map(async ([key, file]) => {
    try {
      const r = await fetch(BASE + file);
      if (!r.ok) throw new Error(`${file}: ${r.status}`);
      buffers[key] = await ctx.decodeAudioData(await r.arrayBuffer());
    } catch (e) {
      console.warn('[ambience] could not load', file, e);
    }
  }));
  start();
}

function start() {
  if (started || !ctx) return;
  started = true;
  if (buffers.bed) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(bedGain);
    for (const rate of [0.94, 1.05]) loop(buffers.bed, lp, rate);
  }
  if (buffers.rain) loop(buffers.rain, rainGain);
  for (let i = 0; i < VOICES; i++) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    gain.connect(pan).connect(engineBus);
    const idleGain = ctx.createGain();
    const cruiseGain = ctx.createGain();
    idleGain.connect(gain);
    cruiseGain.connect(gain);
    const idle = buffers.idle ? loop(buffers.idle, idleGain) : null;
    const cruise = buffers.cruise ? loop(buffers.cruise, cruiseGain) : null;
    voices.push({ gain, pan, idleGain, cruiseGain, idle, cruise, ship: null });
  }
}

/** Open the context from a user gesture. Safe to call repeatedly. */
export function unlockAmbience() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC({ latencyHint: 'playback' });
    out = ctx.createGain();
    out.gain.value = 0;
    out.connect(ctx.destination);
    bedGain = ctx.createGain();
    bedGain.gain.value = 0;
    bedGain.connect(out);
    rainGain = ctx.createGain();
    rainGain.gain.value = RAIN_GAIN;
    rainGain.connect(out);
    engineBus = ctx.createGain();
    engineBus.gain.value = ENGINE_GAIN;
    engineBus.connect(out);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend().catch(() => {});
      else ctx.resume().catch(() => {});
    });
    load();
  }
  if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {});
}

/**
 * Once per frame.
 * @param {object} f
 * @param {Iterable<object>} f.ships traffic.ships (each has pos and phase)
 * @param {{x:number,z:number}} f.target the camera's look-at point
 * @param {number} f.distance the rig's zoom distance
 * @param {THREE.Camera} f.camera for left/right panning
 * @param {boolean} f.active false fades everything out (globe, rival view, loading)
 * @param {number} f.dt seconds since the last frame
 */
export function updateAmbience({ ships, target, distance, camera, active, dt }) {
  if (!ctx || !started) return;
  const t = ctx.currentTime;
  const volume = getSfxVolume() / SFX_VOLUME_DEFAULT;
  const gate = active ? zoomGate(distance) : 0;
  out.gain.setTargetAtTime(MASTER * volume * gate, t, active ? 0.3 : 0.15);
  if (gate <= 0 && out.gain.value < 1e-4) return;

  const e = camera.matrixWorld.elements;
  const len = Math.hypot(e[0], e[2]) || 1;
  const rx = e[0] / len;
  const rz = e[2] / len;

  let flying = 0;
  const near = [];
  const seen = new Set();
  for (const ship of ships) {
    seen.add(ship);
    const prev = lastPos.get(ship);
    const speed = prev && dt > 0 ? Math.hypot(ship.pos.x - prev.x, ship.pos.z - prev.z) / dt : 0;
    if (prev) prev.copy(ship.pos);
    else lastPos.set(ship, ship.pos.clone());
    if (ship.phase === 'docked') continue;
    flying++;
    const dx = ship.pos.x - target.x;
    const dz = ship.pos.z - target.z;
    const d = Math.hypot(dx, dz);
    if (d < HEAR_RADIUS) near.push({ ship, d, dx, dz, speed });
  }
  for (const ship of lastPos.keys()) if (!seen.has(ship)) lastPos.delete(ship);

  const thick = Math.min(1, flying / BED_FULL_SHIPS);
  bedGain.gain.setTargetAtTime(flying ? BED_GAIN * (0.35 + 0.65 * Math.sqrt(thick)) : 0, t, 0.6);

  // Keep a voice on its ship while it stays near, so engines don't jump between ships.
  near.sort((a, b) => a.d - b.d);
  const picked = near.slice(0, VOICES);
  const byShip = new Map(picked.map((n) => [n.ship, n]));
  const free = picked.filter((n) => !voices.some((v) => v.ship === n.ship));
  for (const v of voices) {
    if (!byShip.has(v.ship)) v.ship = free.shift()?.ship ?? null;
    const n = v.ship ? byShip.get(v.ship) : null;
    if (!n) {
      v.gain.gain.setTargetAtTime(0, t, 0.25);
      continue;
    }
    const fall = 1 - n.d / HEAR_RADIUS;
    v.gain.gain.setTargetAtTime(fall * fall, t, 0.15);
    v.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, (n.dx * rx + n.dz * rz) / HEAR_RADIUS)), t, 0.1);
    const go = Math.min(1, n.speed / 1.2);
    v.idleGain.gain.setTargetAtTime(1 - go, t, 0.2);
    v.cruiseGain.gain.setTargetAtTime(go, t, 0.2);
    const rate = 0.9 + 0.25 * go;
    v.idle?.playbackRate.setTargetAtTime(rate, t, 0.3);
    v.cruise?.playbackRate.setTargetAtTime(rate, t, 0.3);
  }
}
