/**
 * Sound effects: short recordings in public/audio/sfx, rendered offline by tools/build-sfx.py to match the music
 * (G minor, low and dark) and the picture (sand, iron). Each sound has several takes; each play picks one it didn't
 * just play and nudges the pitch a little, so repeats don't sound mechanical.
 *
 * For now only a tile landing has a sound. Every other hook below is called by the game but silent, until it gets a
 * sound that fits: render it in build-sfx.py, then point the hook at it with play().
 *
 * The files download and decode as soon as this module loads (an OfflineAudioContext decodes without a click; the
 * buffers then play in the real context). The context is opened when the game starts, before the opening hand is
 * dealt. If the browser still refuses sound, that call does nothing until a click or key on the loading screen
 * resumes it. Effects use their own context and gain, so the music mute slider does not silence them.
 *
 * At most MAX voices play at once. Past that, the oldest short sound fades out quickly.
 */

const SFX_BASE = 0.36; // master gain at volume 100
export const SFX_VOLUME_DEFAULT = 299;
export const SFX_VOLUME_MAX = 300;
const SFX_KEY = 'oto.sfx';
const MAX = 12;
const BASE = '/audio/sfx/';
/** A sound longer than this counts as long: it is the last to be cut when too many play. */
const LONG = 1.5;

let sfxVolume = SFX_VOLUME_DEFAULT;
try {
  const saved = JSON.parse(localStorage.getItem(SFX_KEY) ?? '');
  if (typeof saved === 'number' && saved >= 0 && saved <= SFX_VOLUME_MAX) sfxVolume = saved;
} catch {
  /* keep the default */
}

const sfxGain = (volume = sfxVolume) => (volume / 100) * SFX_BASE;

// ---------- loading ----------
/** name -> [AudioBuffer] (its takes). */
const banks = {};
const lastTake = {};

const loaded = (async () => {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC || typeof fetch !== 'function') return false;
  try {
    const manifest = await (await fetch(BASE + 'manifest.json')).json();
    const decoder = new OAC(1, 1, 22050);
    await Promise.all(
      Object.entries(manifest).flatMap(([name, takes]) =>
        Array.from({ length: takes }, async (_, i) => {
          const res = await fetch(`${BASE}${name}-${i + 1}.wav`);
          if (!res.ok) throw new Error(`${name}-${i + 1}.wav: ${res.status}`);
          const buf = await decoder.decodeAudioData(await res.arrayBuffer());
          (banks[name] ??= [])[i] = buf;
        }),
      ),
    );
    return true;
  } catch (error) {
    console.warn('Sound effects could not be loaded.', error);
    return false;
  }
})();

/** Resolves (true) once every sound is decoded, or false if they could not be loaded. */
export function sfxLoaded() {
  return loaded;
}

// ---------- context ----------
let ctx = null;
let master = null;
/** Resolves once the browser is actually letting this context play. */
let ready = null;
/** @type {{ end: number, long: boolean, stop: (fade?: number) => void }[]} */
const active = [];

function ensure() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = sfxGain();
  // A gentle limiter: a dense payout or a sting over a salvo can't clip.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6;
  comp.knee.value = 4;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  master.connect(comp).connect(ctx.destination);
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

/** Create the context if needed and resume it. Call this inside the startup gesture when the browser blocks autoplay. Returns whether sound can be heard right now. */
export function unlockSfx() {
  if (!ensure()) return false;
  if (ctx.state === 'suspended') ctx.resume();
  return ctx.state === 'running';
}

/** Resolves when sound is allowed. resume() often flips the state a moment after the click. */
export function whenSfxRunning() {
  if (!ensure()) return Promise.resolve(false);
  if (ctx.state === 'suspended') ctx.resume();
  return ready.then(() => true);
}

// ---------- playback ----------
/**
 * Play one take of `name`. `gain` scales it, `rate` sets the playback speed (pitch), `vary` is the random pitch
 * spread (±, as a fraction), `maxDur` cuts it short with a fade. Returns the voice, or null if nothing played.
 */
function play(name, { gain = 1, rate = 1, vary = 0.03, maxDur = Infinity, delay = 0 } = {}) {
  if (!ctx || ctx.state !== 'running') return null;
  const bank = banks[name];
  if (!bank?.length) return null;
  let i = Math.floor(Math.random() * bank.length);
  if (bank.length > 1 && i === lastTake[name]) i = (i + 1) % bank.length;
  lastTake[name] = i;
  const buf = bank[i];
  const now = ctx.currentTime;
  for (let k = active.length - 1; k >= 0; k--) if (active[k].end <= now) active.splice(k, 1);
  if (active.length >= MAX) {
    const k = active.findIndex((v) => !v.long);
    active.splice(k >= 0 ? k : 0, 1)[0].stop(0.04);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const r = rate * (1 + (Math.random() * 2 - 1) * vary);
  src.playbackRate.value = r;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  const start = now + delay;
  const length = Math.min(buf.duration / r, maxDur);
  src.start(start);
  const voice = {
    end: start + length,
    long: buf.duration / r > LONG,
    stop(fade = 0.05) {
      const t = Math.max(ctx.currentTime, start);
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + fade);
        src.stop(t + fade + 0.01);
      } catch {
        /* already stopped */
      }
      voice.end = t + fade;
    },
  };
  if (Number.isFinite(maxDur) && maxDur < buf.duration / r) {
    const fade = Math.min(0.08, maxDur * 0.3);
    g.gain.setValueAtTime(gain, start + maxDur - fade);
    g.gain.linearRampToValueAtTime(0, start + maxDur);
    src.stop(start + maxDur + 0.01);
  }
  src.onended = () => {
    src.disconnect();
    g.disconnect();
  };
  active.push(voice);
  return voice;
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

// ---------- the sounds ----------
/** A tile hits the sand. `heavy` is a whole Wasteland piece. */
export const thud = (heavy = false) => play(heavy ? 'thud-heavy' : 'thud', { vary: 0.05 });

// ---------- silent hooks (no sound yet) ----------
const none = () => null;
/** Pointer entered a card. */
export const hover = none;
/** Pointer or keys moved onto a different dialogue choice. */
export const choiceHover = none;
/** A dialogue choice was confirmed. */
export const choiceClick = none;
/** One typewriter tick while a dialogue line is being spoken. */
export const speak = none;
/** Dialogue advances. */
export const click = none;
/** Card select (`up`) or deselect. */
export const tick = none;
/** Rotate a piece. */
export const chirp = none;
/** A new hand slides in. */
export const deal = none;
/** Reroll. */
export const shuffle = none;
/** Illegal placement. */
export const buzz = none;
/** A bad toast that is not already a placement buzz. */
export const deny = none;
/** The turn starts resolving. */
export const confirm = none;
/** Oil, or a purchase. */
export const coin = none;
/** Food gained. */
export const food = none;
/** A barrel lands in the tribute gauge (`level` 0..1: how full the tribute is). */
export const barrel = none;
/** The season clock locks into the next season. */
export const latch = none;
/** Factory missile launch (stand-in until the combat recordings load). */
export const silo = none;
/** Missile detonation (stand-in until the combat recordings load). */
export const boom = none;
/** A CIWS burst for `dur` seconds (stand-in until the combat recordings load). */
export const ciws = none;
/** Demolish / Wrecking Crew (`heavy`: the 2×2 crew). */
export const demolition = none;
/** The run ends. */
export const doom = none;
/** A dialogue banner drops in (`kind`: 'fortune', 'disaster', 'pressure', or a choice / report). */
export const sting = none;
/** The year's tribute was met. */
export const tribute = none;
/** Every rival has fallen. */
export const fanfare = none;
/** Raiders or bandits made camp. */
export const raid = none;
/** A camp is cleared out. */
export const rout = none;
/** Rebels put down by force. */
export const crush = none;
/** A screen opens (shop, black market, tile pick, strike hand). */
export const panelOpen = none;
/** That screen closes. */
export const panelClose = none;
/** The clouds roll over for a view change. */
export const transition = none;
/** Hidden sites come to light, or a new plot is unlocked. */
export const reveal = none;
/** The Smuggler arrives. */
export const smuggler = none;
/** Rush order. */
export const whistle = none;
