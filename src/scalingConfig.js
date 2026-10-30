/**
 * How hard events and camps hit (Game Debug → Scaling), saved to localStorage.
 *
 * Year events: a percentage that starts at `<event>Base` in year 2 (the first event year), grows by
 * `<event>PerYear` each year after, and stops at `<event>Max`. Good events scale the same way.
 * Rebel (raider) camps and bandit camps take a flat amount each. Every scaled effect is at least 1.
 *
 * `SCALE` is read live, so slider changes apply straight away (even to the running year's event).
 * To make a tweak permanent: "Copy JSON" in the debug panel and paste it over SCALE_DEFAULTS.
 */
export const SCALE_DEFAULTS = {
  famineBase: 0.4,
  faminePerYear: 0.05,
  famineMax: 0.75,
  bumperBase: 0.1,
  bumperPerYear: 0.05,
  bumperMax: 0.25,
  titheBase: 0.2,
  tithePerYear: 0.05,
  titheMax: 0.5,
  oilBoomBase: 0.1,
  oilBoomPerYear: 0.05,
  oilBoomMax: 0.25,
  refugeesBase: 0.2,
  refugeesPerYear: 0.05,
  refugeesMax: 0.5,
  mercenariesBase: 0.15,
  mercenariesPerYear: 0.02,
  mercenariesMax: 0.3,
  prospectorsBase: 0.1,
  prospectorsPerYear: 0.02,
  prospectorsMax: 0.25,
  earthquakeCliffs: 3,
  rebelSlots: 2,
  banditSlots: 2,
  banditOil: 2,
  banditFood: 2,
};

/** First year that draws an event; its strength is the base value. */
export const FIRST_EVENT_YEAR = 2;

const eventRows = (id, label) => [
  { group: `Scaling · ${label}` },
  { key: `${id}Base`, label: `Year ${FIRST_EVENT_YEAR} strength`, min: 0, max: 1, step: 0.01, hint: 'fraction, 0.4 = 40%' },
  { key: `${id}PerYear`, label: '+ per year', min: 0, max: 0.3, step: 0.01 },
  { key: `${id}Max`, label: 'Max strength', min: 0, max: 1, step: 0.01 },
];

export const SCALE_PARAMS = [
  ...eventRows('famine', 'Famine (farm food)'),
  ...eventRows('bumper', 'Bumper Harvest (farm food)'),
  ...eventRows('tithe', 'Tithe of Men (worker slots)'),
  ...eventRows('oilBoom', 'Oil Boom (station oil)'),
  ...eventRows('refugees', 'Refugees taken in (slots + food upkeep)'),
  ...eventRows('mercenaries', 'Mercenaries fee (× tribute)'),
  ...eventRows('prospectors', 'Prospectors oil (× tribute)'),
  { group: 'Scaling · Earthquake' },
  { key: 'earthquakeCliffs', label: 'Cliffs created', min: 1, max: 10, step: 1 },
  { group: 'Scaling · Rebel camps (flat, per camp)' },
  { key: 'rebelSlots', label: 'Rebel Camp: worker slots', min: 0, max: 10, step: 1, hint: 'Rebel Camp (from starvation)' },
  { group: 'Bandit camps (flat, per camp, per season)' },
  { key: 'banditSlots', label: 'Raider Hideout: worker slots', min: 0, max: 10, step: 1 },
  { key: 'banditOil', label: 'Siphoner: oil', min: 0, max: 10, step: 1 },
  { key: 'banditFood', label: 'Scavenger: food', min: 0, max: 10, step: 1 },
];

export const SCALE = { ...SCALE_DEFAULTS };
const KEY = 'oto.scaling';

export function loadScaleConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    for (const k of Object.keys(SCALE_DEFAULTS)) if (typeof saved[k] === 'number') SCALE[k] = saved[k];
  } catch {
    /* keep defaults */
  }
  return SCALE;
}
export const saveScaleConfig = (cfg) => localStorage.setItem(KEY, JSON.stringify(cfg));
export const clearScaleConfig = () => localStorage.removeItem(KEY);

/** Strength (0..1) of event scale `id` in `year`. */
export function eventPct(id, year) {
  const base = SCALE[`${id}Base`] ?? 0;
  const per = SCALE[`${id}PerYear`] ?? 0;
  const max = SCALE[`${id}Max`] ?? 1;
  return Math.max(0, Math.min(max, base + per * Math.max(0, year - FIRST_EVENT_YEAR)));
}


/** A scaled amount: round(total × |frac|), at least 1 whenever frac isn't 0; keeps frac's sign. */
export function scaled(total, frac) {
  if (!frac) return 0;
  return Math.sign(frac) * Math.max(1, Math.round(Math.max(0, total) * Math.abs(frac)));
}

/** "40%" */
export const P = (f) => `${Math.round(f * 100)}%`;
