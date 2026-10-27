/**
 * Year events: one is drawn at the start of every year from year 2 on, after the shop closes.
 * It lasts until the next tribute. See events.md for the full design list.
 *
 * kind:    'pressure' | 'disaster' | 'fortune' | 'choice'
 * mods:    numbers the economy and turn logic read while the event is active
 *            farmMult      × farm food
 *            stationBonus  + oil per staffed station
 *            capDelta      + worker slots (can be negative)
 *            foodUpkeep    + food eaten per season
 *            yearLength    seasons before tribute (default 4)
 *            quotaMult     × this year's quota (applied once when the event starts)
 *            coinMult      × shop coins earned at this year's tribute
 * apply:   one-off effect when the event starts: (ctx) => report line or ''
 *            ctx = { turn, spawnRaider }
 * choices: [{ label, text, say, retort, mods?, apply? }], the player picks one
 *
 * Dialogue (the Overlord introduces every event, see dialogue.js):
 *   lines:   what the Overlord says, one box each
 *   replies: flavour answers for events without choices: [{ say, retort }]
 *   choices also carry `say` (the player's reply) and `retort` (the Overlord's answer)
 */
export const EVENTS = {
  earlyCollection: {
    name: 'Early Collection',
    kind: 'pressure',
    weight: 1,
    text: 'The Overlord wants his oil sooner. Tribute is due after Autumn: 3 seasons this year.',
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
    text: 'The Overlord drafts your workers into his army. -3 worker slots this year.',
    mods: { capDelta: -3 },
    lines: ['My legions need bodies, and your city is full of them.', 'I am taking three of your workers. Consider it an honour.'],
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
    text: 'Blight in the hydro-tanks. Farms produce half food this year.',
    mods: { farmMult: 0.5 },
    lines: ['I hear a blight has crept into your hydro-tanks.', 'Your farms will yield half this year. My quota will not.'],
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
    text: 'Clean rain for once. Farms produce +50% food this year.',
    mods: { farmMult: 1.5 },
    lines: ['Clean rain fell on your fields. How... fortunate.', 'Your farms grow half again as much this year. Fat workers pump more oil. See that they do.'],
    replies: [
      { say: 'Thank you, Overlord.', retort: 'Do not thank me. Thank the sky, then fill my barrels.' },
      { say: "We'll put it to good use.", retort: 'You had better.' },
    ],
  },
  oilBoom: {
    name: 'Oil Boom',
    kind: 'fortune',
    weight: 1,
    text: 'Fresh seams under the sand. Oil stations give +1 oil each this year.',
    mods: { stationBonus: 1 },
    lines: ['My surveyors found fresh seams beneath your sand.', 'Every station will draw one more barrel this year. And so will I.'],
    replies: [
      { say: 'The city will prosper.', retort: 'The city will deliver. Prosperity is my concern.' },
      { say: 'Does this mean a higher quota?', retort: 'Everything means a higher quota.' },
    ],
  },
  refugees: {
    name: 'Refugees at the Gate',
    kind: 'choice',
    weight: 1,
    text: 'A column of refugees begs to be let in.',
    lines: ['A rabble of refugees crawls toward your gates.', 'Let them in and feed them, or turn them away and let the desert have them. Choose.'],
    choices: [
      {
        label: 'Take them in',
        text: '+3 worker slots, -3 food each season this year',
        say: 'Open the gates. They can work.',
        retort: 'More mouths, more hands. We shall see which wins.',
        mods: { capDelta: 3, foodUpkeep: 3 },
      },
      {
        label: 'Turn them away',
        text: 'They turn to raiding: 1 raider camp',
        say: "Close the gates. We can't feed them.",
        retort: 'Hard. I approve. Though they may not take it kindly.',
        apply: ({ spawnRaider }) => (spawnRaider() ? 'The refugees became raiders (-2 worker slots).' : ''),
      },
    ],
  },
  overlordsOffer: {
    name: "Overlord's Offer",
    kind: 'choice',
    weight: 1,
    text: 'The Overlord is in a bargaining mood.',
    lines: [
      'I am feeling generous today, Overseer. Do not get used to it.',
      'Ask for mercy and I will lighten this year\u2019s tribute. Ask for a reward and I will pay you well... for more oil.',
    ],
    choices: [
      {
        label: 'Ask for mercy',
        text: 'This year\u2019s quota -30%',
        say: 'Lighten the tribute. Please.',
        retort: 'Mercy. How predictable. Thirty percent less, this once.',
        mods: { quotaMult: 0.7 },
      },
      {
        label: 'Ask for a reward',
        text: 'Quota +30%, double shop coins at tribute',
        say: 'Raise it. And pay us for it.',
        retort: 'Ambition! Thirty percent more, then. Do not disappoint me.',
        mods: { quotaMult: 1.3, coinMult: 2 },
      },
    ],
  },
};

export const KIND_LABEL = { pressure: 'Pressure', disaster: 'Disaster', fortune: 'Good fortune', choice: 'Choice' };

/**
 * Pick next year's event, or null in year 1. A run of met tributes makes pressure and disasters
 * more likely; a recent missed tribute favours good fortune and choices.
 */
export function drawEvent(turn) {
  if (turn.round < 2) return null;
  const streak = turn.metStreak ?? 0;
  const missed = turn.lastMissed ?? false;
  const factor = (kind) => {
    if (kind === 'pressure' || kind === 'disaster') return (1 + 0.25 * streak) * (missed ? 0.5 : 1);
    return missed ? 1.75 : 1;
  };
  const pool = Object.entries(EVENTS).map(([key, ev]) => [key, ev.weight * factor(ev.kind)]);
  let r = Math.random() * pool.reduce((s, [, w]) => s + w, 0);
  for (const [key, w] of pool) {
    r -= w;
    if (r <= 0) return key;
  }
  return pool[pool.length - 1][0];
}
