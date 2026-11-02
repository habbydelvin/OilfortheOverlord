/**
 * Full-screen cloud bank between the board, the globe and rival cities, drawn with the fog of war's billow
 * shape and shading, in white. cover(): billows rush in from the edges until the screen is solid white.
 * uncover(): they part outward. setPeek(0–1): a few billows at the edges (the overscroll build-up before
 * leaving a city). Procedural, no image assets; draws only while visible.
 */
const CLOUD_COLOR = '#ffffff';
const CLOUD_SHADE = 0.08; // darker variation between billows (the fog uses 0.28)
const COVER_S = 0.55;
const UNCOVER_S = 1.1;

const easeIn = (t) => t * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSRGB = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
function hexLinear(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255));
}

/**
 * One fog billow, the same look as the fog of war (fogOfWar.js BILLOW_SHADE, ported to 2D): lumpy rim, grain,
 * lit top / shaded underside, two-tone colour from the fog colour and shade, greyer when low.
 */
function billowSprite(seed, height, colA, colB) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const tone = (seed * 7.13) % 1;
  const base = colA.map((a, i) => a + (colB[i] - a) * tone);
  const low = 0.84 + 0.16 * clamp01(height / 1.5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size) * 2 - 1;
      const py = 1 - ((y + 0.5) / size) * 2; // up is +y, as in the shader
      const r = Math.hypot(px, py);
      if (r >= 1) continue;
      const a = Math.atan2(py, px);
      const rim = 0.8 + 0.12 * Math.sin(3 * a + seed * 17) + 0.08 * Math.sin(5 * a - seed * 11);
      const t = clamp01((r - 0.25 * rim) / (rim - 0.25 * rim));
      const body = 1 - t * t * (3 - 2 * t);
      if (body <= 0) continue;
      const grain = 0.82 + 0.18 * Math.sin(px * 6.5 + seed * 23) * Math.sin(py * 5.5 - seed * 13);
      const lit = smooth(-0.9, 0.6, py + 0.35 * (1 - r));
      const shadeK = (1 - 0.34 + (0.34 + 0.06) * lit) * low;
      const o = (y * size + x) * 4;
      d[o] = toSRGB(clamp01(base[0] * shadeK)) * 255;
      d[o + 1] = toSRGB(clamp01(base[1] * shadeK)) * 255;
      d[o + 2] = toSRGB(clamp01(base[2] * shadeK)) * 255;
      d[o + 3] = clamp01(body * body * grain) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function createCloudTransition(canvas) {
  const g = canvas.getContext('2d');
  // White clouds with the fog billow shading (not the fog colour).
  let sprites = [];
  let fillStyle = '#f4f6f9';
  let look = '';
  function refreshLook() {
    const key = `${CLOUD_COLOR}|${CLOUD_SHADE}`;
    if (key === look) return;
    look = key;
    const colB = hexLinear(CLOUD_COLOR);
    const colA = colB.map((v) => v * (1 - CLOUD_SHADE));
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    sprites = Array.from({ length: 10 }, () => billowSprite(rnd(), 0.45 + rnd(), colA, colB));
    // Solid colour once covered: the average billow body, mid-height.
    const mid = colA.map((a, i) => (a + colB[i]) / 2 * 0.95);
    fillStyle = `rgb(${mid.map((v) => Math.round(toSRGB(clamp01(v)) * 255)).join(',')})`;
  }
  refreshLook();
  let w = 0;
  let h = 0;
  let puffs = [];

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.width = Math.round(window.innerWidth * dpr);
    h = canvas.height = Math.round(window.innerHeight * dpr);
    // A ring of puffs around the edges plus a filled middle; each knows where it rests when the screen is covered.
    puffs = [];
    let s = 5;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const diag = Math.hypot(w, h) / 2;
    // Billows are single lobes (smaller than cumulus puffs), so more of them, in overlapping layers like the fog.
    for (let i = 0; i < 110; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * diag * 0.95;
      const x = w / 2 + Math.cos(a) * r;
      const y = h / 2 + Math.sin(a) * r;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      puffs.push({
        x,
        y,
        dx,
        dy,
        far: diag * (0.45 + rnd() * 0.3) + (diag - r) * 0.4, // how far out it waits / leaves to
        size: diag * (0.4 + rnd() * 0.35) * (0.7 + (r / diag) * 0.5),
        sprite: i,
        delay: (1 - r / diag) * 0.35, // edge puffs arrive first, the middle last
        spin: rnd() < 0.5 ? -1 : 1,
      });
    }
  }
  layout();
  window.addEventListener('resize', layout);

  let mode = 'idle'; // idle | in | full | out | peek
  let t = 0;
  let peek = 0;
  let done = null;
  let raf = 0;
  let last = 0;

  /** p: 0 = clouds out past the edges, 1 = resting (screen covered). leaving: they part outward instead. */
  function draw(p, leaving) {
    g.clearRect(0, 0, w, h);
    if (p <= 0.001) return;
    for (const c of puffs) {
      const k = leaving ? p : Math.min(1, Math.max(0, (p - c.delay) / (1 - c.delay)));
      if (k <= 0) continue;
      const off = leaving ? (1 - k) * c.far * 1.2 : (1 - k) * c.far;
      const scale = leaving ? 1 + (1 - k) * 0.6 : 0.6 + k * 0.4;
      const size = c.size * scale;
      g.globalAlpha = leaving ? Math.min(1, k * 1.5) : Math.min(1, k * 2);
      g.drawImage(sprites[c.sprite % sprites.length], c.x + c.dx * off - size / 2, c.y + c.dy * off - size / 2, size, size);
    }
    const fill = smooth(0.7, 1, p);
    if (fill > 0) {
      g.globalAlpha = fill;
      g.fillStyle = fillStyle;
      g.fillRect(0, 0, w, h);
    }
    g.globalAlpha = 1;
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    raf = 0;
    if (mode === 'in') {
      t = Math.min(1, t + dt / COVER_S);
      draw(easeIn(t) * 0.25 + t * 0.75, false);
      if (t >= 1) {
        mode = 'full';
        finish();
      }
    } else if (mode === 'out') {
      t = Math.min(1, t + dt / UNCOVER_S);
      draw(1 - easeInOut(t), true);
      if (t >= 1) {
        mode = 'idle';
        canvas.classList.remove('on', 'blocking');
        finish();
      }
    } else if (mode === 'peek') {
      draw(peek, false);
      if (peek <= 0.001) {
        mode = 'idle';
        canvas.classList.remove('on');
      }
    }
    if (mode === 'in' || mode === 'out') raf = requestAnimationFrame(tick);
  }

  function finish() {
    const d = done;
    done = null;
    d?.();
  }

  function start(next) {
    refreshLook();
    mode = next;
    t = next === 'in' ? peek : 0; // a cover continues from wherever the scroll left the clouds
    peek = 0;
    canvas.classList.add('on', 'blocking');
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }

  return {
    cover() {
      return new Promise((resolve) => {
        finish();
        done = resolve;
        start('in');
      });
    },
    uncover() {
      return new Promise((resolve) => {
        finish();
        done = resolve;
        start('out');
      });
    },
    /** Edge wisps while overscrolling; ignored during a transition. */
    setPeek(v) {
      if (mode !== 'idle' && mode !== 'peek') return;
      const next = Math.min(1, Math.max(0, v));
      if (Math.abs(next - peek) < 0.002 && mode === 'idle') return;
      peek = next;
      if (peek > 0.001) {
        if (mode === 'idle') refreshLook();
        mode = 'peek';
        canvas.classList.add('on');
      }
      if (mode === 'peek' && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    },
    reset() {
      mode = 'idle';
      peek = 0;
      t = 0;
      canvas.classList.remove('on', 'blocking');
      g.clearRect(0, 0, w, h);
      finish();
    },
  };
}
