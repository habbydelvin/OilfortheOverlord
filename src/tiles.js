import * as THREE from 'three';
import { clone as cloneModel } from 'three/addons/utils/SkeletonUtils.js';
import { hasBlockout, loadCoreModels, loadBundle, loadWastePieces } from './models.js';
import { SHAPES } from './shapes.js';
import { buildRaiderCamp } from './raiderMesh.js';
import { buildLabourCamp } from './labourCampMesh.js';
import { buildInterceptBunker } from './interceptMesh.js';
import { copySeam } from './seamlessGround.js';
import { MISSILE } from './missiles.js';
import { SCALE } from './scalingConfig.js';
import { L } from './i18n.js';
import { hexToWorld, hexRound, hexDistance, hexesAround, cellSeed, cellsCentre } from './grid.js';
import { hexPrism } from './hexGeometry.js';

/**
 * Desert dieselpunk tile set. Flat colours only for now, detail comes later.
 *
 * category:  'building' (part of the economy), 'land' (terrain with an effect), 'junk' (clogs the hand)
 * buildable: true if a building piece may later be placed on top of this tile
 * weight:    relative draw weight in the hand (0 = never drawn)
 * rule:      card text, effects separated by ' · ' (one per line)
 * trigger:   heading above the rule ('On trigger' for anything that produces each season)
 * stats:     data for the future economy pass (not calculated yet)
 * snapshot:  optional image URL shown in the card's picture slot (e.g. '/cards/snapshots/refinery.jpg')
 */
export const TERRAINS = {
  // ---- buildings ----
  capital: {
    name: 'Capital',
    trigger: 'Passive',
    top: 0x8a8f96,
    edge: 0x5f646b,
    category: 'building',
    buildable: false,
    weight: 0, // only the starting tile
    rule: '+4 worker slots · Adjacent buildings trigger twice',
    stats: { food: -3, manpower: 4 },
  },
  settlement: {
    name: 'Settlement',
    trigger: 'Passive',
    top: 0xa0643c,
    edge: 0x74452a,
    category: 'building',
    buildable: false,
    weight: 2,
    rule: '+2 worker slots',
    stats: { food: -2, manpower: 2, ruinsBonusManpower: 1 },
  },
  farm: {
    name: 'Hydro-farm',
    trigger: 'On trigger',
    top: 0x6fae4a,
    edge: 0x4d7f32,
    category: 'building',
    buildable: false,
    weight: 3,
    rule: '+2 food',
    stats: { food: 2, manpower: -1, adjacent: { pump: { food: 2 } } },
  },
  pump: {
    name: 'Water Pump',
    trigger: 'Passive',
    top: 0x3f8fc0,
    edge: 0x2b6890,
    category: 'building',
    buildable: false,
    weight: 1,
    rule: 'Adjacent farms +2 food',
    stats: {},
  },
  station: {
    name: 'Oil Station',
    trigger: 'On trigger',
    top: 0x3a3a3a,
    edge: 0x222222,
    category: 'building',
    buildable: false,
    weight: 3,
    rule: '+2 oil',
    stats: { manpower: -1, oil: 2, adjacent: { tarpit: { oil: 2 } } },
  },
  refinery: {
    name: 'Refinery',
    trigger: 'On trigger',
    top: 0xd0782a,
    edge: 0x99551b,
    category: 'building',
    buildable: false,
    weight: 1,
    rule: '1× oil per adjacent station',
    stats: { manpower: -1, oilMultiplierPerAdjacent: { station: 1 } },
  },
  milfactory: {
    name: 'Military Factory',
    trigger: 'On trigger',
    top: 0x6a3a32,
    edge: 0x3e221c,
    category: 'building',
    buildable: false,
    weight: 0.5,
    rule: '-3 oil each season · After one year, produce 1 Missile',
    stats: { oil: -3 },
  },
  missilelab: {
    name: 'Missile Recipe Lab',
    trigger: 'Passive',
    top: 0x4a5a6e,
    edge: 0x2f3c4a,
    category: 'building',
    buildable: false,
    weight: 0.5,
    rule: 'Adjacent Military Factories produce +1 Missile',
    stats: { manpower: -2 },
  },
  warhead: {
    name: 'Warhead Institute',
    trigger: 'Passive',
    top: 0x8a5a28,
    edge: 0x5c3a18,
    category: 'building',
    buildable: false,
    weight: 0.5,
    rule: 'Each staffed lab adds 1 neighbouring tile to missile blast',
    stats: { manpower: -2 },
  },
  intercept: {
    name: 'Intercept Network',
    trigger: 'When adjacent tiles are attacked',
    top: 0x3a6a5a,
    edge: 0x24463c,
    category: 'building',
    buildable: false,
    weight: 0.5,
    rule: 'Spend 3 oil to stop one hit on an adjacent building',
    stats: {},
  },
  magazine: {
    name: 'Missile Magazine',
    trigger: 'Passive',
    top: 0x4a5238,
    edge: 0x2c3220,
    category: 'building',
    buildable: false,
    weight: 0.5,
    rule: 'Missile capacity +1',
    stats: { manpower: -2, missileCap: 1 },
  },

  // ---- wasteland (4 cosmetic variants, share one draw weight: 4 × 1.34 ≈ 30% of draws) ----
  wasteland1: {
    name: 'Wasteland',
    trigger: 'Junk',
    top: 0xd8bf8a,
    edge: 0xae9564,
    category: 'junk',
    buildable: false,
    weight: 1.34,
    rule: 'A cluster of 7 (one and all 6 around it) may draw Bandit Camps',
    stats: {},
  },
  wasteland2: {
    name: 'Wasteland',
    trigger: 'Junk',
    top: 0xcfb27a,
    edge: 0xa58a56,
    category: 'junk',
    buildable: false,
    weight: 1.34,
    rule: 'A cluster of 7 (one and all 6 around it) may draw Bandit Camps',
    stats: {},
  },
  wasteland3: {
    name: 'Wasteland',
    trigger: 'Junk',
    top: 0xc9a86c,
    edge: 0x9e804a,
    category: 'junk',
    buildable: false,
    weight: 1.34,
    rule: 'A cluster of 7 (one and all 6 around it) may draw Bandit Camps',
    stats: {},
  },
  wasteland4: {
    name: 'Wasteland',
    trigger: 'Junk',
    top: 0xdcc79a,
    edge: 0xb19f72,
    category: 'junk',
    buildable: false,
    weight: 1.34,
    rule: 'A cluster of 7 (one and all 6 around it) may draw Bandit Camps',
    stats: {},
  },

  // ---- land ----
  oasis: {
    name: 'Oasis',
    trigger: 'Passive',
    top: 0x3fbfae,
    edge: 0x2a8f82,
    category: 'land',
    buildable: false,
    weight: 0.5,
    rule: 'Adjacent farms +3 food',
    stats: { adjacentBonus: { farm: { food: 3 } } },
  },
  tarpit: {
    name: 'Tar Pit',
    trigger: 'Passive',
    top: 0x2a1f2e,
    edge: 0x170f1a,
    category: 'land',
    buildable: false,
    weight: 0.5,
    rule: 'Adjacent oil stations +2 oil',
    stats: { adjacentBonus: { station: { oil: 2 } } }, // +2 total, not stacked
  },
  labourcamp: {
    name: 'Labour Camp',
    trigger: 'Passive',
    top: 0x8a7a5a,
    edge: 0x5f543d,
    category: 'land',
    buildable: false,
    weight: 0.5,
    rule: '+2 worker slots next to a Settlement · +4 worker slots if all 6 sides are Settlements',
    // Flat, not per Settlement: +2 with any Settlement next to it, +2 more once all six neighbours are Settlements.
    stats: { adjacentManpower: { settlement: 2 }, surroundedManpower: { settlement: 2 } },
  },
  cliffs: {
    name: 'Cliffs',
    trigger: 'Junk',
    top: 0x8c4a32,
    edge: 0x633322,
    category: 'junk',
    buildable: false,
    weight: 0.75,
    rule: 'Can\'t be built on',
    stats: {},
  },
  ruins: {
    name: 'Pre-war Ruins',
    trigger: 'Passive',
    top: 0x9a9284,
    edge: 0x6f685c,
    category: 'land',
    buildable: false,
    weight: 0, // already on the map, never drawn
    rule: 'Build next to it to clear · Clearing refills your hand to 5',
    stats: {},
  },
  crater: {
    name: 'Toxic Crater',
    trigger: 'Junk',
    top: 0x9acd32,
    edge: 0x6e9420,
    category: 'junk',
    buildable: false,
    weight: 0, // only created by the overlord
    rule: '-1 worker slot, -1 food per adjacent farm/settlement',
    stats: { adjacentPenalty: { farm: { manpower: -1, food: -1 }, settlement: { manpower: -1, food: -1 } } },
  },
  raider: {
    name: 'Rebel Camp',
    trigger: 'Passive',
    top: 0x7a3a2a,
    edge: 0x52261b,
    category: 'junk',
    buildable: false,
    weight: 0, // only spawned when the food runs out (net ≤ 0 and empty stores)
    get rule() {
      return `-${SCALE.rebelSlots} worker slots`;
    },
    stats: { drain: 'slots' },
  },

  // ---- bandit camps: settle in a full cluster of 7 Wasteland (one and its 6 neighbours) at the end of a season ----
  // Permanent: only "Send in the Militia" clears them (Demolish can't).
  bandit_raider: {
    name: 'Raider Hideout',
    trigger: 'Passive',
    top: 0x7a3a2a,
    edge: 0x52261b,
    category: 'junk',
    buildable: false,
    weight: 0, // only spawned in a full cluster of 7 Wasteland
    bandit: true,
    tent: 0x8c2f22,
    get rule() {
      return `-${SCALE.banditSlots} worker slots`;
    },
    stats: { drain: 'banditSlots' },
  },
  bandit_siphon: {
    name: 'Siphoner Camp',
    trigger: 'Passive',
    top: 0x2f2a26,
    edge: 0x1c1916,
    category: 'junk',
    buildable: false,
    weight: 0,
    bandit: true,
    tent: 0x22201e,
    get rule() {
      return `-${SCALE.banditOil} oil`;
    },
    stats: { drain: 'oil' },
  },
  bandit_scav: {
    name: 'Scavenger Camp',
    trigger: 'Passive',
    top: 0x6b6a2e,
    edge: 0x47461d,
    category: 'junk',
    buildable: false,
    weight: 0,
    bandit: true,
    tent: 0x6f7a2a,
    get rule() {
      return `-${SCALE.banditFood} food`;
    },
    stats: { drain: 'food' },
  },
};

/** Bandit camp terrains (the wasteland spawns pick one at random). */
export const BANDIT_KEYS = Object.keys(TERRAINS).filter((k) => TERRAINS[k].bandit);
/** Any camp: starvation raiders or wasteland bandits. */
export const isCamp = (terrain) => terrain === 'raider' || Boolean(TERRAINS[terrain]?.bandit);

/**
 * Action cards: bought in the shop, played on the board for a one-off effect, never become tiles.
 * range: Chebyshev radius of the cells they affect (0 = just the target cell).
 * size:  instead of range, an N×N square with the target cell as its corner.
 */
export const ACTIONS = {
  spark: {
    name: 'Spark',
    trigger: 'On play',
    top: 0x8a4a8f,
    edge: 0x5f2f63,
    category: 'action',
    symbol: '✶',
    range: 1,
    weight: 0.4, // small chance in random draws (≈3%)
    rule: 'Trigger a tile and the 6 around it',
  },
  demolish: {
    name: 'Demolish',
    trigger: 'On play',
    top: 0x9b3e36,
    edge: 0x6e2a24,
    category: 'action',
    symbol: '✕',
    range: 0,
    weight: 0.4,
    rule: 'Remove a tile',
  },
  demolish2: {
    name: 'Wrecking Crew',
    trigger: 'On play',
    top: 0xb5452f,
    edge: 0x7a2c1e,
    category: 'action',
    symbol: '⊠',
    size: 2, // a diamond of 4 cells, the hovered cell at its top (instead of a range around it)
    weight: 0.4,
    rule: 'Remove up to 4 tiles in a diamond',
  },
  militia: {
    name: 'Send in the Militia',
    trigger: 'On play',
    top: 0x4f6b3a,
    edge: 0x354a26,
    category: 'action',
    symbol: '⚔',
    range: 0,
    weight: 0, // shop only
    rule: 'Clear one bandit or rebel camp',
  },
  missile: {
    name: 'Missile',
    trigger: 'On play',
    top: 0x7a3a2a,
    edge: 0x4e241a,
    category: 'action',
    symbol: '▲',
    range: 0,
    weight: 0, // produced by a Military Factory
    get rule() {
      return `Destroy ${MISSILE.blast ?? 1} tile${(MISSILE.blast ?? 1) === 1 ? '' : 's'} · −${MISSILE.damage ?? 1} capital HP`;
    },
  },
  missile2: {
    name: 'Missile',
    trigger: 'On play',
    top: 0x9b3e28,
    edge: 0x5c2418,
    category: 'action',
    symbol: '▲',
    size: 2,
    weight: 0, // produced next to a Warhead Institute
    get rule() {
      return `Destroy 2×2 · −${MISSILE.damage ?? 1} capital HP`;
    },
  },
  salvo: {
    name: 'Salvo',
    trigger: 'On play',
    top: 0x9b3424,
    edge: 0x5c1c14,
    category: 'action',
    symbol: '⁂',
    range: 0,
    weight: 0, // strike hand only, when 3+ missiles
    rule: 'Drag onto a tile: every missile in hand fans out from there',
  },
  overtime: {
    name: 'Work Overtime',
    trigger: 'On play',
    top: 0x6e4a2a,
    edge: 0x46301c,
    category: 'action',
    symbol: '⌛',
    range: 0,
    weight: 0.4,
    rule: 'Spend 2 oil: a Military Factory gains +1 season of progress',
  },
};

const TRIGGER_ZH = {
  Passive: '被动',
  'On trigger': '触发时',
  Junk: '废料',
  'On play': '打出时',
  'When adjacent tiles are attacked': '周围地块被攻击时',
};
const WASTELAND_ZH = { name: '荒地', rule: '7 格荒地群（一格及其周围 6 格）可能引来匪营' };

/** Chinese name and rule for each card; a function rule reads the live SCALE values like the English getter. */
const ZH = {
  capital: { name: '首都', rule: '+4 人力 · 相邻建筑触发两次' },
  settlement: { name: '定居点', rule: '+2 人力', trigger: '被动（不能重复结算）' },
  farm: { name: '水培农场', rule: '+2 食物' },
  pump: { name: '水泵站', rule: '相邻农场 +2 食物' },
  station: { name: '采油站', rule: '+2 石油' },
  refinery: { name: '炼油厂', rule: '每个相邻采油站 1× 石油' },
  wasteland1: WASTELAND_ZH,
  wasteland2: WASTELAND_ZH,
  wasteland3: WASTELAND_ZH,
  wasteland4: WASTELAND_ZH,
  oasis: { name: '绿洲', rule: '相邻农场 +3 食物' },
  tarpit: { name: '焦油坑', rule: '相邻采油站 +2 石油' },
  labourcamp: { name: '劳工营', rule: '紧邻定居点时 +2 人力 · 六面皆为定居点时 +4 人力' },
  cliffs: { name: '悬崖', rule: '无法在其上建造' },
  ruins: { name: '战前遗迹', rule: '在旁边建造即可清除 · 清除后手牌补至 5 张' },
  crater: { name: '毒坑', rule: '每个相邻农场/定居点 -1 人力，-1 食物' },
  raider: {
    name: '叛军营地',
    rule: () => `-${SCALE.rebelSlots} 人力`,
  },
  bandit_raider: { name: '掠夺者巢穴', rule: () => `-${SCALE.banditSlots} 人力` },
  bandit_siphon: { name: '窃油者营地', rule: () => `-${SCALE.banditOil} 石油` },
  bandit_scav: { name: '拾荒者营地', rule: () => `-${SCALE.banditFood} 食物` },
  spark: { name: '火花', rule: '触发一个地块及其周围 6 个地块' },
  demolish: { name: '拆除', rule: '移除一个地块' },
  demolish2: { name: '拆迁队', rule: '移除菱形范围内至多 4 个地块' },
  militia: { name: '派遣民兵', rule: '清除一个匪营或叛军营地' },
  milfactory: { name: '军事工厂', rule: '每季 -3 石油 · 一年后生产 1 枚导弹' },
  missilelab: { name: '导弹配方改良所', rule: '相邻军事工厂生产导弹数量 +1' },
  warhead: { name: '弹头研究所', rule: '每座开工的研究所使导弹爆炸再多打相邻 1 格' },
  intercept: { name: '拦截网络', rule: '花费 3 石油，阻止相邻建筑被攻击一次' },
  magazine: { name: '储弹仓', rule: '导弹容量 +1' },
  missile: { name: '导弹', rule: () => `摧毁 ${MISSILE.blast ?? 1} 格 · 首都 −${MISSILE.damage ?? 1}` },
  salvo: { name: '齐射', rule: '拖到一格上：手中每枚导弹从该处铺开瞄准' },
  missile2: { name: '导弹', rule: () => `摧毁 2×2 · 首都 −${MISSILE.damage ?? 1}` },
  overtime: { name: '熬夜加班', rule: '花费 2 石油：一座军事工厂生产进度 +1 季' },
};

// name, trigger and rule become getters that answer in the current language (the English stays above).
for (const [key, def] of Object.entries({ ...TERRAINS, ...ACTIONS })) {
  const zh = { trigger: TRIGGER_ZH[def.trigger], ...ZH[key] };
  for (const field of ['name', 'trigger', 'rule']) {
    const d = Object.getOwnPropertyDescriptor(def, field);
    if (!d) continue;
    const en = d.get ? () => d.get.call(def) : () => d.value;
    const z = zh[field];
    Object.defineProperty(def, field, {
      get: () => L(en(), typeof z === 'function' ? z() : z),
      enumerable: true,
      configurable: true,
    });
  }
}
/** Resource icons (inline SVG, tinted by CSS via the res-* class). */
export const ICONS = {
  manpower:
    '<svg class="ico res-mp" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4" fill="currentColor"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z" fill="currentColor"/></svg>',
  food:
    '<svg class="ico res-food" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7.5c-1.6-1.3-4.6-1.6-6.4.3C3.4 10.1 4 14.6 6.3 17.9c1.4 2 3 3.4 4.4 2.9.6-.2.9-.4 1.3-.4s.7.2 1.3.4c1.4.5 3-.9 4.4-2.9 2.3-3.3 2.9-7.8.7-10.1-1.8-1.9-4.8-1.6-6.4-.3z" fill="currentColor"/><path d="M12 7.5c0-2 .6-3.6 2-4.8" fill="none" stroke="#8a5a32" stroke-width="1.8" stroke-linecap="round"/><path d="M13 5.2c1.6-1.9 4.2-2 5.4-1.6-.5 1.9-2.8 3.3-5.4 1.6z" fill="#9be36f"/></svg>',
  oil:
    '<svg class="ico res-oil" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12c.6 2.9.9 5.9.9 9s-.3 6.1-.9 9H6c-.6-2.9-.9-5.9-.9-9s.3-6.1.9-9z" fill="currentColor"/><path d="M5.4 8h13.2M5.4 16h13.2" stroke="rgba(0,0,0,.45)" stroke-width="1.6"/><path d="M12 9.6c-1.1 1.5-1.8 2.5-1.8 3.3a1.8 1.8 0 003.6 0c0-.8-.7-1.8-1.8-3.3z" fill="#1c1c1c"/></svg>',
};

const ICON_WORD = { food: 'food', oil: 'oil', manpower: 'manpower', 食物: 'food', 石油: 'oil', 人力: 'manpower' };

/**
 * "+2 food" (or "+2 食物") -> +2 and the food icon, wrapped as one amount (.amt: shown larger on the cards).
 * Also oil / 石油 and worker slot(s) / manpower / 人力.
 */
export const iconize = (line) =>
  line.replace(/([+-]?\d+(?:\.\d+)?×?) (?:(food|oil|worker slots?|manpower)\b|(食物|石油|人力))/g, (_, n, en, zh) => {
    const w = en ?? zh;
    return `<span class="amt">${n}${ICONS[w.startsWith('worker') ? 'manpower' : ICON_WORD[w]]}</span>`;
  });

/** Card text as HTML: a small trigger heading, then one line per effect. */
export const cardText = (t) =>
  (t.trigger ? `<div class="trigger">${t.trigger}</div>` : '') +
  t.rule.split(' · ').map((l) => `<div>${iconize(l)}</div>`).join('');

/**
 * The card's LED panel (top right): a little hexagon board, a flower of 7 hexes (19 for pieces that don't fit in it),
 * where `lit` cells light up: class 'on' in the card colour (--top from the card), 'area' in yellow.
 * lit: [[x, z, cls], ...] in hex cells (see grid.js); they're centred on the panel.
 */
function hexPanelHTML(lit) {
  // Centre: the cell nearest the middle of the lit cells.
  const world = lit.map(([x, z]) => hexToWorld(x, z));
  const mx = world.reduce((s, w) => s + w.x, 0) / lit.length;
  const mz = world.reduce((s, w) => s + w.z, 0) / lit.length;
  const fz = mz / (Math.sqrt(3) / 2);
  const [cx, cz] = hexRound(mx - fz / 2, fz);
  const radius = Math.max(1, ...lit.map(([x, z]) => hexDistance(x, z, cx, cz)));
  const cls = new Map(lit.map(([x, z, c]) => [`${x - cx},${z - cz}`, c]));
  // Pointy-top hexagons, a little smaller than their cell so the dark glass shows between them.
  const r = (1 / Math.sqrt(3)) * 0.88;
  const corners = Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  const half = radius + 0.5;
  const halfH = radius * (Math.sqrt(3) / 2) + 1 / Math.sqrt(3);
  const polys = hexesAround(0, 0, radius)
    .map(([x, z]) => {
      const w = hexToWorld(x, z);
      const pts = corners.map(([px, pz]) => `${(w.x + px).toFixed(3)},${(w.z + pz).toFixed(3)}`).join(' ');
      const c = cls.get(`${x},${z}`);
      return `<polygon points="${pts}"${c ? ` class="${c}"` : ''}/>`;
    })
    .join('');
  return `<div class="shape hex"><svg viewBox="${-half} ${-halfH} ${2 * half} ${2 * halfH}" aria-hidden="true">${polys}</svg></div>`;
}

/**
 * A piece shape on the card's LED panel: the cells the piece covers light up in the card colour.
 * cells: [[x, z], ...] already rotated, starting at 0,0.
 */
export function shapeGridHTML(cells) {
  return hexPanelHTML(cells.map(([x, z]) => [x, z, 'on']));
}

/**
 * Tiles that affect other tiles show their reach on the LED panel instead of their size:
 * the tile itself lit in its card colour, the cells it affects lit yellow.
 * 'plus' = the 6 around it (adjacency), 'square' = the tile and the 6 around it, 'block2' = a diamond of 4.
 */
export const AREAS = {
  capital: 'plus',
  pump: 'plus',
  refinery: 'plus',
  oasis: 'plus',
  tarpit: 'plus',
  labourcamp: 'plus',
  crater: 'plus',
  spark: 'square',
  demolish2: 'block2',
  missilelab: 'plus',
  warhead: 'plus',
  intercept: 'plus',
  missile2: 'block2',
};

export function areaGridHTML(area) {
  if (area === 'block2') return hexPanelHTML([[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, z]) => [x, z, 'area']));
  return hexPanelHTML(hexesAround(0, 0, 1).map(([x, z]) => [x, z, x === 0 && z === 0 && area !== 'square' ? 'on' : 'area']));
}

/** LED panel contents for a card: its area of effect if it has one, else its shape (nothing for other action cards). */
export function cardArtHTML(key, cells = [[0, 0]]) {
  if (AREAS[key]) return areaGridHTML(AREAS[key]);
  return cardDef(key)?.symbol ? '' : shapeGridHTML(cells);
}

/** The picture slot above the card text: a tile snapshot when one is set, the symbol for action cards, else empty. */
export const snapHTML = (t) =>
  `<div class="snap">${t.symbol ? `<div class="symbol">${t.symbol}</div>` : t.snapshot ? `<img src="${t.snapshot}" alt="" decoding="async">` : ''}</div>`;

/**
 * Card pictures and frame art, decoded ahead of time (off the main thread) and kept, so dealing a hand or opening the
 * shop never stops to decode a 740 × 500 picture. Call once the game has started.
 */
const preloaded = [];
export function preloadCardArt() {
  const urls = new Set(['/cards/CardBaseTall.png', '/cards/CardSpecMask.png']);
  for (const t of Object.values(TERRAINS)) if (t.snapshot) urls.add(t.snapshot);
  for (const url of urls) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    img.decode().catch(() => {});
    preloaded.push(img);
  }
}

export const isAction = (key) => key in ACTIONS;
/** Tile or action-card definition for a card key. */
export const cardDef = (key) => TERRAINS[key] ?? ACTIONS[key];

/** Shop stock. Special tiles are locked until bought once; action cards are one use. [terrain, price in barrels of excess oil] */
export const SHOP_ITEMS = [
  ['station', 2], // basics: always in the random draws, so never locked
  ['farm', 2],
  ['settlement', 2],
  ['pump', 3],
  ['oasis', 4],
  ['tarpit', 4],
  ['labourcamp', 4],
  ['refinery', 5],
  ['spark', 2], // action cards: one use, only from the shop
  ['demolish', 2],
  ['demolish2', 4],
  ['militia', 2],
  ['milfactory', 5],
  ['missilelab', 4],
  ['warhead', 4],
  ['intercept', 4],
  ['magazine', 4],
  ['overtime', 3],
];

/** Military buildings (and the Overtime action that runs them): the Black Market's stock; rivals value them too. */
export const MILITARY = new Set(['milfactory', 'missilelab', 'warhead', 'intercept', 'magazine']);
export const BLACK_MARKET = new Set([...MILITARY, 'overtime', 'militia']);
/** The Black Market's other aisle: every non-military shop card except the basics (those come up in every deal). */
export const BLACK_MARKET_RESOURCE = new Set(['pump', 'oasis', 'tarpit', 'labourcamp', 'refinery', 'spark', 'demolish', 'demolish2']);

/** Basic tiles sold in the shop. They are never locked and never offered as a free tile pick. */
export const BASIC_SHOP = new Set(['station', 'farm', 'settlement']);

/** Shop / free-pick cards that stay hidden until another card has been unlocked. */
export const SHOP_REQUIRES = {
  missilelab: 'milfactory',
  warhead: 'milfactory',
  magazine: 'milfactory',
  overtime: 'milfactory',
};

/** True if this shop item may appear (its prerequisite is already unlocked). */
export const shopReady = (key, unlocked) => {
  const need = SHOP_REQUIRES[key];
  return !need || unlocked.has(need);
};

/**
 * Card pictures: front renders of each tile model (public/cards/snapshots, made by tools/card-snapshots.html).
 * Card key -> image; the four Wasteland colours share one. Bump SNAPSHOT_VERSION after re-rendering.
 */
const SNAPSHOT_VERSION = '20261103-recipelab';
const SNAPSHOTS = {
  capital: 'capital', settlement: 'settlement', farm: 'farm', pump: 'pump', station: 'station', refinery: 'refinery',
  oasis: 'oasis', tarpit: 'tarpit', labourcamp: 'labourcamp', cliffs: 'cliffs', ruins: 'ruins', crater: 'crater',
  milfactory: 'milfactory', magazine: 'magazine', warhead: 'warhead', intercept: 'intercept', missilelab: 'missilelab',
  raider: 'raider', bandit_raider: 'bandit_raider', bandit_siphon: 'bandit_siphon', bandit_scav: 'bandit_scav',
  wasteland1: 'wasteland', wasteland2: 'wasteland', wasteland3: 'wasteland', wasteland4: 'wasteland',
};
for (const [key, file] of Object.entries(SNAPSHOTS)) if (TERRAINS[key]) TERRAINS[key].snapshot = `/cards/snapshots/${file}.webp?v=${SNAPSHOT_VERSION}`;

export const TERRAIN_KEYS = Object.keys(TERRAINS);

export const isBuilding = (terrain) => TERRAINS[terrain]?.category === 'building';

/**
 * Model clips that never loop: they play on cue, like the Missile Magazine's Launch (TileFactory.cue) and the
 * Intercept Network's Fire (its gun rig, TileFactory.#ciwsRig).
 */
const EVENT_CLIPS = new Set(['Launch', 'Fire']);
/** Seconds an Intercept Network's gun takes to swing back into its idle sweep after firing. */
const CIWS_EASE_BACK = 0.8;

export const TILE = {
  gap: 0, // seam between tiles (world units); Game Debug → Graphics → Tile gap
  capH: 0.12, // coloured terrain layer
  soilH: 0.5, // dark earth underneath
};

const FULL = { sx: 1, sz: 1, cx: 0, cz: 0, w: 1, h: 1 };
/**
 * Apply TILE.gap to everything under `root` tagged with userData.fit (fitted models, stand-in blocks, camp
 * soil, ghost blocks): x/z scale shrinks so a w×h footprint becomes (w - gap)×(h - gap), still centred.
 */
export function applyTileGap(root, gap = TILE.gap) {
  root.traverse((o) => {
    const f = o.userData.fit;
    if (!f) return;
    o.scale.x = (f.sx * (f.w - gap)) / f.w;
    o.scale.z = (f.sz * (f.h - gap)) / f.h;
    o.position.x = -f.cx * o.scale.x;
    o.position.z = -f.cz * o.scale.z;
  });
  return root;
}
/** Tag a full-cell mesh centred on its origin so applyTileGap shrinks it. */
export const fitFull = (o) => ((o.userData.fit = FULL), o);

export const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Builds tile meshes. Building terrains use the blockout FBX once it has
 * loaded; everything else stays a coloured soil block.
 */
export class TileFactory {
  /** @type {Map<string, THREE.Object3D> | null} */
  models = null;
  ready;
  /** Wasteland piece models by shape key (each a list: a shape can have several), loaded after the core models. */
  pieces = null;
  piecesReady;

  constructor() {
    // Hexagonal blocks, like the cells (see grid.js): the coloured cap with its top at y = 0, the soil under it.
    this.capGeo = hexPrism(TILE.capH).translate(0, -TILE.capH, 0);
    this.soilGeo = hexPrism(TILE.soilH).translate(0, -TILE.capH - TILE.soilH, 0);
    this.soilMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 1 });
    this.capMats = {};
    for (const [k, t] of Object.entries(TERRAINS)) {
      const top = new THREE.MeshStandardMaterial({ color: t.top, roughness: 0.95 });
      const edge = new THREE.MeshStandardMaterial({ color: t.edge, roughness: 0.95 });
      // Hexagonal prism (CylinderGeometry) groups: sides, top, bottom.
      this.capMats[k] = [edge, top, edge];
    }
    // Loading phases: the core models gate the game start; the Wasteland pieces, then the other buildings and
    // tiles, load in the background. Until a model arrives its tiles show stand-ins, upgraded in place when it
    // lands (adoptBlockouts / adoptWastePieces in main.js).
    this.ready = loadCoreModels()
      .then((models) => {
        this.models = models;
      })
      .catch((error) => {
        console.error('Blockout models failed to load; coloured blocks stay in place.', error);
        this.models = new Map();
      });
    this.piecesReady = this.ready
      .then(() => loadWastePieces())
      .then((byShape) => (this.pieces = byShape))
      .catch((error) => {
        console.error('Wasteland piece models failed to load; Wasteland stays as coloured blocks.', error);
        return null;
      });
    this.extrasDone = false;
    this.extrasReady = this.piecesReady
      .then(() => loadBundle('extra'))
      .then((roots) => {
        for (const [key, root] of roots) this.models.set(key, root);
        return roots;
      })
      .catch((error) => {
        console.error('Building models failed to load; those tiles stay as stand-ins.', error);
        return null;
      })
      .finally(() => (this.extrasDone = true));
  }

  /** Flat stand-in used for land, junk, and buildings before the FBX arrives. */
  #block(terrain) {
    const group = new THREE.Group();
    const soil = new THREE.Mesh(this.soilGeo, this.soilMat);
    const cap = new THREE.Mesh(this.capGeo, this.capMats[terrain]);
    for (const mesh of [soil, cap]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    group.add(fitFull(soil), fitFull(cap));
    return group;
  }

  /**
   * bare: an empty holder, for a cell covered by a whole-piece Wasteland model (the model is added separately).
   * seed: a lone Wasteland cell's look (cellSeed in grid.js: the same cell always looks the same).
   * rot: the card's rotation, sixths of a turn clockwise on screen (like createPiece). The models are hexagons
   * like the cells, so every turn still fits; it goes on the model, inside the holder the board moves around.
   */
  create(terrain, opts) {
    return applyTileGap(this.#create(terrain, opts));
  }

  #create(terrain, { bare = false, rot = 0, seed = 0 } = {}) {
    if (bare) return new THREE.Group();
    if (terrain.startsWith('wasteland')) {
      const holder = new THREE.Group();
      this.fillWaste(holder, terrain, seed);
      return holder;
    }
    const tagSoil = (g) => (g.traverse((o) => o.geometry === this.soilGeo && fitFull(o)), g);
    // Finished camp models (Camp01-05.fbx); the code-built camp only if its file failed to load.
    if (isCamp(terrain) && !this.models?.has(terrain)) return tagSoil(buildRaiderCamp(this.soilGeo, this.soilMat, TERRAINS[terrain].tent));
    // The finished model (LaborCampCity01.fbx); the code-built camp only if that file failed to load.
    if (terrain === 'labourcamp' && !this.models?.has('labourcamp')) return tagSoil(buildLabourCamp(this.soilGeo, this.soilMat));
    // Intercept Network: the code-built CIWS bunker until a model file exists.
    if (terrain === 'intercept' && !this.models?.has('intercept')) return tagSoil(buildInterceptBunker(this.soilGeo, this.soilMat));
    const source = this.models?.get(terrain);
    if (!source) return this.#block(terrain);
    // The fitted model keeps its own offset. A holder takes the cell position
    // so placing or animating the tile does not undo that fit.
    const holder = new THREE.Group();
    const model = cloneModel(source);
    const turn = new THREE.Group();
    turn.rotation.y = (-rot * Math.PI) / 3;
    turn.add(model);
    holder.add(turn);
    holder.userData.blockout = true;
    holder.userData.rot = rot;
    if (model.animations.length) this.#animate(model);
    return holder;
  }

  /** @type {Set<{ mixer: THREE.AnimationMixer, root: THREE.Object3D, idle: number, cues: object[] }>} */
  #mixers = new Set();

  /** Loop every clip baked into the model (for example, the Capital's sky traffic), except cue clips (EVENT_CLIPS). */
  #animate(model) {
    const mixer = new THREE.AnimationMixer(model);
    for (const clip of model.animations) {
      if (EVENT_CLIPS.has(clip.name)) continue;
      const action = mixer.clipAction(clip);
      action.play();
      // Start each copy at a random point so two copies never fly in sync.
      action.time = Math.random() * clip.duration;
    }
    const entry = { mixer, root: model, idle: 0, cues: [], rig: null };
    model.userData.anim = entry;
    if (model.userData.ciwsParts) entry.rig = this.#ciwsRig(model, entry);
    this.#mixers.add(entry);
  }

  /**
   * A model's CIWS gun (models.js splitCiws), for the attack phase: missiles.js fireCIWS turns `turret` and lifts
   * `pivot` itself between begin() and end(). Meanwhile the idle sweep (the 'Aim' clip) holds where it was, fire(s)
   * plays the Fire clip (barrels spinning, muzzle flash, tracers) over about s seconds, and afterwards the gun eases
   * back into its sweep. Kept as model.userData.ciws, where findCiws (interceptMesh.js) finds it.
   */
  #ciwsRig(model, entry) {
    const parts = model.userData.ciwsParts;
    const turret = model.getObjectByName(parts.turret);
    const pivot = model.getObjectByName(parts.gun);
    if (!turret || !pivot) return null;
    const aimClip = model.animations.find((c) => c.name === 'Aim');
    const fireClip = model.animations.find((c) => c.name === 'Fire');
    const sweep = aimClip ? entry.mixer.clipAction(aimClip) : null;
    // The sweep's pose at any moment, to ease back into it.
    const poses = (aimClip?.tracks ?? [])
      .filter((t) => THREE.PropertyBinding.parseTrackName(t.name).propertyName === 'quaternion')
      .map((t) => ({ node: model.getObjectByName(THREE.PropertyBinding.parseTrackName(t.name).nodeName), it: t.createInterpolant() }))
      .filter((p) => p.node);
    const q = new THREE.Quaternion();
    const rig = {
      turret,
      pivot,
      muzzles: [model.getObjectByName(parts.muzzle) ?? pivot],
      busy: 0,
      back: null,
      clock: 0, // the sweep's time while it's paused
      get active() {
        return rig.busy > 0 || rig.back !== null;
      },
      begin() {
        if (rig.busy++ > 0) return;
        rig.back = null;
        if (!sweep?.isRunning()) return;
        rig.clock = sweep.time;
        const held = poses.map((p) => p.node.quaternion.clone());
        sweep.stop(); // (that puts the rest pose back: hold the sweep's instead)
        poses.forEach((p, i) => p.node.quaternion.copy(held[i]));
      },
      fire(seconds = 0.9) {
        if (!fireClip) return;
        const a = entry.mixer.clipAction(fireClip);
        a.reset().setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = false;
        a.timeScale = 1 / Math.max(0.3, seconds); // its second of muzzle flash, over the burst
        a.play();
        a.time = 0.2; // straight into the firing
      },
      end() {
        if (rig.busy === 0 || --rig.busy > 0 || !sweep) return;
        rig.back = { t: 0, from: poses.map((p) => p.node.quaternion.clone()) };
      },
      update(dt) {
        if (!rig.active) return;
        rig.clock += dt;
        if (!rig.back) return;
        rig.back.t += dt;
        const k = Math.min(1, rig.back.t / CIWS_EASE_BACK);
        const time = rig.clock % aimClip.duration;
        poses.forEach((p, i) => p.node.quaternion.copy(rig.back.from[i]).slerp(q.fromArray(p.it.evaluate(time)), k * k * (3 - 2 * k)));
        if (k < 1) return;
        rig.back = null;
        sweep.reset().play();
        sweep.time = time;
      },
    };
    model.userData.ciws = rig;
    return rig;
  }

  /** Whether a tile's model has the cue clip `name` (a stand-in, or a model without it, doesn't). */
  canCue(holder, name) {
    let entry = null;
    holder.traverse((o) => (entry ??= o.userData.anim ?? null));
    return !!entry?.root.animations.some((c) => c.name === name);
  }

  /**
   * Play a cue clip (EVENT_CLIPS) once on a tile; when it ends the model is back in its rest pose and onEnd runs.
   * At `cutAt` seconds into the clip `cut(i)` runs (e.g. reads where a part is), and the `hide` parts vanish (scale 0)
   * from then on. With `repeat`, the clip then jumps back from `repeatFrom` to `repeatAt` that many times (the parts
   * come back) and cuts again each time. With `hold` (seconds), the clip instead stops at the cut with everything
   * still showing, and after that long onResume runs, the `hide` parts vanish and it plays on. Resolves at the last
   * cut with what `cut` returned, or null (no such clip, or the tile went away first).
   */
  cue(holder, name, { speed = 1, cutAt = null, cut = null, hide = [], repeat = 0, repeatFrom = null, repeatAt = 0, hold = 0, onResume = null, onEnd = null } = {}) {
    let entry = null;
    holder.traverse((o) => (entry ??= o.userData.anim ?? null));
    const clip = entry?.root.animations.find((c) => c.name === name);
    if (!clip) {
      onEnd?.();
      return Promise.resolve(null);
    }
    const action = entry.mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    action.timeScale = speed;
    action.play();
    // Each hidden part with its scale track: the mixer only writes values that change, so a part coming back gets
    // its scale from the clip.
    const parts = hide.flatMap((n) => {
      const o = entry.root.getObjectByName(n);
      if (!o) return [];
      const ids = [o.name, o.uuid, THREE.PropertyBinding.sanitizeNodeName(o.name)];
      const track = clip.tracks.find((t) => {
        const b = THREE.PropertyBinding.parseTrackName(t.name);
        return b.propertyName === 'scale' && ids.includes(b.nodeName);
      });
      return [{ o, scale: track?.createInterpolant() ?? null }];
    });
    return new Promise((resolve) => {
      if (cutAt == null) resolve(null);
      entry.cues.push({ action, cutAt, cut, parts, left: repeat, repeatFrom, repeatAt, hold, onResume, onEnd, resolve, n: 0, phase: cutAt == null ? 'after' : 'before' });
    });
  }

  /** After the mixer has posed the model this frame: cuts, holds, repeats, hidden parts and finished cues. */
  #runCues(entry, dt) {
    for (let i = entry.cues.length - 1; i >= 0; i--) {
      const c = entry.cues[i];
      if (c.phase === 'hold') {
        // (a paused action doesn't count as running)
        if ((c.hold -= dt) > 0) continue;
        c.action.paused = false;
        c.phase = 'after';
        c.hidden = true;
        c.onResume?.();
        for (const p of c.parts) p.o.scale.setScalar(0);
        continue;
      }
      if (!c.action.isRunning()) {
        c.action.stop();
        entry.cues.splice(i, 1);
        c.resolve(null); // (no effect if it already resolved)
        c.onEnd?.();
        continue;
      }
      const t = c.action.time;
      if (c.reveal) {
        // Back after a repeat, now the mixer has posed the clip's earlier moment (not a frame before).
        c.reveal = false;
        c.hidden = false;
        for (const p of c.parts) p.o.scale.fromArray(p.scale ? p.scale.evaluate(c.repeatAt) : [1, 1, 1]);
      }
      if (c.phase === 'before' && t >= c.cutAt) {
        const value = c.cut?.(c.n++) ?? null;
        if (c.hold > 0) {
          c.phase = 'hold';
          c.action.paused = true;
          c.resolve(value);
          continue;
        }
        if (c.left > 0) c.phase = 'repeat';
        else {
          c.phase = 'after';
          c.resolve(value);
        }
        c.hidden = true;
      } else if (c.phase === 'repeat' && t >= c.repeatFrom) {
        c.left--;
        c.action.time = c.repeatAt;
        c.phase = 'before';
        c.reveal = true;
      }
      if (c.hidden) for (const p of c.parts) p.o.scale.setScalar(0);
    }
  }

  /** Advance tile animations. Copies that leave the scene (replaced, nuked, old ghosts) get dropped. */
  update(dt) {
    for (const entry of this.#mixers) {
      let node = entry.root;
      let frozen = false; // an idle building (no workers, main.js shadeIdle) holds still
      while (node.parent) {
        frozen ||= node.userData.idle === true;
        node = node.parent;
      }
      if (node.isScene) {
        entry.idle = 0;
        // A cue (a magazine's launch) or a gun in action plays out even on an idle building.
        if (!frozen || entry.cues.length || entry.rig?.active) entry.mixer.update(dt);
        if (entry.cues.length) this.#runCues(entry, dt);
        entry.rig?.update(dt);
      } else if (++entry.idle > 120) {
        // About two seconds detached. The copy has been thrown away.
        for (const c of entry.cues) {
          c.resolve(null);
          c.onEnd?.();
        }
        entry.cues.length = 0;
        if (entry.root.userData.ciws === entry.rig) delete entry.root.userData.ciws;
        entry.mixer.stopAllAction();
        entry.mixer.uncacheRoot(entry.root);
        this.#mixers.delete(entry);
      }
    }
  }

  /** One of a shape's piece models (null: none loaded). seed: the same piece always gets the same one. */
  #pieceModel(shape, seed = 0) {
    const list = this.pieces?.get(shape);
    return list?.length ? list[Math.abs(Math.round(seed)) % list.length] : null;
  }

  /**
   * A lone Wasteland cell: one of the Wasteland looks (the 'mono' list: mostly dunes and sand, see loadWastePieces),
   * turned any of the six ways, both picked by `seed`; a coloured block until the pieces have loaded.
   */
  fillWaste(holder, terrain, seed = 0) {
    holder.clear();
    const source = this.#pieceModel('mono', seed);
    if (source) this.#fillWith(holder, source, (seed >>> 8) % 6);
    else holder.add(this.#block(terrain));
    holder.userData.blockout = Boolean(source);
    applyTileGap(holder);
  }

  /**
   * A cell left over from a Wasteland piece (a building took another of its cells): the look it had in the piece,
   * turned as it was, so the rest of the piece looks unchanged. piece: { shape, rot, seed } as it was placed;
   * offset: [x, z] from the middle of the piece's cells to this one (world units). Falls back to fillWaste.
   */
  fillWastePart(holder, terrain, piece, offset, seed = 0) {
    // Which of the shape's cells this is: where it sits in the piece before its turn.
    const at = new THREE.Vector3(offset[0], 0, offset[1]).applyAxisAngle(THREE.Object3D.DEFAULT_UP, (piece.rot * Math.PI) / 3);
    const i = this.#pieceCells(piece.shape).findIndex((c) => Math.hypot(c.x - at.x, c.z - at.z) < 0.25);
    const [look, turn] = i >= 0 ? this.#pieceLook(piece.seed, i) : [null, 0];
    if (!look) return this.fillWaste(holder, terrain, seed);
    holder.clear();
    this.#fillWith(holder, look, piece.rot + turn);
    holder.userData.blockout = true;
    applyTileGap(holder);
  }

  /** A shape's cells around their middle (world offsets, the piece unturned). */
  #pieceCells(shape) {
    const cells = SHAPES[shape]?.cells ?? [];
    const mid = cellsCentre(cells);
    return cells.map(([x, z]) => {
      const w = hexToWorld(x, z);
      return { x: w.x - mid.x, z: w.z - mid.z };
    });
  }

  /** Cell i of the piece with this seed: its look and its turn (sixths), the same every time. */
  #pieceLook(seed, i) {
    const h = cellSeed(seed, i);
    return [this.#pieceModel('mono', h), (h >>> 8) % 6];
  }

  #fillWith(holder, source, rot) {
    const turn = new THREE.Group();
    turn.rotation.y = (-rot * Math.PI) / 3;
    const model = cloneModel(source);
    turn.add(model);
    holder.add(turn);
    if (model.animations.length) this.#animate(model);
  }

  /**
   * A whole Wasteland piece: a look for each of its cells (mostly dunes and sand, see loadWastePieces), each turned
   * its own way, all picked by `seed` (the piece's id: its ghost, the placed piece and what a building leaves of it
   * match). Turned to the piece's rotation (rot sixths of a turn, like rotateCells) and centred on the origin: place
   * it at the middle of the piece's cells (cellsCentre in grid.js). Null until the piece models have loaded.
   */
  createPiece(shape, rot = 0, seed = 0) {
    if (!SHAPES[shape] || !this.#pieceModel('mono')) return null;
    const group = new THREE.Group();
    this.#pieceCells(shape).forEach((c, i) => {
      const cell = new THREE.Group();
      cell.position.set(c.x, 0, c.z);
      const [look, turn] = this.#pieceLook(seed, i);
      this.#fillWith(cell, look, turn);
      group.add(cell);
    });
    group.rotation.y = (-rot * Math.PI) / 3; // rot sixths of a turn, clockwise on screen
    return applyTileGap(group);
  }

  /** Ghost copy of a whole Wasteland piece for the placement preview. */
  previewPiece(shape, rot = 0, seed = 0) {
    const group = this.createPiece(shape, rot, seed);
    return group && this.#ghost(group);
  }

  /** Transparent copy for the placement ghost (turned `rot` sixths like the tile it previews). Materials are not shared. */
  preview(terrain, rot = 0) {
    return this.#ghost(this.create(terrain, { rot }));
  }

  #ghost(mesh) {
    mesh.traverse((obj) => {
      if (!obj.isMesh) return;
      // A mesh can carry several materials (e.g. the Village02 ship): ghost each of them.
      let seeThrough = false;
      const ghost = (source) => {
        const material = copySeam(source, source.clone());
        // Already see-through parts (refinery smoke) keep their own, lower opacity and cast no shadow.
        seeThrough ||= material.transparent;
        material.transparent = true;
        material.opacity = Math.min(material.opacity, 0.86);
        material.depthWrite = false;
        material.userData.base = material.color.clone();
        return material;
      };
      obj.material = Array.isArray(obj.material) ? obj.material.map(ghost) : ghost(obj.material);
      obj.castShadow = !seeThrough;
    });
    return mesh;
  }

  /** Swap a placed flat block for its blockout, keeping the board transform. */
  upgrade(mesh, terrain) {
    if (!hasBlockout(terrain) || !this.models?.has(terrain)) return mesh;
    if (mesh.userData.blockout) return mesh;
    const next = this.create(terrain, { rot: mesh.userData.rot ?? 0 });
    next.position.copy(mesh.position);
    next.scale.copy(mesh.scale);
    next.visible = mesh.visible;
    next.userData.blockout = true;
    mesh.parent?.add(next);
    mesh.removeFromParent();
    return next;
  }
}
