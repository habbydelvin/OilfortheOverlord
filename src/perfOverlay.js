/**
 * In-game performance overlay (` key, with the debug panel). Shows FPS, frame times, CPU ms per update step, GPU ms
 * (whole frame and split around the fog), renderer counters, and A/B toggles for the expensive
 * systems. A capture button records a few seconds and copies a JSON summary.
 *
 * Usage: perf.frameBegin(now) ... perf.begin('name') / perf.end('name') ... perf.frameEnd().
 * GPU: perf.gpuBegin() before renderer.render, perf.gpuMark('fog') at a split point, perf.gpuEnd().
 * Everything is a no-op while the overlay is closed.
 */

const HISTORY = 240; // frames kept per series
const STORAGE_KEY = 'oto.perfOpen';
const UI_INTERVAL = 250; // ms between text refreshes (the graph redraws every frame)

class Series {
  constructor() {
    this.buf = new Float32Array(HISTORY);
    this.i = 0;
    this.n = 0;
    this.acc = 0; // this frame's total
    this.t0 = 0;
    this.hit = false; // got a value this frame
  }
  push(v) {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % HISTORY;
    this.n = Math.min(this.n + 1, HISTORY);
  }
  values() {
    const out = [];
    for (let k = 0; k < this.n; k++) out.push(this.buf[(this.i - this.n + k + HISTORY) % HISTORY]);
    return out;
  }
  avg() {
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.buf[k];
    return this.n ? s / this.n : 0;
  }
  max() {
    let m = 0;
    for (let k = 0; k < this.n; k++) m = Math.max(m, this.buf[k]);
    return m;
  }
  last() {
    return this.n ? this.buf[(this.i - 1 + HISTORY) % HISTORY] : 0;
  }
}

function stats(values) {
  if (!values.length) return { avg: 0, p95: 0, max: 0, n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  return { avg: +avg.toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3), max: +s[s.length - 1].toFixed(3), n: s.length };
}

export class Perf {
  enabled = false;
  #sections = new Map(); // name -> Series (CPU ms)
  #gpu = new Map(); // segment -> Series (GPU ms)
  #frame = new Series(); // rAF interval ms
  #cpu = new Series(); // main frame CPU ms
  #gpuTotal = new Series();
  #frameStart = 0;
  #lastFrame = 0;
  #lastUi = 0;
  #capture = null; // { until, frames: [] }
  #counters = {}; // name -> fn returning a number/string, shown in the overlay
  #toggles = []; // { label, get, set } or { label, options, get, set }

  constructor(renderer) {
    this.renderer = renderer;
    const gl = renderer.getContext();
    this.gl = gl;
    renderer.info.autoReset = false; // count every pass of a frame (offscreen fog too); reset in frameBegin
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queryPool = [];
    this.pending = []; // frames of { name, q }[] waiting for results
    this.current = null; // { segments, open }
    this.#build();
    this.setOpen(localStorage.getItem(STORAGE_KEY) === '1');
  }

  // ---------- registration ----------

  /** A live value shown in the overlay, e.g. perf.counter('fog billows', () => fog.drawnBillows). */
  counter(name, fn) {
    this.#counters[name] = fn;
  }

  /** A checkbox (get/set booleans) or a select (options + get/set strings) in the A/B section. */
  toggle(def) {
    this.#toggles.push(def);
    this.#renderToggles();
  }

  // ---------- CPU timing ----------

  frameBegin(now) {
    this.renderer.info.reset();
    if (!this.enabled) return;
    if (this.#lastFrame) this.#frame.push(now - this.#lastFrame);
    this.#lastFrame = now;
    this.#frameStart = performance.now();
  }

  begin(name) {
    if (!this.enabled) return;
    let s = this.#sections.get(name);
    if (!s) this.#sections.set(name, (s = new Series()));
    s.t0 = performance.now();
  }

  end(name) {
    if (!this.enabled) return;
    const s = this.#sections.get(name);
    if (!s || !s.t0) return;
    s.acc += performance.now() - s.t0;
    s.t0 = 0;
    s.hit = true;
  }

  frameEnd() {
    if (!this.enabled) return;
    const cpu = performance.now() - this.#frameStart;
    this.#cpu.push(cpu);
    const row = this.#capture ? { frame: this.#frame.last(), cpu } : null;
    for (const [name, s] of this.#sections) {
      s.push(s.acc);
      if (row) row[name] = s.acc;
      s.acc = 0;
      s.hit = false;
    }
    this.#pollGpu();
    if (row) {
      this.#capture.frames.push(row);
      if (performance.now() >= this.#capture.until) this.#finishCapture();
    }
    this.#drawGraph();
    const now = performance.now();
    if (now - this.#lastUi > UI_INTERVAL) {
      this.#lastUi = now;
      this.#renderText();
    }
  }

  // ---------- GPU timing ----------

  #query() {
    return this.queryPool.pop() ?? this.gl.createQuery();
  }

  gpuBegin() {
    if (!this.enabled || !this.ext) return;
    const q = this.#query();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.current = { segments: [{ name: 'scene', q }] };
  }

  /** Close the running GPU segment and open a new one (call mid-render, e.g. from onBeforeRender). */
  gpuMark(name) {
    if (!this.current) return;
    const gl = this.gl;
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    const q = this.#query();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.current.segments.push({ name, q });
  }

  gpuEnd() {
    if (!this.current) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.current.segments);
    this.current = null;
    if (this.pending.length > 8) this.#recycle(this.pending.shift()); // results lost; don't grow
  }

  #recycle(segments) {
    for (const s of segments) this.queryPool.push(s.q);
  }

  #pollGpu() {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const segs = this.pending[0];
      const last = segs[segs.length - 1].q;
      if (!gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const sums = new Map();
        let total = 0;
        for (const { name, q } of segs) {
          const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
          sums.set(name, (sums.get(name) ?? 0) + ms);
          total += ms;
        }
        for (const [name, ms] of sums) {
          let s = this.#gpu.get(name);
          if (!s) this.#gpu.set(name, (s = new Series()));
          s.push(ms);
        }
        // Segments missing this frame (e.g. fog hidden) count as 0.
        for (const [name, s] of this.#gpu) if (!sums.has(name)) s.push(0);
        this.#gpuTotal.push(total);
        const row = this.#capture?.frames.at(-1);
        if (row) {
          row.gpu = total;
          for (const [name, ms] of sums) row[`gpu:${name}`] = ms;
        }
      }
      this.#recycle(segs);
    }
  }

  // ---------- capture ----------

  capture(seconds = 5) {
    if (!this.enabled) this.setOpen(true);
    this.#capture = { until: performance.now() + seconds * 1000, frames: [], seconds };
    this.#status(`Capturing ${seconds}s…`);
  }

  async #finishCapture() {
    const { frames, seconds } = this.#capture;
    this.#capture = null;
    const keys = new Set();
    frames.forEach((f) => Object.keys(f).forEach((k) => keys.add(k)));
    const summary = {};
    for (const k of keys) summary[k] = stats(frames.map((f) => f[k]).filter((v) => v !== undefined));
    const info = this.renderer.info;
    const report = {
      when: new Date().toISOString(),
      seconds,
      frames: frames.length,
      fps: +(1000 / (summary.frame?.avg || 1)).toFixed(1),
      pixelRatio: this.renderer.getPixelRatio(),
      canvas: [this.renderer.domElement.width, this.renderer.domElement.height],
      render: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length },
      counters: Object.fromEntries(Object.entries(this.#counters).map(([k, fn]) => [k, fn()])),
      toggles: Object.fromEntries(this.#toggles.map((t) => [t.label, t.get()])),
      ms: summary,
    };
    const json = JSON.stringify(report, null, 2);
    window.lastPerfCapture = report;
    console.log('[perf] capture', report);
    try {
      await navigator.clipboard.writeText(json);
      this.#status(`Captured ${frames.length} frames · ${report.fps} fps · copied JSON`);
    } catch {
      this.#status(`Captured ${frames.length} frames · ${report.fps} fps · see console (window.lastPerfCapture)`);
    }
  }

  // ---------- UI ----------

  setOpen(open) {
    this.enabled = open;
    this.root.classList.toggle('hidden', !open);
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    if (!open) {
      // Drop in-flight GPU queries so nothing leaks while closed.
      this.pending.forEach((s) => this.#recycle(s));
      this.pending.length = 0;
      this.#lastFrame = 0;
    }
  }

  #build() {
    const style = document.createElement('style');
    style.textContent = `
#perf { position: fixed; top: 8px; right: calc(var(--panel-w, 300px) + 8px); z-index: 1000; width: 300px;
  max-height: calc(100vh - 16px); overflow-y: auto; padding: 8px 10px; border-radius: 6px;
  background: rgba(10, 12, 14, 0.88); color: #d8e0e2; font: 11px/1.35 ui-monospace, Menlo, monospace;
  pointer-events: auto; user-select: none; }
#perf.hidden { display: none; }
#perf .ph { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
#perf .ph b { font-size: 13px; }
#perf .fps { font-size: 18px; font-weight: bold; }
#perf canvas { display: block; width: 100%; height: 60px; margin: 4px 0; background: rgba(255,255,255,0.04); }
#perf table { width: 100%; border-collapse: collapse; }
#perf td { padding: 0 2px; white-space: nowrap; }
#perf td.n { text-align: right; }
#perf tr.hdr td { color: #8a979a; border-bottom: 1px solid rgba(255,255,255,0.1); }
#perf .sec { color: #8a979a; margin: 6px 0 2px; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
#perf .bar { display: inline-block; height: 7px; background: #5fb0c9; vertical-align: middle; }
#perf .gbar { background: #d9925a; }
#perf label { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 1px 0; cursor: pointer; }
#perf select, #perf button { font: inherit; background: #222a2d; color: inherit; border: 1px solid rgba(255,255,255,0.15); border-radius: 3px; }
#perf button { padding: 3px 8px; cursor: pointer; }
#perf .acts { display: flex; gap: 6px; margin-top: 6px; }
#perf .st { color: #9fd49a; min-height: 14px; margin-top: 4px; white-space: normal; }
#perf .warn { color: #e2a35a; }`;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'perf';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="ph"><b>Performance <small>(\`)</small></b><span class="fps">--</span></div>
      <div class="summary"></div>
      <canvas width="560" height="120"></canvas>
      <div class="sec">CPU per frame (ms) · avg / max</div>
      <table class="cpu"></table>
      <div class="sec">GPU (ms) · avg / max</div>
      <table class="gpu"></table>
      <div class="sec">Renderer</div>
      <table class="info"></table>
      <div class="sec">A/B toggles</div>
      <div class="toggles"></div>
      <div class="acts">
        <button data-act="cap">Capture 5s</button>
        <button data-act="reset">Reset stats</button>
        <button data-act="close">Close</button>
      </div>
      <div class="st"></div>`;
    document.body.appendChild(root);
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.addEventListener('wheel', (e) => e.stopPropagation());
    root.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      e.target.closest('button')?.blur();
      if (act === 'cap') this.capture(5);
      else if (act === 'reset') {
        this.#sections.clear();
        this.#gpu.clear();
        this.#frame = new Series();
        this.#cpu = new Series();
        this.#gpuTotal = new Series();
      } else if (act === 'close') this.setOpen(false);
    });
    root.addEventListener('change', (e) => {
      const i = Number(e.target.dataset.t);
      const t = this.#toggles[i];
      if (!t) return;
      t.set(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      e.target.blur();
    });
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  #status(msg) {
    this.root.querySelector('.st').textContent = msg;
  }

  #renderToggles() {
    const el = this.root?.querySelector('.toggles');
    if (!el) return;
    el.innerHTML = this.#toggles
      .map((t, i) =>
        t.options
          ? `<label>${t.label}<select data-t="${i}">${t.options.map((o) => `<option${String(o) === String(t.get()) ? ' selected' : ''}>${o}</option>`).join('')}</select></label>`
          : `<label>${t.label}<input type="checkbox" data-t="${i}"${t.get() ? ' checked' : ''} /></label>`,
      )
      .join('');
  }

  /** Re-read toggle states (e.g. after the debug panel changed a setting). */
  refreshToggles() {
    this.#renderToggles();
  }

  #renderText() {
    const r = this.root;
    const fAvg = this.#frame.avg();
    const fps = fAvg ? 1000 / fAvg : 0;
    const vals = this.#frame.values().sort((a, b) => b - a);
    const low1 = vals.length ? vals[Math.max(0, Math.floor(vals.length * 0.01) - 0)] : 0;
    const fpsEl = r.querySelector('.fps');
    fpsEl.textContent = `${fps.toFixed(0)} fps`;
    fpsEl.classList.toggle('warn', fps < 55);
    // Some drivers (Chrome on Apple Metal) report timer values far above the frame time: say so.
    const bogus = this.ext && this.#gpuTotal.n > 10 && this.#gpuTotal.avg() > fAvg * 1.5;
    const gpu = !this.ext
      ? '<span class="warn">n/a</span>'
      : `${this.#gpuTotal.avg().toFixed(2)} ms${bogus ? ' <span class="warn">(unreliable on this driver: compare the A/B toggles\' fps instead)</span>' : ''}`;
    r.querySelector('.summary').innerHTML =
      `frame ${fAvg.toFixed(2)} ms · worst 1% ${low1.toFixed(1)} ms<br>` +
      `CPU ${this.#cpu.avg().toFixed(2)} ms (max ${this.#cpu.max().toFixed(1)}) · GPU ${gpu}`;

    const rows = [...this.#sections].map(([name, s]) => [name, s.avg(), s.max()]).sort((a, b) => b[1] - a[1]);
    const top = Math.max(0.5, ...rows.map((x) => x[1]));
    r.querySelector('.cpu').innerHTML = rows
      .map(([name, a, m]) => `<tr><td>${name}</td><td><span class="bar" style="width:${Math.round((a / top) * 60)}px"></span></td><td class="n">${a.toFixed(2)}</td><td class="n">${m.toFixed(1)}</td></tr>`)
      .join('');

    if (!this.ext) {
      r.querySelector('.gpu').innerHTML = '<tr><td class="warn">EXT_disjoint_timer_query_webgl2 not available (try Chrome); use the A/B toggles and watch fps instead</td></tr>';
    } else {
      const g = [...this.#gpu].map(([name, s]) => [name, s.avg(), s.max()]);
      const gt = Math.max(0.5, ...g.map((x) => x[1]));
      r.querySelector('.gpu').innerHTML = g
        .map(([name, a, m]) => `<tr><td>${name}</td><td><span class="bar gbar" style="width:${Math.round((a / gt) * 60)}px"></span></td><td class="n">${a.toFixed(2)}</td><td class="n">${m.toFixed(1)}</td></tr>`)
        .join('');
    }

    const info = this.renderer.info;
    const canvas = this.renderer.domElement;
    const items = [
      ['draw calls', info.render.calls],
      ['triangles', info.render.triangles.toLocaleString()],
      ['geometries', info.memory.geometries],
      ['textures', info.memory.textures],
      ['programs', info.programs?.length ?? '?'],
      ['canvas px', `${canvas.width}×${canvas.height} @${this.renderer.getPixelRatio()}`],
      ...Object.entries(this.#counters).map(([k, fn]) => [k, fn()]),
    ];
    r.querySelector('.info').innerHTML = items.map(([k, v]) => `<tr><td>${k}</td><td class="n">${v}</td></tr>`).join('');
  }

  #drawGraph() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const scale = h / 50; // 50 ms full height
    ctx.clearRect(0, 0, w, h);
    // 16.7 ms and 33.3 ms guides.
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    for (const ms of [16.7, 33.3]) {
      ctx.moveTo(0, h - ms * scale);
      ctx.lineTo(w, h - ms * scale);
    }
    ctx.stroke();
    const bw = w / HISTORY;
    const plot = (series, color) => {
      const v = series.values();
      ctx.fillStyle = color;
      const off = HISTORY - v.length;
      for (let k = 0; k < v.length; k++) {
        const bh = Math.min(h, v[k] * scale);
        ctx.fillRect((off + k) * bw, h - bh, Math.max(1, bw - 0.5), bh);
      }
    };
    plot(this.#frame, 'rgba(120,200,120,0.55)');
    plot(this.#gpuTotal, 'rgba(217,146,90,0.85)');
    plot(this.#cpu, 'rgba(95,176,201,0.9)');
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '18px monospace';
    ctx.fillText('frame', 4, 18);
    ctx.fillStyle = 'rgba(95,176,201,1)';
    ctx.fillText('cpu', 70, 18);
    ctx.fillStyle = 'rgba(217,146,90,1)';
    ctx.fillText('gpu', 115, 18);
  }
}
