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

import { L } from './i18n.js';

/** Costs and penalties for the replies. Tune freely. */
export const LEADER_COSTS = {
  feedRebels: 5, // food spent to disperse the rebels
  crushPopulation: 1, // population lost crushing them (food instead if there is no population)
  crushFoodFallback: 3,
  bribeShare: 0.25, // share of the oil stockpile the bandits ask for
  bribeMin: 3, // ...but never less than this
};

// Speaker ids (also the portrait keys); dialogue.js shows them translated.
const REBEL = 'Rebel Leader';
const BANDIT = 'Bandit Leader';
const REPORT = 'Field Report';

export async function playRebelScene({ dialogue, turn, camp, clearCamp, punish }) {
  dialogue.open({
    kind: 'disaster',
    kindLabel: L('Unrest', '动乱'),
    title: L('The People Rise', '民众起义'),
    // A function: the camp's text is read again if the language changes during the scene.
    effect: () =>
      L(
        `A rebel camp has formed in your city (${camp.effect ?? 'fewer worker slots'})`,
        `你的城里出现了一座叛军营地（${camp.effect ?? '人力减少'}）`,
      ),
  });
  await dialogue.say(
    REBEL,
    L(
      'Overseer. You sit in your tower counting barrels while the workers count ribs.',
      '总督。你坐在高塔里数着油桶，工人们却在数自己的肋骨。',
    ),
  );
  await dialogue.say(REBEL, L("The Overlord's tanks drink better than our children.", '霸主的油罐喝得都比我们的孩子好。'));
  await dialogue.say(
    REBEL,
    L(
      'We have made camp in your streets. Until there is bread, there will be no hands for your pumps.',
      '我们已经在你的街道上扎营。没有面包，你的油泵就别想有人手。',
    ),
  );

  const food = LEADER_COSTS.feedRebels;
  const canFeed = turn.food >= food;
  const i = await dialogue.ask(REBEL, L('So. What will the Overseer do?', '那么，总督打算怎么办？'), [
    {
      text: L('Open the stores. Feed them.', '打开粮仓。给他们吃的。'),
      tag: canFeed ? L(`-${food} food · camp leaves`, `-${food} 食物 · 营地撤走`) : L('not enough food', '食物不足'),
      disabled: !canFeed,
    },
    {
      text: L('Crush them.', '镇压他们。'),
      tag: turn.population >= LEADER_COSTS.crushPopulation
        ? L(`camp leaves · -${LEADER_COSTS.crushPopulation} population`, `营地撤走 · -${LEADER_COSTS.crushPopulation} 人口`)
        : L(`camp leaves · -${LEADER_COSTS.crushFoodFallback} food`, `营地撤走 · -${LEADER_COSTS.crushFoodFallback} 食物`),
    },
    { text: L("I'll fix the harvest.", '我会解决收成问题。'), tag: L('no effect', '无效果') },
  ]);

  let line;
  if (i === 0) {
    turn.food -= food;
    clearCamp(camp.x, camp.z);
    await dialogue.say(REBEL, L("...Bread. Fine. We'll remember this.", '……面包。好吧。我们会记住的。'));
    line = L(
      `<span class="good">You fed the rebels and they dispersed (-${food} food).</span>`,
      `<span class="good">你给叛军发了粮食，他们散去了（-${food} 食物）。</span>`,
    );
  } else if (i === 1) {
    clearCamp(camp.x, camp.z);
    const cost = punish();
    await dialogue.say(REBEL, L('You can bury us. The hunger stays.', '你可以埋了我们。饥饿却埋不掉。'));
    line = L(`<span class="bad">You crushed the rebellion (${cost}).</span>`, `<span class="bad">你镇压了叛乱（${cost}）。</span>`);
  } else {
    await dialogue.say(
      REBEL,
      L("Words. We'll wait. Hungry people are patient, until they aren't.", '空话。我们等着。饿肚子的人很有耐心，直到他们不再有耐心。'),
    );
    line = L(
      '<span class="bad">The rebels stay camped until your people are fed.</span>',
      '<span class="bad">在你的人民吃饱之前，叛军会一直驻扎下去。</span>',
    );
  }
  await dialogue.leave();
  return line;
}

export async function playBanditScene({ dialogue, turn, camp, clearCamp, pinMilitia }) {
  dialogue.open({
    kind: 'disaster',
    kindLabel: L('Raid', '袭击'),
    title: L('Convoys Ambushed', '车队遇伏'),
    effect: () => L(`Bandits have settled your wasteland: ${camp.name} (${camp.effect})`, `土匪占据了你的荒地：${camp.name}（${camp.effect}）`),
  });
  await dialogue.say(
    REPORT,
    L(
      'Three of your supply convoys never reached the Hive City. Burnt-out trucks were found in the empty wastes past the city edge.',
      '你的三支补给车队没能抵达蜂巢城。在城市边缘外的空旷荒野中发现了烧毁的卡车残骸。',
    ),
  );
  await dialogue.say(
    BANDIT,
    L('Your trucks carried a lot of fuel for a city that leaves so much land empty.', '一座留着这么多空地的城市，卡车上的燃料倒是装得不少。'),
  );
  await dialogue.say(
    BANDIT,
    L('All that dead sand you lay down, Overseer, makes a fine home for my wolves.', '你铺下的那些死沙地，总督，正好给我的狼群安家。'),
  );

  const price = Math.max(LEADER_COSTS.bribeMin, Math.ceil(turn.stockpile * LEADER_COSTS.bribeShare));
  const canPay = turn.stockpile >= price;
  const i = await dialogue.ask(BANDIT, L('So we come to terms. Or we come to blows.', '那么，要么谈条件，要么动刀子。'), [
    {
      text: L('Name your price.', '开个价吧。'),
      tag: canPay ? L(`-${price} oil · camp leaves`, `-${price} 石油 · 营地撤走`) : L('not enough oil', '石油不足'),
      disabled: !canPay,
    },
    { text: L('The militia will burn you out.', '民兵会把你们烧个精光。'), tag: L('free Send in the Militia next hand', '下轮手牌获得免费的派遣民兵') },
    { text: L('Take what you want and go.', '想要什么就拿走，然后滚。'), tag: L('no effect', '无效果') },
  ]);

  let line;
  if (i === 0) {
    turn.stockpile -= price;
    clearCamp(camp.x, camp.z);
    await dialogue.say(BANDIT, L("A businessman. I like that. We'll find other roads to rob.", '是个生意人。我喜欢。我们去别的路上抢。'));
    line = L(
      `<span class="good">You paid off the bandits (-${price} oil). Their camp is gone.</span>`,
      `<span class="good">你收买了土匪（-${price} 石油）。他们的营地消失了。</span>`,
    );
  } else if (i === 1) {
    const pinned = pinMilitia();
    await dialogue.say(BANDIT, L("Let them come. Bring more trucks while you're at it.", '让他们来。顺便多带几辆卡车。'));
    line = pinned
      ? L(
          '<span class="good">Send in the Militia is waiting in your next hand.</span>',
          '<span class="good">派遣民兵已在你的下轮手牌中等候。</span>',
        )
      : L(
          '<span class="bad">Your next hand was already full: no militia this time.</span>',
          '<span class="bad">你的下轮手牌已满：这次没有民兵。</span>',
        );
  } else {
    await dialogue.say(BANDIT, L("Oh, we'll take it. Every season.", '哦，我们会拿的。每个季节都拿。'));
    line = L('<span class="bad">The bandits stay in the wasteland.</span>', '<span class="bad">土匪留在了荒地里。</span>');
  }
  await dialogue.leave();
  return line;
}
