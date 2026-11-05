/**
 * Recorded combat sounds for the Combat Test (public/audio/combat-test, credits in CREDITS.md).
 *
 * Nothing is ever cut off: every stop is a gain ramp to silence, and the source is only stopped once that ramp has
 * finished. Ending an attack (endAttack) releases what is still going: the siren winds down over a few seconds, gun
 * streams stop scheduling shots and let the last one ring, incoming whooshes fade. Explosions always play their own
 * tails out.
 *
 * Its own AudioContext, scaled by the game's SFX volume. Each category has its own gain (setVolume) for tuning.
 */
import { getSfxVolume } from './sfx.js';

const BASE = '/audio/combat-test/';
/** Every sound has a pool of different recordings (built by tools/build-combat-audio.py). */
const POOLS = {
  launch: ['missile-launch.wav'],
  incoming: ['incoming-1.wav', 'incoming-2.wav', 'incoming-3.wav', 'incoming-4.wav'],
  boomLarge: ['explosion-large-1.wav', 'explosion-large-2.wav', 'explosion-large-3.wav', 'explosion-large-4.wav', 'explosion-large-5.wav'],
  boomSmall: ['explosion-small-1.wav', 'explosion-small-2.wav'],
  gun: ['gun-burst-1.wav', 'gun-burst-2.wav', 'gun-burst-3.wav', 'gun-burst-4.wav', 'gun-burst-5.wav', 'gun-burst-6.wav'],
  siren: ['siren-tornado.wav'],
};
/** Where the firing stops in each gun burst (s); the rest is its own tail, kept only on a stream's last burst. */
const GUN_BODY = { 'gun-burst-1.wav': 0.55, 'gun-burst-2.wav': 0.4, 'gun-burst-3.wav': 0.6, 'gun-burst-4.wav': 0.7, 'gun-burst-5.wav': 0.55, 'gun-burst-6.wav': 0.45 };
/** A non-final burst fades out over this as the next one starts. */
const GUN_XFADE = 0.05;

/** Category mix (0–1.5), before the game's SFX volume. */
export const COMBAT_AUDIO_DEFAULTS = { missile: 0.7, explosion: 0.9, gun: 0.55, siren: 0.45, sirenFadeIn: 3, sirenFadeOut: 4 };
/**
 * Voices per category, counting voices still fading out. Past this a new sound either replaces the oldest one that
 * isn't already fading (a quick fade, never a hard cut) or, if it's low priority, is skipped.
 */
const LIMIT = { missile: 10, explosion: 6, gun: 16 };
const STEAL_FADE = 0.1;
/** Replaced voices still fading out may push the count this far past the limit, no further. */
const MAX_FADING_OVER = 2;
/** Explosions starting within this window are one blast: the first plays, the rest make it a little heavier. */
const GROUP_WINDOW = 0.06;
/** How much heavier a grouped blast can get (gain multiplier, ≈ +3 dB). */
const GROUP_MAX_BOOST = 1.4;
/** Each sample fades in over this, so a waveform that doesn't start at zero can't click. */
const ONSET = 0.003;
/** Headroom on the whole combat mix (≈ −6 dB) before the output compressor. */
const HEADROOM = 0.5;

export function createCombatAudio(cfg = { ...COMBAT_AUDIO_DEFAULTS }) {
  let ctx = null;
  let master = null;
  const bus = {};
  const buffers = {}; // pool name -> [{ file, buf }]
  const bags = {}; // pool name -> shuffled indices still to play
  const lastPick = {};
  let loading = null;
  const voices = { missile: [], explosion: [], gun: [] };
  const streams = new Set(); // gun streams still scheduling shots
  const whooshes = new Set(); // incoming missile sounds still in the air
  let siren = null; // { src, gain, stopAt }
  let group = null; // the explosion blast still open for grouping: { at, voice, size, count }
  let meter = null;
  const stats = { played: 0, grouped: 0, skipped: 0, stolen: 0, peakVoices: 0, peakOut: 0 };

  const masterLevel = () => (getSfxVolume() / 100) * 0.35 * HEADROOM;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = masterLevel();
    // Output stage: the mix keeps some headroom, and a fast compressor catches the peaks of a dense salvo so
    // stacked explosions, guns and the siren can't clip into crackle.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    master.connect(comp).connect(meter).connect(ctx.destination);
    for (const k of ['missile', 'explosion', 'gun', 'siren']) {
      bus[k] = ctx.createGain();
      bus[k].gain.value = cfg[k];
      bus[k].connect(master);
    }
    return true;
  }

  /** Fetch and decode every file (once). Resolves when they're all ready; a missing file is skipped. */
  function load() {
    if (!ensure()) return Promise.resolve();
    loading ??= Promise.all(
      Object.entries(POOLS).map(async ([name, files]) => {
        const loaded = await Promise.all(
          files.map(async (file) => {
            try {
              const res = await fetch(BASE + file);
              if (!res.ok) throw new Error(res.status);
              return { file, buf: await ctx.decodeAudioData(await res.arrayBuffer()) };
            } catch (err) {
              console.warn(`[combat audio] ${file} failed to load`, err);
              return null;
            }
          }),
        );
        const ok = loaded.filter(Boolean);
        if (ok.length) buffers[name] = ok;
      }),
    );
    return loading;
  }

  /** Call from a user gesture: resumes the context and starts loading. */
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    load();
  }

  const live = () => ctx && ctx.state === 'running';
  /** stop() on a source that already ended can throw in some browsers. */
  const halt = (src, at) => {
    try {
      src.stop(at);
    } catch {
      /* already stopped */
    }
  };

  /** Ramp a gain to silence from wherever it is now, over `fade` seconds. Returns when it is silent. */
  function release(gain, fade, at = ctx.currentTime) {
    const p = gain.gain;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(at);
    else {
      p.cancelScheduledValues(at);
      p.setValueAtTime(p.value, at);
    }
    p.linearRampToValueAtTime(0, at + Math.max(0.01, fade));
    return at + Math.max(0.01, fade);
  }

  /**
   * One sample through a category bus. Returns a voice: { stop(fade) }. offset: start partway into the sample;
   * dur: play only this long, then fade over `tail` (otherwise the whole sample).
   */
  /**
   * The next recording from a pool: a shuffle bag, so every variation plays before any repeats, and never the same
   * one twice in a row (also across a reshuffle).
   */
  function pick(name) {
    const pool = buffers[name];
    if (!pool) return null;
    if (pool.length === 1) return pool[0];
    if (!bags[name]?.length) {
      const bag = pool.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag[bag.length - 1] === lastPick[name]) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      bags[name] = bag;
    }
    const i = bags[name].pop();
    lastPick[name] = i;
    return pool[i];
  }

  function play(name, cat, { gain = 1, rate = 1, offset = 0, dur = null, tail = 0.05, when = 0, priority = 1, sample = null } = {}) {
    if (!live() || !buffers[name]) return null;
    const list = voices[cat];
    const now = ctx.currentTime;
    // Finished voices leave the list; fading ones stay (they still sound, so they still count).
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end <= now) list.splice(i, 1);
    // Hard ceiling, fading voices included: a replacement may overlap its victim's short fade, but never more.
    if (list.length >= LIMIT[cat] + MAX_FADING_OVER) {
      stats.skipped++;
      return null;
    }
    if (list.filter((v) => !v.fading).length >= LIMIT[cat]) {
      // Full: replace the oldest voice that isn't fading and is no more important, else skip this one.
      const victim = list.find((v) => !v.fading && v.priority <= priority);
      if (!victim) {
        stats.skipped++;
        return null;
      }
      victim.stop(STEAL_FADE);
      stats.stolen++;
    }
    const entry = sample ?? pick(name);
    if (!entry) return null;
    stats.lastFile = entry.file;
    const buf = entry.buf;
    const start = Math.max(now, when || now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + ONSET);
    src.connect(g).connect(bus[cat]);
    const natural = (buf.duration - offset) / rate;
    let end = start + natural;
    if (dur != null && dur < natural) {
      g.gain.setValueAtTime(gain, start + dur);
      g.gain.linearRampToValueAtTime(0, start + dur + tail);
      end = start + dur + tail;
    }
    src.start(start, offset);
    src.stop(end + 0.02);
    const voice = {
      end,
      priority,
      fading: false,
      gain: g,
      level: gain,
      start,
      stop(fade = 0.3) {
        const t = ctx.currentTime;
        if (t >= voice.end) return;
        if (t < start) {
          // Never started: nothing to hear, so nothing to fade.
          halt(src, start);
          voice.end = start;
          return;
        }
        voice.fading = true;
        voice.end = release(g, fade, t);
        halt(src, voice.end + 0.02);
      },
    };
    src.onended = () => g.disconnect();
    list.push(voice);
    stats.played++;
    stats.peakVoices = Math.max(stats.peakVoices, list.filter((v) => v.end > now).length);
    return voice;
  }

  /**
   * A smooth fade of `param` from its current level to `to` over `dur` seconds. Linear gain ramps sound abrupt
   * (loudness is perceived on a log scale, so most of the change lands in the first moments), so this moves through
   * decibels on an S-curve: it eases in, glides, and settles. Safe to call mid-fade: it starts from where it is.
   */
  function smoothFade(param, to, dur) {
    const at = ctx.currentTime;
    const from = param.value;
    const FLOOR = 0.001; // -60 dB
    const a = 20 * Math.log10(Math.max(from, FLOOR));
    const b = 20 * Math.log10(Math.max(to, FLOOR));
    const n = 96;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const s = t * t * (3 - 2 * t);
      curve[i] = 10 ** ((a + (b - a) * s) / 20);
    }
    curve[0] = from;
    curve[n - 1] = to;
    param.cancelScheduledValues(at);
    param.setValueCurveAtTime(curve, at, Math.max(0.05, dur));
    return at + Math.max(0.05, dur);
  }


  return {
    cfg,
    load,
    unlock,

    /** A missile leaving its launcher. */
    launch() {
      play('launch', 'missile', { gain: 0.8 });
    },

    /**
     * A missile coming in, timed so its rising whoosh peaks at impact `seconds` from now. Returns a handle: call
     * .stop() when it lands or is shot down (it fades rather than cutting).
     */
    incoming(seconds) {
      const entry = pick('incoming');
      if (!entry) return null;
      const buf = entry.buf;
      // Start partway in so the whoosh's peak (its end) lands on the impact; arriving later than the recording is
      // long, it waits and starts that much later instead.
      const lead = Math.min(buf.duration, Math.max(0.3, seconds));
      const wait = Math.max(0, seconds - buf.duration);
      const v = play('incoming', 'missile', { sample: entry, gain: 0.8, offset: buf.duration - lead, when: ctx.currentTime + wait });
      if (!v) return null;
      whooshes.add(v);
      return {
        stop: (fade = 0.35) => {
          whooshes.delete(v);
          v.stop(fade);
        },
      };
    },

    /** An explosion: 'large' for a strike, 'small' for an intercept or a decoy. Always plays its whole tail. */
    explosion(size = 'large') {
      if (!live()) return;
      const now = ctx.currentTime;
      const large = size !== 'small';
      // Part of a blast that just started: make that one a little heavier instead of stacking another sample.
      // (A large impact landing on a small blast still plays: it's the one that matters.)
      if (group && now - group.at <= GROUP_WINDOW && (group.large || !large) && !group.voice.fading) {
        group.count++;
        stats.grouped++;
        const boost = Math.min(GROUP_MAX_BOOST, 1 + 0.12 * (group.count - 1));
        group.voice.gain.gain.setTargetAtTime(group.voice.level * boost, Math.max(now, group.voice.start + ONSET), 0.015);
        return;
      }
      const voice = play(large ? 'boomLarge' : 'boomSmall', 'explosion', {
        gain: 1,
        priority: large ? 2 : 1, // a strike can replace an intercept's tail; an intercept is skipped when it's full
      });
      if (voice) group = { at: now, voice, large, count: 1 };
    },

    /** Counters for the test panel: how the explosion budget behaved, and the loudest output since the last reset. */
    stats() {
      if (meter) {
        const buf = new Float32Array(meter.fftSize);
        meter.getFloatTimeDomainData(buf);
        for (const v of buf) stats.peakOut = Math.max(stats.peakOut, Math.abs(v));
      }
      const now = ctx?.currentTime ?? 0;
      return { ...stats, activeExplosions: voices.explosion.filter((v) => v.end > now).length };
    },
    resetStats() {
      Object.assign(stats, { played: 0, grouped: 0, skipped: 0, stolen: 0, peakVoices: 0, peakOut: 0 });
    },

    /**
     * A gun stream for `seconds`: rapid shots, each covered by the next, and the last left to ring out. Returns a
     * handle: .stop() ends it early (no new shots; what's ringing fades).
     */
    gunBurst(seconds = 0.8) {
      if (!buffers.gun || !live()) return null;
      // A stream is a chain of different recorded bursts: each fires its body, then fades as the next starts; the
      // last one keeps its natural tail.
      const shots = [];
      let t = ctx.currentTime;
      const end = t + Math.max(0.2, seconds);
      while (t < end) {
        const entry = pick('gun');
        const body = GUN_BODY[entry.file] ?? 0.5;
        const last = t + body >= end;
        shots.push(play('gun', 'gun', { sample: entry, when: t, gain: 0.9, dur: last ? null : body, tail: GUN_XFADE }));
        t += body - GUN_XFADE * 0.5;
      }
      const stream = {
        stop(fade = 0.2) {
          streams.delete(stream);
          for (const s of shots) s?.stop(fade);
        },
      };
      streams.add(stream);
      setTimeout(() => streams.delete(stream), (seconds + 5) * 1000);
      return stream;
    },

    /** The air-raid siren: starts (or swells back up, if it was winding down) and loops until sirenOff. */
    sirenOn() {
      if (!buffers.siren || !live()) return;
      const now = ctx.currentTime;
      if (siren && siren.stopAt == null) return; // already wailing
      if (siren) {
        // Winding down: bring the same siren back up, no restart.
        smoothFade(siren.gain.gain, 1, cfg.sirenFadeIn);
        clearTimeout(siren.timer);
        siren.stopAt = null;
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffers.siren[0].buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      smoothFade(gain.gain, 1, cfg.sirenFadeIn);
      src.connect(gain).connect(bus.siren);
      src.start(now);
      siren = { src, gain, stopAt: null, timer: 0 };
    },

    /** Wind the siren down over `fade` seconds (default: cfg.sirenFadeOut), then stop it. */
    sirenOff(fade = cfg.sirenFadeOut) {
      if (!siren || siren.stopAt != null) return;
      const s = siren;
      s.stopAt = smoothFade(s.gain.gain, 0, fade);
      halt(s.src, s.stopAt + 0.05);
      s.timer = setTimeout(() => {
        if (siren === s) siren = null;
        s.gain.disconnect();
      }, (fade + 0.2) * 1000);
    },

    /** The attack is over: release everything still sounding (explosions keep their tails). */
    endAttack({ sirenFade = cfg.sirenFadeOut, gunFade = 0.25, whooshFade = 0.5 } = {}) {
      this.sirenOff(sirenFade);
      for (const s of [...streams]) s.stop(gunFade);
      for (const w of [...whooshes]) {
        whooshes.delete(w);
        w.stop(whooshFade);
      }
    },

    /** Category mix and the game's SFX volume, applied smoothly. */
    setVolume(key, value) {
      cfg[key] = value;
      if (bus[key]) bus[key].gain.setTargetAtTime(value, ctx.currentTime, 0.05);
    },
    syncMaster() {
      if (master) master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.05);
    },
    /** Every file decoded (until then, callers can fall back to the synthesised sounds). */
    get ready() {
      return Object.keys(POOLS).every((k) => buffers[k]) && live();
    },
    get sirenActive() {
      return !!siren && siren.stopAt == null;
    },
  };
}
