import './library.css';
import * as THREE from 'three';
import { SHAPES } from './pieces.js';
import { ACTIONS, SHOP_ITEMS, TERRAINS, TERRAIN_KEYS, TileFactory, cardText, hex } from './tiles.js';
import { SCALE, P, loadScaleConfig, eventPct, FIRST_EVENT_YEAR } from './scalingConfig.js';
import { EVENTS, KIND_LABEL } from './events.js';

loadScaleConfig(); // show the tuned numbers

const GROUPS = [
  {
    id: 'building',
    title: 'Buildings',
    blurb: 'Part of the economy. A building is never drawn as a multi-tile piece.',
  },
  {
    id: 'land',
    title: 'Land',
    blurb: 'Terrain with an effect on whatever is placed next to it, or on top of it.',
  },
  {
    id: 'action',
    title: 'Action cards',
    blurb: 'Played on the board for a one-off effect, then gone; never become tiles. Locked until bought in the shop; after that they are also drawn now and then at random.',
  },
  {
    id: 'junk',
    title: 'Junk',
    blurb: 'Clogs the hand. Only Wasteland is drawn as a polyomino. The four Wasteland colours share one look and split a draw weight of about 5.4 (≈30% of draws). Wasteland must be placed before ending the turn and can never be built on.',
  },
  {
    id: 'events',
    title: 'Events',
    blurb: `One event is drawn at the start of every year from year ${FIRST_EVENT_YEAR} on and lasts until the next tribute. Each met tribute in a row makes Pressure and Disaster 25% more likely; a missed tribute halves them and makes Good fortune and Choice ×1.75. Events whose condition isn't met are skipped. Effect text shows year-${FIRST_EVENT_YEAR} strength; numbers marked "e.g." use a sample city (2 camps, 2 settlements, tribute 20).`,
  },
];

/** Readable form of each event's `when` draw condition (events.js). */
const EVENT_WHEN = {
  showOfForce: 'You have at least one building and an empty cell next to your land',
  earthquake: 'There is an empty cell next to your land',
  mercenaries: 'You have at least one camp',
  prospectors: 'A hidden "?" site remains',
  taxSettlements: 'You have at least one settlement',
};

const SAMPLE_INFO = { camps: 2, settlements: 2, sites: 1, quota: 20, buildings: 3, open: 5 };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function eventHTML(key) {
  const ev = EVENTS[key];
  const p = ev.scale ? eventPct(ev.scale, FIRST_EVENT_YEAR) : 0;
  const info = { ...SAMPLE_INFO, cliffs: SCALE.earthquakeCliffs };
  const total = Object.values(EVENTS).reduce((s, e) => s + e.weight, 0);
  const scaling = ev.scale
    ? `${P(SCALE[`${ev.scale}Base`])} in year ${FIRST_EVENT_YEAR}, +${P(SCALE[`${ev.scale}PerYear`])}/yr, max ${P(SCALE[`${ev.scale}Max`])}`
    : key === 'earthquake'
      ? `${SCALE.earthquakeCliffs} cliffs`
      : 'Fixed';
  const sampled = (fn) => {
    const src = String(fn);
    return /info\?\.(camps|quota|settlements)/.test(src) ? `${esc(fn(p, null, info))} <span class="eg">e.g.</span>` : esc(fn(p, null, info));
  };
  // Choice texts that need the live economy to read sensibly.
  const override = { 'refugees:Take them in': `+${P(p)} worker slots, ${P(p)} of the food grown eaten on top each season` };
  const choices = ev.choices
    ? `<ul class="choices">${ev.choices
        .map((c) => `<li><b>${esc(c.label)}</b>: ${override[`${key}:${c.label}`] ?? sampled(c.text)}<div class="say">“${esc(c.say)}” — <i>${esc(c.retort)}</i></div></li>`)
        .join('')}</ul>`
    : '';
  const lines = typeof ev.lines === 'function' ? ev.lines(p) : ev.lines ?? [];
  return `
    <article class="tile event ${ev.kind}" id="event-${key}">
      <div class="event-head"><span class="badge ${ev.kind}">${KIND_LABEL[ev.kind]}</span></div>
      <h3>${esc(ev.name)}</h3>
      <p class="key">${key}</p>
      <div class="rule">${sampled(ev.text)}</div>
      ${choices}
      <blockquote class="dialogue">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</blockquote>
      <dl>
        <div><dt>Kind</dt><dd>${KIND_LABEL[ev.kind]}</dd></div>
        <div><dt>Draw</dt><dd>${ev.weight} · ${Math.round((ev.weight / total) * 1000) / 10}% (base)</dd></div>
        <div><dt>Scaling</dt><dd>${scaling}</dd></div>
        <div><dt>Only when</dt><dd>${EVENT_WHEN[key] ?? 'Always'}</dd></div>
      </dl>
    </article>`;
}

const NAME = Object.fromEntries(TERRAIN_KEYS.map((k) => [k, TERRAINS[k].name]));

const PRICE = Object.fromEntries(SHOP_ITEMS);

const bagWeight =
  TERRAIN_KEYS.reduce((sum, key) => sum + TERRAINS[key].weight, 0) +
  Object.values(ACTIONS).reduce((sum, a) => sum + (a.weight ?? 0), 0);

function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function bonusText(bonus) {
  return Object.entries(bonus)
    .map(([stat, n]) => `${signed(n)} ${stat}`)
    .join(', ');
}

function availability(key, terrain) {
  if (key === 'capital') return 'Starting tile';
  if (key === 'crater') return 'Overlord only';
  if (key === 'raider') return 'Starvation only';
  if (terrain.bandit) return '3×3 block of Wasteland, end of season';
  if (key === 'ruins') return 'Mystery site only';
  if (terrain.weight <= 0) return 'Never';
  if (PRICE[key]) return `Locked until bought (${PRICE[key]} barrels) · then ${terrain.weight}`;
  const share = Math.round((terrain.weight / bagWeight) * 1000) / 10;
  return `${terrain.weight} · ${share}%`;
}

function shapeNote(key) {
  if (key.startsWith('wasteland')) return 'Polyomino · any shape below';
  return 'Single tile';
}

/** Readable lines for the economy object on each terrain. */
function statLines(stats) {
  if (!stats || Object.keys(stats).length === 0) return ['No direct yield'];
  const lines = [];
  if (stats.food) lines.push(`Food ${signed(stats.food)}`);
  if (stats.manpower > 0) lines.push(`Worker slots +${stats.manpower}`);
  if (stats.manpower < 0) lines.push(`Needs ${-stats.manpower} worker`);
  if (stats.oil) lines.push(`Oil ${signed(stats.oil)}`);
  if (stats.adjacentManpower) {
    for (const [n, v] of Object.entries(stats.adjacentManpower)) lines.push(`Next to ${NAME[n] ?? n}: Worker slots +${v}`);
  }
  if (stats.drain === 'slots') lines.push(`Worker slots -${P(SCALE.campSlots)} per camp (at most ${P(SCALE.campStackMax)} in total)`);
  if (stats.drain === 'banditSlots') lines.push(`Worker slots -${SCALE.banditSlots}`);
  if (stats.drain === 'oil') lines.push(`Oil -${SCALE.banditOil} per season`);
  if (stats.drain === 'food') lines.push(`Food -${SCALE.banditFood} per season`);
  if (stats.drain === 'stockpile') lines.push(`Stockpile -${SCALE.banditStockpile} barrels per season`);
  if (stats.ruinsBonusManpower) lines.push(`On ruins, +${stats.ruinsBonusManpower} extra worker slot`);
  if (stats.adjacent) {
    for (const [neighbour, bonus] of Object.entries(stats.adjacent)) {
      lines.push(`Next to ${NAME[neighbour] ?? neighbour}: ${bonusText(bonus)}`);
    }
  }
  if (stats.adjacentBonus) {
    for (const [neighbour, bonus] of Object.entries(stats.adjacentBonus)) {
      lines.push(`Gives adjacent ${NAME[neighbour] ?? neighbour}: ${bonusText(bonus)}`);
    }
  }
  if (stats.adjacentPenalty) {
    for (const [neighbour, bonus] of Object.entries(stats.adjacentPenalty)) {
      lines.push(`Hits each adjacent ${NAME[neighbour] ?? neighbour}: ${bonusText(bonus)}`);
    }
  }
  if (stats.oilMultiplierPerAdjacent) {
    for (const [neighbour, n] of Object.entries(stats.oilMultiplierPerAdjacent)) {
      lines.push(`Oil ×${n} for each adjacent ${NAME[neighbour] ?? neighbour}`);
    }
  }
  if (stats.builtOnBonus) lines.push(`When built on: ${bonusText(stats.builtOnBonus)}, any building`);
  return lines.length ? lines : ['No direct yield'];
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
      <img class="thumb" src="${thumb}" alt="${terrain.name} tile" width="480" height="320" />
      <div class="swatches" title="Authored top and edge colours">
        <i style="background:${hex(terrain.top)}"></i>
        <i style="background:${hex(terrain.edge)}"></i>
        <span>${hex(terrain.top)} · ${hex(terrain.edge)}</span>
      </div>
      <h3>${terrain.name}</h3>
      <p class="key">${key}</p>
      <div class="rule">${cardText(terrain)}</div>
      <ul class="stats">${lines}</ul>
      <dl>
        <div><dt>Category</dt><dd>${terrain.category}</dd></div>
        <div><dt>Buildable</dt><dd>${terrain.buildable ? 'Yes' : 'No'}</dd></div>
        <div><dt>Shape</dt><dd>${shapeNote(key)}</dd></div>
        <div><dt>Draw</dt><dd>${availability(key, terrain)}</dd></div>
      </dl>
    </article>`;
}

function actionHTML(key) {
  const a = ACTIONS[key];
  const area = a.size ? `${a.size}×${a.size} square, target is a corner` : a.range ? `${2 * a.range + 1}×${2 * a.range + 1} around the target` : 'The target cell';
  return `
    <article class="tile action" id="tile-${key}">
      <div class="thumb symbol-thumb" style="--top:${hex(a.top)};--edge:${hex(a.edge)}"><span>${a.symbol}</span></div>
      <div class="swatches" title="Card colours">
        <i style="background:${hex(a.top)}"></i>
        <i style="background:${hex(a.edge)}"></i>
        <span>${hex(a.top)} · ${hex(a.edge)}</span>
      </div>
      <h3>${a.name}</h3>
      <p class="key">${key}</p>
      <div class="rule">${cardText(a)}</div>
      <dl>
        <div><dt>Category</dt><dd>action</dd></div>
        <div><dt>Area</dt><dd>${area}</dd></div>
        <div><dt>Uses</dt><dd>One, then discarded</dd></div>
        <div><dt>Shop</dt><dd>${PRICE[key]} barrels</dd></div>
        <div><dt>Draw</dt><dd>Locked until bought · then ${a.weight} · ${Math.round((a.weight / bagWeight) * 1000) / 10}%</dd></div>
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
          <div class="shape-meta">${key} · ${shape.cells.length} · weight ${shape.weight}</div>
        </div>`;
    })
    .join('');
}

const root = document.getElementById('library');
document.getElementById('lede').textContent = 'Loading blockouts…';

const thumbs = await renderThumbs();
document.getElementById('lede').textContent =
  `${TERRAIN_KEYS.length} tiles, ${Object.keys(ACTIONS).length} action cards, ${Object.keys(EVENTS).length} events · bag weight ${bagWeight}. Weights are relative. Capital and the toxic crater are never drawn; shop tiles are locked until bought.`;

root.innerHTML = GROUPS.map((group) => {
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
  const extra = group.id === 'junk' ? `<div class="shapes"><h3>Wasteland shapes</h3><div class="shape-row">${shapeStrip()}</div></div>` : '';
  return `
    <section class="group">
      <header>
        <h2>${group.title}</h2>
        <p>${group.blurb}</p>
      </header>
      <div class="grid">${keys.map((key) => cardHTML(key, thumbs[key])).join('')}</div>
      ${extra}
    </section>`;
}).join('');
