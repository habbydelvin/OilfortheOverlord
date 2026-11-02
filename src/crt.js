/**
 * The old CRT monitor the world is seen through: layers over the 3D view and its in-world HTML (building icons,
 * payout numbers, ruin buttons), under the HUD (top plates, side panel, left column, cards). A fine RGB aperture
 * grille, faint scanlines, extra contrast (the scene keeps its colours), darker edges, a glass glare and a black
 * bezel shaped like a picture tube (rounded corners, bulging sides); and, for our vibe, dirt: grime and dust,
 * greasy smears, flickering noise and a slow rolling band.
 *
 * Pure HTML/CSS (styles in ui.css, #crt): it costs the 3D renderer nothing and never takes a click.
 * The dirt and noise textures are drawn once here, on canvases.
 */

const rand = (a, b) => a + Math.random() * (b - a);

/** Grime and dust (multiplied over the picture: darker spots, never lighter). */
function grimeTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const blob = (x, y, r, rgba) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  // Grime gathers in the corners and along the edges.
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) blob(x, y, rand(0.3, 0.45) * w, `rgba(44, 42, 26, ${rand(0.4, 0.55)})`);
  for (let i = 0; i < 16; i++) blob(rand(0, w), Math.random() < 0.5 ? rand(0, 0.1 * h) : rand(0.9 * h, h), rand(60, 200), `rgba(58, 56, 34, ${rand(0.15, 0.3)})`);
  for (let i = 0; i < 12; i++) blob(Math.random() < 0.5 ? rand(0, 0.08 * w) : rand(0.92 * w, w), rand(0, h), rand(60, 180), `rgba(58, 56, 34, ${rand(0.15, 0.3)})`);
  // Mottled olive-brown blotches (the mask in ui.css keeps them toward the rim).
  for (let i = 0; i < 40; i++) blob(rand(0, w), rand(0, h), rand(20, 160), `rgba(64, 60, 36, ${rand(0.06, 0.18)})`);
  // Faint streaks running down from the top, as if something dripped once.
  for (let i = 0; i < 5; i++) {
    const x = rand(0.05, 0.95) * w;
    const len = rand(0.15, 0.45) * h;
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, 'rgba(60, 44, 26, 0.16)');
    gr.addColorStop(1, 'rgba(60, 44, 26, 0)');
    g.fillStyle = gr;
    g.fillRect(x, 0, rand(2, 6), len);
  }
  // Dust specks.
  for (let i = 0; i < 520; i++) {
    g.fillStyle = `rgba(30, 22, 14, ${rand(0.15, 0.55)})`;
    g.beginPath();
    g.arc(rand(0, w), rand(0, h), rand(0.4, 1.6), 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Greasy smears and light dust (screened over the picture: a faint haze on the glass). */
function smearTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  // Wiped smears: long soft hazy strokes.
  for (let i = 0; i < 4; i++) {
    const x = rand(0, w);
    const y = rand(0, h);
    const gr = g.createRadialGradient(x, y, 0, x, y, rand(90, 220));
    gr.addColorStop(0, 'rgba(255, 236, 200, 0.07)');
    gr.addColorStop(1, 'rgba(255, 236, 200, 0)');
    g.save();
    g.translate(x, y);
    g.scale(1, rand(0.25, 0.5));
    g.rotate(rand(-0.6, 0.6));
    g.translate(-x, -y);
    g.fillStyle = gr;
    g.fillRect(x - 240, y - 240, 480, 480);
    g.restore();
  }
  // Light dust.
  for (let i = 0; i < 180; i++) {
    g.fillStyle = `rgba(255, 245, 225, ${rand(0.12, 0.35)})`;
    g.beginPath();
    g.arc(rand(0, w), rand(0, h), rand(0.4, 1.2), 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Grey noise around mid grey (overlaid: grain in both directions), tiled and jumped around to flicker. */
function noiseTexture(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 200;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

const url = (canvas) => `url(${canvas.toDataURL('image/png')})`;

// The screen's outline (in a 1000 × 1000 box stretched over the view): rounded corners, every side bulging out a little.
const E = 18; // inset of the corners from the frame
const B = 15; // how far the middle of each side bulges out
const C = 140; // corner rounding: almost a capsule, like a scope's glass
const SCREEN = [
  `M${C} ${E}Q500 ${E - 2 * B} ${1000 - C} ${E}Q${1000 - E} ${E} ${1000 - E} ${C}`,
  `Q${1000 - E + 2 * B} 500 ${1000 - E} ${1000 - C}Q${1000 - E} ${1000 - E} ${1000 - C} ${1000 - E}`,
  `Q500 ${1000 - E + 2 * B} ${C} ${1000 - E}Q${E} ${1000 - E} ${E} ${1000 - C}`,
  `Q${E - 2 * B} 500 ${E} ${C}Q${E} ${E} ${C} ${E}Z`,
].join('');

/** Build the CRT layers inside `el` (#crt). */
export function setupCrt(el) {
  el.innerHTML = `
    <div class="crt-tone"></div>
    <div class="crt-grille"></div>
    <div class="crt-scan"></div>
    <div class="crt-noise"></div>
    <div class="crt-roll"></div>
    <div class="crt-grime"></div>
    <div class="crt-smear"></div>
    <div class="crt-vignette"></div>
    <div class="crt-glare"></div>
    <svg class="crt-bezel" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      <defs><filter id="crt-rim" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="6"/></filter></defs>
      <path class="crt-rim" d="${SCREEN}" filter="url(#crt-rim)"/>
      <path fill-rule="evenodd" d="M-20-20H1020V1020H-20Z${SCREEN}"/>
    </svg>`;
  el.querySelector('.crt-grime').style.backgroundImage = url(grimeTexture(1280, 800));
  el.querySelector('.crt-smear').style.backgroundImage = url(smearTexture(1280, 800));
  el.querySelector('.crt-noise').style.backgroundImage = url(noiseTexture(160));
}
