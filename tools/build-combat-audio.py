"""
Builds public/audio/combat-test/*.wav from the Sonniss GDC originals in art/audio-src/combat-test/sonniss/.

Static gain only (no single-pass loudnorm: its dynamic mode pumps and distorts short clips). Each output is cut,
given short edge fades, resampled (long-filter swr) to 48 kHz, matched to a loudness target with one fixed gain, and kept at
least 1 dB under full scale (headroom wins over loudness). Stereo 16-bit with triangular dither.

Run: python3 tools/build-combat-audio.py
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art/audio-src/combat-test/sonniss')
OUT = os.path.join(ROOT, 'public/audio/combat-test')

def src(key):
    hits = [f for f in os.listdir(SRC) if key in f]
    if len(hits) != 1:
        sys.exit(f'source {key!r}: {hits}')
    return os.path.join(SRC, hits[0])

BZ3 = 'explosion-whooshe-003'
BZ20 = 'explosion-whooshe-020'

# name: (source, start, end, fade_in, fade_out, reverse, target LUFS)
JOBS = {
    # Large ground impacts: five different recordings.
    'explosion-large-1': ('explosion_large_08', 0.0, 3.72, 0.003, 0.4, False, -16),
    'explosion-large-2': ('explosion_large_07', 0.04, 2.57, 0.003, 0.3, False, -16),
    'explosion-large-3': ('Explosion_8', 0.02, 6.5, 0.003, 1.5, False, -16),
    'explosion-large-4': (BZ3, 2.30, 8.0, 0.01, 1.0, False, -16),
    'explosion-large-5': (BZ20, 2.68, 8.95, 0.01, 1.0, False, -16),
    # Small / intercepted / decoy: two more.
    'explosion-small-1': ('explosion_large_no_tail_03', 0.0, 1.30, 0.003, 0.25, False, -19),
    # (explosion_far_distant_02 left out: its spikes cap it 12 dB under the others once headroom is kept.)
    'explosion-small-2': ('explosion_med_long_tail_01', 0.0, 3.10, 0.003, 0.6, False, -19),
    # Incoming: four approach whooshes, each rising to its end (the impact).
    'incoming-1': (BZ3, 0.05, 2.30, 0.4, 0.02, False, -21),
    'incoming-2': (BZ20, 0.0, 2.68, 0.5, 0.02, False, -21),
    'incoming-3': ('Long_Rising_Whoosh', 0.0, 1.07, 0.15, 0.02, False, -21),
    'incoming-4': ('Rocket_Launcher', 0.24, 1.70, 0.5, 0.02, True, -21),
    # Launch: the rocket launcher shot.
    'missile-launch': ('Rocket_Launcher', 0.0, 3.40, 0.003, 0.8, False, -18),
    # Gun bursts (CIWS streams chain these). Each keeps its own tail; GUN_BODY below says where the firing stops.
    'gun-burst-1': ('submachine_auto_shot', 0.0, 2.40, 0.003, 0.5, False, -18),
    'gun-burst-2': ('Metallic_Auto_Gun', 0.05, 0.95, 0.003, 0.15, False, -18),
    'gun-burst-3': ('Metallic_Auto_Gun', 0.95, 2.45, 0.003, 0.3, False, -18),
    'gun-burst-4': ('Metallic_Auto_Gun', 3.80, 5.20, 0.003, 0.3, False, -18),
    'gun-burst-5': ('Metallic_Auto_Gun', 5.22, 6.13, 0.003, 0.2, False, -18),
    'gun-burst-6': ('BR_AK47_Burst_With_Tail', 0.85, 5.0, 0.003, 1.5, False, -18),
}

def measure(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True).stderr
    lufs = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', r)[-1])
    peak = float(re.findall(r'Peak:\s+(-?[\d.inf]+) dBFS', r)[-1])
    return lufs, peak

def main():
    os.makedirs(OUT, exist_ok=True)
    report = {}
    for name, (key, a, b, fi, fo, rev, target) in JOBS.items():
        dur = b - a
        chain = [f'atrim={a}:{b}', 'asetpts=PTS-STARTPTS']
        if rev:
            chain.append('areverse')
        chain += [f'afade=t=in:d={fi}:curve=qsin', f'afade=t=out:st={max(0, dur - fo)}:d={fo}:curve=qsin',
                  'aresample=48000:filter_size=64:phase_shift=12:cutoff=0.97']
        tmp = os.path.join(OUT, f'.{name}.tmp.wav')
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', src(key), '-af', ','.join(chain),
                        '-ac', '2', '-c:a', 'pcm_f32le', tmp], check=True)
        lufs, peak = measure(tmp)
        gain = target - lufs
        gain = min(gain, -1.0 - peak)  # never closer than 1 dB to full scale
        out = os.path.join(OUT, f'{name}.wav')
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-af', f'volume={gain:.2f}dB',
                        '-c:a', 'pcm_s16le', '-dither_method', 'triangular', out], check=True)
        os.remove(tmp)
        l2, p2 = measure(out)
        report[name] = {'lufs': round(l2, 1), 'peak': round(p2, 1), 'sec': round(dur, 2)}
        print(f'{name:20} {l2:6.1f} LUFS  peak {p2:5.1f} dBFS  {dur:5.2f}s')
    return report

if __name__ == '__main__':
    main()
