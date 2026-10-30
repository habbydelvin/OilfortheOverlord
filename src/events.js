import { P } from './scalingConfig.js';
import { L, both } from './i18n.js';

/** " (-4 now)" for a concrete amount this season, or '' when there's nothing to show. */
const now = (n, unit, zhUnit) => {
  if (!n) return '';
  const v = `${n > 0 ? '+' : ''}${n}`;
  return L(` (${v} ${unit} now)`, `（当前 ${v} ${zhUnit}）`);
};

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
 *
 * Player-facing text (name, lines, replies, choice label/say/retort) is read through getters, so it
 * follows the current language (i18n.js).
 */
export const EVENTS = {
  earlyCollection: {
    get name() {
      return L('Early Collection', '提前征收');
    },
    kind: 'pressure',
    weight: 1,
    text: () =>
      L(
        'The Overlord wants his oil sooner. Tribute is due after Autumn: 3 seasons this year.',
        '霸主想早点拿到他的石油。今年秋季一过就要上缴贡品：只有 3 个季节。',
      ),
    mods: { yearLength: 3 },
    get lines() {
      return [
        L('My engines grow thirsty, Overseer.', '我的引擎渴了，总督。'),
        L('This year I collect after Autumn. Do not make me wait for Winter.', '今年秋季一过我就来收。别让我等到冬天。'),
      ];
    },
    get replies() {
      return [
        {
          say: L("Three seasons? That's impossible.", '三个季节？这不可能。'),
          retort: L('Then make it possible. Or I will find an Overseer who can.', '那就让它变得可能。否则我会另找一个做得到的总督。'),
        },
        { say: L('As you command, Overlord.', '遵命，霸主。'), retort: L('Good. Obedience suits you.', '很好。顺从很适合你。') },
        { say: '...', retort: L('Silence. Wise. Now go and pump.', '沉默。明智。现在去抽油吧。') },
      ];
    },
  },
  titheOfMen: {
    get name() {
      return L('Tithe of Men', '人丁之税');
    },
    kind: 'pressure',
    weight: 1,
    scale: 'tithe',
    text: (p, e) =>
      L(
        `The Overlord drafts your workers into his army. -${P(p)} worker slots this year${now(e?.eventCap, 'worker slots', '人力')}.`,
        `霸主把你的工人征入他的军队。今年人力 -${P(p)}${now(e?.eventCap, 'worker slots', '人力')}。`,
      ),
    mods: (p) => ({ capPct: -p }),
    lines: (p) => [
      L('My legions need bodies, and your city is full of them.', '我的军团需要人手，而你的城里多的是。'),
      L(`I am taking ${P(p)} of your workers. Consider it an honour.`, `我要带走你 ${P(p)} 的工人。就当是一份荣耀吧。`),
    ],
    get replies() {
      return [
        {
          say: L('They are needed at the wells!', '油井那边离不开他们！'),
          retort: L('They are needed where I say they are needed.', '我说哪里离不开他们，哪里就离不开他们。'),
        },
        { say: L("Take them. We'll manage.", '带走吧。我们能撑过去。'), retort: L('You will. You have no choice.', '你会的。你别无选择。') },
        {
          say: L('Will they come back?', '他们还会回来吗？'),
          retort: L('When I am done with them. If any are left.', '等我用完了他们。如果还有人剩下的话。'),
        },
      ];
    },
  },
  famine: {
    get name() {
      return L('Famine', '饥荒');
    },
    kind: 'disaster',
    weight: 1,
    scale: 'famine',
    text: (p, e) =>
      L(
        `Blight in the hydro-tanks. Farms produce ${P(p)} less food this year${now(e?.eventFood, 'food', '食物')}.`,
        `水培槽里爆发了枯萎病。今年农场的食物产量减少 ${P(p)}${now(e?.eventFood, 'food', '食物')}。`,
      ),
    mods: (p) => ({ farmPct: -p }),
    lines: (p) => [
      L('I hear a blight has crept into your hydro-tanks.', '我听说枯萎病已经爬进了你的水培槽。'),
      L(`Your farms will yield ${P(p)} less this year. My quota will not shrink.`, `今年你的农场将减产 ${P(p)}。我的配额可不会缩水。`),
    ],
    get replies() {
      return [
        {
          say: L('Then lower the quota!', '那就降低配额！'),
          retort: L('Ha! Starve if you must. My oil will still arrive.', '哈！要饿死就饿死吧。我的石油照样得送到。'),
        },
        {
          say: L("We'll ration what we have.", '我们会把现有的粮食配给着用。'),
          retort: L('Sensible. Hungry men dig faster anyway.', '明智。反正饿着肚子的人挖得更快。'),
        },
        { say: L('Did you do this?', '这是你干的吗？'), retort: L('Would it matter if I had?', '就算是我干的，又有什么区别？') },
      ];
    },
  },
  bumperHarvest: {
    get name() {
      return L('Bumper Harvest', '大丰收');
    },
    kind: 'fortune',
    weight: 1,
    scale: 'bumper',
    text: (p, e) =>
      L(
        `Clean rain for once. Farms produce +${P(p)} food this year${now(e?.eventFood, 'food', '食物')}.`,
        `难得下了一场干净的雨。今年农场的食物产量 +${P(p)}${now(e?.eventFood, 'food', '食物')}。`,
      ),
    mods: (p) => ({ farmPct: p }),
    lines: (p) => [
      L('Clean rain fell on your fields. How... fortunate.', '干净的雨水落在了你的田里。真是……幸运。'),
      L(
        `Your farms grow ${P(p)} more this year. Fat workers pump more oil. See that they do.`,
        `今年你的农场多产 ${P(p)}。吃饱的工人能抽更多的油。给我盯紧了。`,
      ),
    ],
    get replies() {
      return [
        {
          say: L('Thank you, Overlord.', '谢谢您，霸主。'),
          retort: L('Do not thank me. Thank the sky, then fill my barrels.', '别谢我。去谢老天，然后把我的油桶装满。'),
        },
        { say: L("We'll put it to good use.", '我们会好好利用的。'), retort: L('You had better.', '最好如此。') },
      ];
    },
  },
  oilBoom: {
    get name() {
      return L('Oil Boom', '石油热潮');
    },
    kind: 'fortune',
    weight: 1,
    scale: 'oilBoom',
    text: (p, e) =>
      L(
        `Fresh seams under the sand. Oil stations pump +${P(p)} crude this year${now(e?.eventCrude, 'crude', '石油')}.`,
        `沙下发现了新的油层。今年采油站的原油产量 +${P(p)}${now(e?.eventCrude, 'crude', '石油')}。`,
      ),
    mods: (p) => ({ stationPct: p }),
    lines: (p) => [
      L('My surveyors found fresh seams beneath your sand.', '我的勘测员在你的沙地下发现了新的油层。'),
      L(`Every station will draw ${P(p)} more this year. And so will I.`, `今年每座采油站都会多抽 ${P(p)}。我也一样。`),
    ],
    get replies() {
      return [
        {
          say: L('The city will prosper.', '城市会繁荣起来的。'),
          retort: L('The city will deliver. Prosperity is my concern.', '城市要做的是交货。繁荣是我的事。'),
        },
        {
          say: L('Does this mean a higher quota?', '这是不是意味着配额要提高了？'),
          retort: L('Everything means a higher quota.', '一切都意味着配额要提高。'),
        },
      ];
    },
  },
  refugees: {
    get name() {
      return L('Refugees at the Gate', '城门外的难民');
    },
    kind: 'choice',
    weight: 1,
    scale: 'refugees',
    text: () => L('A column of refugees begs to be let in.', '一队难民乞求入城。'),
    get lines() {
      return [
        L('A rabble of refugees crawls toward your gates.', '一群难民正朝你的城门爬过来。'),
        L(
          'Let them in and feed them, or turn them away and let the desert have them. Choose.',
          '放他们进来，喂饱他们；或者把他们赶走，让沙漠收了他们。选吧。',
        ),
      ];
    },
    choices: [
      {
        get label() {
          return L('Take them in', '收留他们');
        },
        text: (p, e) =>
          L(
            `+${P(p)} worker slots, -${e?.eventUpkeep ?? 0} food each season`,
            `人力 +${P(p)}，每季 -${e?.eventUpkeep ?? 0} 食物`,
          ),
        get say() {
          return L('Open the gates. They can work.', '打开城门。他们能干活。');
        },
        get retort() {
          return L('More mouths, more hands. We shall see which wins.', '多了嘴，也多了手。看看哪一边占上风。');
        },
        mods: (p) => ({ capPct: p, foodUpkeepPct: p }),
      },
      {
        get label() {
          return L('Turn them away', '把他们赶走');
        },
        text: () => L('+1 rebel camp', '+1 叛军营地'),
        get say() {
          return L("Close the gates. We can't feed them.", '关上城门。我们养不起他们。');
        },
        get retort() {
          return L('Hard. I approve. Though they may not take it kindly.', '够狠。我赞成。不过他们未必会善罢甘休。');
        },
        apply: ({ spawnRaider }) => {
          const raid = spawnRaider();
          return raid ? both(() => L(`The refugees became raiders (${raid.effect}).`, `难民变成了掠夺者（${raid.effect}）。`)) : '';
        },
      },
    ],
  },
  // (The Overlord's Offer event was replaced by the yearly tribute target, see targets.js.)

  showOfForce: {
    get name() {
      return L('Show of Force', '武力示威');
    },
    kind: 'pressure',
    weight: 1,
    text: () =>
      L(
        'Your diggers uncover Pre-war Ruins. A dormant missile inside wakes and strikes one of your buildings.',
        '你的挖掘队挖出了战前遗迹。里面一枚沉睡的导弹苏醒过来，击中了你的一座建筑。',
      ),
    when: (info) => info.buildings > 0 && info.open > 0,
    get lines() {
      return [
        L(
          'Your diggers struck something old beneath the sand. Pre-war ruins, and a silo.',
          '你的挖掘队在沙下挖到了古老的东西。战前遗迹，还有一座导弹井。',
        ),
        L(
          'Its last missile still knows where to fly. Consider it a reminder of what I keep in mine.',
          '它的最后一枚导弹依然记得该飞往何处。就当是提醒你，我自己的导弹井里藏着什么。',
        ),
      ];
    },
    get replies() {
      return [
        { say: L('Stop it! Disarm it!', '快阻止它！拆掉它！'), retort: L('Too late, Overseer. Watch the sky.', '太迟了，总督。看看天上吧。') },
        { say: L('Can you stop it?', '你能阻止它吗？'), retort: L("I could. Consider why I don't.", '我能。好好想想我为什么不。') },
      ];
    },
    apply: ({ showOfForce }) => showOfForce(),
  },
  drought: {
    get name() {
      return L('Drought', '干旱');
    },
    kind: 'disaster',
    weight: 1,
    text: (p, e) =>
      L(
        `The wells run dry. Water Pumps and Oases give no bonus this year${now(e && -e.droughtFood, 'food', '食物')}.`,
        `水井干涸了。今年水泵站和绿洲不提供加成${now(e && -e.droughtFood, 'food', '食物')}。`,
      ),
    mods: { drought: true },
    get lines() {
      return [
        L('Not a drop has fallen in months. Your pumps cough sand.', '几个月来一滴雨都没下。你的水泵咳出来的全是沙子。'),
        L('Your oases are mud. The farms will have to make do. As will you.', '你的绿洲成了泥塘。农场只能将就了。你也一样。'),
      ];
    },
    get replies() {
      return [
        {
          say: L('The farms will wither!', '农场会枯萎的！'),
          retort: L('Then let them wither. Oil does not need rain.', '那就让它们枯萎。石油可不需要雨水。'),
        },
        {
          say: L("We'll ration the water.", '我们会限量用水。'),
          retort: L('See that you ration it away from my oil.', '限量可以，别限到我的石油头上。'),
        },
      ];
    },
  },
  dustStorm: {
    get name() {
      return L('Dust Storm', '沙尘暴');
    },
    kind: 'disaster',
    weight: 1,
    text: () =>
      L(
        'Sand buries the outskirts. Every hand this year comes with one extra Wasteland.',
        '黄沙掩埋了城郊。今年每轮手牌都会多出一块荒地。',
      ),
    mods: { extraWaste: 1 },
    get lines() {
      return [
        L('A wall of sand is rolling over your city.', '一堵沙墙正朝你的城市滚滚压来。'),
        L('Wherever it settles, the land dies.', '它落在哪里，哪里的土地就会死去。'),
      ];
    },
    get replies() {
      return [
        {
          say: L('We will build around it.', '我们会绕开它建造。'),
          retort: L('Build faster. The sand will not wait, and neither will I.', '那就建快点。沙子不会等你，我也不会。'),
        },
        { say: L('Can nothing stop it?', '就没有什么能阻止它吗？'), retort: L('I could. I will not.', '我能。但我不会。') },
      ];
    },
  },
  earthquake: {
    get name() {
      return L('Earthquake', '地震');
    },
    kind: 'disaster',
    weight: 1,
    text: (p, e, info) =>
      L(
        `The ground splits: ${info?.cliffs ?? 3} empty cells next to your land turn into Cliffs.`,
        `大地裂开：你领地旁的 ${info?.cliffs ?? 3} 个空格变成了悬崖。`,
      ),
    when: (info) => info.open > 0,
    get lines() {
      return [
        L('Did you feel that, Overseer? The earth itself is tired of you.', '你感觉到了吗，总督？连大地都厌倦你了。'),
        L('Cliffs have torn open at the edge of your city. Build around them.', '你的城市边缘裂开了悬崖。绕开它们建造吧。'),
      ];
    },
    get replies() {
      return [
        {
          say: L('Was anyone hurt?', '有人受伤吗？'),
          retort: L('Nothing of value. The wells still stand.', '没什么值钱的。油井都还在。'),
        },
        { say: L('We will build around them.', '我们会绕开它们建造。'), retort: L('Good. Adapt or be buried.', '很好。要么适应，要么被埋。') },
      ];
    },
    apply: ({ earthquake }) => earthquake(),
  },

  mercenaries: {
    get name() {
      return L('Mercenaries', '雇佣兵');
    },
    kind: 'choice',
    weight: 1,
    scale: 'mercenaries',
    text: () => L('A mercenary company offers to clear out every camp in your city.', '一支雇佣兵团愿意清剿你城里的所有营地。'),
    when: (info) => info.camps > 0,
    get lines() {
      return [
        L(
          'A company of mercenaries has come to my attention. Killers, but tidy ones.',
          '一支雇佣兵团引起了我的注意。都是杀手，但干活利落。',
        ),
        L(
          'They will burn out every rebel and bandit camp in your city. I will add their fee to your tribute. Well?',
          '他们会烧光你城里每一座叛军营地和匪营。他们的酬金我会加进你的贡品里。怎么样？',
        ),
      ];
    },
    choices: [
      {
        get label() {
          return L('Hire them', '雇用他们');
        },
        text: (p, e, info) => {
          const n = info?.camps ?? 0;
          const oil = Math.round((info?.quota ?? 0) * p);
          return L(
            `${n === 1 ? 'The camp' : `All ${n} camps`} cleared, tribute +${P(p)} (+${oil} oil)`,
            `${n === 1 ? '清除该营地' : `清除全部 ${n} 座营地`}，贡品 +${P(p)}（+${oil} 石油）`,
          );
        },
        get say() {
          return L('Hire them. Clear the streets.', '雇用他们。把街道清理干净。');
        },
        get retort() {
          return L('A sensible purchase. The fee is mine, of course.', '明智的买卖。酬金当然归我。');
        },
        mods: (p) => ({ quotaMult: 1 + p }),
        apply: ({ clearAllCamps }) => {
          const n = clearAllCamps();
          return n ? L(`The mercenaries cleared ${n} camp${n === 1 ? '' : 's'}.`, `雇佣兵清除了 ${n} 座营地。`) : '';
        },
      },
      {
        get label() {
          return L('Refuse them', '拒绝他们');
        },
        text: () => L('The camps stay', '营地保留'),
        get say() {
          return L('We will deal with our own.', '我们自己的麻烦自己解决。');
        },
        get retort() {
          return L('Proud. We shall see how proud you are at tribute.', '真骄傲。到上缴贡品的时候，看你还骄傲得起来。');
        },
      },
    ],
  },
  prospectors: {
    get name() {
      return L('Prospectors', '探矿者');
    },
    kind: 'choice',
    weight: 1,
    scale: 'prospectors',
    text: () =>
      L(
        'Prospectors offer a map to a hidden site, or a cut of the oil they found.',
        '探矿者愿意卖给你一张通往隐藏地点的地图，或者分你一份他们找到的石油。',
      ),
    when: (info) => info.sites > 0,
    get lines() {
      return [
        L('Prospectors have wandered in from the deep desert, Overseer.', '有一批探矿者从沙漠深处游荡过来了，总督。'),
        L(
          'They will sell you a map to a buried site, or a share of the crude they struck. One or the other.',
          '他们可以卖给你一张埋藏地点的地图，或者分你一份他们挖到的原油。二选一。',
        ),
      ];
    },
    choices: [
      {
        get label() {
          return L('Buy the map', '买下地图');
        },
        text: () => L('Reveal the "?" site closest to your land', '揭开离你领地最近的神秘地点（“?”）'),
        get say() {
          return L('Show us where to dig.', '告诉我们该往哪儿挖。');
        },
        get retort() {
          return L('Curiosity. Let us hope it pays.', '好奇心。但愿它能带来回报。');
        },
        disabled: (info) => !info.sites,
        apply: ({ prospect }) => prospect(),
      },
      {
        get label() {
          return L('Take the oil', '拿走石油');
        },
        text: (p, e, info) => {
          const n = Math.max(1, Math.round((info?.quota ?? 0) * p));
          return L(`+${n} oil in the stockpile now (${P(p)} of the tribute)`, `石油库存立即 +${n} 石油（相当于贡品的 ${P(p)}）`);
        },
        get say() {
          return L("We'll take the crude.", '我们要原油。');
        },
        get retort() {
          return L('Good. Barrels, not maps.', '很好。要油桶，不要地图。');
        },
        apply: ({ turn, p }) => {
          const n = Math.max(1, Math.round(turn.quota * p));
          turn.stockpile += n;
          return L(`The prospectors sold you ${n} barrels.`, `探矿者卖给你 ${n} 桶石油。`);
        },
      },
    ],
  },
  blackMarket: {
    get name() {
      return L('Black Market Caravan', '黑市商队');
    },
    kind: 'choice',
    weight: 1,
    text: () => L('A smuggler caravan offers its services for the year.', '一支走私商队愿意今年为你效劳。'),
    get lines() {
      return [
        L(
          'A caravan of smugglers has parked outside your walls. I tolerate them. For now.',
          '一支走私商队在你的城墙外扎了营。我容忍他们。暂时。',
        ),
        L(
          'They will cut you a deal on goods, or bring in extra supplies all year. Pick.',
          '他们可以给你的货物打折，或者全年给你多运些物资。选吧。',
        ),
      ];
    },
    choices: [
      {
        get label() {
          return L('Cheap goods', '廉价货物');
        },
        text: () => L("Shop prices halved at this year's tribute", '今年上缴贡品时市场价格减半'),
        get say() {
          return L('We want their prices.', '我们要他们的低价。');
        },
        get retort() {
          return L('Spend wisely. I will be watching your ledger.', '花钱长点脑子。我会盯着你的账本。');
        },
        mods: { shopMult: 0.5 },
      },
      {
        get label() {
          return L('Extra supplies', '额外物资');
        },
        text: () => L('+1 card in every hand this year', '今年每轮手牌 +1 张卡牌'),
        get say() {
          return L('Bring us supplies.', '给我们运物资来。');
        },
        get retort() {
          return L('More scrap for your little city. How quaint.', '给你的小城多添点破烂。真是可爱。');
        },
        mods: { handBonus: 1 },
      },
    ],
  },
  taxSettlements: {
    get name() {
      return L('Tax the Settlements', '向定居点征税');
    },
    kind: 'choice',
    weight: 1,
    text: () => L('The Overlord suggests squeezing the settlements for oil.', '霸主建议压榨定居点，榨出石油。'),
    when: (info) => info.settlements > 0,
    get lines() {
      return [
        L('Your settlements are fat, Overseer. Squeeze them.', '你的定居点养得太肥了，总督。榨一榨。'),
        L(
          'Tax them in oil this year, and accept that some will flee the work. Or spare them, if you are soft.',
          '今年向他们征收石油，并接受会有人逃避劳役。或者放过他们，如果你心软的话。',
        ),
      ];
    },
    choices: [
      {
        get label() {
          return L('Tax them', '征税');
        },
        text: (p, e, info) => {
          const n = info?.settlements ?? 0;
          return L(
            `+2 oil per settlement each season (+${2 * n} oil), -1 worker slot per settlement (-${n} slot${n === 1 ? '' : 's'})`,
            `每个定居点每季 +2 石油（+${2 * n} 石油），每个定居点 -1 人力（-${n} 人力）`,
          );
        },
        get say() {
          return L('Tax them.', '征税。');
        },
        get retort() {
          return L('Now you are learning.', '你总算开窍了。');
        },
        mods: { settlementOil: 2, settlementSlots: -1 },
      },
      {
        get label() {
          return L('Spare them', '放过他们');
        },
        text: () => L('Nothing changes', '一切照旧'),
        get say() {
          return L('Leave them be.', '别去管他们。');
        },
        get retort() {
          return L('Soft. I will remember it.', '心软。我会记住的。');
        },
      },
    ],
  },
};

export const KIND_LABEL = {
  get pressure() {
    return L('Pressure', '压力');
  },
  get disaster() {
    return L('Disaster', '灾难');
  },
  get fortune() {
    return L('Good fortune', '好运');
  },
  get choice() {
    return L('Choice', '抉择');
  },
};

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
