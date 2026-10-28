/**
 * First-contact scenes with the city's enemies. Each plays once per run:
 *   Rebel Leader  — the first raider camp from starvation (or turned-away refugees).
 *   Bandit Leader — the first bandit camp drawn by a 3×3 block of Wasteland.
 * Later camps arrive silently (just the season report line).
 *
 * The replies have real consequences. The scene gets a small context from main.js:
 *   { dialogue, turn, camp: { x, z, name, effect }, clearCamp(x, z), punish(), pinMilitia() }
 * and resolves with a report line describing what happened.
 */

/** Costs and penalties for the replies. Tune freely. */
export const LEADER_COSTS = {
  feedRebels: 5, // food spent to disperse the rebels
  crushPopulation: 1, // population lost crushing them (food instead if there is no population)
  crushFoodFallback: 3,
  bribeShare: 0.25, // share of the oil stockpile the bandits ask for
  bribeMin: 3, // ...but never less than this
};

const REBEL = 'Rebel Leader';
const BANDIT = 'Bandit Leader';
const REPORT = 'Field Report';

export async function playRebelScene({ dialogue, turn, camp, clearCamp, punish }) {
  dialogue.open({
    kind: 'disaster',
    kindLabel: 'Unrest',
    title: 'The People Rise',
    effect: `A rebel camp has formed in your city (${camp.effect ?? 'fewer worker slots'})`,
  });
  await dialogue.say(REBEL, 'Overseer. You sit in your tower counting barrels while the workers count ribs.');
  await dialogue.say(REBEL, "The Overlord's tanks drink better than our children.");
  await dialogue.say(REBEL, 'We have made camp in your streets. Until there is bread, there will be no hands for your pumps.');

  const food = LEADER_COSTS.feedRebels;
  const canFeed = turn.food >= food;
  const i = await dialogue.ask(REBEL, 'So. What will the Overseer do?', [
    { text: 'Open the stores. Feed them.', tag: canFeed ? `-${food} food · camp leaves` : 'not enough food', disabled: !canFeed },
    {
      text: 'Crush them.',
      tag: turn.population >= LEADER_COSTS.crushPopulation
        ? `camp leaves · -${LEADER_COSTS.crushPopulation} population`
        : `camp leaves · -${LEADER_COSTS.crushFoodFallback} food`,
    },
    { text: "I'll fix the harvest.", tag: 'no effect' },
  ]);

  let line;
  if (i === 0) {
    turn.food -= food;
    clearCamp(camp.x, camp.z);
    await dialogue.say(REBEL, "...Bread. Fine. We'll remember this.");
    line = `<span class="good">You fed the rebels and they dispersed (-${food} food).</span>`;
  } else if (i === 1) {
    clearCamp(camp.x, camp.z);
    const cost = punish();
    await dialogue.say(REBEL, 'You can bury us. The hunger stays.');
    line = `<span class="bad">You crushed the rebellion (${cost}).</span>`;
  } else {
    await dialogue.say(REBEL, "Words. We'll wait. Hungry people are patient, until they aren't.");
    line = '<span class="bad">The rebels stay camped until your people are fed.</span>';
  }
  await dialogue.leave();
  return line;
}

export async function playBanditScene({ dialogue, turn, camp, clearCamp, pinMilitia }) {
  dialogue.open({
    kind: 'disaster',
    kindLabel: 'Raid',
    title: 'Convoys Ambushed',
    effect: `Bandits have settled your wasteland: ${camp.name} (${camp.effect})`,
  });
  await dialogue.say(
    REPORT,
    'Three of your supply convoys never reached the Hive City. Burnt-out trucks were found in the empty wastes past the city edge.',
  );
  await dialogue.say(BANDIT, 'Your trucks carried a lot of fuel for a city that leaves so much land empty.');
  await dialogue.say(BANDIT, 'All that dead sand you lay down, Overseer, makes a fine home for my wolves.');

  const price = Math.max(LEADER_COSTS.bribeMin, Math.ceil(turn.stockpile * LEADER_COSTS.bribeShare));
  const canPay = turn.stockpile >= price;
  const i = await dialogue.ask(BANDIT, 'So we come to terms. Or we come to blows.', [
    { text: 'Name your price.', tag: canPay ? `-${price} oil · camp leaves` : 'not enough oil', disabled: !canPay },
    { text: 'The militia will burn you out.', tag: 'free Send in the Militia next hand' },
    { text: 'Take what you want and go.', tag: 'no effect' },
  ]);

  let line;
  if (i === 0) {
    turn.stockpile -= price;
    clearCamp(camp.x, camp.z);
    await dialogue.say(BANDIT, "A businessman. I like that. We'll find other roads to rob.");
    line = `<span class="good">You paid off the bandits (-${price} oil). Their camp is gone.</span>`;
  } else if (i === 1) {
    const pinned = pinMilitia();
    await dialogue.say(BANDIT, "Let them come. Bring more trucks while you're at it.");
    line = pinned
      ? '<span class="good">Send in the Militia is waiting in your next hand.</span>'
      : '<span class="bad">Your next hand was already full: no militia this time.</span>';
  } else {
    await dialogue.say(BANDIT, "Oh, we'll take it. Every season.");
    line = '<span class="bad">The bandits stay in the wasteland.</span>';
  }
  await dialogue.leave();
  return line;
}
