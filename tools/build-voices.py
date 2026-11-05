"""
Renders the characters' spoken gibberish (public/audio/voice/*.mp3), played by src/sfx.js while dialogue lines show.

The characters speak an invented language, Vashk: no meaning, but consistent rules, so it passes for a real tongue:
- a fixed sound inventory (rolled r, kh, sh, zh, no umlauts) with a desert / steppe flavour;
- syllables mostly CV and CVC, onset clusters like kr, zv, shk; stress always on the second-to-last syllable;
- light vowel harmony (a word leans to a o u or to e i);
- a fixed lexicon drawn with Zipf frequencies, so short function words keep recurring; questions end in the particle "ka";
- a few recurring names (Ozhrak, Vashkar) the attentive player will start to recognise.

It is spoken by neural TTS voices (Piper) fed raw phonemes, so the prosody is a real human voice's. The voices come
from other languages on purpose (all CC0), so the accent can't be placed: picked by ear and by checking that Whisper's
language ID either spreads its guess over several languages or hears a real language and transcribes it as one:
- the Overlord: fa_IR reza_ibrahim (deepest, slowest); the Rebel Leader: fa_IR amir;
- the Bandit Leader: ru_RU denis; the Smuggler: ru_RU dmitri; the Aide: sk_SK lili.
Then each character gets their own pitch and, for the four masked men, a gas-mask treatment (cavity resonance, muffling,
a little grit, an exhale through the valve). See CREDITS.md next to the output.

Every character gets clips of several lengths; sfx.js picks one to fit the line.

Setup (once):
  /opt/homebrew/bin/python3.12 -m venv /tmp/piperenv && /tmp/piperenv/bin/pip install piper-tts numpy scipy
  voices into /tmp/sfxwork/voices (or VOICES=dir) from https://huggingface.co/rhasspy/piper-voices :
    fa_IR-reza_ibrahim-medium, fa_IR-amir-medium, ru_RU-denis-medium, ru_RU-dmitri-medium, sk_SK-lili-medium
    (.onnx + .onnx.json each)
Run:
  /tmp/piperenv/bin/python tools/build-voices.py [speaker ...]
Needs ffmpeg (mp3 encoding).
"""
import json, os, subprocess, sys, tempfile, wave
import numpy as np
from scipy import signal
from piper import PiperVoice, SynthesisConfig

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public/audio/voice')
VOICES = os.environ.get('VOICES', '/tmp/sfxwork/voices')
SR = 22050
rng = np.random.default_rng(1913)

# ============================================================ the language ============================================================
# Abstract phonemes, mapped to each voice's IPA below.
CONS = ['p', 't', 'k', 'b', 'd', 'g', 'm', 'n', 'l', 'r', 'v', 'z', 's', 'sh', 'zh', 'kh', 'ts', 'j', 'h']
CONS_W = [4, 8, 9, 5, 7, 4, 6, 8, 6, 9, 6, 4, 6, 5, 2, 4, 2, 2, 2]
CLUSTERS = ['kr', 'dr', 'tr', 'vr', 'zv', 'shk', 'st', 'gl', 'br', 'skh', 'gr', 'zd']
CODAS = ['n', 'm', 'k', 'r', 'sh', 't', 'l', 's', 'kh']
CODA_W = [8, 4, 6, 7, 4, 4, 3, 3, 3]
BACK, FRONT = ['a', 'o', 'u'], ['e', 'i']

# Function words: short, very frequent (as in every real language).
FUNCTION = ['da', 'vo', 'esh', 'ni', 'tu', 'za', 'om', 'ar', 'ke', 'mo', 'il']  # (ka is only the question particle)
NAMES = ['ozhrak', 'vashkar']


def pick(items, weights=None):
    if weights is None:
        return items[rng.integers(len(items))]
    w = np.array(weights, float)
    return items[rng.choice(len(items), p=w / w.sum())]


def syllable(vowels, first):
    r = rng.random()
    if first and r < 0.07:
        onset = ''
    elif r < 0.22:
        onset = pick(CLUSTERS)
    else:
        onset = pick(CONS, CONS_W)
    v = pick(vowels)
    coda = pick(CODAS, CODA_W) if rng.random() < 0.38 else ''
    return [onset, v, coda]


def make_word():
    n = pick([1, 2, 3, 4], [2, 9, 6, 1])
    vowels = BACK if rng.random() < 0.6 else FRONT
    if rng.random() < 0.2:
        vowels = BACK + FRONT  # not every word obeys harmony
    return [syllable(vowels, i == 0) for i in range(n)]


def flat(word):
    return ''.join(''.join(s) for s in word)


def parse(text):
    """'ozhrak' -> syllables, splitting greedily on vowels (only for the fixed names and function words)."""
    out, cur = [], ['', '', '']
    i = 0
    digraphs = ('sh', 'zh', 'kh', 'ts')
    while i < len(text):
        ch = text[i : i + 2] if text[i : i + 2] in digraphs else text[i]
        i += len(ch)
        if ch in 'aeiou':
            if cur[1]:
                out.append(cur)
                cur = ['', '', '']
            cur[1] = ch
        elif cur[1]:
            # A consonant after the vowel: coda if another consonant or the end follows, else next onset.
            nxt = text[i : i + 1]
            if nxt and nxt not in 'aeiou':
                cur[2] += ch
            elif not nxt:
                cur[2] += ch
            else:
                out.append(cur)
                cur = [ch, '', '']
        else:
            cur[0] += ch
    out.append(cur)
    return out


LEXICON = [parse(w) for w in FUNCTION] + [parse(w) for w in NAMES]
seen = set(FUNCTION + NAMES)
while len(LEXICON) < 260:
    w = make_word()
    f = flat(w)
    if f not in seen and 2 <= len(f) <= 11:
        seen.add(f)
        LEXICON.append(w)
# Zipf: rank r drawn with weight 1 / r^0.78 (the commonest word is under 10% of speech, as in real languages).
ZIPF = 1 / np.arange(1, len(LEXICON) + 1) ** 0.78
ZIPF /= ZIPF.sum()


def sentence(kind, n_words):
    words = [LEXICON[rng.choice(len(LEXICON), p=ZIPF)] for _ in range(n_words)]
    # No word twice in a row.
    for i in range(1, len(words)):
        while flat(words[i]) == flat(words[i - 1]):
            words[i] = LEXICON[rng.choice(len(LEXICON), p=ZIPF)]
    if kind == '?':
        words.append(parse('ka'))
    commas = set()
    if n_words >= 6 and rng.random() < 0.7:
        commas.add(int(rng.integers(2, n_words - 2)))
    return words, commas, kind


# ---------- to each voice's IPA ----------
STRESS = 'ˈ'


def to_ipa(words, commas, end, table):
    parts = []
    for wi, w in enumerate(words):
        n = len(w)
        stress_at = max(0, n - 2) if n > 1 else 0
        out = ''
        for si, (on, v, co) in enumerate(w):
            stressed = si == stress_at and n > 1 or (n == 1 and len(flat(w)) > 2)
            o = ''.join(table['c'].get(c, c) for c in split_cons(on))
            # A lone r between vowels is a tap; at the start of a word or in a cluster, a trill.
            if on == 'r' and si > 0:
                o = table['tap']
            vv = table['v_long' if stressed else 'v'][v]
            c = ''.join(table['c'].get(x, x) for x in split_cons(co))
            out += (STRESS if stressed else '') + o + vv + c
        parts.append(out)
        if wi in commas:
            parts[-1] += ','
    return ' '.join(parts) + end


def split_cons(s):
    out, i = [], 0
    while i < len(s):
        if s[i : i + 2] in ('sh', 'zh', 'kh', 'ts'):
            out.append(s[i : i + 2])
            i += 2
        else:
            out.append(s[i])
            i += 1
    return out


# Each abstract sound -> the IPA candidates in order of preference; a voice uses the first one it has learned (the
# phones its own language uses, found by phonemizing a native sample, NATIVE below).
PREFER = {
    'p': ['p'], 't': ['t'], 'k': ['k'], 'b': ['b'], 'd': ['d'], 'g': ['ɡ', 'g'], 'm': ['m'], 'n': ['n'],
    'l': ['l', 'ɫ', 'ɭ'], 'r': ['r', 'ɾ', 'ɹ'], 'tap': ['ɾ', 'r', 'ɹ'], 'v': ['v', 'w'], 'z': ['z', 's'], 's': ['s'],
    'sh': ['ʃ', 'ʂ', 'ɕ'], 'zh': ['ʒ', 'ʐ', 'ʑ', 'ʃ'], 'kh': ['x', 'χ', 'h'], 'ts': ['ts'], 'j': ['j'], 'h': ['h', 'x'],
    'a': ['a', 'ɑ', 'ɐ'], 'e': ['e', 'ɛ'], 'i': ['i', 'ɪ'], 'o': ['o', 'ɔ'], 'u': ['u', 'ʊ'],
}
NATIVE = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'voice-native.json')))


def table_for(model):
    v = voice(model)
    lang = v.config.espeak_voice.split('-')[0]
    phones = set(x for s in v.phonemize(NATIVE[lang]) for x in s)
    choose = lambda k: next((c for c in PREFER[k] if all(ch in phones for ch in c)), PREFER[k][0])
    long = 'ː' in phones
    cons = {k: choose(k) for k in PREFER if k not in ('a', 'e', 'i', 'o', 'u', 'tap')}
    vow = {k: choose(k) for k in 'aeiou'}
    return {
        'c': cons,
        'tap': choose('tap'),
        'v': vow,
        'v_long': {k: (x + 'ː' if long and len(x) == 1 else x) for k, x in vow.items()},
    }


# ============================================================ DSP ============================================================
def lp(x, f, o=2):
    return signal.sosfilt(signal.butter(o, f, 'lp', fs=SR, output='sos'), x)


def hp(x, f, o=2):
    return signal.sosfilt(signal.butter(o, f, 'hp', fs=SR, output='sos'), x)


def bp(x, lo, hi, o=2):
    return signal.sosfilt(signal.butter(o, [lo, hi], 'bp', fs=SR, output='sos'), x)


def peak(x, f, gain_db, q=1.2):
    """RBJ peaking EQ."""
    a = 10 ** (gain_db / 40)
    w = 2 * np.pi * f / SR
    al = np.sin(w) / (2 * q)
    b = [1 + al * a, -2 * np.cos(w), 1 - al * a]
    d = [1 + al / a, -2 * np.cos(w), 1 - al / a]
    return signal.lfilter(b, d, x)


def comb(x, delay_ms, fb):
    """Feedback comb: the short cavity inside a mask or helmet."""
    d = max(1, int(SR * delay_ms / 1000))
    den = np.zeros(d + 1)
    den[0], den[d] = 1, -fb
    return signal.lfilter([1 - fb], den, x)


def norm(x):
    return x / (np.abs(x).max() + 1e-9)


def env(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na:
        e[:na] = np.linspace(0, 1, na)
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def make_ir(length, decay, hi):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-6.9 * t / decay)
    ir = lp(ir, hi)
    ir = np.concatenate([np.zeros(int(0.012 * SR)), ir])
    return ir / np.sqrt(np.sum(ir ** 2))


IR_HALL = make_ir(2.2, 1.6, 3000)
IR_ROOM = make_ir(0.5, 0.3, 4500)


def verb(x, ir, wet):
    y = np.concatenate([x, np.zeros(len(ir))])
    w = signal.fftconvolve(y, ir)[: len(y)]
    w *= np.abs(x).max() / (np.abs(w).max() + 1e-9)
    return y + wet * w


def exhale(dur=0.42, level=0.18):
    """Breath out through a mask valve: the flap ticks open, air rushes through the filter."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    air = bp(rng.normal(0, 1, n), 500, 2600) * np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5
    tick = np.zeros(n)
    k = int(0.006 * SR)
    tick[:k] = rng.normal(0, 1, k) * np.linspace(1, 0, k)
    tick = bp(tick, 300, 1500) * 0.6
    return norm(air + tick) * level


def mask(x, cfg):
    """A gas mask: the cavity rings (comb), the filter canister muffles, the rubber adds a honk, a little grit."""
    y = hp(x, cfg.get('hp', 160))
    y = comb(y, cfg['cavity_ms'], cfg['cavity_fb'])
    y = peak(y, cfg.get('honk', 1100), cfg.get('honk_db', 6), 1.4)
    y = lp(y, cfg['muffle'], 4)
    y = np.tanh(norm(y) * cfg.get('grit', 1.5))
    return norm(y)


def pitch_resample(x, ratio):
    """Lower (ratio < 1) or raise the pitch by playing the audio slower / faster (the formants move with it)."""
    if abs(ratio - 1) < 1e-3:
        return x
    from fractions import Fraction

    fr = Fraction(1 / ratio).limit_denominator(60)
    return signal.resample_poly(x, fr.numerator, fr.denominator)


# ============================================================ the characters ============================================================
_voices = {}


def voice(name):
    if name not in _voices:
        _voices[name] = PiperVoice.load(os.path.join(VOICES, name + '.onnx'))
    return _voices[name]


CHARACTERS = {
    # The Overlord: the deepest, slowest voice. A sealed respirator under an officer's cap, red lenses.
    'overlord': dict(model='fa_IR-reza_ibrahim-medium', speaker=None, wps=1.5, length=1.0, pitch=0.92, noise=0.55,
                     kinds=['.', '.', '.', '!'], words=(4, 11),
                     mask=dict(cavity_ms=0.85, cavity_fb=0.42, muffle=3300, honk=950, honk_db=7, grit=1.6, hp=110),
                     ir=IR_HALL, wet=0.22, breath=0.16),
    # Rebel Leader: a wide, agitated voice, a round canister mask, more muffled.
    'rebel': dict(model='fa_IR-amir-medium', speaker=None, wps=2.2, length=0.95, pitch=0.95, noise=0.7,
                  kinds=['!', '.', '?', '!'], words=(3, 9),
                  mask=dict(cavity_ms=1.25, cavity_fb=0.38, muffle=2500, honk=800, honk_db=7, grit=2.0),
                  ir=IR_ROOM, wet=0.12, breath=0.2),
    # Bandit Leader: a riveted metal face plate that rings.
    'bandit': dict(model='ru_RU-denis-medium', speaker=None, wps=2.3, length=0.95, pitch=0.97, noise=0.7,
                   kinds=['.', '!', '?', '.'], words=(3, 9),
                   mask=dict(cavity_ms=0.6, cavity_fb=0.55, muffle=3800, honk=1500, honk_db=5, grit=2.2),
                   ir=IR_ROOM, wet=0.15, breath=0.14),
    # The Smuggler: quick and light, a half mask over nose and mouth.
    'smuggler': dict(model='ru_RU-dmitri-medium', speaker=None, wps=2.6, length=0.95, pitch=1.0, noise=0.65,
                     kinds=['?', '.', '.', '!', '?'], words=(3, 10),
                     mask=dict(cavity_ms=1.0, cavity_fb=0.25, muffle=4300, honk=1200, honk_db=4, grit=1.4),
                     ir=IR_ROOM, wet=0.1, breath=0.1),
    # The Aide (field reports): crisp, clear, no mask.
    'aide': dict(model='sk_SK-lili-medium', speaker=None, wps=2.4, length=0.95, pitch=1.0, noise=0.6,
                 kinds=['.', '.', '.', '!'], words=(4, 10), mask=None, ir=IR_ROOM, wet=0.08, breath=0),
}

# Speech lengths (s) each character gets, two takes each. sfx.js picks the one that fits the line, and the text types
# out over the speech (the manifest records each clip's speech length).
TARGETS = [0.8, 1.1, 1.4, 1.8, 2.2, 2.7, 3.2, 3.8, 4.5, 5.5]
TAKES = 2
TOL = 0.12


def synth(cfg, ipa):
    v = voice(cfg['model'])
    sc = SynthesisConfig(speaker_id=cfg['speaker'], length_scale=cfg['length'] * cfg['pitch'], noise_scale=cfg['noise'], noise_w_scale=0.8)
    chunks = [c.audio_float_array for c in v.synthesize(f'[[ {ipa} ]]', sc)]
    x = np.concatenate(chunks) if chunks else np.zeros(1)
    return pitch_resample(x.astype(float), cfg['pitch'])


def trim(x, thresh=0.02):
    a = np.abs(x)
    idx = np.nonzero(a > a.max() * thresh)[0]
    if not len(idx):
        return x
    return x[max(0, idx[0] - int(0.01 * SR)) : idx[-1] + int(0.04 * SR)]


def utterance(cfg, target):
    """Sentences until about `target` seconds of speech."""
    if 'table' not in cfg:
        cfg['table'] = table_for(cfg['model'])
    out = []
    total = 0.0
    while total < target * 0.75:
        left = target - total
        nw = int(np.clip(round(left * cfg['wps']), cfg['words'][0] if left > 2.5 else 1, cfg['words'][1]))
        words, commas, kind = sentence(pick(cfg['kinds']), nw)
        x = trim(synth(cfg, to_ipa(words, commas, kind, cfg['table'])))
        if out:
            gap = np.zeros(int(rng.uniform(0.22, 0.4) * SR))
            out.append(gap)
            total += len(gap) / SR
        out.append(x)
        total += len(x) / SR
    return np.concatenate(out)


def finish(cfg, x):
    x = norm(x)
    if cfg['mask']:
        x = mask(x, cfg['mask'])
    x = verb(x, cfg['ir'], cfg['wet'])
    if cfg['breath']:
        b = exhale()
        at = len(x) - int(0.3 * SR)
        x = np.concatenate([x, np.zeros(max(0, at + len(b) - len(x)))])
        x[at : at + len(b)] += b * cfg['breath'] / 0.18 * np.abs(x).max()
    # Trim the silent tail, short fades, loudness to about -20 dBFS RMS over the voiced part, 1 dB headroom.
    a = np.abs(x)
    end = np.nonzero(a > a.max() * 0.003)[0][-1]
    x = x[: end + int(0.02 * SR)]
    x *= env(len(x), 0.004, 0.03)
    fr = int(0.05 * SR)
    rms = np.array([np.sqrt(np.mean(x[i : i + fr] ** 2)) for i in range(0, len(x) - fr, fr // 2)])
    loud = rms[rms > rms.max() * 0.15]
    x *= 10 ** (-20 / 20) / (np.sqrt(np.mean(loud ** 2)) + 1e-12)
    pk = np.abs(x).max()
    if pk > 0.89:
        x *= 0.89 / pk
    return x


def write_mp3(path, x):
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp = f.name
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-codec:a', 'libmp3lame', '-q:a', '5', path], check=True)
    os.unlink(tmp)


def main():
    only = set(sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    mpath = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {}
    for name, cfg in CHARACTERS.items():
        if only and name not in only:
            continue
        for f in os.listdir(OUT):
            if f.startswith(name + '-') and f.endswith('.mp3'):
                os.unlink(os.path.join(OUT, f))
        clips = []
        k = 0
        for target in TARGETS:
            for _ in range(TAKES):
                best = None
                # Targets are the length of the talking itself (the room and the exhale ring on after it).
                for _try in range(14):
                    x = utterance(cfg, target)
                    d = len(x) / SR
                    if best is None or abs(d - target) < abs(best[1] - target):
                        best = (x, d)
                    if abs(d - target) <= target * TOL:
                        break
                speech = best[1]
                x = finish(cfg, best[0])
                k += 1
                fname = f'{name}-{k}.mp3'
                write_mp3(os.path.join(OUT, fname), x)
                clips.append({'file': fname, 'dur': round(len(x) / SR, 2), 'speech': round(speech, 2)})
        manifest[name] = clips
        print(name, ' '.join(str(c['speech']) for c in clips))
    with open(mpath, 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
