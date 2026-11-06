/**
 * Player release build (`npm run build`, i.e. `vite build --mode release`): no Game Debug panel, no tile library,
 * no perf overlay, no console cheats, and only the shipped defaults for every tuning value.
 * Vite replaces import.meta.env.MODE at build time, so the dev-only code behind `if (!RELEASE)` is dropped
 * from the release bundle entirely (vite.config.js also swaps the debug modules for empty stubs).
 */
export const RELEASE = import.meta.env.MODE === 'release';

/**
 * Tuning saved by the Game Debug panel and the perf overlay. Players can't reach those, so in the release build
 * any leftovers in their browser are cleared on every launch, and every value comes from the defaults in code.
 */
const DEV_KEYS = [
  'oto.debugOpen',
  'oto.perfOpen',
  'oto.combatPanel',
  'oto.gfx',
  'oto.fogConfig',
  'oto.missileConfig',
  'oto.laserConfig', // Game Debug → Laser strike: the release plays the code defaults
  'oto.overlordStrike', // missile or laser: the release plays the laser
  'oto.laserColor',
  'oto.payoutConfig',
  'oto.scaling',
  'oto.iconConfig',
  'oto.shakeConfig',
  'oto.previewConfig',
  'oto.globeConfig',
  'oto.intercept', // combat-test tuning (arsenal.js): the release plays the code defaults
  'oto.decoy',
  'oto.boost',
  'oto.lodDistance',
  'oftoMode', // debug expansion mode
];

/**
 * One-time fresh start for this release: the first launch of a build with a new id wipes the saved game, the
 * tutorial and lesson progress, and anything else the game stored, so everyone starts from the beginning.
 * Only player preferences survive. Later launches of the same release keep their new progress.
 * Change RESET_ID to wipe again in a future release.
 */
const RESET_ID = '2026-11-06';
const RESET_KEY = 'oto.releaseReset';
const KEEP_KEYS = new Set(['oto.lang', 'oto.music', 'oto.sfx', RESET_KEY]);
const isGameKey = (k) => k.startsWith('oto.') || k.startsWith('ofto');

if (RELEASE) {
  try {
    if (localStorage.getItem(RESET_KEY) !== RESET_ID) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      for (const k of keys) if (k && isGameKey(k) && !KEEP_KEYS.has(k)) localStorage.removeItem(k);
      localStorage.setItem(RESET_KEY, RESET_ID);
    }
    for (const k of DEV_KEYS) localStorage.removeItem(k);
  } catch {
    /* storage unavailable: the defaults are used anyway */
  }
}
