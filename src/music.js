/**
 * Background music: one track, looped forever.
 *
 * The track plays at full level right to its last note, so a plain loop would cut audibly. Instead each
 * copy is scheduled to start CROSSFADE seconds before the previous one ends: the old copy fades out while
 * the new one fades in, on equal-power curves so the overall loudness does not dip or bump at the seam.
 * The very first copy fades in from silence.
 *
 * Browsers only allow sound after the player interacts with the page, so the music starts on the first
 * click or key press (for example, pressing Enter in the intro). The file downloads straight away, so it
 * is ready by then.
 *
 * The bottom-left control (index.html #music) mutes it and sets the volume; both are saved in localStorage.
 */

const URL = '/audio/OverlordIsWatching.mp3';
const DEFAULT_VOLUME = 67; // slider position 0-100; the level is its square (67 -> 0.45, a background level)
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
  if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 100) settings.volume = saved.volume;
  if (typeof saved.muted === 'boolean') settings.muted = saved.muted;
} catch {
  /* keep defaults */
}
const save = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
/** Squared, so the slider feels even to the ear (loudness is not linear in gain). */
const level = () => (settings.muted ? 0 : (settings.volume / 100) ** 2);

let ctx = null;
let master = null;
let buffer = null;
let download = null;

/** Plays one copy of the track from audio time `when`, fading in over `fadeIn` seconds and out at its end. */
function playCopy(when, fadeIn) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  source.connect(gain).connect(master);
  const end = when + buffer.duration;
  gain.gain.setValueAtTime(0, when);
  gain.gain.setValueCurveAtTime(IN, when, fadeIn);
  gain.gain.setValueCurveAtTime(OUT, end - CROSSFADE, CROSSFADE);
  source.start(when);
  source.stop(end);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
  // The next copy is booked a whole track ahead, as this one begins: the audio clock times it exactly,
  // and timer delays (background tabs) cannot make it late.
  const next = end - CROSSFADE;
  setTimeout(() => playCopy(next, CROSSFADE), Math.max(0, (when - ctx.currentTime) * 1000));
}

async function start() {
  // Created inside the click / key press, so the browser lets it play.
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = level();
  master.connect(ctx.destination);
  ctx.resume();
  try {
    buffer = await ctx.decodeAudioData(await download);
  } catch (error) {
    console.warn('Background music could not be loaded.', error);
    return;
  }
  playCopy(ctx.currentTime + 0.05, FADE_IN);
}

/** Volume and mute changes glide over a fraction of a second instead of clicking. */
function applyLevel() {
  if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.08);
  updateControl();
}

export function setMusicVolume(volume) {
  settings.volume = Math.max(0, Math.min(100, Math.round(volume)));
  settings.muted = settings.volume === 0;
  save();
  applyLevel();
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
  control.button.title = off ? 'Music off (click to turn on)' : 'Music on (click to mute)';
  control.button.setAttribute('aria-label', off ? 'Unmute music' : 'Mute music');
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
  updateControl();
}

/** Download the track now, show the control, and start the music on the player's first click or key press. */
export function initMusic() {
  if (download) return;
  mountControl();
  download = fetch(URL).then((r) => {
    if (!r.ok) throw new Error(`${URL}: ${r.status}`);
    return r.arrayBuffer();
  });
  download.catch(() => {}); // reported when it is decoded
  const begin = () => {
    window.removeEventListener('pointerdown', begin, true);
    window.removeEventListener('keydown', begin, true);
    start();
  };
  window.addEventListener('pointerdown', begin, true);
  window.addEventListener('keydown', begin, true);
}

