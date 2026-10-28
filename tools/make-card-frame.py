"""Build the tall card frame used by the game (public/cards/CardBaseTall.png) from the frame art.

Cards are 1.82 x as tall as they are wide; the art (CardBase.png) is 1.434 x. The top band (gauges,
screen, 3x3 tiles) and the bottom cable strip are kept as they are. The gap is filled with copies of a
plain band of the centre panel (62-72% down the art: brass pipes on the sides), cross-faded into each
other so there are no hard joins. Baking it into one image (instead of CSS border-image slices) avoids
the hairline seams browsers draw where slices meet.

It also writes public/cards/CardSpecMask.png: where the hand cards' moving sheen may catch light. It follows
the frame's own brightness (bright metal shines, dark rust and grime do not), broken up by grain and blotches,
so the highlight reads as rough, old metal rather than polished chrome.

Usage:  python tools/make-card-frame.py [path/to/CardBase.png]
Needs Pillow and numpy. Writes public/cards/CardBase.png (560 px wide), CardBaseTall.png and CardSpecMask.png.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

WIDTH = 560  # sharp at the largest card size (205 px shop card) on 2x screens
RATIO = 1.82  # card height / width, must match .card in src/ui.css
BAND = (0.62, 0.72)  # plain band of the art to repeat, as fractions of its height
OVERLAP = 8  # rows cross-faded between band copies
INNER = (0.13, 0.87)  # panel inside (inside its bevel lines), as fractions of the width
INNER_FROM = 0.34  # top of the unique panel piece used for the inside, as a fraction of the art height
FEATHER_X, FEATHER_Y = 14, 22  # px of soft edge around that piece

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = os.path.join(root, 'public', 'cards')
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(out_dir, 'CardBase.png')

art = Image.open(src).convert('RGBA')
if art.width != WIDTH:
    art = art.resize((WIDTH, round(art.height * WIDTH / art.width)), Image.LANCZOS)
    art.save(os.path.join(out_dir, 'CardBase.png'), optimize=True)

H = art.height
a, b = round(BAND[0] * H), round(BAND[1] * H)
top, band, bottom = art.crop((0, 0, WIDTH, a)), art.crop((0, a, WIDTH, b)), art.crop((0, b, WIDTH, H))
target = round(WIDTH * RATIO)
fill = target - top.height - bottom.height

# Fewest copies that cover the gap; the overlap is then spread so the strip is exactly `fill` tall.
n = max(1, -(-(fill - OVERLAP) // (band.height - OVERLAP)))
step = (fill - band.height) / (n - 1) if n > 1 else 0
strip = Image.new('RGBA', (WIDTH, fill))
for i in range(n):
    y = round(i * step)
    copy = band.copy()
    if i > 0:
        # Fade this copy in over the rows it shares with the one above.
        shared = round((i - 1) * step) + band.height - y
        mask = Image.new('L', band.size, 255)
        for r in range(max(0, shared)):
            mask.paste(round(255 * (r + 1) / (shared + 1)), (0, r, WIDTH, r + 1))
        strip.paste(copy, (0, y), mask)
    else:
        strip.paste(copy, (0, y))

# Repeated copies show as a pattern in the panel, so the panel's inside comes from one tall unique piece
# of plain panel (mirrored, so it does not look like a copy of the panel right above it), feathered in.
# The side rails and the panel's bevel lines keep the repeated band: they are uniform, so it does not show.
x0, x1 = round(INNER[0] * WIDTH), round(INNER[1] * WIDTH)
r0 = round(INNER_FROM * H)
inner = art.crop((x0, r0, x1, r0 + fill)).transpose(Image.FLIP_LEFT_RIGHT)
mask = Image.new('L', inner.size, 0)
px = mask.load()
for y in range(inner.height):
    fy = min(1, (y + 1) / FEATHER_Y, (inner.height - y) / FEATHER_Y)
    for x in range(inner.width):
        fx = min(1, (x + 1) / FEATHER_X, (inner.width - x) / FEATHER_X)
        px[x, y] = round(255 * fx * fy)
strip.paste(inner, (x0, 0), Image.composite(inner, Image.new('RGBA', inner.size), mask).getchannel('A'))

tall = Image.new('RGBA', (WIDTH, target))
tall.paste(top, (0, 0))
tall.paste(strip, (0, top.height))
tall.paste(bottom, (0, top.height + fill))
tall.save(os.path.join(out_dir, 'CardBaseTall.png'), optimize=True)
print(f'CardBaseTall.png {WIDTH}x{target}: {n} band copies of {band.height}px in {fill}px')

# ---- sheen mask -----------------------------------------------------------------------------------------
SPEC_WIDTH = 400  # enough grain detail at hand-card size on 2x screens
rng = np.random.default_rng(7)  # fixed seed: the same mask every run
spec_src = tall.resize((SPEC_WIDTH, round(tall.height * SPEC_WIDTH / WIDTH)), Image.LANCZOS)
lum = np.asarray(spec_src.convert('L'), dtype=np.float32) / 255
alpha = np.asarray(spec_src.getchannel('A'), dtype=np.float32) / 255
lo, hi = np.percentile(lum[alpha > 0.5], [25, 92])
metal = np.clip((lum - lo) / (hi - lo), 0, 1) ** 1.6  # only the brighter metal catches the light


def noise(blur):
    """Random field softened by `blur` px, rescaled to 0-1."""
    img = Image.fromarray((rng.random(lum.shape) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img, dtype=np.float32)
    return (a - a.min()) / max(1e-6, a.max() - a.min())


blotch = np.clip((noise(10) - 0.3) * 1.8, 0, 1)  # patches of worn, duller metal
grain = noise(0.7)  # fine scratchy grain
spec = metal * (0.25 + 0.75 * blotch) * (0.45 + 0.55 * grain) * alpha
out = np.zeros(lum.shape + (4,), dtype=np.uint8)
out[..., :3] = 255
out[..., 3] = np.clip(spec * 255, 0, 255).astype(np.uint8)
Image.fromarray(out, 'RGBA').save(os.path.join(out_dir, 'CardSpecMask.png'), optimize=True)
print(f'CardSpecMask.png {out.shape[1]}x{out.shape[0]}, mean coverage {spec.mean():.2f}')
