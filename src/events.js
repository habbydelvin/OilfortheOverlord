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
 *            shopMult      × shop prices at this year's tribute
 *            drought       pumps and oases give no bonus
 *            extraWaste    extra Wasteland pieces dealt into every hand
 *            handBonus     extra cards in every hand
 *            settlementOil / settlementSlots   oil / worker slots per settlement each season
 * text:    (p, e, info) => effect text; e = the economy with the event applied (for the "now" numbers),
 *            info = { quota, camps, sites, settlements, cliffs } (see eventInfo in main.js)
 * when:    (info) => false to skip this event in the draw (nothing for it to act on)
 * apply:   one-off effect when the event starts: (ctx) => report line or ''
 *            ctx = { turn, p, info, spawnRaider, clearAllCamps, prospect, earthquake, showOfForce }
 * choices: [{ label, text, say, retort, mods?, apply?, disabled?(info) }], the player picks one
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
      { say: 'Will they come back?', retort: 'When I am done with them. If any are left.' },
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

  showOfForce: {
    name: 'Show of Force',
    kind: 'pressure',
    weight: 1,
    text: () => 'Your diggers uncover Pre-war Ruins. A dormant missile inside wakes and strikes one of your buildings.',
    when: (info) => info.buildings > 0 && info.open > 0,
    lines: [
      'Your diggers struck something old beneath the sand. Pre-war ruins, and a silo.',
      'Its last missile still knows where to fly. Consider it a reminder of what I keep in mine.',
    ],
    replies: [
      { say: 'Stop it! Disarm it!', retort: 'Too late, Overseer. Watch the sky.' },
      { say: 'Can you stop it?', retort: "I could. Consider why I don't." },
    ],
    apply: ({ showOfForce }) => showOfForce(),
  },
  drought: {
    name: 'Drought',
    kind: 'disaster',
    weight: 1,
    text: (p, e) => `The wells run dry. Water Pumps and Oases give no bonus this year${now(e && -e.droughtFood, 'food')}.`,
    mods: { drought: true },
    lines: ['Not a drop has fallen in months. Your pumps cough sand.', 'Your oases are mud. The farms will have to make do. As will you.'],
    replies: [
      { say: 'The farms will wither!', retort: 'Then let them wither. Oil does not need rain.' },
      { say: "We'll ration the water.", retort: 'See that you ration it away from my oil.' },
    ],
  },
  dustStorm: {
    name: 'Dust Storm',
    kind: 'disaster',
    weight: 1,
    text: () => 'Sand buries the outskirts. Every hand this year comes with one extra Wasteland.',
    mods: { extraWaste: 1 },
    lines: ['A wall of sand is rolling over your city.', 'Wherever it settles, the land dies.'],
    replies: [
      { say: 'We will build around it.', retort: 'Build faster. The sand will not wait, and neither will I.' },
      { say: 'Can nothing stop it?', retort: 'I could. I will not.' },
    ],
  },
  earthquake: {
    name: 'Earthquake',
    kind: 'disaster',
    weight: 1,
    text: (p, e, info) => `The ground splits: ${info?.cliffs ?? 3} empty cells next to your land turn into Cliffs.`,
    when: (info) => info.open > 0,
    lines: ['Did you feel that, Overseer? The earth itself is tired of you.', 'Cliffs have torn open at the edge of your city. Build around them.'],
    replies: [
      { say: 'Was anyone hurt?', retort: 'Nothing of value. The wells still stand.' },
      { say: 'We will build around them.', retort: 'Good. Adapt or be buried.' },
    ],
    apply: ({ earthquake }) => earthquake(),
  },

  mercenaries: {
    name: 'Mercenaries',
    kind: 'choice',
    weight: 1,
    scale: 'mercenaries',
    text: () => 'A mercenary company offers to clear out every camp in your city.',
    when: (info) => info.camps > 0,
    lines: [
      'A company of mercenaries has come to my attention. Killers, but tidy ones.',
      'They will burn out every rebel and bandit camp in your city. I will add their fee to your tribute. Well?',
    ],
    choices: [
      {
        label: 'Hire them',
        text: (p, e, info) => {
          const n = info?.camps ?? 0;
          return `${n === 1 ? 'The camp' : `All ${n} camps`} cleared, tribute +${P(p)} (+${Math.round((info?.quota ?? 0) * p)} oil)`;
        },
        say: 'Hire them. Clear the streets.',
        retort: 'A sensible purchase. The fee is mine, of course.',
        mods: (p) => ({ quotaMult: 1 + p }),
        apply: ({ clearAllCamps }) => {
          const n = clearAllCamps();
          return n ? `The mercenaries cleared ${n} camp${n === 1 ? '' : 's'}.` : '';
        },
      },
      {
        label: 'Refuse them',
        text: () => 'The camps stay',
        say: 'We will deal with our own.',
        retort: 'Proud. We shall see how proud you are at tribute.',
      },
    ],
  },
  prospectors: {
    name: 'Prospectors',
    kind: 'choice',
    weight: 1,
    scale: 'prospectors',
    text: () => 'Prospectors offer a map to a hidden site, or a cut of the oil they found.',
    when: (info) => info.sites > 0,
    lines: ['Prospectors have wandered in from the deep desert, Overseer.', 'They will sell you a map to a buried site, or a share of the crude they struck. One or the other.'],
    choices: [
      {
        label: 'Buy the map',
        text: () => 'Reveal the "?" site closest to your land',
        say: 'Show us where to dig.',
        retort: 'Curiosity. Let us hope it pays.',
        disabled: (info) => !info.sites,
        apply: ({ prospect }) => prospect(),
      },
      {
        label: 'Take the oil',
        text: (p, e, info) => `+${Math.max(1, Math.round((info?.quota ?? 0) * p))} oil in the stockpile now (${P(p)} of the tribute)`,
        say: "We'll take the crude.",
        retort: 'Good. Barrels, not maps.',
        apply: ({ turn, p }) => {
          const n = Math.max(1, Math.round(turn.quota * p));
          turn.stockpile += n;
          return `The prospectors sold you ${n} barrels.`;
        },
      },
    ],
  },
  blackMarket: {
    name: 'Black Market Caravan',
    kind: 'choice',
    weight: 1,
    text: () => 'A smuggler caravan offers its services for the year.',
    lines: ['A caravan of smugglers has parked outside your walls. I tolerate them. For now.', 'They will cut you a deal on goods, or bring in extra supplies all year. Pick.'],
    choices: [
      {
        label: 'Cheap goods',
        text: () => 'Shop prices halved at this year\'s tribute',
        say: 'We want their prices.',
        retort: 'Spend wisely. I will be watching your ledger.',
        mods: { shopMult: 0.5 },
      },
      {
        label: 'Extra supplies',
        text: () => '+1 card in every hand this year',
        say: 'Bring us supplies.',
        retort: 'More scrap for your little city. How quaint.',
        mods: { handBonus: 1 },
      },
    ],
  },
  taxSettlements: {
    name: 'Tax the Settlements',
    kind: 'choice',
    weight: 1,
    text: () => 'The Overlord suggests squeezing the settlements for oil.',
    when: (info) => info.settlements > 0,
    lines: ['Your settlements are fat, Overseer. Squeeze them.', 'Tax them in oil this year, and accept that some will flee the work. Or spare them, if you are soft.'],
    choices: [
      {
        label: 'Tax them',
        text: (p, e, info) => {
          const n = info?.settlements ?? 0;
          return `+2 oil per settlement each season (+${2 * n} oil), -1 worker slot per settlement (-${n} slot${n === 1 ? '' : 's'})`;
        },
        say: 'Tax them.',
        retort: 'Now you are learning.',
        mods: { settlementOil: 2, settlementSlots: -1 },
      },
      {
        label: 'Spare them',
        text: () => 'Nothing changes',
        say: 'Leave them be.',
        retort: 'Soft. I will remember it.',
      },
    ],
  },
};

export const KIND_LABEL = { pressure: 'Pressure', disaster: 'Disaster', fortune: 'Good fortune', choice: 'Choice' };

/**
 * Pick next year's event, or null in year 1. A run of met tributes makes pressure and disasters
 * more likely; a recent missed tribute favours good fortune and choices.
 * `kinds` limits the draw to those kinds (a target reward forces good fortune).
 */
export function drawEvent(turn, { kinds, info } = {}) {
  if (turn.round < 2) return null;
  const streak = turn.metStreak ?? 0;
  const missed = turn.lastMissed ?? false;
  const factor = (kind) => {
    if (kind === 'pressure' || kind === 'disaster') return (1 + 0.25 * streak) * (missed ? 0.5 : 1);
    return missed ? 1.75 : 1;
  };
  const pool = Object.entries(EVENTS)
    .filter(([, ev]) => (!kinds || kinds.includes(ev.kind)) && (!info || !ev.when || ev.when(info)))
    .map(([key, ev]) => [key, ev.weight * factor(ev.kind)]);
  if (!pool.length) return null;
  let r = Math.random() * pool.reduce((s, [, w]) => s + w, 0);
  for (const [key, w] of pool) {
    r -= w;
    if (r <= 0) return key;
  }
  return pool[pool.length - 1][0];
}
