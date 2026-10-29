/**
 * The pixel work behind matchSaltToSand (models.js), shared by the background worker (saltWorker.js) and the
 * main-thread fallback. Salty pixels are pale and unsaturated; the sand reference is the clearly tan pixels.
 * When salt covers more than 2% of the ground, salty pixels take the sand colour, scaled by their own
 * brightness so the crack pattern stays as darker sand. `px` is RGBA bytes, changed in place.
 * Returns the sand colour (sRGB 0-1, null when there is no sand) and the salty share of the ground.
 */
export function recolourSalt(px) {
  const smooth = (a, b, v) => Math.min(1, Math.max(0, (v - a) / (b - a)));
  const weight = new Float32Array(px.length / 4);
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
    const w = (1 - smooth(0.1, 0.22, sat)) * smooth(0.25, 0.45, lum);
    weight[j] = w;
    if (w > 0.5) {
      saltLum += lum;
      saltW++;
    } else if (sat > 0.25) {
      sand[0] += r;
      sand[1] += g;
      sand[2] += b;
      sandN++;
    }
  }
  if (!sandN) return { ref: null, share: 0 };
  const ref = sand.map((v) => v / sandN);
  const share = saltW / weight.length;
  if (share > 0.02) {
    const meanLum = saltLum / saltW;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const w = weight[j];
      if (w <= 0) continue;
      const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      const k = lum / meanLum;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(px[i + c] * (1 - w) + Math.min(1, ref[c] * k) * 255 * w);
    }
  }
  return { ref, share };
}
