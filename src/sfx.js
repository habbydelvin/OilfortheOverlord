/**
 * Placeholder sound effects, synthesised in the browser. Wasteland landings use the rock drops in public/audio/place/.
 *
 * The context is opened when the game starts, before the opening hand is dealt. If the
 * browser still refuses sound, that call does nothing until a click or key on the loading
 * screen resumes it. Effects use their own context and gain, so the music mute slider
 * does not silence them.
 *
 * At most MAX voices play at once. A full payout or a fast-forward drops the oldest.
 */

const SFX_BASE = 0.32; // gain at volume 100, the old fixed level
export const SFX_VOLUME_DEFAULT = 299;
export const SFX_VOLUME_MAX = 300;
const SFX_KEY = 'oto.sfx';
const MAX = 8;

let sfxVolume = SFX_VOLUME_DEFAULT;
try {
  const saved = JSON.parse(localStorage.getItem(SFX_KEY) ?? '');
  if (typeof saved === 'number' && saved >= 0 && saved <= SFX_VOLUME_MAX) sfxVolume = saved;
} catch {
  /* keep the default */
}

const sfxGain = (volume = sfxVolume) => (volume / 100) * SFX_BASE;

let ctx = null;
let master = null;
let noiseBuf = null;
/** Resolves once the browser is actually letting this context play. */
let ready = null;
/** Rock drops for a Wasteland tile hitting the sand. Loaded after unlock. */
const WASTE_THUDS = ['/audio/place/wasteland-1.ogg', '/audio/place/wasteland-2.ogg', '/audio/place/wasteland-3.ogg'];
let wasteBufs = [];
let wasteLoad = null;
let wasteLast = -1;
/** Boulder and rubble hits for a building landing. Loaded after unlock. */
const BUILD_THUDS = ['/audio/place/building-1.ogg', '/audio/place/building-2.ogg'];
let buildBufs = [];
let buildLoad = null;
let buildLast = -1;
/** Button clicks for rotating a piece (ZapSplat, Ogg Opus). Loaded after unlock. */
const ROTATE_CLICKS = ['/audio/ui/rotate-click-001.ogg', '/audio/ui/rotate-click-002.ogg', '/audio/ui/rotate-click-003.ogg', '/audio/ui/rotate-click-005.ogg'];
let rotateBufs = [];
let rotateLoad = null;
let rotateLast = -1;
/** Whooshes for the cloud transition. [0] zooms out to the planet, [1] zooms into a city. */
const ZOOM_WHOOSH = ['/audio/transition/zoom-out.ogg', '/audio/transition/zoom-in.ogg?v=2'];
let zoomBufs = [null, null];
let zoomLoad = false;
/** @type {{ end: number, kill: () => void }[]} */
const active = [];

function ensure() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = sfxGain();
  master.connect(ctx.destination);
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  ready = new Promise((resolve) => {
    if (ctx.state === 'running') return resolve();
    const done = () => {
      if (ctx.state !== 'running') return;
      ctx.removeEventListener('statechange', done);
      resolve();
    };
    ctx.addEventListener('statechange', done);
  });
  return true;
}

/** 0–300. 100 is the old quiet level, 300 is the default. */
export function setSfxVolume(volume) {
  sfxVolume = Math.max(0, Math.min(SFX_VOLUME_MAX, Math.round(volume)));
  localStorage.setItem(SFX_KEY, JSON.stringify(sfxVolume));
  if (master) master.gain.setTargetAtTime(sfxGain(), ctx.currentTime, 0.03);
  return sfxVolume;
}

export function getSfxVolume() {
  return sfxVolume;
}

/** Play `hover()` once each time the pointer enters a different `.card` inside `root`. */
export function bindCardHover(root) {
  if (!root) return;
  let current = null;
  root.addEventListener('pointerover', (e) => {
    const card = e.target.closest('.card');
    if (!card || !root.contains(card) || card === current) return;
    current = card;
    hover();
  });
  root.addEventListener('pointerout', (e) => {
    if (!current) return;
    const next = e.relatedTarget?.closest?.('.card');
    if (next && root.contains(next)) return;
    current = null;
  });
}

/** Create the context if needed and resume it. Call this inside the startup gesture when the browser blocks autoplay. Returns whether sound can be heard right now. */
function loadWasteThuds() {
  if (wasteLoad || !ctx) return;
  wasteLoad = Promise.all(
    WASTE_THUDS.map(async (file) => {
      try {
        const res = await fetch(file);
        if (!res.ok) throw new Error(res.status);
        return await ctx.decodeAudioData(await res.arrayBuffer());
      } catch (err) {
        console.warn(`[sfx] ${file} failed to load`, err);
        return null;
      }
    }),
  ).then((bufs) => {
    wasteBufs = bufs.filter(Boolean);
  });
}

function loadBuildThuds() {
  if (buildLoad || !ctx) return;
  buildLoad = Promise.all(
    BUILD_THUDS.map(async (file) => {
      try {
        const res = await fetch(file);
        if (!res.ok) throw new Error(res.status);
        return await ctx.decodeAudioData(await res.arrayBuffer());
      } catch (err) {
        console.warn(`[sfx] ${file} failed to load`, err);
        return null;
      }
    }),
  ).then((bufs) => {
    buildBufs = bufs.filter(Boolean);
  });
}

function loadRotateClicks() {
  if (rotateLoad || !ctx) return;
  rotateLoad = Promise.all(
    ROTATE_CLICKS.map(async (file) => {
      try {
        const res = await fetch(file);
        if (!res.ok) throw new Error(res.status);
        return await ctx.decodeAudioData(await res.arrayBuffer());
      } catch (err) {
        console.warn(`[sfx] ${file} failed to load`, err);
        return null;
      }
    }),
  ).then((bufs) => {
    rotateBufs = bufs.filter(Boolean);
  });
}

function loadZoomWhooshes() {
  if (!ctx || zoomLoad) return;
  zoomLoad = true;
  ZOOM_WHOOSH.forEach(async (file, i) => {
    try {
      const res = await fetch(file);
      if (!res.ok) throw new Error(res.status);
      zoomBufs[i] = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      console.warn(`[sfx] ${file} failed to load`, err);
    }
  });
}

export function unlockSfx() {
  if (!ensure()) return false;
  if (ctx.state === 'suspended') ctx.resume();
  loadWasteThuds();
  loadBuildThuds();
  loadRotateClicks();
  loadZoomWhooshes();
  return ctx.state === 'running';
}

/** Resolves when sound is allowed. resume() often flips the state a moment after the click. */
export function whenSfxRunning() {
  if (!ensure()) return Promise.resolve(false);
  if (ctx.state === 'suspended') ctx.resume();
  return ready.then(() => true);
}

/** ±4% so two identical events are not the same sample. */
const vary = (freq) => freq * (1 + (Math.random() * 2 - 1) * 0.04);

function env(when, dur, peak, attack = 0.008) {
  const g = ctx.createGain();
  const span = Math.max(dur, attack + 0.02);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + span);
  return g;
}

function tone(nodes, when, type, freq, dur, peak, slideTo) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(vary(freq), when);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), when + dur);
  const g = env(when, dur, peak);
  o.connect(g).connect(master);
  o.start(when);
  o.stop(when + dur + 0.03);
  nodes.push(o, g);
}

function noise(nodes, when, dur, peak, freq, q, slideTo) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(freq, when);
  filter.Q.value = q;
  if (slideTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), when + dur);
  const g = env(when, dur, peak, 0.004);
  src.connect(filter).connect(g).connect(master);
  src.start(when);
  src.stop(when + dur + 0.03);
  nodes.push(src, filter, g);
}

/** Run `build(now, nodes)` as one voice. `dur` is how long the voice counts toward the cap. */
function begin(dur, build) {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i].end <= now) active.splice(i, 1);
  }
  if (active.length >= MAX) active.shift().kill();
  const nodes = [];
  const voice = {
    end: now + dur,
    kill() {
      for (const n of nodes) {
        try {
          n.stop?.();
        } catch {
          /* already stopped */
        }
        try {
          n.disconnect();
        } catch {
          /* already gone */
        }
      }
    },
  };
  active.push(voice);
  build(now, nodes);
}

/** Pointer entered a card. Quieter and higher than the select tick. */
export function hover() {
  begin(0.04, (t, nodes) => tone(nodes, t, 'sine', 1280, 0.03, 0.1));
}

/** Pointer or keys moved onto a different dialogue choice. */
export function choiceHover() {
  begin(0.04, (t, nodes) => tone(nodes, t, 'sine', 920, 0.028, 0.1));
}

/** A dialogue choice was confirmed. */
export function choiceClick() {
  begin(0.08, (t, nodes) => {
    tone(nodes, t, 'triangle', 620, 0.05, 0.16);
    tone(nodes, t + 0.028, 'sine', 930, 0.055, 0.12);
  });
}

/** One typewriter tick while a dialogue line is being spoken. */
export function speak() {
  begin(0.035, (t, nodes) => noise(nodes, t, 0.025, 0.09, 1600 + Math.random() * 900, 0.7));
}

/** Card select (higher) or deselect. */
export function tick(up = false) {
  begin(0.06, (t, nodes) => tone(nodes, t, 'sine', up ? 880 : 520, 0.045, 0.22));
}

/** Rotate a piece. */
export function chirp() {
  begin(0.1, (t, nodes) => tone(nodes, t, 'triangle', 420, 0.09, 0.18, 880));
}

/** A new hand slides in. */
export function deal() {
  begin(0.28, (t, nodes) => {
    noise(nodes, t, 0.2, 0.14, 900, 0.7, 420);
    tone(nodes, t, 'sine', 660, 0.05, 0.1);
    tone(nodes, t + 0.06, 'sine', 740, 0.05, 0.1);
    tone(nodes, t + 0.12, 'sine', 880, 0.06, 0.11);
  });
}

/** A tile hits the sand. `heavy` is a whole Wasteland piece. */
export function thud(heavy = false) {
  begin(0.22, (t, nodes) => {
    const f = heavy ? 90 : 140;
    noise(nodes, t, 0.08, heavy ? 0.4 : 0.32, 200, 0.8);
    tone(nodes, t, 'sine', f, 0.16, heavy ? 0.4 : 0.3, f * 0.5);
  });
}

/** Cloud transition. `inward` is planet → city; otherwise city → planet. */
export function zoomWhoosh(inward = false) {
  const buf = zoomBufs[inward ? 1 : 0];
  if (!buf) return;
  begin(buf.duration, (t, nodes) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.7;
    src.connect(g).connect(master);
    src.start(t);
    nodes.push(src, g);
  });
}

/** A building hits the sand: one of the recorded impacts, or the ordinary thud if they are not ready. */
export function buildThud() {
  if (!buildBufs.length) {
    thud();
    return;
  }
  let i = Math.floor(Math.random() * buildBufs.length);
  if (buildBufs.length > 1 && i === buildLast) i = (i + 1) % buildBufs.length;
  buildLast = i;
  const buf = buildBufs[i];
  begin(buf.duration, (t, nodes) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(g).connect(master);
    src.start(t);
    nodes.push(src, g);
  });
}

/** A piece is rotated: one of the recorded button clicks, or the synthesised chirp if they are not ready. */
export function rotateClick() {
  if (!rotateBufs.length) {
    chirp();
    return;
  }
  let i = Math.floor(Math.random() * rotateBufs.length);
  if (rotateBufs.length > 1 && i === rotateLast) i = (i + 1) % rotateBufs.length;
  rotateLast = i;
  const buf = rotateBufs[i];
  begin(buf.duration, (t, nodes) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.03;
    const g = ctx.createGain();
    g.gain.value = 0.8;
    src.connect(g).connect(master);
    src.start(t);
    nodes.push(src, g);
  });
}

/** A Wasteland tile hits the sand: one of the recorded rock drops, or the heavy thud if they are not ready. */
export function wasteThud() {
  if (!wasteBufs.length) {
    thud(true);
    return;
  }
  let i = Math.floor(Math.random() * wasteBufs.length);
  if (wasteBufs.length > 1 && i === wasteLast) i = (i + 1) % wasteBufs.length;
  wasteLast = i;
  const buf = wasteBufs[i];
  begin(buf.duration, (t, nodes) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.55;
    src.connect(g).connect(master);
    src.start(t);
    nodes.push(src, g);
  });
}

/** Illegal placement. */
export function buzz() {
  begin(0.14, (t, nodes) => tone(nodes, t, 'square', 220, 0.12, 0.1, 110));
}

/** A bad toast that is not already a placement buzz. */
export function deny() {
  begin(0.09, (t, nodes) => tone(nodes, t, 'square', 180, 0.07, 0.07, 140));
}

/** The turn starts resolving. */
export function confirm() {
  begin(0.2, (t, nodes) => {
    tone(nodes, t, 'sine', 523, 0.16, 0.12);
    tone(nodes, t, 'sine', 784, 0.16, 0.1);
  });
}

/** Oil, or a purchase. */
export function coin() {
  begin(0.16, (t, nodes) => {
    tone(nodes, t, 'sine', 988, 0.06, 0.16);
    tone(nodes, t + 0.05, 'sine', 1318, 0.08, 0.14);
  });
}

/** A barrel of oil lands in the tribute gauge: a hollow knock, higher as the tribute fills (`level` 0..1). */
export function barrel(level = 0) {
  begin(0.16, (t, nodes) => {
    noise(nodes, t, 0.04, 0.16, 1400, 0.6);
    tone(nodes, t, 'triangle', 260 + level * 340, 0.12, 0.2, 200 + level * 260);
  });
}

/** The season clock's bolt locks into the next season: a sharp click and a low iron thunk. */
export function latch() {
  begin(0.22, (t, nodes) => {
    noise(nodes, t, 0.03, 0.22, 2600, 0.5);
    tone(nodes, t + 0.01, 'square', 150, 0.1, 0.14, 90);
    tone(nodes, t + 0.02, 'triangle', 420, 0.06, 0.08, 300);
  });
}

/** Food gained. */
export function food() {
  begin(0.14, (t, nodes) => tone(nodes, t, 'sine', 392, 0.12, 0.16, 330));
}

/** Reroll. */
export function shuffle() {
  begin(0.22, (t, nodes) => noise(nodes, t, 0.2, 0.2, 1400, 0.6, 480));
}

/** Dialogue advances. */
export function click() {
  begin(0.04, (t, nodes) => noise(nodes, t, 0.025, 0.18, 2800, 0.6));
}

/** Factory missile lighting off and going up. */
export function silo() {
  begin(0.85, (t, nodes) => {
    noise(nodes, t, 0.18, 0.18, 140, 0.8, 70);
    tone(nodes, t, 'sine', 70, 0.28, 0.22, 40);
    noise(nodes, t + 0.22, 0.28, 0.3, 420, 0.55, 140);
    tone(nodes, t + 0.22, 'sawtooth', 90, 0.32, 0.16, 50);
    noise(nodes, t + 0.38, 0.4, 0.22, 900, 0.6, 220);
  });
}

/** Missile detonation. */
export function boom() {
  begin(0.4, (t, nodes) => {
    tone(nodes, t, 'sine', 90, 0.34, 0.42, 38);
    noise(nodes, t, 0.28, 0.32, 220, 0.5, 70);
  });
}

/** Demolish / Wrecking Crew: a crunch and thump, metal hammer clanks, then rubble trickling down. `heavy` is the 2×2 crew. */
export function demolition(heavy = false) {
  begin(heavy ? 0.9 : 0.7, (t, nodes) => {
    noise(nodes, t, 0.26, heavy ? 0.42 : 0.34, 320, 0.7, 110);
    tone(nodes, t, 'sine', heavy ? 95 : 120, 0.3, heavy ? 0.4 : 0.32, 45);
    const clanks = heavy ? [0.06, 0.15, 0.22, 0.33] : [0.07, 0.18, 0.3];
    clanks.forEach((d, i) => {
      const f = [1450, 1150, 1700, 1300][i];
      tone(nodes, t + d, 'triangle', f, 0.07, 0.1);
      tone(nodes, t + d, 'square', f * 2.7, 0.035, 0.03);
    });
    const bits = heavy ? 9 : 6;
    for (let i = 0; i < bits; i++) {
      const at = t + 0.2 + Math.random() * (heavy ? 0.6 : 0.45);
      noise(nodes, at, 0.04 + Math.random() * 0.05, 0.06 + Math.random() * 0.06, 1800 + Math.random() * 2200, 1.2);
    }
  });
}

/** The run ends. */
export function doom() {
  begin(0.55, (t, nodes) => {
    tone(nodes, t, 'sine', 440, 0.18, 0.14, 392);
    tone(nodes, t + 0.14, 'sine', 349, 0.18, 0.13, 311);
    tone(nodes, t + 0.28, 'sine', 262, 0.22, 0.14, 196);
  });
}

/** A CIWS burst: a fast ripping "brrrt" of rounds for `dur` seconds. */
export function ciws(dur = 0.8) {
  begin(dur + 0.05, (t, nodes) => {
    const n = Math.round(dur * 45);
    for (let i = 0; i < n; i++) noise(nodes, t + i / 45, 0.014, 0.16, 700 + Math.random() * 500, 0.9);
    tone(nodes, t, 'sawtooth', 48, dur, 0.06, 40);
  });
}
