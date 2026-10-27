/**
 * Tunable values for the end-of-turn payout animation.
 * To make a tweak permanent: use "Copy JSON" in the debug panel and paste it over PAYOUT_DEFAULTS.
 */
export const PAYOUT_DEFAULTS = {
  order: 'sweep',
  stagger: 0.4,
  maxRipple: 3.1,
  hopHeight: 0.26,
  hopDuration: 0.62,
  squash: 0.62,
  stretch: 1.18,
  landSquish: 0.16,
  labelDelay: 0.14,
  labelLife: 1.25,
  labelStartY: 1.45,
  labelRise: 0.85,
  labelPop: 1.15,
  labelPopTime: 0.22,
  labelWobble: 18,
  labelSize: 18,
  fadeStart: 0.25,
};

/** Slider definitions for the debug panel, grouped by heading. */
export const PAYOUT_PARAMS = [
  { group: 'Stagger' },
  { key: 'stagger', label: 'Delay per tile (s)', min: 0, max: 0.4, step: 0.005 },
  { key: 'maxRipple', label: 'Max total ripple (s)', min: 0.2, max: 6, step: 0.05, hint: 'caps delay on big maps' },

  { group: 'Tile hop' },
  { key: 'hopHeight', label: 'Hop height', min: 0, max: 1.5, step: 0.01 },
  { key: 'hopDuration', label: 'Hop duration (s)', min: 0.15, max: 2, step: 0.01 },
  { key: 'squash', label: 'Anticipation squash', min: 0.3, max: 1, step: 0.01, hint: 'lower = flatter' },
  { key: 'stretch', label: 'Launch stretch', min: 1, max: 1.8, step: 0.01 },
  { key: 'landSquish', label: 'Landing squish', min: 0, max: 0.5, step: 0.01 },

  { group: 'Numbers' },
  { key: 'labelDelay', label: 'Appear after (s)', min: 0, max: 1, step: 0.01 },
  { key: 'labelLife', label: 'Lifetime (s)', min: 0.3, max: 4, step: 0.05 },
  { key: 'labelStartY', label: 'Start height', min: 0, max: 3, step: 0.05 },
  { key: 'labelRise', label: 'Rise distance', min: 0, max: 3, step: 0.05 },
  { key: 'labelPop', label: 'Pop overshoot', min: 1, max: 2, step: 0.01 },
  { key: 'labelPopTime', label: 'Pop time (s)', min: 0.05, max: 0.8, step: 0.01 },
  { key: 'labelWobble', label: 'Wobble (deg)', min: 0, max: 45, step: 1 },
  { key: 'labelSize', label: 'Font size (px)', min: 12, max: 64, step: 1 },
  { key: 'fadeStart', label: 'Fade starts at', min: 0, max: 1, step: 0.01, hint: 'fraction of lifetime' },
];

const STORAGE_KEY = 'oto.payoutConfig';

/** Defaults, overridden by whatever was last tweaked in the debug panel (saved in localStorage). */
export function loadPayoutConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    saved = {};
  }
  const cfg = { ...PAYOUT_DEFAULTS };
  for (const k of Object.keys(cfg)) if (k in saved) cfg[k] = saved[k];
  return cfg;
}

export function savePayoutConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearPayoutConfig() {
  localStorage.removeItem(STORAGE_KEY);
}
