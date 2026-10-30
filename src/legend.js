/**
 * Icon legend: a small window on the left (opened from the "Icon legend" button in the top-left column) listing
 * every icon and marker the board shows, each next to its name, with a short description on hover: the buildings'
 * map icons, the boosters with their "+n" tag, the "?" sites, idle buildings, the neon tiles of boosted buildings,
 * and the resources.
 */
import { ICONS } from './tiles.js';
import { MAP_ICONS } from './zoomIcons.js';
import { NEON } from './neonGlow.js';
import { L, onLangChange } from './i18n.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const attr = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** A map icon as it looks over a tile (the round badge), optionally greyed or with a "+n" tag. */
const badge = (icon, { idle = false, boost = null } = {}) =>
  `<span class="map-icon legend-ico${idle ? ' idle' : ''}">${icon}${boost ? `<span class="map-boost"><b>+n</b>${ICONS[boost]}</span>` : ''}</span>`;
const plain = (icon) => `<span class="legend-ico legend-plain">${icon}</span>`;
const mystery = () => '<span class="legend-ico legend-mystery">?</span>';
const neon = (colour) => `<span class="legend-ico legend-neon" style="--neon:${hex(colour)}"></span>`;

/** [section title, [[icon, name, description], ...]] */
function sections() {
  return [
    [
      L('Buildings', '建筑'),
      [
        [badge(MAP_ICONS.crown), L('Capital', '首都'), L('Your city: +4 manpower, eats 3 food each season. Buildings next to it trigger twice.', '你的城市：+4 人力，每季消耗 3 食物。相邻建筑触发两次。')],
        [badge(ICONS.food), L('Hydro-farm', '水培农场'), L('Grows 2 food each season. Needs 1 worker.', '每季产出 2 食物。需要 1 人力。')],
        [badge(ICONS.oil), L('Oil Station', '采油站'), L('Pumps 2 crude oil each season. Needs 1 worker.', '每季开采 2 原油。需要 1 人力。')],
        [badge(ICONS.manpower), L('Settlement · Labour Camp', '定居点 · 劳工营'), L('Settlements house workers (+2 manpower, eat 2 food). A Labour Camp adds +2 manpower next to a Settlement.', '定居点提供人力（+2 人力，消耗 2 食物）。劳工营与定居点相邻时 +2 人力。')],
        [badge(MAP_ICONS.ruins), L('Pre-war Ruins', '战前遗迹'), L('Build next to it to clear it. Clearing refills your hand to 5 cards.', '在相邻处建造即可清理。清理后手牌补满 5 张。')],
      ],
    ],
    [
      L('Boosters (+n: added to neighbours)', '增益地块（+n：为相邻地块增加）'),
      [
        [badge(MAP_ICONS.water, { boost: 'food' }), L('Water Pump', '水泵站'), L('Hydro-farms next to it grow +2 food.', '相邻的水培农场 +2 食物。')],
        [badge(MAP_ICONS.palm, { boost: 'food' }), L('Oasis', '绿洲'), L('Hydro-farms next to it grow +3 food.', '相邻的水培农场 +3 食物。')],
        [badge(MAP_ICONS.tar, { boost: 'oil' }), L('Tar Pit', '焦油坑'), L('Oil Stations next to it pump +2 oil.', '相邻的采油站 +2 石油。')],
        [badge(MAP_ICONS.refinery, { boost: 'oil' }), L('Refinery', '炼油厂'), L('Makes its own oil: half the crude of each staffed Oil Station next to it. Needs 1 worker.', '自行产油：每座相邻且有人力的采油站原油的一半。需要 1 人力。')],
      ],
    ],
    [
      L('Markers', '标记'),
      [
        [mystery(), L('"?" site', '神秘地点'), L('Something is hidden here. Build next to it to reveal it.', '这里藏着什么。在相邻处建造即可揭示。')],
        [badge(MAP_ICONS.devil), L('Bandit / rebel camp', '匪营 / 叛军营地'), L('Hostile camp: it steals from you each season (workers, food or oil). Send in the Militia to clear it.', '敌对营地：每季都会偷走你的资源（人力、食物或石油）。派遣民兵即可清除。')],
        [badge(ICONS.food, { idle: true }), L('Idle building', '闲置建筑'), L('Not enough manpower to staff it: it produces nothing until a worker is free.', '人力不足，无人运作：在有空闲人力前不产出任何东西。')],
      ],
    ],
    [
      L('Glowing tiles', '发光地块'),
      [
        [neon(NEON.farm), L('Boosted Hydro-farm', '受增益的水培农场'), L('Next to a Water Pump, Oasis or the Capital. Glows brighter with each one.', '与水泵站、绿洲或首都相邻。每多一个，光芒越亮。')],
        [neon(NEON.station), L('Boosted Oil Station', '受增益的采油站'), L('Next to a Tar Pit, the Capital or a staffed Refinery. Glows brighter with each one.', '与焦油坑、首都或有人力的炼油厂相邻。每多一个，光芒越亮。')],
        [neon(NEON.settlement), L('Boosted Settlement', '受增益的定居点'), L('Next to a Labour Camp.', '与劳工营相邻。')],
      ],
    ],
    [
      L('Resources', '资源'),
      [
        [plain(ICONS.food), L('Food', '食物'), L('Feeds the Capital and Settlements. Spare food is banked in the food stores.', '供养首都和定居点。多余的食物存入粮仓。')],
        [plain(ICONS.oil), L('Oil', '石油'), L('The Overlord\'s tribute. The stockpile is taken after Winter.', '献给霸主的贡品。冬季过后石油库存会被收走。')],
        [plain(ICONS.manpower), L('Manpower', '人力'), L('Workers to staff farms, Oil Stations and Refineries.', '为农场、采油站和炼油厂提供人手。')],
      ],
    ],
  ];
}

export function setupLegend(button, panel) {
  const render = () => {
    const blocks = sections()
      .map(
        ([title, rows]) =>
          `<div class="legend-block"><div class="legend-section">${title}</div>` +
          rows.map(([icon, name, tip]) => `<div class="legend-row" data-tip="${attr(tip)}">${icon}<span>${name}</span></div>`).join('') +
          '</div>',
      )
      .join('');
    panel.innerHTML =
      `<div class="legend-head"><span>${L('Icon legend', '图标说明')}</span><button class="legend-x" type="button" title="${L('Close', '关闭')}">×</button></div>` +
      `<div class="legend-cols">${blocks}</div>`;
  };
  const setOpen = (open) => {
    if (open) render();
    panel.classList.toggle('hidden', !open);
    button.classList.toggle('on', open);
  };
  button.addEventListener('click', (e) => {
    e.currentTarget.blur();
    setOpen(panel.classList.contains('hidden'));
  });
  panel.addEventListener('click', (e) => {
    if (e.target.closest('.legend-x')) setOpen(false);
  });
  onLangChange(() => !panel.classList.contains('hidden') && render());
}
