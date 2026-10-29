"""
Seamless weathered-steel tile for the interface panels (public/ui/metal.webp), matched to the card frame's
plate (public/cards/CardBaseTall.png): mottled grey around the same average colour, rust patches on about a
sixth of the surface, vertical grime streaks, fine grain and light scratches. All noise is made in the
frequency domain, so it wraps around and the tile repeats without seams. Relief shading (pits, grain, flake
edges, scratches lit from the top left) gives it the cards' rough, tactile surface.

Also writes public/ui/metal-spec.webp, the matching greyscale sheen mask (as CardSpecMask.png for the cards, see
tools/make-card-frame.py): bright bare metal catches the moving glint, rust and grime stay dull, grain breaks it up.

Usage: python3 tools/make-ui-metal.py   (needs numpy and Pillow)
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

N = 512  # tile size (shown at 256 CSS px, so it stays sharp on high-density screens)
rng = np.random.default_rng(1920)
fy = np.fft.fftfreq(N)[:, None]
fx = np.fft.fftfreq(N)[None, :]


def noise(scale, sx=1.0, sy=1.0):
    """Periodic noise with features about `scale` px across, `scale * sy` px tall (sy > 1: vertical streaks), -1..1."""
    w = rng.standard_normal((N, N))
    k = np.exp(-((fx * scale * sx) ** 2 + (fy * scale * sy) ** 2) * 2.0)
    n = np.real(np.fft.ifft2(np.fft.fft2(w) * k))
    n -= n.mean()
    return n / np.abs(n).max()


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def fbm(scale, octaves=6, persistence=0.62, sx=1.0, sy=1.0):
    """Layered noise: detail at every size from `scale` px down to a few px."""
    total, amp, norm = 0.0, 1.0, 0.0
    for i in range(octaves):
        total = total + noise(scale / 2 ** i, sx, sy) * amp
        norm += amp
        amp *= persistence
    return total / norm


# Luminance: layered mottling down to pixel-sized grain, plus long vertical grime streaks.
lum = fbm(160, octaves=7) * 58
lum += noise(4, sx=1.0, sy=25) * 9
lum += rng.standard_normal((N, N)) * 4
lum += noise(1.3) * 10  # fine speckle
# Galvanised flecks: small bright and dark spots.
fl = noise(2.2)
lum += smooth(0.35, 0.6, fl) * 22 - smooth(0.35, 0.6, -fl) * 14

base = np.array([86.0, 83.0, 78.0])  # the card plate's grey
img = base[None, None, :] + lum[:, :, None]

# Flaking: sharp-edged plateaus, a step lighter, with a dark rim where the coating broke.
fk = fbm(120, octaves=5)
plate = smooth(0.1, 0.13, fk)
img += (plate * 9)[:, :, None]
edge = smooth(0.0, 0.012, 0.012 - np.abs(fk - 0.115)) * smooth(0.0, 0.3, noise(60))  # broken, not continuous
img *= (1 - edge * 0.3)[:, :, None]

# Rust: washes with ragged edges, darker cores, and thin drips running down from them.
r = fbm(110, octaves=6)
rust = smooth(0.14, 0.28, r) * 0.8
# Long vertical runs, strongest under the washes and fading out in places.
runs = smooth(0.2, 0.55, noise(4, sx=1.0, sy=40)) * smooth(-0.15, 0.15, fbm(120, octaves=3, sx=1.0, sy=2.5))
rust = np.clip(rust + runs * 0.85, 0, 1)
core = smooth(0.3, 0.45, r)
rust_col = np.array([108.0, 80.0, 60.0]) + (fbm(20, octaves=3) * 18)[:, :, None]
core_col = np.array([68.0, 50.0, 38.0])
img = img * (1 - rust[:, :, None]) + rust_col * rust[:, :, None]
img = img * (1 - core[:, :, None] * 0.6) + core_col * core[:, :, None] * 0.6

# Grime: soft dark blotches.
grime = smooth(0.15, 0.5, fbm(90, octaves=3))
img *= (1 - grime * 0.18)[:, :, None]

# Relief: a height map of pits, grain and flake edges, shaded with light from the top left (wraps around).
height = fbm(10, octaves=4) * 0.7 + noise(1.6) * 0.5
height -= smooth(0.3, 0.6, noise(2.0)) * 0.9  # pits
height += plate * 0.8  # the intact coating stands a little proud of the bare metal
height -= rust * 0.3


def relief(h):
    return (np.roll(h, 1, (0, 1)) - np.roll(h, -1, (0, 1))) * 0.5  # brighter where the surface faces the light


img *= (1 + np.clip(relief(height), -1, 1) * 0.55)[:, :, None]

out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')

# Scratches: short thin light and dark lines, drawn with wrap-around so the tile stays seamless.
layer = Image.new('RGBA', (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(layer)
for _ in range(150):
    x, y = rng.uniform(0, N, 2)
    ang = rng.normal(-0.5, 0.6)
    length = rng.uniform(8, 46)
    x2, y2 = x + np.cos(ang) * length, y + np.sin(ang) * length
    light = rng.random() < 0.65
    col = (215, 210, 200, int(rng.uniform(35, 80))) if light else (20, 16, 12, int(rng.uniform(40, 90)))
    for ox in (-N, 0, N):
        for oy in (-N, 0, N):
            d.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=col, width=1)
            if light:  # a dark lip under each bright scratch: a groove, not a painted line
                d.line([(x + ox + 1, y + oy + 1), (x2 + ox + 1, y2 + oy + 1)], fill=(10, 8, 6, col[3] // 2), width=1)
layer = layer.filter(ImageFilter.GaussianBlur(0.35))
out = Image.alpha_composite(out.convert('RGBA'), layer).convert('RGB')

out.save('public/ui/metal.webp', quality=88, method=6)
a = np.asarray(out).astype(float)
print('saved public/ui/metal.webp', out.size, 'mean', a.mean((0, 1)).round(1), 'std', a.std((0, 1)).round(1))

# Sheen mask: the brighter bare metal, minus rust, in duller worn patches, broken up by fine grain.
L = a.mean(2) / 255
lo, hi = np.percentile(L, [25, 95])
metal = np.clip((L - lo) / (hi - lo), 0, 1) ** 1.5 * (1 - rust * 0.9)
blotch = np.clip((noise(40) * 0.5 + 0.5 - 0.3) * 1.8, 0, 1)
grain = noise(0.9) * 0.5 + 0.5
spec = metal * (0.3 + 0.7 * blotch) * (0.4 + 0.6 * grain)
# Greyscale (white = shines): used as a luminance mask in CSS, which keeps the file small.
Image.fromarray(np.clip(spec * 255, 0, 255).astype(np.uint8), 'L').convert('RGB').save('public/ui/metal-spec.webp', quality=85, method=6)
print('saved public/ui/metal-spec.webp, mean coverage', spec.mean().round(2))
