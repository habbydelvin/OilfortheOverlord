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

import { L } from './i18n.js';

/** Consecutive Low picks before the Overlord forces High. */
export const LOW_STREAK_LIMIT = 3;

export const TIERS = {
  low: {
    get label() {
      return L('Low', '低');
    },
    mult: 0.85,
    pool: null, // no reward
    get say() {
      return L('A modest target, Overlord. We will not fail you.', '一个稳妥的目标，霸主。我们不会让您失望。');
    },
    get retort() {
      return L(
        'Timid. But a sure barrel is worth more than a promised one. This once.',
        '胆小。不过一桶到手的油，胜过一桶许诺的油。就这一次。',
      );
    },
  },
  medium: {
    get label() {
      return L('Medium', '中');
    },
    mult: 1,
    pool: 'small',
    get say() {
      return L('The full tribute, as you demand.', '如您所求，足额贡品。');
    },
    get retort() {
      return L(
        'As it should be. Deliver, and you will be paid for it.',
        '本该如此。交得出货，你就能拿到报酬。',
      );
    },
  },
  high: {
    get label() {
      return L('High', '高');
    },
    mult: 1.25,
    pool: 'big',
    get say() {
      return L('Raise it. We will give you more.', '提高目标。我们会给您更多。');
    },
    get retort() {
      return L(
        'Ambition! I like it. Fill my tanks and you will be rewarded handsomely.',
        '野心！我喜欢。把我的油罐灌满，你会得到丰厚的奖赏。',
      );
    },
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
  coins50: {
    pool: 'small',
    get text() {
      return L('+50% market oil at tribute', '上缴贡品时市场石油 +50%');
    },
    coinMult: 1.5,
  },
  food: {
    pool: 'small',
    get text() {
      return L('+6 food in the store', '粮仓 +6 食物');
    },
    grant: ({ turn }) => {
      turn.food += 6;
      return '';
    },
  },
  freeReroll: {
    pool: 'small',
    get text() {
      return L('2 free hand rerolls', '2 次免费手牌重抽');
    },
    grant: ({ turn }) => {
      turn.freeRerolls += 2;
      return '';
    },
  },
  pop: {
    pool: 'small',
    get text() {
      return L('+1 population', '+1 人口');
    },
    grant: ({ turn }) => {
      turn.population += 1;
      return '';
    },
  },

  // ---- big (High) ----
  cardPick: {
    pool: 'big',
    get text() {
      return L('Pick 1 of 3 market tiles for free', '从 3 块市场地块中免费挑选 1 块');
    },
    grant: ({ turn }) => {
      turn.cardPicks += 1;
      return L('A free tile pick awaits at the start of next year.', '明年年初可免费挑选一块地块。');
    },
  },
  fortune: {
    pool: 'big',
    get text() {
      return L('A good-fortune event next year', '明年出现一次好运事件');
    },
    grant: ({ turn }) => {
      turn.forceFortune = true;
      return L('Next year brings good fortune.', '明年将会好运临门。');
    },
  },
  coins2x: {
    pool: 'big',
    get text() {
      return L('Double market oil at tribute', '上缴贡品时市场石油翻倍');
    },
    coinMult: 2,
  },
  boom: {
    pool: 'big',
    get text() {
      return L('+2 population, +8 food', '+2 人口，+8 食物');
    },
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
