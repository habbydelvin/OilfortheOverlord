/**
 * Yearly tribute targets: from year 2 on, the Overlord lets the Overseer set this year's target
 * before the year event. The base quota still comes from nextQuota(); the tier scales it for this
 * year only (next year's base grows from the base, not the scaled quota).
 *
 * Higher tiers carry a reward, rolled fresh every year from the tier's pool. It is only paid at
 * the next tribute, and only if the (scaled) quota is met.
 *
 * Picking Low LOW_STREAK_LIMIT years in a row forces the next target to High (no choice).
 */

/** Consecutive Low picks before the Overlord forces High. */
export const LOW_STREAK_LIMIT = 3;

export const TIERS = {
  low: {
    label: 'Low',
    mult: 0.85,
    pool: null, // no reward
    say: 'A modest target, Overlord. We will not fail you.',
    retort: 'Timid. But a sure barrel is worth more than a promised one. This once.',
  },
  medium: {
    label: 'Medium',
    mult: 1,
    pool: 'small',
    say: 'The full tribute, as you demand.',
    retort: 'As it should be. Deliver, and you will be paid for it.',
  },
  high: {
    label: 'High',
    mult: 1.25,
    pool: 'big',
    say: 'Raise it. We will give you more.',
    retort: 'Ambition! I like it. Fill my tanks and you will be rewarded handsomely.',
  },
};

export const TIER_ORDER = ['low', 'medium', 'high'];

/**
 * Rewards, paid at tribute when the target is met.
 *   text:    shown in the dialogue tag and HUD (may contain icon tokens, see iconize)
 *   coinMult × market coins at that tribute (applied to the excess)
 *   grant:   (ctx) => report line, ctx = { turn }. Runs when the reward is earned.
 */
export const REWARDS = {
  // ---- small (Medium) ----
  coins50: { pool: 'small', text: '+50% market oil at tribute', coinMult: 1.5 },
  food: {
    pool: 'small',
    text: '+6 food in the store',
    grant: ({ turn }) => {
      turn.food += 6;
      return '';
    },
  },
  freeReroll: {
    pool: 'small',
    text: '2 free hand rerolls',
    grant: ({ turn }) => {
      turn.freeRerolls += 2;
      return '';
    },
  },
  pop: {
    pool: 'small',
    text: '+1 population',
    grant: ({ turn }) => {
      turn.population += 1;
      return '';
    },
  },

  // ---- big (High) ----
  cardPick: {
    pool: 'big',
    text: 'Pick 1 of 3 market tiles for free',
    grant: ({ turn }) => {
      turn.cardPicks += 1;
      return 'A free tile pick awaits at the start of next year.';
    },
  },
  fortune: {
    pool: 'big',
    text: 'A good-fortune event next year',
    grant: ({ turn }) => {
      turn.forceFortune = true;
      return 'Next year brings good fortune.';
    },
  },
  coins2x: { pool: 'big', text: 'Double market oil at tribute', coinMult: 2 },
  boom: {
    pool: 'big',
    text: '+2 population, +8 food',
    grant: ({ turn }) => {
      turn.population += 2;
      turn.food += 8;
      return '';
    },
  },
};

/** A random reward key from a pool ('small' | 'big'), or null for no pool. */
export function rollReward(pool) {
  if (!pool) return null;
  const keys = Object.keys(REWARDS).filter((k) => REWARDS[k].pool === pool);
  return keys[Math.floor(Math.random() * keys.length)];
}

/** This year's quota for a tier. */
export const scaledQuota = (base, tier) => Math.max(1, Math.round(base * TIERS[tier].mult));
