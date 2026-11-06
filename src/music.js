/**
 * Background music: the main screen's theme and the game's track, each looped forever; one plays at a time, and
 * switching between them fades one out as the other comes in (playTrack).
 *
 * The track plays at full level right to its last note, so a plain loop would cut audibly. Instead each
 * copy is scheduled to start CROSSFADE seconds before the previous one ends: the old copy fades out while
 * the new one fades in, on equal-power curves so the overall loudness does not dip or bump at the seam.
 * The very first copy fades in from silence.
 *
 * The file downloads straight away. Playback starts when the game does (see startMusic), which is also
 * when the browser is asked to allow sound. The crossfade is not booked until the context is running,
 * so a suspended context cannot stack copies of the track.
 *
 * The bottom-left control (index.html #music) mutes it and sets the volume; both are saved in localStorage.
 */

import { L, onLangChange } from './i18n.js';

// The tracks: game, the gameplay track; title, the main screen's theme. Each copy fades in at its start and out at its
// end, the next one fading in under it (CROSSFADE), so the loop never cuts.
const TRACKS = {
  game: '/audio/game-theme.mp3',
  title: '/audio/title/menu-theme.mp3',
};
export const MUSIC_VOLUME_DEFAULT = 79; // slider position; the level is its square, capped at 2
export const MUSIC_VOLUME_MAX = 200; // 100 = full level, 200 = twice as loud
const DEFAULT_VOLUME = MUSIC_VOLUME_DEFAULT;
const SETTINGS_KEY = 'oto.music';
const FADE_IN = 4; // seconds, first start
const CROSSFADE = 4; // seconds, loop seam

/** Equal-power fade curves: sin for fading in, cos for fading out, so in² + out² stays 1. */
function curve(fadeIn) {
  const c = new Float32Array(128);
  for (let i = 0; i < c.length; i++) {
    const t = (i / (c.length - 1)) * (Math.PI / 2);
    c[i] = fadeIn ? Math.sin(t) : Math.cos(t);
  }
  return c;
}
const IN = curve(true);
const OUT = curve(false);

const settings = { volume: DEFAULT_VOLUME, muted: false };
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= MUSIC_VOLUME_MAX) settings.volume = saved.volume;
  if (typeof saved.muted === 'boolean') settings.muted = saved.muted;
} catch {
  /* keep defaults */
}
const save = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
/** Squared, so the slider feels even to the ear (loudness is not linear in gain). Capped at 2. */
const level = () => (settings.muted ? 0 : Math.min(2, (settings.volume / 100) ** 2));

let ctx = null;
let master = null;
let lowpass = null;
let distance = null;
let muffled = false;

/** Open on the board. On the War Map the highs are gone and the track sits much further back. */
const AIR_HZ = 16000;
const SPACE_HZ = 450;
const SPACE_GAIN = 0.35;

/**
 * One looped track: its file (downloaded once), its own fader (so it can fade out under another), and the copies it
 * has scheduled. run counts each start: a stopped track's pending copies see a newer run and don't play.
 */
const decks = Object.fromEntries(Object.entries(TRACKS).map(([name, url]) => [name, { name, url, download: null, buffer: null, gain: null, run: 0, playing: false }]));
let wanted = 'game'; // the track that should be playing

function fetchTrack(deck) {
  deck.download ??= fetch(deck.url).then((res) => {
    if (!res.ok) throw new Error(`${deck.url}: ${res.status}`);
    return res.arrayBuffer();
  });
  deck.download.catch(() => {}); // reported when it's played
  return deck.download;
}

/** Plays one copy of the track from audio time `when`, fading in over `fadeIn` seconds and out at its end. */
function playCopy(deck, run, when, fadeIn) {
  if (run !== deck.run) return; // stopped meanwhile
  const source = ctx.createBufferSource();
  source.buffer = deck.buffer;
  const gain = ctx.createGain();
  source.connect(gain).connect(deck.gain);
  const end = when + deck.buffer.duration;
  gain.gain.setValueAtTime(0, when);
  gain.gain.setValueCurveAtTime(IN, when, fadeIn);
  gain.gain.setValueCurveAtTime(OUT, end - CROSSFADE, CROSSFADE);
  source.start(when);
  source.stop(end);
  deck.sources.add(source);
  source.onended = () => {
    deck.sources.delete(source);
    source.disconnect();
    gain.disconnect();
  };
  // The next copy is booked a whole track ahead, as this one begins: the audio clock times it exactly,
  // and timer delays (background tabs) cannot make it late.
  const next = end - CROSSFADE;
  setTimeout(() => playCopy(deck, run, next, CROSSFADE), Math.max(0, (when - ctx.currentTime) * 1000));
}

/** Start a track's loop (fading in over `fadeIn` s), unless it's already playing. */
function startDeck(deck, fadeIn) {
  if (deck.playing || !ctx || ctx.state !== 'running') return;
  deck.playing = true;
  const run = ++deck.run;
  deck.gain.gain.cancelScheduledValues(ctx.currentTime);
  deck.gain.gain.setValueAtTime(1, ctx.currentTime);
  fetchTrack(deck)
    .then((raw) => deck.buffer ?? ctx.decodeAudioData(raw))
    .then((decoded) => {
      deck.buffer = decoded;
      if (run === deck.run) playCopy(deck, run, ctx.currentTime + 0.05, fadeIn);
    })
    .catch((error) => {
      deck.playing = false;
      console.warn(`Music (${deck.name}) could not be loaded.`, error);
    });
}

/** Fade a track out over `seconds`, then stop its copies. */
function stopDeck(deck, seconds) {
  if (!deck.playing) return;
  deck.playing = false;
  const run = ++deck.run; // no more copies get booked
  const now = ctx.currentTime;
  deck.gain.gain.cancelScheduledValues(now);
  deck.gain.gain.setValueAtTime(deck.gain.gain.value, now);
  deck.gain.gain.linearRampToValueAtTime(0, now + seconds);
  setTimeout(() => {
    if (run !== deck.run) return; // started again meanwhile
    for (const src of deck.sources) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
  }, seconds * 1000 + 100);
}

function beginPlayback() {
  if (!ctx || ctx.state !== 'running') return;
  startDeck(decks[wanted], FADE_IN);
}

/** Open the music context and start the wanted track once the browser is allowing sound. Safe to call again. */
export function startMusic() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = level();
    lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = muffled ? SPACE_HZ : AIR_HZ;
    lowpass.Q.value = 0.5;
    distance = ctx.createGain();
    distance.gain.value = muffled ? SPACE_GAIN : 1;
    master.connect(lowpass).connect(distance).connect(ctx.destination);
    for (const deck of Object.values(decks)) {
      deck.gain = ctx.createGain();
      deck.sources = new Set();
      deck.gain.connect(master);
    }
    ctx.addEventListener('statechange', beginPlayback);
  }
  if (ctx.state === 'suspended') ctx.resume();
  beginPlayback();
}

/**
 * Switch the music: 'title' (the main screen's theme) or 'game'. The old track fades out over `fadeOut` seconds; the
 * new one fades in over `fadeIn`, starting after `delay` seconds (so the old one can be gone first).
 */
export function playTrack(name, { fadeOut = 2, fadeIn = FADE_IN, delay = 0 } = {}) {
  if (!decks[name]) return;
  wanted = name;
  if (!ctx) return; // startMusic plays it once sound is allowed
  for (const deck of Object.values(decks)) if (deck.name !== name) stopDeck(deck, fadeOut);
  const go = () => wanted === name && startDeck(decks[name], fadeIn);
  if (delay > 0) setTimeout(go, delay * 1000);
  else go();
}

/** Muffle the track on the War Map, and open it again in a city. Glides, so the change is not a click. */
export function setMusicMuffled(on) {
  muffled = on;
  if (!lowpass) return;
  const now = ctx.currentTime;
  lowpass.frequency.cancelScheduledValues(now);
  lowpass.frequency.setTargetAtTime(on ? SPACE_HZ : AIR_HZ, now, 0.35);
  distance.gain.cancelScheduledValues(now);
  distance.gain.setTargetAtTime(on ? SPACE_GAIN : 1, now, 0.35);
}

/** Volume and mute changes glide over a fraction of a second instead of clicking. */
function applyLevel() {
  if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.08);
  updateControl();
}

let volumeListener = null;
/** Called with the saved slider position after the corner control or the debug panel changes it. */
export function onMusicVolume(fn) {
  volumeListener = fn;
}

export function getMusicVolume() {
  return settings.volume;
}

export function setMusicVolume(volume) {
  settings.volume = Math.max(0, Math.min(MUSIC_VOLUME_MAX, Math.round(volume)));
  settings.muted = settings.volume === 0;
  save();
  applyLevel();
  volumeListener?.(settings.volume);
}

export function setMusicMuted(muted) {
  settings.muted = muted;
  if (!muted && settings.volume === 0) settings.volume = DEFAULT_VOLUME; // unmuting at zero would stay silent
  save();
  applyLevel();
}

// ---------- the bottom-left control ----------
const ICON_ON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_OFF =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
let control = null;

function updateControl() {
  if (!control) return;
  const off = settings.muted || settings.volume === 0;
  control.root.classList.toggle('muted', off);
  control.button.innerHTML = off ? ICON_OFF : ICON_ON;
  control.button.title = off
    ? L('Music off (click to turn on)', '音乐已关闭（点击开启）')
    : L('Music on (click to mute)', '音乐已开启（点击静音）');
  control.button.setAttribute('aria-label', off ? L('Unmute music', '取消音乐静音') : L('Mute music', '音乐静音'));
  control.slider.value = String(off ? 0 : settings.volume);
}

function mountControl() {
  const root = document.getElementById('music');
  if (!root) return;
  control = { root, button: root.querySelector('#btnMusic'), slider: root.querySelector('#musicVolume') };
  control.button.addEventListener('click', () => {
    setMusicMuted(!(settings.muted || settings.volume === 0));
    control.button.blur(); // so Enter (end turn) does not toggle it again
  });
  control.slider.addEventListener('input', () => setMusicVolume(Number(control.slider.value)));
  control.slider.addEventListener('change', () => control.slider.blur()); // arrow keys go back to the camera
  onLangChange(updateControl);
  updateControl();
}

let initialised = false;
/** Download the tracks now and show the control. Playback waits for startMusic. */
export function initMusic(first = 'game') {
  if (initialised) return;
  initialised = true;
  wanted = first;
  mountControl();
  fetchTrack(decks[first]);
  for (const deck of Object.values(decks)) fetchTrack(deck);
}

