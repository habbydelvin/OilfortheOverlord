import * as THREE from 'three';
import { clone as cloneModel } from 'three/addons/utils/SkeletonUtils.js';
import { hasBlockout, loadCoreModels, loadBundle } from './models.js';
import { buildRaiderCamp } from './raiderMesh.js';
import { buildLabourCamp } from './labourCampMesh.js';
import { copySeam } from './seamlessGround.js';
import { SCALE, P } from './scalingConfig.js';
import { L } from './i18n.js';

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
    rule: '+4 worker slots · Eats 3 food each season · Adjacent buildings trigger twice',
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
    rule: 'Makes 0.5× the oil of each adjacent station',
    stats: { manpower: -1, oilMultiplierPerAdjacent: { station: 0.5 } },
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
    rule: '3×3 Blocks have a chance to spawn Bandit Camps',
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
    rule: '3×3 Blocks have a chance to spawn Bandit Camps',
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
    rule: '3×3 Blocks have a chance to spawn Bandit Camps',
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
    rule: '3×3 Blocks have a chance to spawn Bandit Camps',
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
    rule: '+2 worker slots if next to a Settlement',
    stats: { adjacentManpower: { settlement: 2 } }, // +2 total, not per settlement
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
    name: 'Raider Camp',
    trigger: 'Passive',
    top: 0x7a3a2a,
    edge: 0x52261b,
    category: 'junk',
    buildable: false,
    weight: 0, // only spawned when the food runs out (net ≤ 0 and empty stores)
    get rule() {
      return `-${P(SCALE.campSlots)} worker slots · Arrives when the food stores run dry · One leaves each season with a food surplus`;
    },
    stats: { drain: 'slots' },
  },

  // ---- bandit camps: settle in a full 3×3 block of Wasteland at the end of a season ----
  // Permanent: only "Send in the Militia" clears them (Demolish can't).
  bandit_raider: {
    name: 'Raider Hideout',
    trigger: 'Passive',
    top: 0x7a3a2a,
    edge: 0x52261b,
    category: 'junk',
    buildable: false,
    weight: 0, // only spawned in a 3×3 block of Wasteland
    bandit: true,
    tent: 0x8c2f22,
    get rule() {
      return `-${SCALE.banditSlots} worker slots · Clear it with Send in the Militia`;
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
      return `-${SCALE.banditOil} oil each season · Clear it with Send in the Militia`;
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
      return `-${SCALE.banditFood} food each season · Clear it with Send in the Militia`;
    },
    stats: { drain: 'food' },
  },
  bandit_smuggle: {
    name: 'Smuggler Den',
    trigger: 'Passive',
    top: 0x3e4a5c,
    edge: 0x29313d,
    category: 'junk',
    buildable: false,
    weight: 0,
    bandit: true,
    tent: 0x34506e,
    get rule() {
      return `Steals ${SCALE.banditStockpile} barrels from your oil stockpile each season · Clear it with Send in the Militia`;
    },
    stats: { drain: 'stockpile' },
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
    rule: 'Trigger tiles in a 3×3 area',
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
    rule: 'Remove a tile (not a Capital or a camp)',
  },
  demolish2: {
    name: 'Wrecking Crew',
    trigger: 'On play',
    top: 0xb5452f,
    edge: 0x7a2c1e,
    category: 'action',
    symbol: '⊠',
    size: 2, // a 2×2 square, the hovered cell is its corner (instead of a range around it)
    weight: 0.4,
    rule: 'Remove up to 4 tiles in a 2×2 square (not Capitals or camps)',
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
    rule: 'Clear one bandit or raider camp',
  },
};

const TRIGGER_ZH = { Passive: '被动', 'On trigger': '触发时', Junk: '废料', 'On play': '打出时' };
const WASTELAND_ZH = { name: '荒地', rule: '3×3 荒地区域有几率出现匪营' };
const MILITIA_ZH = '用“派遣民兵”清除';

/** Chinese name and rule for each card; a function rule reads the live SCALE values like the English getter. */
const ZH = {
  capital: { name: '首都', rule: '+4 人力 · 每季消耗 3 食物 · 相邻建筑触发两次' },
  settlement: { name: '定居点', rule: '+2 人力' },
  farm: { name: '水培农场', rule: '+2 食物' },
  pump: { name: '水泵站', rule: '相邻农场 +2 食物' },
  station: { name: '采油站', rule: '+2 石油' },
  refinery: { name: '炼油厂', rule: '产出每个相邻采油站产量 0.5 倍的石油' },
  wasteland1: WASTELAND_ZH,
  wasteland2: WASTELAND_ZH,
  wasteland3: WASTELAND_ZH,
  wasteland4: WASTELAND_ZH,
  oasis: { name: '绿洲', rule: '相邻农场 +3 食物' },
  tarpit: { name: '焦油坑', rule: '相邻采油站 +2 石油' },
  labourcamp: { name: '劳工营', rule: '紧邻定居点时 +2 人力' },
  cliffs: { name: '悬崖', rule: '无法在其上建造' },
  ruins: { name: '战前遗迹', rule: '在旁边建造即可清除 · 清除后手牌补至 5 张' },
  crater: { name: '毒坑', rule: '每个相邻农场/定居点 -1 人力，-1 食物' },
  raider: {
    name: '掠夺者营地',
    rule: () => `-${P(SCALE.campSlots)} 人力 · 粮仓耗尽时出现 · 食物有盈余时每季离开一个`,
  },
  bandit_raider: { name: '掠夺者巢穴', rule: () => `-${SCALE.banditSlots} 人力 · ${MILITIA_ZH}` },
  bandit_siphon: { name: '窃油者营地', rule: () => `每季 -${SCALE.banditOil} 石油 · ${MILITIA_ZH}` },
  bandit_scav: { name: '拾荒者营地', rule: () => `每季 -${SCALE.banditFood} 食物 · ${MILITIA_ZH}` },
  bandit_smuggle: { name: '走私者窝点', rule: () => `每季从石油库存中偷走 ${SCALE.banditStockpile} 桶 · ${MILITIA_ZH}` },
  spark: { name: '火花', rule: '触发 3×3 范围内的地块' },
  demolish: { name: '拆除', rule: '移除一个地块（首都和营地除外）' },
  demolish2: { name: '拆迁队', rule: '移除 2×2 范围内至多 4 个地块（首都和营地除外）' },
  militia: { name: '派遣民兵', rule: '清除一个匪营或掠夺者营地' },
};

// name, trigger and rule become getters that answer in the current language (the English stays above).
for (const [key, def] of Object.entries({ ...TERRAINS, ...ACTIONS })) {
  const zh = { ...ZH[key], trigger: TRIGGER_ZH[def.trigger] };
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
 * A piece shape on the card's LED panel (top right): every square of the 3×3 grid is drawn, and the ones the
 * piece covers light up in the card colour (--top from the card). The 4-long I piece gets a 4×4 grid.
 * cells: [[x, z], ...] already rotated, starting at 0,0.
 */
export function shapeGridHTML(cells) {
  const w = Math.max(...cells.map((c) => c[0])) + 1;
  const h = Math.max(...cells.map((c) => c[1])) + 1;
  const n = Math.max(3, w, h);
  const ox = Math.floor((n - w) / 2);
  const oz = Math.floor((n - h) / 2);
  const lit = new Set(cells.map(([x, z]) => `${x + ox},${z + oz}`));
  let squares = '';
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) squares += lit.has(`${x},${z}`) ? '<i class="on"></i>' : '<i></i>';
  return `<div class="shape" style="grid-template-columns:repeat(${n},1fr)">${squares}</div>`;
}

/**
 * Tiles that affect other tiles show their reach on the LED panel instead of their size:
 * the tile itself lit in its card colour, the cells it affects lit yellow.
 * 'plus' = the 4 sides (adjacency), 'square' = the full 3×3 around it.
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
};

export function areaGridHTML(area) {
  if (area === 'block2') return `<div class="shape area-grid" style="grid-template-columns:repeat(2,1fr)">${'<i class="area"></i>'.repeat(4)}</div>`;
  let squares = '';
  for (let z = 0; z < 3; z++)
    for (let x = 0; x < 3; x++) {
      const centre = x === 1 && z === 1;
      const hit = area === 'square' || x === 1 || z === 1;
      squares += centre && area !== 'square' ? '<i class="on"></i>' : hit ? '<i class="area"></i>' : '<i></i>';
    }
  return `<div class="shape area-grid" style="grid-template-columns:repeat(3,1fr)">${squares}</div>`;
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
];

/** Basic tiles sold in the shop. They are never locked and never offered as a free tile pick. */
export const BASIC_SHOP = new Set(['station', 'farm', 'settlement']);

/**
 * Card pictures: front renders of each tile model (public/cards/snapshots, made by tools/card-snapshots.html).
 * Card key -> image; the four Wasteland colours share one. Bump SNAPSHOT_VERSION after re-rendering.
 */
const SNAPSHOT_VERSION = '20261030-noground';
const SNAPSHOTS = {
  capital: 'capital', settlement: 'settlement', farm: 'farm', pump: 'pump', station: 'station', refinery: 'refinery',
  oasis: 'oasis', tarpit: 'tarpit', labourcamp: 'labourcamp', cliffs: 'cliffs', ruins: 'ruins', crater: 'crater',
  raider: 'raider', bandit_raider: 'bandit_raider', bandit_siphon: 'bandit_siphon', bandit_scav: 'bandit_scav', bandit_smuggle: 'bandit_smuggle',
  wasteland1: 'wasteland', wasteland2: 'wasteland', wasteland3: 'wasteland', wasteland4: 'wasteland',
};
for (const [key, file] of Object.entries(SNAPSHOTS)) if (TERRAINS[key]) TERRAINS[key].snapshot = `/cards/snapshots/${file}.webp?v=${SNAPSHOT_VERSION}`;

export const TERRAIN_KEYS = Object.keys(TERRAINS);

export const isBuilding = (terrain) => TERRAINS[terrain]?.category === 'building';

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
  /** Wasteland piece models by shape key, loaded in the background after the buildings. */
  pieces = null;
  piecesReady;

  constructor() {
    const s = 1;
    this.capGeo = new THREE.BoxGeometry(s, TILE.capH, s).translate(0, -TILE.capH / 2, 0);
    this.soilGeo = new THREE.BoxGeometry(s, TILE.soilH, s).translate(0, -TILE.capH - TILE.soilH / 2, 0);
    this.soilMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 1 });
    this.capMats = {};
    for (const [k, t] of Object.entries(TERRAINS)) {
      const top = new THREE.MeshStandardMaterial({ color: t.top, roughness: 0.95 });
      const edge = new THREE.MeshStandardMaterial({ color: t.edge, roughness: 0.95 });
      // BoxGeometry face order: +x, -x, +y (top), -y, +z, -z
      this.capMats[k] = [edge, edge, top, edge, edge, edge];
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
      .then(() => loadBundle('waste'))
      .then((roots) => (this.pieces = new Map([...roots].map(([key, root]) => [key.slice('waste-'.length), root]))))
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
   */
  create(terrain, opts) {
    return applyTileGap(this.#create(terrain, opts));
  }

  #create(terrain, { bare = false } = {}) {
    if (bare) return new THREE.Group();
    if (terrain.startsWith('wasteland')) {
      const holder = new THREE.Group();
      this.fillWaste(holder, terrain);
      return holder;
    }
    const tagSoil = (g) => (g.traverse((o) => o.geometry === this.soilGeo && fitFull(o)), g);
    // Finished camp models (Camp01-05.fbx); the code-built camp only if its file failed to load.
    if (isCamp(terrain) && !this.models?.has(terrain)) return tagSoil(buildRaiderCamp(this.soilGeo, this.soilMat, TERRAINS[terrain].tent));
    // The finished model (LaborCampCity01.fbx); the code-built camp only if that file failed to load.
    if (terrain === 'labourcamp' && !this.models?.has('labourcamp')) return tagSoil(buildLabourCamp(this.soilGeo, this.soilMat));
    const source = this.models?.get(terrain);
    if (!source) return this.#block(terrain);
    // The fitted model keeps its own offset. A holder takes the cell position
    // so placing or animating the tile does not undo that fit.
    const holder = new THREE.Group();
    const model = cloneModel(source);
    holder.add(model);
    holder.userData.blockout = true;
    if (model.animations.length) this.#animate(model);
    return holder;
  }

  /** @type {Set<{ mixer: THREE.AnimationMixer, root: THREE.Object3D, idle: number }>} */
  #mixers = new Set();

  /** Loop every clip baked into the model (for example, the Capital's sky traffic). */
  #animate(model) {
    const mixer = new THREE.AnimationMixer(model);
    for (const clip of model.animations) {
      const action = mixer.clipAction(clip);
      action.play();
      // Start each copy at a random point so two copies never fly in sync.
      action.time = Math.random() * clip.duration;
    }
    this.#mixers.add({ mixer, root: model, idle: 0 });
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
        if (!frozen) entry.mixer.update(dt);
      } else if (++entry.idle > 120) {
        // About two seconds detached. The copy has been thrown away.
        entry.mixer.stopAllAction();
        entry.mixer.uncacheRoot(entry.root);
        this.#mixers.delete(entry);
      }
    }
  }

  /** A lone Wasteland cell: the Single wasteland model, or a coloured block until the pieces have loaded. */
  fillWaste(holder, terrain) {
    holder.clear();
    const source = this.pieces?.get('mono');
    if (source) {
      const model = cloneModel(source);
      holder.add(model);
      if (model.animations.length) this.#animate(model);
    } else holder.add(this.#block(terrain));
    holder.userData.blockout = Boolean(source);
    applyTileGap(holder);
  }

  /**
   * A whole Wasteland piece as one model, turned to the piece's rotation (rot quarter turns clockwise from
   * above, like rotateCells). Centred on the origin: place it at the centre of the piece's cells.
   * Null until the piece models have loaded.
   */
  createPiece(shape, rot = 0) {
    const source = this.pieces?.get(shape);
    if (!source) return null;
    const group = new THREE.Group();
    const model = cloneModel(source);
    group.add(model);
    group.rotation.y = (-rot * Math.PI) / 2;
    if (model.animations.length) this.#animate(model);
    return applyTileGap(group);
  }

  /** Ghost copy of a whole Wasteland piece for the placement preview. */
  previewPiece(shape, rot = 0) {
    const group = this.createPiece(shape, rot);
    return group && this.#ghost(group);
  }

  /** Transparent copy for the placement ghost. Materials are not shared. */
  preview(terrain) {
    return this.#ghost(this.create(terrain));
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
    const next = this.create(terrain);
    next.position.copy(mesh.position);
    next.scale.copy(mesh.scale);
    next.visible = mesh.visible;
    next.userData.blockout = true;
    mesh.parent?.add(next);
    mesh.removeFromParent();
    return next;
  }
}
