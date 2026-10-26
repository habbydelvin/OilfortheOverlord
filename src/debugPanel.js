import { PAYOUT_DEFAULTS, PAYOUT_PARAMS, savePayoutConfig, clearPayoutConfig } from './payoutConfig.js';

const decimals = (step) => (String(step).split('.')[1] ?? '').length;

/**
 * Debug panel for tuning the payout animation. Edits `cfg` in place (the Payout reads it live)
 * and saves to localStorage so tweaks survive a reload.
 */
export function createDebugPanel(root, toggleBtn, cfg, { onPlay }) {
  const fmt = (p, v) => (p.type === 'select' ? v : Number(v).toFixed(decimals(p.step)));

  function render() {
    const rows = PAYOUT_PARAMS.map((p) => {
      if (p.group) return `<div class="dbg-group">${p.group}</div>`;
      const title = p.hint ? ` title="${p.hint}"` : '';
      const input =
        p.type === 'select'
          ? `<select data-k="${p.key}">${p.options
              .map((o) => `<option${o === cfg[p.key] ? ' selected' : ''}>${o}</option>`)
              .join('')}</select>`
          : `<input type="range" data-k="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${cfg[p.key]}" />`;
      const changed = cfg[p.key] !== PAYOUT_DEFAULTS[p.key] ? ' changed' : '';
      return `
        <label class="dbg-row${changed}"${title}>
          <span class="dbg-name">${p.label}</span>
          <span class="dbg-val" data-v="${p.key}">${fmt(p, cfg[p.key])}</span>
          ${input}
        </label>`;
    }).join('');
    root.innerHTML = `
      <div class="dbg-head">
        <b>Payout tuning</b>
        <button class="dbg-x" data-act="close" title="Hide (\`)">×</button>
      </div>
      <div class="dbg-body">${rows}</div>
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

  root.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const p = PAYOUT_PARAMS.find((q) => q.key === k);
    cfg[k] = p.type === 'select' ? e.target.value : Number(e.target.value);
    root.querySelector(`[data-v="${k}"]`).textContent = fmt(p, cfg[k]);
    e.target.closest('.dbg-row').classList.toggle('changed', cfg[k] !== PAYOUT_DEFAULTS[k]);
    savePayoutConfig(cfg);
  });

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    btn.blur(); // so Space doesn't re-click it
    const act = btn.dataset.act;
    if (act === 'play') onPlay();
    else if (act === 'close') setOpen(false);
    else if (act === 'reset') {
      Object.assign(cfg, PAYOUT_DEFAULTS);
      clearPayoutConfig();
      render();
      status('Reset to defaults');
    } else if (act === 'copy') {
      const json = JSON.stringify(cfg, null, 2);
      try {
        await navigator.clipboard.writeText(json);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = json;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      status('Copied: paste over PAYOUT_DEFAULTS in src/payoutConfig.js');
    }
  });

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
  return { toggle: () => setOpen(root.classList.contains('hidden')) };
}
