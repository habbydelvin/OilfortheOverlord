"""
Renders the game's sound effects (public/audio/sfx/*.wav), played by src/sfx.js.

For now there is one: a tile landing on the board. The rest of the game's sound hooks are silent until each gets a sound
that fits (see src/sfx.js).

Sounds are synthesised here, offline, with physical models rather than plain oscillators, so they sit with the music
(OverlordIsWatching: G minor, slow, dark, nearly all of its energy under 800 Hz) and the picture (sand, rusted iron):
metal rings as a set of inharmonic, separately decaying partials; sand is many tiny band-limited grains; everything goes
through a high cut, a little saturation and a shared reverb.

Each sound is mono 16-bit at 22.05 kHz (everything is cut above 7 kHz anyway), normalised to a loudness target (RMS,
dBFS) with at least 1 dB headroom, in several takes; sfx.js picks between them and nudges the pitch.

Needs numpy and scipy:  python3 -m venv /tmp/sfxenv && /tmp/sfxenv/bin/pip install numpy scipy
Run:                    /tmp/sfxenv/bin/python tools/build-sfx.py [name ...]
"""
import json, os, sys, wave
import numpy as np
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public/audio/sfx')
SR = 22050
rng = np.random.default_rng(7)


# ---------- basics ----------
def secs(n):
    return int(round(n * SR))


def silence(d):
    return np.zeros(secs(d))


def t_axis(d):
    return np.arange(secs(d)) / SR


def place(dst, src, at, gain=1.0):
    """Mix src into dst starting at `at` seconds (dst grows if needed)."""
    i = max(0, secs(at))
    end = i + len(src)
    if end > len(dst):
        dst = np.concatenate([dst, np.zeros(end - len(dst))])
    dst[i:end] += src * gain
    return dst


def mix(*parts):
    """parts: (signal, at, gain)."""
    out = np.zeros(1)
    for p in parts:
        sig, at, g = (p + (1.0,))[:3] if len(p) == 2 else p
        out = place(out, sig, at, g)
    return out


def env_exp(d, decay, attack=0.002):
    """Fast attack, exponential decay (`decay`: seconds to -60 dB)."""
    t = t_axis(d)
    e = np.exp(-6.9 * t / max(decay, 1e-4))
    a = secs(attack)
    if a > 1:
        e[:a] *= np.linspace(0, 1, a) ** 2
    return e


def white(d):
    return rng.uniform(-1, 1, secs(d))


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, min(f, SR * 0.45), 'lp', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'hp', fs=SR, output='sos'), x)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, min(hi, SR * 0.45)], 'bp', fs=SR, output='sos'), x)


def sat(x, drive=1.5):
    return np.tanh(x * drive) / np.tanh(drive)


def norm(x):
    return x / (np.abs(x).max() + 1e-9)


# ---------- physical-ish models ----------
def modal(d, f0, ratios, decays, amps, exc=None, jitter=0.004):
    """Sum of decaying partials at f0*ratio, each with its own decay (s to -60 dB), excited by `exc` (impulse if None)."""
    t = t_axis(d)
    y = np.zeros_like(t)
    for r, dc, a in zip(ratios, decays, amps):
        f = f0 * r * (1 + rng.uniform(-jitter, jitter))
        if f > SR * 0.45:
            continue
        ph = rng.uniform(0, 2 * np.pi)
        y += a * np.sin(2 * np.pi * f * t + ph) * np.exp(-6.9 * t / dc)
    if exc is not None:
        y = signal.fftconvolve(exc, y)[: len(t)]
    return y


def striker(hardness=0.5, d=0.006):
    """A short excitation pulse: harder = brighter, shorter."""
    n = max(4, secs(d * (1.2 - hardness)))
    e = np.hanning(n * 2)[n:] * rng.uniform(-1, 1, n) * 0.4
    e[0] += 1.0
    return lp(e, 1500 + hardness * 9000, 1)


PLATE = [1.0, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.50, 4.15, 4.6]  # thick iron plate


def metal_hit(f0, d=0.8, decay=0.5, hard=0.6, series=PLATE, bright=0.6):
    n = len(series)
    decays = [decay * (1.0 / (1 + i * 0.35)) for i in range(n)]
    amps = [(1.0 / (1 + i * (1.4 - bright))) * rng.uniform(0.6, 1.0) for i in range(n)]
    y = modal(d, f0, series, decays, amps, striker(hard))
    return norm(y)


def thump(f0=70, d=0.5, decay=0.25, drop=1.5):
    """A body hitting the ground: a falling low sine with a soft attack."""
    t = t_axis(d)
    f = f0 * (1 + drop * np.exp(-t / 0.015))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-6.9 * t / decay)
    return norm(y)


def grains(d, rate, lo, hi, dur=(0.002, 0.012), amp=(0.2, 1.0), shape=None):
    """Sand / gravel / debris: many tiny band-limited ticks. `shape(t)` scales the density over time (0..1)."""
    out = silence(d)
    tt = 0.0
    while tt < d:
        dens = shape(tt / d) if shape else 1.0
        tt += rng.exponential(1.0 / max(rate * max(dens, 0.02), 1e-3))
        if tt >= d:
            break
        if shape and rng.random() > dens:
            continue
        g = white(rng.uniform(*dur))
        g = bp(g, lo, hi) * np.hanning(len(g))
        out = place(out, g, tt, rng.uniform(*amp))
    return out[: secs(d)]


# ---------- reverb ----------
def make_ir(length, decay, lo_cut=200, hi_cut=4000, predelay=0.01, early=6):
    n = secs(length)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-6.9 * t / decay)
    # Darker as it decays: blend a low-passed copy in over time.
    dark = lp(ir, hi_cut * 0.4)
    w = np.clip(t / decay, 0, 1)
    ir = (1 - w) * lp(ir, hi_cut) + w * dark
    ir = hp(ir, lo_cut, 1)
    for i in range(early):
        k = secs(predelay + rng.uniform(0.004, 0.03))
        if k < n:
            ir[k] += rng.uniform(0.3, 0.7) * rng.choice([-1, 1]) * np.max(np.abs(ir[:200]))
    pd = secs(predelay)
    ir = np.concatenate([np.zeros(pd), ir])
    return ir / np.sqrt(np.sum(ir ** 2))


IR_YARD = make_ir(1.4, 0.9, hi_cut=4000, predelay=0.012)  # the factory yard: the board


def verb(x, ir, wet):
    tail = len(ir)
    y = np.concatenate([x, np.zeros(tail)])
    w = signal.fftconvolve(y, ir)[: len(y)]
    w = w / (np.abs(w).max() + 1e-9) * (np.abs(x).max() + 1e-9)
    return (1 - wet * 0.5) * y + wet * w


# ---------- finishing ----------
def finish(x, target_db, top=7000, low=35, ir=None, wet=0.0, drive=1.0):
    x = np.asarray(x, dtype=float)
    if ir is not None and wet > 0:
        x = verb(x, ir, wet)
    x = hp(x, low, 2)
    x = lp(x, top, 2)
    if drive > 1:
        x = sat(norm(x), drive)
    # Trim the silent tail, then fade.
    a = np.abs(x)
    thresh = a.max() * 10 ** (-60 / 20)
    idx = np.nonzero(a > thresh)[0]
    if len(idx):
        x = x[: min(len(x), idx[-1] + secs(0.02))]
    fo = min(secs(0.03), len(x) // 4)
    if fo > 1:
        x[-fo:] *= np.linspace(1, 0, fo) ** 2
    fi = secs(0.001)
    x[:fi] *= np.linspace(0, 1, fi)
    # Loudness: RMS over the loud part (the frames within 20 dB of the loudest), to the target.
    fr = secs(0.05)
    frames = [np.sqrt(np.mean(x[i : i + fr] ** 2)) for i in range(0, max(1, len(x) - fr), fr // 2)] or [np.sqrt(np.mean(x ** 2))]
    frames = np.array(frames)
    loud = frames[frames > frames.max() * 0.1]
    rms = np.sqrt(np.mean(loud ** 2)) if len(loud) else frames.max()
    x = x * (10 ** (target_db / 20) / (rms + 1e-12))
    peak = np.abs(x).max()
    ceiling = 10 ** (-1 / 20)
    if peak > ceiling:
        x *= ceiling / peak
    return x


def write(name, x):
    os.makedirs(OUT, exist_ok=True)
    dither = (rng.random(len(x)) - rng.random(len(x))) / 32768
    pcm = np.clip(np.round((x + dither) * 32767), -32768, 32767).astype('<i2')
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# Loudness target (RMS dBFS of the loud part). The music sits around -17.
BOARD = -22


# ============================================================ the sounds ============================================================
def s_thud(heavy=False):
    """A tile dropped onto the sand: a weighty thump and a soft puff, then a short, smooth hush of settling sand.
    (No crackling grains and only a touch of room: in the tail they sounded like creaking boards.)"""
    f = rng.uniform(55, 62) if heavy else rng.uniform(75, 90)
    body = thump(f, 0.5, 0.3 if heavy else 0.2, 1.2)
    puff = lp(white(0.2), 500) * env_exp(0.2, 0.15) * 0.5
    d = 0.3 if heavy else 0.22
    hush = lp(hp(white(d), 250), 1200 if heavy else 1500) * env_exp(d, d * 0.8, 0.006) * 0.12
    return finish(mix((body, 0), (puff, 0), (hush, 0.005)), BOARD + (2 if heavy else 0), top=4000, ir=IR_YARD, wet=0.04)


# name: (builder, takes)
SOUNDS = {
    'thud': (lambda: s_thud(False), 4),
    'thud-heavy': (lambda: s_thud(True), 3),
}


def main():
    only = set(sys.argv[1:])
    manifest = {}
    for name, (fn, n) in SOUNDS.items():
        if only and name not in only:
            manifest[name] = n
            continue
        for i in range(n):
            x = fn()
            write(f'{name}-{i + 1}', x)
        manifest[name] = n
        print(f'{name}: {n} × ~{len(x) / SR:.2f}s')
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=0)


if __name__ == '__main__':
    main()
