import { PAYOUT_DEFAULTS, PAYOUT_PARAMS, savePayoutConfig, clearPayoutConfig } from './payoutConfig.js';

const decimals = (step) => (String(step).split('.')[1] ?? '').length;

/**
 * Game Debug panel: game mode, dev shortcuts, and tuning sliders.
 * Each tuning section edits its `cfg` in place (read live) and saves to localStorage.
 * `fog` and `gfx` are optional extra sections: { params, defaults, cfg, save, clear, onChange(param) }.
 */
export function createDebugPanel(root, toggleBtn, cfg, { onPlay, expansionMode, onExpansionMode, onSkipYear, fog, gfx, missiles, icons, scaling, onMissiles, onPerf }) {
  const fmt = (p, v) => (p.type === 'select' || p.type === 'color' ? v : Number(v).toFixed(decimals(p.step)));
  const payout = { id: 'payout', params: PAYOUT_PARAMS, defaults: PAYOUT_DEFAULTS, cfg, save: savePayoutConfig, clear: clearPayoutConfig };
  const sections = [gfx && { id: 'gfx', ...gfx }, missiles && { id: 'missiles', ...missiles }, payout, scaling && { id: 'scaling', ...scaling }, icons && { id: 'icons', ...icons }, fog && { id: 'fog', ...fog }].filter(Boolean);
  const sectionOf = (id) => sections.find((s) => s.id === id);

  function rowsFor({ id, params, defaults, cfg }) {
    return params.map((p) => {
      if (p.group) return `<div class="dbg-group">${p.group}</div>`;
      const title = p.hint ? ` title="${p.hint}"` : '';
      const input =
        p.type === 'color'
          ? `<input type="color" data-s="${id}" data-k="${p.key}" value="${cfg[p.key]}" />`
          : p.type === 'select'
          ? `<select data-s="${id}" data-k="${p.key}">${p.options
              .map((o) => `<option${o === cfg[p.key] ? ' selected' : ''}>${o}</option>`)
              .join('')}</select>`
          : `<input type="range" data-s="${id}" data-k="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${cfg[p.key]}" />`;
      const changed = cfg[p.key] !== defaults[p.key] ? ' changed' : '';
      return `
        <label class="dbg-row${changed}"${title}>
          <span class="dbg-name">${p.label}</span>
          <span class="dbg-val" data-v="${id}.${p.key}">${fmt(p, cfg[p.key])}</span>
          ${input}
        </label>`;
    }).join('');
  }

  function render() {
    const rows = sections.map(rowsFor).join('');
    root.innerHTML = `
      <div class="dbg-head">
        <b>Game Debug</b>
        <button class="dbg-x" data-act="close" title="Hide (\`)">×</button>
      </div>
      <div class="dbg-body">
        <div class="dbg-group">Game mode</div>
        <label class="dbg-row dbg-check" title="Old rules: fill your 3×3 territory, then pick a plot to expand. Toggling restarts the run. (X)">
          <span class="dbg-name">Territory expansion <small>(X)</small></span>
          <input type="checkbox" data-act="mode"${expansionMode?.() ? ' checked' : ''} />
        </label>
        <div class="dbg-group">Dev testing</div>
        <div class="dbg-actions dbg-dev">
          <button data-act="skipMet" title="Jump to the tribute and deliver exactly the quota">Skip year <small>(meet)</small></button>
          <button data-act="skipMiss" title="Jump to the tribute and deliver nothing (a strike)">Skip year <small>(miss)</small></button>
          <button data-act="missiles" title="Preview the Overlord's missile strike (settings under Missiles · preview) (M)">Missiles <small>(M)</small></button>
          <button data-act="perf" title="Performance overlay: fps, ms per system, GPU time, A/B toggles (-)">Perf</button>
        </div>
        ${rows}
      </div>
      <div class="dbg-actions">
        <button data-act="play">Play <small>(Space)</small></button>
        <button data-act="copy">Copy JSON</button>
        <button data-act="reset">Reset</button>
      </div>
      <div class="dbg-status"></div>`;
  }

  const status = (msg) => {
    const el = root.querySelector('.dbg-status');
    el.textContent = msg;
    clearTimeout(status.t);
    status.t = setTimeout(() => (el.textContent = ''), 1800);
  };

  root.addEventListener('change', (e) => {
    if (e.target.dataset.act === 'mode') onExpansionMode?.(e.target.checked);
  });

  root.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    const sec = sectionOf(e.target.dataset.s);
    if (!k || !sec) return;
    const p = sec.params.find((q) => q.key === k);
    sec.cfg[k] = p.type === 'select' || p.type === 'color' ? e.target.value : Number(e.target.value);
    root.querySelector(`[data-v="${sec.id}.${k}"]`).textContent = fmt(p, sec.cfg[k]);
    e.target.closest('.dbg-row').classList.toggle('changed', sec.cfg[k] !== sec.defaults[k]);
    sec.save(sec.cfg);
    sec.onChange?.(p);
  });

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    btn.blur(); // so Space doesn't re-click it
    const act = btn.dataset.act;
    if (act === 'play') onPlay();
    else if (act === 'skipMet' || act === 'skipMiss') status(onSkipYear?.(act === 'skipMet') ?? '');
    else if (act === 'close') setOpen(false);
    else if (act === 'perf') onPerf?.();
    else if (act === 'missiles') status(onMissiles?.() ?? '');
    else if (act === 'reset') {
      for (const sec of sections) {
        Object.assign(sec.cfg, sec.defaults);
        sec.clear();
        sec.onChange?.(null);
      }
      render();
      status('Reset to defaults');
    } else if (act === 'copy') {
      // Every tuning section, current values only (old saved keys are left out).
      const all = Object.fromEntries(
        sections.map((sec) => [sec.id, Object.fromEntries(Object.keys(sec.defaults).map((k) => [k, sec.cfg[k]]))]),
      );
      const json = JSON.stringify(all, null, 2);
      if (await copyText(json)) status('Copied all debug values (payout → PAYOUT_DEFAULTS, fog → FOG, missiles → MISSILE)');
      else showJson(json);
    }
  });

  /** Clipboard API first (needs https or localhost), then the old execCommand route. True if it worked. */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;user-select:text';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  /** If the browser blocks copying, show the JSON selected in the panel so it can be copied by hand. */
  function showJson(json) {
    root.querySelector('.dbg-json')?.remove();
    const ta = document.createElement('textarea');
    ta.className = 'dbg-json';
    ta.value = json;
    ta.readOnly = true;
    ta.rows = 8;
    ta.style.cssText = 'width:100%;margin-top:6px;font:11px monospace;user-select:text;pointer-events:auto';
    root.appendChild(ta);
    ta.focus();
    ta.select();
    status('Copy blocked by the browser: press Cmd/Ctrl+C to copy the selected JSON');
  }

  function setOpen(open) {
    root.classList.toggle('hidden', !open);
    toggleBtn.classList.toggle('hidden', open);
    localStorage.setItem('oto.debugOpen', open ? '1' : '0');
  }
  toggleBtn.addEventListener('click', (e) => {
    e.currentTarget.blur();
    setOpen(true);
  });

  render();
  setOpen(localStorage.getItem('oto.debugOpen') === '1');
  return {
    toggle: () => setOpen(root.classList.contains('hidden')),
    isOpen: () => !root.classList.contains('hidden'),
    /** Redraw every row (after a setting changed elsewhere, e.g. the perf overlay). */
    refresh: render,
    /** Sync the mode checkbox after the X hotkey changes it. */
    refreshMode: () => {
      const box = root.querySelector('[data-act="mode"]');
      if (box) box.checked = Boolean(expansionMode?.());
    },
  };
}
