import './library.css';
import * as THREE from 'three';
import { SHAPES } from './pieces.js';
import { ACTIONS, SHOP_ITEMS, TERRAINS, TERRAIN_KEYS, TileFactory, cardText, hex } from './tiles.js';
import { SCALE, P, loadScaleConfig, eventPct, FIRST_EVENT_YEAR } from './scalingConfig.js';
import { EVENTS, KIND_LABEL } from './events.js';
import { L, applyStatic, onLangChange, setLang } from './i18n.js';

loadScaleConfig(); // show the tuned numbers

const groups = () => [
  {
    id: 'building',
    title: L('Buildings', '建筑'),
    blurb: L('Part of the economy. A building is never drawn as a multi-tile piece.', '经济的组成部分。建筑永远不会以多格板块的形式抽到。'),
  },
  {
    id: 'land',
    title: L('Land', '地形'),
    blurb: L('Terrain with an effect on whatever is placed next to it, or on top of it.', '对相邻或其上放置之物产生效果的地形。'),
  },
  {
    id: 'action',
    title: L('Action cards', '行动卡'),
    blurb: L(
      'Played on the board for a one-off effect, then gone; never become tiles. Locked until bought in the shop; after that they are also drawn now and then at random.',
      '在棋盘上打出，产生一次性效果后即消失，永远不会变成地块。在市场购买前处于锁定状态；购买后也会不时被随机抽到。',
    ),
  },
  {
    id: 'junk',
    title: L('Junk', '废料'),
    blurb: L(
      'Clogs the hand. Only Wasteland is drawn as a polyomino. The four Wasteland colours share one look and split a draw weight of about 5.4 (≈30% of draws). Wasteland must be placed before ending the turn and can never be built on.',
      '占用手牌。只有荒地会以多格板块的形式抽到。四种颜色的荒地外观相同，共享约 5.4 的抽取权重（约占抽取的 30%）。荒地必须在回合结束前放置，且永远无法在其上建造。',
    ),
  },
  {
    id: 'events',
    title: L('Events', '年度事件'),
    blurb: L(
      `One event is drawn at the start of every year from year ${FIRST_EVENT_YEAR} on and lasts until the next tribute. Each met tribute in a row makes Pressure and Disaster 25% more likely; a missed tribute halves them and makes Good fortune and Choice ×1.75. Events whose condition isn't met are skipped. Effect text shows year-${FIRST_EVENT_YEAR} strength; numbers marked "e.g." use a sample city (2 camps, 2 settlements, tribute 20).`,
      `从第 ${FIRST_EVENT_YEAR} 年起，每年开始时抽取一个事件，持续到下一次上缴贡品。每连续完成一次贡品，压力和灾难事件的几率提高 25%；失职则使其减半，并使好运和抉择事件的几率 ×1.75。条件未满足的事件会被跳过。效果文本按第 ${FIRST_EVENT_YEAR} 年的强度显示；标有“例”的数字使用一座示例城市（2 个营地、2 个定居点、贡品 20）。`,
    ),
  },
];

/** Readable form of each event's `when` draw condition (events.js). */
const eventWhen = (key) =>
  ({
    showOfForce: L('You have at least one building and an empty cell next to your land', '你至少有一座建筑，且领地旁有空格'),
    earthquake: L('There is an empty cell next to your land', '领地旁有空格'),
    mercenaries: L('You have at least one camp', '你至少有一个营地'),
    prospectors: L('A hidden "?" site remains', '还有未揭开的神秘地点'),
    taxSettlements: L('You have at least one settlement', '你至少有一个定居点'),
  })[key] ?? L('Always', '总是');

/** KIND_LABEL may be a lookup object (with getters) or a function, depending on events.js. */
const kindLabel = (kind) => (typeof KIND_LABEL === 'function' ? KIND_LABEL(kind) : KIND_LABEL[kind]);

const SAMPLE_INFO = { camps: 2, settlements: 2, sites: 1, quota: 20, buildings: 3, open: 5 };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function eventHTML(key) {
  const ev = EVENTS[key];
  const p = ev.scale ? eventPct(ev.scale, FIRST_EVENT_YEAR) : 0;
  const info = { ...SAMPLE_INFO, cliffs: SCALE.earthquakeCliffs };
  const total = Object.values(EVENTS).reduce((s, e) => s + e.weight, 0);
  const scaling = ev.scale
    ? L(
        `${P(SCALE[`${ev.scale}Base`])} in year ${FIRST_EVENT_YEAR}, +${P(SCALE[`${ev.scale}PerYear`])}/yr, max ${P(SCALE[`${ev.scale}Max`])}`,
        `第 ${FIRST_EVENT_YEAR} 年 ${P(SCALE[`${ev.scale}Base`])}，每年 +${P(SCALE[`${ev.scale}PerYear`])}，上限 ${P(SCALE[`${ev.scale}Max`])}`,
      )
    : key === 'earthquake'
      ? L(`${SCALE.earthquakeCliffs} cliffs`, `${SCALE.earthquakeCliffs} 处悬崖`)
      : L('Fixed', '固定');
  const sampled = (fn) => {
    const src = String(fn);
    return /info\?\.(camps|quota|settlements)/.test(src) ? `${esc(fn(p, null, info))} <span class="eg">${L('e.g.', '例')}</span>` : esc(fn(p, null, info));
  };
  // Choice texts that need the live economy to read sensibly (key: event and choice index).
  const override = {
    'refugees:0': L(`+${P(p)} worker slots, ${P(p)} of the food grown eaten on top each season`, `+${P(p)} 人力，每季额外吃掉所产食物的 ${P(p)}`),
  };
  const choices = ev.choices
    ? `<ul class="choices">${ev.choices
        .map((c, i) => `<li><b>${esc(c.label)}</b>${L(': ', '：')}${override[`${key}:${i}`] ?? sampled(c.text)}<div class="say">“${esc(c.say)}” — <i>${esc(c.retort)}</i></div></li>`)
        .join('')}</ul>`
    : '';
  const lines = typeof ev.lines === 'function' ? ev.lines(p) : ev.lines ?? [];
  return `
    <article class="tile event ${ev.kind}" id="event-${key}">
      <div class="event-head"><span class="badge ${ev.kind}">${kindLabel(ev.kind)}</span></div>
      <h3>${esc(ev.name)}</h3>
      <p class="key">${key}</p>
      <div class="rule">${sampled(ev.text)}</div>
      ${choices}
      <blockquote class="dialogue">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</blockquote>
      <dl>
        <div><dt>${L('Kind', '类型')}</dt><dd>${kindLabel(ev.kind)}</dd></div>
        <div><dt>${L('Draw', '抽取')}</dt><dd>${ev.weight} · ${Math.round((ev.weight / total) * 1000) / 10}%${L(' (base)', '（基础）')}</dd></div>
        <div><dt>${L('Scaling', '成长')}</dt><dd>${scaling}</dd></div>
        <div><dt>${L('Only when', '条件')}</dt><dd>${eventWhen(key)}</dd></div>
      </dl>
    </article>`;
}

const tileName = (k) => TERRAINS[k]?.name ?? k;
const STAT_ZH = { food: '食物', oil: '石油', manpower: '人力' };
const CATEGORY_ZH = { building: '建筑', land: '地形', junk: '废料', action: '行动' };

const PRICE = Object.fromEntries(SHOP_ITEMS);

const bagWeight =
  TERRAIN_KEYS.reduce((sum, key) => sum + TERRAINS[key].weight, 0) +
  Object.values(ACTIONS).reduce((sum, a) => sum + (a.weight ?? 0), 0);

function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function bonusText(bonus) {
  return Object.entries(bonus)
    .map(([stat, n]) => `${signed(n)} ${L(stat, STAT_ZH[stat] ?? stat)}`)
    .join(L(', ', '，'));
}

function availability(key, terrain) {
  if (key === 'capital') return L('Starting tile', '初始地块');
  if (key === 'crater') return L('Overlord only', '仅由霸主生成');
  if (key === 'raider') return L('Starvation only', '仅因饥荒出现');
  if (terrain.bandit) return L('3×3 block of Wasteland, end of season', '3×3 荒地区域，季节结束时');
  if (key === 'ruins') return L('Mystery site only', '仅来自神秘地点');
  if (terrain.weight <= 0) return L('Never', '从不');
  if (PRICE[key]) return L(`Locked until bought (${PRICE[key]} barrels) · then ${terrain.weight}`, `购买前锁定（${PRICE[key]} 桶）· 之后 ${terrain.weight}`);
  const share = Math.round((terrain.weight / bagWeight) * 1000) / 10;
  return `${terrain.weight} · ${share}%`;
}

function shapeNote(key) {
  if (key.startsWith('wasteland')) return L('Polyomino · any shape below', '多格板块 · 下列任意形状');
  return L('Single tile', '单格');
}

/** Readable lines for the economy object on each terrain. */
function statLines(stats) {
  const none = L('No direct yield', '无直接产出');
  if (!stats || Object.keys(stats).length === 0) return [none];
  const lines = [];
  if (stats.food) lines.push(L(`Food ${signed(stats.food)}`, `食物 ${signed(stats.food)}`));
  if (stats.manpower > 0) lines.push(L(`Worker slots +${stats.manpower}`, `人力 +${stats.manpower}`));
  if (stats.manpower < 0) lines.push(L(`Needs ${-stats.manpower} worker`, `需要 ${-stats.manpower} 人力`));
  if (stats.oil) lines.push(L(`Oil ${signed(stats.oil)}`, `石油 ${signed(stats.oil)}`));
  if (stats.adjacentManpower) {
    for (const [n, v] of Object.entries(stats.adjacentManpower)) lines.push(L(`Next to ${tileName(n)}: Worker slots +${v}`, `紧邻${tileName(n)}：人力 +${v}`));
  }
  if (stats.drain === 'slots')
    lines.push(
      L(
        `Worker slots -${P(SCALE.campSlots)} per camp (at most ${P(SCALE.campStackMax)} in total)`,
        `每个营地使人力 -${P(SCALE.campSlots)}（总计最多 ${P(SCALE.campStackMax)}）`,
      ),
    );
  if (stats.drain === 'banditSlots') lines.push(L(`Worker slots -${SCALE.banditSlots}`, `人力 -${SCALE.banditSlots}`));
  if (stats.drain === 'oil') lines.push(L(`Oil -${SCALE.banditOil} per season`, `每季石油 -${SCALE.banditOil}`));
  if (stats.drain === 'food') lines.push(L(`Food -${SCALE.banditFood} per season`, `每季食物 -${SCALE.banditFood}`));
  if (stats.drain === 'stockpile') lines.push(L(`Stockpile -${SCALE.banditStockpile} barrels per season`, `每季石油库存 -${SCALE.banditStockpile} 桶`));
  if (stats.ruinsBonusManpower) lines.push(L(`On ruins, +${stats.ruinsBonusManpower} extra worker slot`, `建在遗迹上时额外 +${stats.ruinsBonusManpower} 人力`));
  if (stats.adjacent) {
    for (const [neighbour, bonus] of Object.entries(stats.adjacent)) {
      lines.push(L(`Next to ${tileName(neighbour)}: ${bonusText(bonus)}`, `紧邻${tileName(neighbour)}：${bonusText(bonus)}`));
    }
  }
  if (stats.adjacentBonus) {
    for (const [neighbour, bonus] of Object.entries(stats.adjacentBonus)) {
      lines.push(L(`Gives adjacent ${tileName(neighbour)}: ${bonusText(bonus)}`, `使相邻的${tileName(neighbour)}：${bonusText(bonus)}`));
    }
  }
  if (stats.adjacentPenalty) {
    for (const [neighbour, bonus] of Object.entries(stats.adjacentPenalty)) {
      lines.push(L(`Hits each adjacent ${tileName(neighbour)}: ${bonusText(bonus)}`, `每个相邻的${tileName(neighbour)}：${bonusText(bonus)}`));
    }
  }
  if (stats.oilMultiplierPerAdjacent) {
    for (const [neighbour, n] of Object.entries(stats.oilMultiplierPerAdjacent)) {
      lines.push(L(`Makes ${n}× the oil of each adjacent ${tileName(neighbour)}`, `产出每个相邻${tileName(neighbour)}产量 ${n} 倍的石油`));
    }
  }
  if (stats.builtOnBonus) lines.push(L(`When built on: ${bonusText(stats.builtOnBonus)}, any building`, `在其上建造任意建筑时：${bonusText(stats.builtOnBonus)}`));
  return lines.length ? lines : [none];
}

/** One WebGL context, one still per terrain. A page of live canvases trips the browser context limit. */
async function renderThumbs() {
  const width = 480;
  const height = 320;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14181a);
  scene.add(new THREE.HemisphereLight(0xdfe8e4, 0x2a2622, 1.35));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.1);
  sun.position.set(4, 7, 3);
  sun.castShadow = true;
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
  camera.position.set(1.45, 1.25, 1.65);
  camera.lookAt(0, -0.32, 0);

  const factory = new TileFactory();
  await factory.ready;
  const urls = {};
  const offset = new THREE.Vector3(1, 0.72, 1.15).normalize();
  for (const key of TERRAIN_KEYS) {
    const mesh = factory.create(key);
    scene.add(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = (Math.max(size.x, size.y, size.z) * 0.68) / Math.sin(THREE.MathUtils.degToRad(16));
    camera.position.copy(center).addScaledVector(offset, dist);
    camera.near = Math.max(0.01, dist / 80);
    camera.far = dist * 12;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    urls[key] = renderer.domElement.toDataURL('image/png');
    scene.remove(mesh);
  }
  renderer.dispose();
  return urls;
}

function cardHTML(key, thumb) {
  const terrain = TERRAINS[key];
  const lines = statLines(terrain.stats)
    .map((line) => `<li>${line}</li>`)
    .join('');
  return `
    <article class="tile ${terrain.category}" id="tile-${key}">
      <img class="thumb" src="${thumb}" alt="${L(`${terrain.name} tile`, `${terrain.name}地块`)}" width="480" height="320" />
      <div class="swatches" title="${L('Authored top and edge colours', '设定的顶面和边缘颜色')}">
        <i style="background:${hex(terrain.top)}"></i>
        <i style="background:${hex(terrain.edge)}"></i>
        <span>${hex(terrain.top)} · ${hex(terrain.edge)}</span>
      </div>
      <h3>${terrain.name}</h3>
      <p class="key">${key}</p>
      <div class="rule">${cardText(terrain)}</div>
      <ul class="stats">${lines}</ul>
      <dl>
        <div><dt>${L('Category', '类别')}</dt><dd>${L(terrain.category, CATEGORY_ZH[terrain.category])}</dd></div>
        <div><dt>${L('Buildable', '可建造')}</dt><dd>${terrain.buildable ? L('Yes', '是') : L('No', '否')}</dd></div>
        <div><dt>${L('Shape', '形状')}</dt><dd>${shapeNote(key)}</dd></div>
        <div><dt>${L('Draw', '抽取')}</dt><dd>${availability(key, terrain)}</dd></div>
      </dl>
    </article>`;
}

function actionHTML(key) {
  const a = ACTIONS[key];
  const d = 2 * (a.range ?? 0) + 1;
  const area = a.size
    ? L(`${a.size}×${a.size} square, target is a corner`, `${a.size}×${a.size} 方形，目标格为其一角`)
    : a.range
      ? L(`${d}×${d} around the target`, `目标周围 ${d}×${d}`)
      : L('The target cell', '目标格');
  return `
    <article class="tile action" id="tile-${key}">
      <div class="thumb symbol-thumb" style="--top:${hex(a.top)};--edge:${hex(a.edge)}"><span>${a.symbol}</span></div>
      <div class="swatches" title="${L('Card colours', '卡牌颜色')}">
        <i style="background:${hex(a.top)}"></i>
        <i style="background:${hex(a.edge)}"></i>
        <span>${hex(a.top)} · ${hex(a.edge)}</span>
      </div>
      <h3>${a.name}</h3>
      <p class="key">${key}</p>
      <div class="rule">${cardText(a)}</div>
      <dl>
        <div><dt>${L('Category', '类别')}</dt><dd>${L('action', CATEGORY_ZH.action)}</dd></div>
        <div><dt>${L('Area', '范围')}</dt><dd>${area}</dd></div>
        <div><dt>${L('Uses', '次数')}</dt><dd>${L('One, then discarded', '一次，之后弃掉')}</dd></div>
        <div><dt>${L('Shop', '市场')}</dt><dd>${L(`${PRICE[key]} barrels`, `${PRICE[key]} 桶`)}</dd></div>
        <div><dt>${L('Draw', '抽取')}</dt><dd>${L('Locked until bought · then', '购买前锁定 · 之后')} ${a.weight} · ${Math.round((a.weight / bagWeight) * 1000) / 10}%</dd></div>
      </dl>
    </article>`;
}

function shapeStrip() {
  const color = hex(TERRAINS.wasteland1.top);
  const edge = hex(TERRAINS.wasteland1.edge);
  const cell = 18;
  return Object.entries(SHAPES)
    .map(([key, shape]) => {
      const w = Math.max(...shape.cells.map((c) => c[0])) + 1;
      const h = Math.max(...shape.cells.map((c) => c[1])) + 1;
      const squares = shape.cells
        .map(
          ([x, z]) =>
            `<i style="left:${x * cell}px;top:${z * cell}px;background:${color};box-shadow:inset 0 -4px 0 ${edge}"></i>`,
        )
        .join('');
      return `
        <div class="shape-card">
          <div class="mini" style="width:${w * cell}px;height:${h * cell}px">${squares}</div>
          <div class="shape-name">${shape.name}</div>
          <div class="shape-meta">${key} · ${shape.cells.length} · ${L('weight', '权重')} ${shape.weight}</div>
        </div>`;
    })
    .join('');
}

// The language chosen in the game (saved by i18n.js); a switch in another tab is followed too.
applyStatic();
window.addEventListener('storage', (e) => {
  if (e.key === 'oto.lang') setLang(e.newValue);
});

const root = document.getElementById('library');
const lede = document.getElementById('lede');
const loading = () => (lede.textContent = L('Loading blockouts…', '正在加载模型…'));
loading();
const stopLoading = onLangChange(loading);

const thumbs = await renderThumbs();
stopLoading();
render();
onLangChange(render);

function render() {
  lede.textContent = L(
    `${TERRAIN_KEYS.length} tiles, ${Object.keys(ACTIONS).length} action cards, ${Object.keys(EVENTS).length} events · bag weight ${bagWeight}. Weights are relative. Capital and the toxic crater are never drawn; shop tiles are locked until bought.`,
    `${TERRAIN_KEYS.length} 种地块、${Object.keys(ACTIONS).length} 张行动卡、${Object.keys(EVENTS).length} 个年度事件 · 总权重 ${bagWeight}。权重为相对值。首都和毒坑永远不会被抽到；市场地块在购买前处于锁定状态。`,
  );
  root.innerHTML = groups().map(groupHTML).join('');
}

function groupHTML(group) {
  if (group.id === 'events') {
    return `
    <section class="group">
      <header>
        <h2>${group.title}</h2>
        <p>${group.blurb}</p>
      </header>
      <div class="grid">${Object.keys(EVENTS).map(eventHTML).join('')}</div>
    </section>`;
  }
  if (group.id === 'action') {
    return `
    <section class="group">
      <header>
        <h2>${group.title}</h2>
        <p>${group.blurb}</p>
      </header>
      <div class="grid">${Object.keys(ACTIONS).map(actionHTML).join('')}</div>
    </section>`;
  }
  const keys = TERRAIN_KEYS.filter((key) => TERRAINS[key].category === group.id);
  const extra = group.id === 'junk' ? `<div class="shapes"><h3>${L('Wasteland shapes', '荒地形状')}</h3><div class="shape-row">${shapeStrip()}</div></div>` : '';
  return `
    <section class="group">
      <header>
        <h2>${group.title}</h2>
        <p>${group.blurb}</p>
      </header>
      <div class="grid">${keys.map((key) => cardHTML(key, thumbs[key])).join('')}</div>
      ${extra}
    </section>`;
}
