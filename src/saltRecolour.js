/**
 * The pixel work behind matchSaltToSand (models.js), shared by the background worker (saltWorker.js) and the
 * main-thread fallback. Salty pixels are pale and unsaturated; the sand reference is the clearly tan pixels.
 * When salt covers more than 2% of the ground, salty pixels take the sand colour. Their own brightness only
 * shades it a little (the crack pattern stays as slightly darker sand) and never lifts it above the sand, and the
 * salt area is grown by a few pixels so its pale rim (half salt, half sand) is covered too: no white line is left.
 * `px` is RGBA bytes of a `width`-pixel-wide image, changed in place.
 * Returns the sand colour (sRGB 0-1, null when there is no sand) and the salty share of the ground.
 */
const GROW = 3; // pixels the salt area is grown by, to cover its rim

export function recolourSalt(px, width) {
  const smooth = (a, b, v) => Math.min(1, Math.max(0, (v - a) / (b - a)));
  const count = px.length / 4;
  let weight = new Float32Array(count);
  const sand = [0, 0, 0];
  let sandN = 0;
  let saltLum = 0;
  let saltW = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const max = Math.max(r, g, b);
    const sat = max > 0 ? (max - Math.min(r, g, b)) / max : 0;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Pale and greyish, including the half-salt pixels along the salt's edge.
    const w = (1 - smooth(0.12, 0.32, sat)) * smooth(0.2, 0.4, lum);
    weight[j] = w;
    if (w > 0.5) {
      saltLum += lum;
      saltW++;
    } else if (sat > 0.3) {
      sand[0] += r;
      sand[1] += g;
      sand[2] += b;
      sandN++;
    }
  }
  if (!sandN) return { ref: null, share: 0 };
  const ref = sand.map((v) => v / sandN);
  const share = saltW / count;
  if (share > 0.02) {
    if (width) weight = grow(weight, width, count / width, GROW);
    const meanLum = saltLum / saltW;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const w = weight[j];
      if (w <= 0) continue;
      const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      const k = Math.min(1, Math.max(0.8, 1 + (lum / meanLum - 1) * 0.5)); // never paler than the sand
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(px[i + c] * (1 - w) + Math.min(1, ref[c] * k) * 255 * w);
    }
  }
  return { ref, share };
}

/** Each pixel takes the largest weight within `r` pixels (a square max filter, done along rows then columns). */
function grow(weight, w, h, r) {
  const tmp = new Float32Array(weight.length);
  const out = new Float32Array(weight.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dx = Math.max(0, x - r); dx <= Math.min(w - 1, x + r); dx++) if (weight[row + dx] > m) m = weight[row + dx];
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      for (let dy = Math.max(0, y - r); dy <= Math.min(h - 1, y + r); dy++) if (tmp[dy * w + x] > m) m = tmp[dy * w + x];
      out[y * w + x] = m;
    }
  }
  return out;
}
