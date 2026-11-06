import { L, onLangChange } from './i18n.js';
import { PAYOUT_DEFAULTS, PAYOUT_PARAMS, savePayoutConfig, clearPayoutConfig } from './payoutConfig.js';

const decimals = (step) => (String(step).split('.')[1] ?? '').length;

/**
 * Game Debug panel: game mode, dev shortcuts, and tuning sliders.
 * Each tuning section edits its `cfg` in place (read live) and saves to localStorage.
 * `fog` and `gfx` are optional extra sections: { params, defaults, cfg, save, clear, onChange(param) }.
 */
export function createDebugPanel(root, toggleBtn, cfg, { onPlay, expansionMode, onExpansionMode, onSkipYear, fog, globe, gfx, missiles, laser, onLaserTest, intercept, icons, scaling, audio, preview, shake, onShake, onMissiles, onPerf, onResetTutorial, crtOn, onCrt, onGiveTile, giveKeys, onGiveMissile, overlordStrike, onOverlordStrike, laserColor, onLaserColor, laserColorDefault = '#ff3a1c' }) {
  const fmt = (p, v) => (p.type === 'select' || p.type === 'color' ? v : Number(v).toFixed(decimals(p.step)));
  const payout = { id: 'payout', params: PAYOUT_PARAMS, defaults: PAYOUT_DEFAULTS, cfg, save: savePayoutConfig, clear: clearPayoutConfig };
  const sections = [audio && { id: 'audio', ...audio }, gfx && { id: 'gfx', ...gfx }, preview && { id: 'preview', ...preview }, shake && { id: 'shake', ...shake }, missiles && { id: 'missiles', ...missiles }, laser && { id: 'laser', ...laser }, intercept && { id: 'intercept', ...intercept }, payout, scaling && { id: 'scaling', ...scaling }, icons && { id: 'icons', ...icons }, fog && { id: 'fog', ...fog }, globe && { id: 'globe', ...globe }].filter(Boolean);
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
        <label class="dbg-row" title="${L('Which strike a missed tribute and the bottom-left button play.', '未缴足贡品和左下角按钮使用哪种打击。')}">
          <span class="dbg-name">${L('Overlord strike', '霸主打击')}</span>
          <select data-act="overlordStrike">
            <option value="missile"${overlordStrike?.() === 'laser' ? '' : ' selected'}>${L('Missile strike', '导弹打击')}</option>
            <option value="laser"${overlordStrike?.() === 'laser' ? ' selected' : ''}>${L('Laser strike', '激光打击')}</option>
          </select>
        </label>
        <label class="dbg-row${(laserColor?.() ?? laserColorDefault).toLowerCase() === laserColorDefault.toLowerCase() ? '' : ' changed'}" title="Colour of the five targeting beams and the energy blast.">
          <span class="dbg-name">${L('Laser colour', '激光颜色')}</span>
          <span class="dbg-val" data-v="laserColor">${laserColor?.() ?? laserColorDefault}</span>
          <input type="color" data-act="laserColor" value="${laserColor?.() ?? laserColorDefault}" />
        </label>
        <div class="dbg-actions dbg-dev">
          <button data-act="skipMet" title="Jump to the tribute and deliver exactly the quota">Skip year <small>(meet)</small></button>
          <button data-act="skipMiss" title="Jump to the tribute and deliver nothing (a strike)">Skip year <small>(miss)</small></button>
          <button data-act="laserTest" title="Preview the laser strike with the current Laser strike settings">Laser test</button>
          <button data-act="missiles" title="Preview the Overlord's missile strike (settings under Missiles · preview) (M)">Missiles <small>(M)</small></button>
          <button data-act="allTiles" title="Restart with every tile unlocked (?alltiles=1). Hand stays 5 cards; Give tile below adds one.">All tiles sandbox</button>
          <button data-act="resetTutorial" title="Forget that the tutorial and hints were seen, and start a new run with the guided Spring">Reset tutorial</button>
          <button data-act="shake" title="Play one missile-impact camera shake (settings under Missile camera shake)">Test shake</button>
          <button data-act="perf" title="Performance overlay: fps, ms per system, GPU time, A/B toggles (-)">Perf</button>
          <button data-act="crt" title="The old CRT monitor effect over the world, on or off (Graphics → CRT screen)">CRT <small>(${crtOn?.() ? 'on' : 'off'})</small></button>
        </div>
        <label class="dbg-row dbg-give">
          <span class="dbg-name">Give tile</span>
          <select data-act="giveKey">${(giveKeys ?? []).map((k) => `<option value="${k}">${k}</option>`).join('')}</select>
          <button type="button" data-act="give">Add to hand</button>
        </label>
        <label class="dbg-row dbg-give">
          <span class="dbg-name">Give missile</span>
          <button type="button" data-act="giveMissile">Add to attack hand</button>
          <button type="button" data-act="giveDecoy">Add decoy</button>
        </label>
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
    else if (e.target.dataset.act === 'overlordStrike') status(onOverlordStrike?.(e.target.value) ?? '');
  });

  root.addEventListener('input', (e) => {
    if (e.target.dataset.act === 'laserColor') {
      const hex = e.target.value;
      const val = root.querySelector('[data-v="laserColor"]');
      if (val) val.textContent = hex;
      e.target.closest('.dbg-row')?.classList.toggle('changed', hex.toLowerCase() !== laserColorDefault.toLowerCase());
      onLaserColor?.(hex);
      return;
    }
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
    else if (act === 'allTiles') {
      const u = new URL(location.href);
      u.searchParams.set('alltiles', '1');
      location.href = u.href;
    }
    else if (act === 'give') {
      const k = root.querySelector('[data-act="giveKey"]')?.value;
      status(onGiveTile?.(k) ?? '');
    }
    else if (act === 'giveMissile') status(onGiveMissile?.() ?? '');
    else if (act === 'giveDecoy') status(onGiveMissile?.('decoy') ?? '');
    else if (act === 'resetTutorial') status(onResetTutorial?.() ?? '');
    else if (act === 'laserTest') status(onLaserTest?.() ?? '');
    else if (act === 'missiles') status(onMissiles?.() ?? '');
    else if (act === 'shake') status(onShake?.() ?? '');
    else if (act === 'crt') {
      const msg = onCrt?.() ?? '';
      render(); // the button's label and the Graphics → CRT screen option
      status(msg);
    }
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
      if (await copyText(json)) status('Copied all debug values (audio, payout, fog, missiles, and the rest)');
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
  onLangChange(() => render());
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
