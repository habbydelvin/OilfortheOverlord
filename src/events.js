import { P } from './scalingConfig.js';

/** " (-4 now)" for a concrete amount this season, or '' when there's nothing to show. */
const now = (n, unit) => (n ? ` (${n > 0 ? '+' : ''}${n} ${unit} now)` : '');

/**
 * Year events: one is drawn at the start of every year from year 2 on, after the shop closes
 * and the tribute target is set (targets.js).
 * It lasts until the next tribute. See events.md for the full design list.
 *
 * kind:    'pressure' | 'disaster' | 'fortune' | 'choice'
 * scale:   id of the scaling entry (scalingConfig.js): its strength p (0..1) grows each year
 * mods:    (p) => numbers the economy and turn logic read while the event is active (or a plain object)
 *            farmPct       ± share of all farm food
 *            stationPct    ± share of all station crude
 *            capPct        ± share of the worker slots
 *            foodUpkeepPct share of the food grown, eaten on top each season
 *            yearLength    seasons before tribute (default 4)
 *            quotaMult     × this year's quota (applied once when the event starts)
 *            coinMult      × shop coins earned at this year's tribute
 * text:    (p, e) => effect text; e = the economy with the event applied (for the "now" numbers)
 * apply:   one-off effect when the event starts: (ctx) => report line or ''
 *            ctx = { turn, spawnRaider }, spawnRaider() => { text, effect } | null
 * choices: [{ label, text, say, retort, mods?, apply? }], the player picks one (text/mods as above)
 *
 * Dialogue (the Overlord introduces every event, see dialogue.js):
 *   lines:   what the Overlord says, one box each (or (p) => lines)
 *   replies: flavour answers for events without choices: [{ say, retort }]
 *   choices also carry `say` (the player's reply) and `retort` (the Overlord's answer)
 */
export const EVENTS = {
  earlyCollection: {
    name: 'Early Collection',
    kind: 'pressure',
    weight: 1,
    text: () => 'The Overlord wants his oil sooner. Tribute is due after Autumn: 3 seasons this year.',
    mods: { yearLength: 3 },
    lines: ['My engines grow thirsty, Overseer.', 'This year I collect after Autumn. Do not make me wait for Winter.'],
    replies: [
      { say: "Three seasons? That's impossible.", retort: 'Then make it possible. Or I will find an Overseer who can.' },
      { say: 'As you command, Overlord.', retort: 'Good. Obedience suits you.' },
      { say: '...', retort: 'Silence. Wise. Now go and pump.' },
    ],
  },
  titheOfMen: {
    name: 'Tithe of Men',
    kind: 'pressure',
    weight: 1,
    scale: 'tithe',
    text: (p, e) => `The Overlord drafts your workers into his army. -${P(p)} worker slots this year${now(e?.eventCap, 'worker slots')}.`,
    mods: (p) => ({ capPct: -p }),
    lines: (p) => ['My legions need bodies, and your city is full of them.', `I am taking ${P(p)} of your workers. Consider it an honour.`],
    replies: [
      { say: 'They are needed at the wells!', retort: 'They are needed where I say they are needed.' },
      { say: "Take them. We'll manage.", retort: 'You will. You have no choice.' },
      { say: 'Will they come back?', retort: 'No.' },
    ],
  },
  famine: {
    name: 'Famine',
    kind: 'disaster',
    weight: 1,
    scale: 'famine',
    text: (p, e) => `Blight in the hydro-tanks. Farms produce ${P(p)} less food this year${now(e?.eventFood, 'food')}.`,
    mods: (p) => ({ farmPct: -p }),
    lines: (p) => ['I hear a blight has crept into your hydro-tanks.', `Your farms will yield ${P(p)} less this year. My quota will not shrink.`],
    replies: [
      { say: 'Then lower the quota!', retort: 'Ha! Starve if you must. My oil will still arrive.' },
      { say: "We'll ration what we have.", retort: 'Sensible. Hungry men dig faster anyway.' },
      { say: 'Did you do this?', retort: 'Would it matter if I had?' },
    ],
  },
  bumperHarvest: {
    name: 'Bumper Harvest',
    kind: 'fortune',
    weight: 1,
    scale: 'bumper',
    text: (p, e) => `Clean rain for once. Farms produce +${P(p)} food this year${now(e?.eventFood, 'food')}.`,
    mods: (p) => ({ farmPct: p }),
    lines: (p) => ['Clean rain fell on your fields. How... fortunate.', `Your farms grow ${P(p)} more this year. Fat workers pump more oil. See that they do.`],
    replies: [
      { say: 'Thank you, Overlord.', retort: 'Do not thank me. Thank the sky, then fill my barrels.' },
      { say: "We'll put it to good use.", retort: 'You had better.' },
    ],
  },
  oilBoom: {
    name: 'Oil Boom',
    kind: 'fortune',
    weight: 1,
    scale: 'oilBoom',
    text: (p, e) => `Fresh seams under the sand. Oil stations pump +${P(p)} crude this year${now(e?.eventCrude, 'crude')}.`,
    mods: (p) => ({ stationPct: p }),
    lines: (p) => ['My surveyors found fresh seams beneath your sand.', `Every station will draw ${P(p)} more this year. And so will I.`],
    replies: [
      { say: 'The city will prosper.', retort: 'The city will deliver. Prosperity is my concern.' },
      { say: 'Does this mean a higher quota?', retort: 'Everything means a higher quota.' },
    ],
  },
  refugees: {
    name: 'Refugees at the Gate',
    kind: 'choice',
    weight: 1,
    scale: 'refugees',
    text: () => 'A column of refugees begs to be let in.',
    lines: ['A rabble of refugees crawls toward your gates.', 'Let them in and feed them, or turn them away and let the desert have them. Choose.'],
    choices: [
      {
        label: 'Take them in',
        text: (p, e) => `+${P(p)} worker slots, -${e?.eventUpkeep ?? 0} food each season`,
        say: 'Open the gates. They can work.',
        retort: 'More mouths, more hands. We shall see which wins.',
        mods: (p) => ({ capPct: p, foodUpkeepPct: p }),
      },
      {
        label: 'Turn them away',
        text: () => '+1 raider camp',
        say: "Close the gates. We can't feed them.",
        retort: 'Hard. I approve. Though they may not take it kindly.',
        apply: ({ spawnRaider }) => {
          const raid = spawnRaider();
          return raid ? `The refugees became raiders (${raid.effect}).` : '';
        },
      },
    ],
  },
  // (The Overlord's Offer event was replaced by the yearly tribute target, see targets.js.)
};

export const KIND_LABEL = { pressure: 'Pressure', disaster: 'Disaster', fortune: 'Good fortune', choice: 'Choice' };

/**
 * Pick next year's event, or null in year 1. A run of met tributes makes pressure and disasters
 * more likely; a recent missed tribute favours good fortune and choices.
 * `kinds` limits the draw to those kinds (a target reward forces good fortune).
 */
export function drawEvent(turn, { kinds } = {}) {
  if (turn.round < 2) return null;
  const streak = turn.metStreak ?? 0;
  const missed = turn.lastMissed ?? false;
  const factor = (kind) => {
    if (kind === 'pressure' || kind === 'disaster') return (1 + 0.25 * streak) * (missed ? 0.5 : 1);
    return missed ? 1.75 : 1;
  };
  const pool = Object.entries(EVENTS)
    .filter(([, ev]) => !kinds || kinds.includes(ev.kind))
    .map(([key, ev]) => [key, ev.weight * factor(ev.kind)]);
  if (!pool.length) return null;
  let r = Math.random() * pool.reduce((s, [, w]) => s + w, 0);
  for (const [key, w] of pool) {
    r -= w;
    if (r <= 0) return key;
  }
  return pool[pool.length - 1][0];
}
