import './ui.css';
import * as THREE from 'three';
import { createScene } from './scene.js';
import { CameraRig } from './controls.js';
import { Grid } from './grid.js';
import { TileFactory, TERRAINS, hex } from './tiles.js';
import { hasBlockout } from './models.js';
import { Frontier } from './frontier.js';
import { Placement } from './placement.js';
import { Hand } from './hand.js';
import { Expansion } from './expansion.js';
import { Mysteries } from './mystery.js';
import { computeEconomy, growthCost, FIRST_QUOTA, nextQuota, SEASONS } from './economy.js';
import { Payout } from './payout.js';
import { loadPayoutConfig } from './payoutConfig.js';
import { createDebugPanel } from './debugPanel.js';

const HAND_SIZE = 5;
const SEED_TERRAIN = 'capital';

// ---------- setup ----------
const { renderer, scene, camera, followTarget } = createScene(document.getElementById('app'));
const rig = new CameraRig(camera, renderer.domElement);
const grid = new Grid();
const factory = new TileFactory();
const tiles = new THREE.Group();
scene.add(tiles);
const frontier = new Frontier(scene);
const placement = new Placement(scene, grid, factory);
const expansion = new Expansion(scene);
const mysteries = new Mysteries(scene);
const payoutCfg = loadPayoutConfig();
const payout = new Payout(camera, document.getElementById('floaters'), payoutCfg);
const debug = createDebugPanel(document.getElementById('debug'), document.getElementById('btnDebug'), payoutCfg, {
  onPlay: () => previewPayout(),
});
const hand = new Hand(document.getElementById('hand'), HAND_SIZE, (piece) => placement.setPiece(piece), grid);

const $ = (id) => document.getElementById(id);
const anims = [];
let piecesPlaced = 0;

// Turn state: a turn is a season, a round is four seasons, tribute after Winter.
const turn = { round: 1, season: 0, stockpile: 0, rerolls: 0, rerollSpent: 0, total: 0, food: 0, population: 0, quota: FIRST_QUOTA };

/** This season's economy with the carried-over food store and population. */
const economyNow = () => computeEconomy(grid, turn.rerollSpent, { population: turn.population, foodStore: turn.food });

// Tiles that can't be drawn yet: no Cliffs or Pre-war Ruins during the first round.
// The opening hand (first season, rerolls included) only has the basics: Wasteland, stations, farms, settlements.
const OPENING_TILES = ['wasteland1', 'wasteland2', 'wasteland3', 'wasteland4', 'station', 'farm', 'settlement'];
hand.excluded = () => {
  if (turn.round === 1 && turn.season === 0) return Object.keys(TERRAINS).filter((k) => !OPENING_TILES.includes(k));
  return turn.round === 1 ? ['cliffs', 'ruins'] : [];
};

// ---------- tiles ----------
const WASTELAND_VARIANTS = ['wasteland1', 'wasteland2', 'wasteland3', 'wasteland4'];

/** Places a tile, replacing whatever was there (building over Wasteland / Ruins). */
function addTile(x, z, terrain, delay = 0) {
  // Mix wasteland shades per cell so a wasteland piece doesn't look like one flat slab.
  if (WASTELAND_VARIANTS.includes(terrain)) {
    terrain = WASTELAND_VARIANTS[Math.floor(Math.random() * WASTELAND_VARIANTS.length)];
  }
  const old = grid.get(x, z);
  const onRuins = old?.terrain === 'ruins' || (old?.onRuins ?? false);
  if (old) removeMesh(old.mesh);

  const mesh = factory.create(terrain);
  mesh.position.set(x, 0, z);
  mesh.visible = false;
  tiles.add(mesh);
  grid.set(x, z, { terrain, mesh, onRuins });
  anims.push({ mesh, t: -delay, dur: 0.38 });
}

/** Swap any flat stand-in that now has a loaded blockout, including one still falling. */
function adoptBlockouts() {
  for (const cell of grid.cells.values()) {
    if (!hasBlockout(cell.terrain)) continue;
    const previous = cell.mesh;
    const next = factory.upgrade(previous, cell.terrain);
    if (next === previous) continue;
    const anim = anims.find((a) => a.mesh === previous);
    if (anim) anim.mesh = next;
    cell.mesh = next;
  }
  if (hand.piece) placement.setPiece(hand.piece);
}

factory.ready.then(adoptBlockouts);

function removeMesh(mesh) {
  tiles.remove(mesh);
  const i = anims.findIndex((a) => a.mesh === mesh);
  if (i >= 0) anims.splice(i, 1);
}

/** Debug stand-in for the overlord's nuke: turn a random non-capital tile into a Toxic Crater. */
function nukeRandomTile(quiet = false) {
  const targets = [...grid.cells.values()].filter((c) => c.terrain !== 'capital' && c.terrain !== 'crater');
  if (!targets.length) {
    if (!quiet) toast('Nothing for the Overlord to nuke');
    return null;
  }
  const { x, z } = targets[Math.floor(Math.random() * targets.length)];
  const lost = TERRAINS[grid.get(x, z).terrain].name;
  addTile(x, z, 'crater');
  grid.get(x, z).onRuins = false; // the ruins are gone too
  if (!quiet) toast('The Overlord is displeased: a Toxic Crater forms', 'bad');
  placement.cell = null; // force ghost revalidation
  updateHUD();
  return lost;
}

function updateDropAnims(dt) {
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    a.t += dt;
    if (a.t < 0) continue;
    a.mesh.visible = true;
    const p = Math.min(a.t / a.dur, 1);
    const fall = 1 - Math.pow(1 - p, 3);
    a.mesh.position.y = (1 - fall) * 1.4;
    // little squash on landing
    const squash = p > 0.7 ? Math.sin(((p - 0.7) / 0.3) * Math.PI) * 0.12 : 0;
    a.mesh.scale.set(1 + squash * 0.4, 1 - squash, 1 + squash * 0.4);
    if (p >= 1) {
      a.mesh.position.y = 0;
      a.mesh.scale.set(1, 1, 1);
      anims.splice(i, 1);
    }
  }
}

// ---------- HUD ----------
let toastTimer = 0;
function toast(msg, kind = '', ms = 1600) {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = kind), ms);
}

function pop(el) {
  el.classList.remove('pop');
  void el.offsetWidth; // restart animation
  el.classList.add('pop');
}

/** Big number = current amount, small (±n) = change this season. */
function setRes(id, amount, change) {
  $(id).textContent = Math.round(amount);
  $(id).classList.toggle('neg', Math.round(amount) < 0);
  const d = $(`${id}D`);
  const n = Math.round(change);
  // Only show the bracket when something is used up: if nothing is consumed it just repeats the big number.
  d.textContent = n === Math.round(amount) ? '' : `(${n > 0 ? `+${n}` : n})`;
  d.className = n > 0 ? 'up' : n < 0 ? 'down' : '';
}

function updateHUD() {
  const n = grid.size;
  const quota = turn.quota;
  const left = 3 - turn.season;
  $('seasonLabel').textContent =
    `Round ${turn.round} · ${SEASONS[turn.season]} · tribute ${left ? `in ${left} season${left === 1 ? '' : 's'}` : 'due this Winter'}`;
  showOil(turn.stockpile);
  $('pieceCount').textContent =
    `${piecesPlaced} piece${piecesPlaced === 1 ? '' : 's'} placed · territory ${n} / ${grid.capacity}`;

  // Projected economy for this season if the turn ended now.
  const e = economyNow();
  // Food / Manpower: big number = how much you produce, small (±n) = excess or shortfall after upkeep.
  // Food shows the balance (grown minus eaten), which is what actually goes into the store.
  setRes('resFood', e.foodBalance, e.foodBalance);
  setRes('resMp', e.supplied, e.spare);
  // Oil: big number = the stockpile (the Overlord takes it all after Winter), small = this season's yield.
  $('resOilD').textContent = `(+${e.oil})`;
  $('resOilD').className = e.oil > 0 ? 'up' : '';

  // Food store progress toward the next population point.
  const cost = growthCost(turn.population);
  $('popFill').style.width = `${Math.min(1, turn.food / cost) * 100}%`;
  $('popText').textContent =
    `store ${turn.food} / ${cost} → +1 pop` +
    (e.popGrowth ? ` · growing +${e.popGrowth} this season` : '') +
    (turn.population ? ` · population ${turn.population}` : '');

  $('btnReroll').classList.toggle('hidden', hand.isEmpty);
  $('btnReroll').classList.toggle('disabled', e.supplied - rerollCost() < 1);
  $('btnRerollSub').textContent = `costs ${rerollCost()} manpower`;
  $('btnNextSub').textContent = hand.placeableForced.length
    ? 'place your Wasteland first'
    : turn.season === 3
      ? `collect oil, pay ${quota} tribute`
      : 'collect oil, draw a new hand';
  if (tipKind) renderResTip(e);
}

/** Each reroll in a season costs 1 more manpower than the last (1, 2, 3, …); resets every turn. */
const rerollCost = () => turn.rerolls + 1;

// ---------- resource breakdown tooltips ----------
let tipKind = null; // 'food' | 'mp' | 'oil' while a resource row is hovered

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const pct = (f) => `${Math.round(f * 100)}%`;
const times = (f) => `×${+f.toFixed(2)}`;

/**
 * Line items for one resource. Each row: [label, value, type]
 * type: 'add' (signed amount), 'mul' (multiplier), 'total' (subtotal line), 'note' (plain text)
 */
function breakdown(kind, e) {
  const c = (t) => e.counts[t] ?? 0;
  const rows = [];
  const add = (label, v) => v && rows.push([label, signed(v), v < 0 ? 'add bad' : 'add']);
  const mul = (label, f) => f !== 1 && rows.push([label, times(f), f < 1 ? 'mul bad' : 'mul']);
  const total = (label, v) => rows.push([label, v, 'total']);
  const note = (text) => rows.push([text, '', 'note']);

  if (kind === 'food') {
    add(`Hydro-farms ×${c('farm')}`, 2 * c('farm'));
    add(`Pump bonus ×${e.bonus.pumpFarms}`, 2 * e.bonus.pumpFarms);
    add(`Oasis bonus ×${e.bonus.oasisFarms}`, 3 * e.bonus.oasisFarms);
    if (e.staffing < 1) mul(`Understaffed (${pct(e.staffing)})`, e.staffing);
    total('Grown', Math.round(e.foodGrown));
    add('Capital eats', -3 * c('capital'));
    add(`Settlements ×${c('settlement')}`, -c('settlement'));
    add('Toxic craters', -e.craterFood);
    total('Balance', signed(Math.round(e.foodBalance)));
    if (e.foodBalance < 0) {
      note(
        e.fed < 1
          ? `Store can't cover it: people go hungry, stations run at ${pct(e.fed)}`
          : `Shortfall covered from the store (${e.foodStore})`,
      );
    }
    note(`Store ${e.foodStore} → ${e.storeAfter} / ${e.nextGrowthCost} for +1 population`);
    if (e.popGrowth) note(`Population grows +${e.popGrowth} this season`);
  } else if (kind === 'mp') {
    add('Capital', 4 * c('capital'));
    add(`Settlements ×${c('settlement')}`, 2 * c('settlement'));
    add('Built on ruins', e.bonus.ruins);
    add(`Population`, e.population);
    add('Toxic craters', -e.craterManpower);
    add('Rerolls this season', -e.rerollsSpent);
    total('Supplied', e.supplied);
    add(`Hydro-farms ×${c('farm')}`, -c('farm'));
    add(`Stations ×${c('station')}`, -c('station'));
    add(`Refineries ×${c('refinery')}`, -2 * c('refinery'));
    total('Spare', signed(e.spare));
    note(
      e.spare >= 0
        ? `Each spare worker: +10% station output (now ${times(e.boost)})`
        : `Short ${-e.spare} workers: buildings run at ${pct(e.staffing)}`,
    );
  } else {
    add(`Stations ×${c('station')}`, 2 * c('station'));
    add(`Tar pit bonus ×${e.bonus.tarpitStations}`, 2 * e.bonus.tarpitStations);
    total('Crude', e.crude);
    mul(`Refineries (${e.refineryLinks} station link${e.refineryLinks === 1 ? '' : 's'})`, e.refineryMult);
    mul('Spare workers', e.boost);
    mul('Understaffed', e.staffing);
    mul('Hunger', e.fed);
    total('This season', signed(e.oil));
    note(`Stockpile ${turn.stockpile} → ${turn.stockpile + e.oil} / ${turn.quota} tribute`);
    note('The Overlord takes all of it after Winter.');
  }
  return rows;
}

const TIP_TITLE = 'How this season adds up';

function renderResTip(e = economyNow()) {
  const rows = breakdown(tipKind, e);
  $('resTip').innerHTML =
    `<div class="title">${TIP_TITLE}</div>` +
    (rows.length ? '' : '<div class="row note">Nothing yet</div>') +
    rows
      .map(([label, value, type]) => `<div class="row ${type}"><span>${label}</span><b>${value}</b></div>`)
      .join('');
}

for (const row of document.querySelectorAll('#panel .res[data-tip]')) {
  row.addEventListener('mouseenter', () => {
    tipKind = row.dataset.tip;
    renderResTip();
    const tip = $('resTip');
    tip.style.setProperty('--c', getComputedStyle(row).getPropertyValue('--c'));
    tip.classList.remove('hidden');
    // Beside the row, kept on screen.
    const r = row.getBoundingClientRect();
    const top = Math.min(r.top, window.innerHeight - tip.offsetHeight - 8);
    tip.style.top = `${Math.max(8, top)}px`;
  });
  row.addEventListener('mouseleave', () => {
    tipKind = null;
    $('resTip').classList.add('hidden');
  });
}

// ---------- hovered tile info ----------
let inspected = null; // cell object currently shown
function updateInspect(cell) {
  const c = cell ? grid.get(cell[0], cell[1]) : null;
  if (c === inspected && c?.terrain === inspected?.terrain) return;
  inspected = c;
  const el = $('inspect');
  if (!c) {
    el.classList.add('hidden');
    return;
  }
  const t = TERRAINS[c.terrain];
  el.style.setProperty('--top', hex(t.top));
  el.style.setProperty('--edge', hex(t.edge));
  const notes = [];
  if (c.onRuins && t.category === 'building')
    notes.push(`Built on Pre-war Ruins: +${c.terrain === 'settlement' ? 2 : 1} manpower`);
  if (t.buildable) notes.push('A building can be placed on top of this tile');
  el.innerHTML = `
    <div class="card-big">
      <div class="art"><div class="swatch"></div></div>
      <div class="name">${t.name}</div>
      <div class="rule">${t.rule}</div>
      <div class="kind">${t.category}</div>
    </div>
    ${notes.map((n) => `<div class="note">${n}</div>`).join('')}`;
  el.classList.remove('hidden');
}

// ---------- turns ----------
/** Next turn: tiles hop and flash what they produce, then the turn is settled. */
function endTurn() {
  if (turn.over) return;
  if (payout.active) {
    if (previewing) cancelPreview();
    else {
      payout.skip(); // pressing again fast-forwards
      return;
    }
  }
  // Wasteland must be placed first, but only if it fits somewhere; if there's no room, the turn can end.
  const blocking = hand.placeableForced.length;
  if (blocking) {
    toast(`Place your Wasteland first (${blocking} left in hand)`, 'bad');
    return;
  }
  hand.select(-1);
  const e = economyNow();
  runPayout(e, () => settleTurn(e));
}

/** Debug (Space): play the payout sequence without ending the turn or changing anything. */
let previewing = false;
function previewPayout() {
  if (payout.active) {
    if (!previewing) {
      payout.skip(); // a real turn is playing: just finish it
      return;
    }
    cancelPreview(); // restart the preview
  }
  previewing = true;
  runPayout(economyNow(), cancelPreview);
}

function cancelPreview() {
  payout.cancel();
  previewing = false;
  document.body.classList.remove('paying');
  updateHUD(); // undo the counter / bar filling
}

/** Draw the food store bar. `amount` may briefly overshoot the cost (bar glows) or go negative (hunger). */
function showStore(amount, cost, bumpIt = false, population = turn.population) {
  const shown = Math.max(0, Math.round(amount));
  $('popFill').style.width = `${Math.min(1, shown / cost) * 100}%`;
  $('popFill').classList.toggle('full', shown >= cost);
  $('popFill').classList.toggle('empty', amount < 0);
  $('popText').textContent =
    `store ${shown} / ${cost} → +1 pop` + (population ? ` · population ${population}` : '');
  if (bumpIt) bump($('popText'));
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

/** A "+1 pop" chip flies from the store bar to the Capital. */
const chipV = new THREE.Vector3();
function flyChip(capital) {
  if (!capital) return;
  const from = $('popFill').parentElement.getBoundingClientRect();
  chipV.set(capital.x, 0.8, capital.z).project(camera);
  const tx = (chipV.x * 0.5 + 0.5) * window.innerWidth;
  const ty = (-chipV.y * 0.5 + 0.5) * window.innerHeight;
  const chip = document.createElement('div');
  chip.className = 'pop-chip';
  chip.textContent = '+1 pop';
  chip.style.left = `${from.right - 30}px`;
  chip.style.top = `${from.top}px`;
  document.body.appendChild(chip);
  requestAnimationFrame(() => {
    chip.style.transform = `translate(${tx - from.right + 30}px, ${ty - from.top}px) scale(0.6)`;
    chip.style.opacity = '0';
  });
  setTimeout(() => chip.remove(), 700);
}

/** Show an oil amount in the stockpile counter and the quota bar at the top. */
function showOil(amount, bump = false) {
  const quota = turn.quota;
  $('oilStock').textContent = amount;
  $('resOil').textContent = amount;
  $('quotaCount').textContent = `${amount} / ${quota} barrels`;
  $('quotaFill').style.width = `${Math.min(1, amount / quota) * 100}%`;
  $('quotaFill').classList.toggle('met', amount >= quota);
  if (bump) {
    pop($('oilStock'));
    pop($('quotaCount'));
  }
}

function runPayout(e, onDone) {
  const tiles = e.perCell
    .filter((p) => p.food || p.manpower || p.oil || EFFECT_TILES.has(p.terrain))
    .map((p) => ({ ...p, mesh: grid.get(p.x, p.z).mesh }));

  // Population growth: once the tiles are done, the Capital hops once per population point gained.
  const capital = [...grid.cells.values()].find((c) => c.terrain === 'capital');
  if (capital) {
    for (let i = 0; i < e.popGrowth; i++)
      tiles.push({ x: capital.x, z: capital.z, mesh: capital.mesh, population: 1, finale: true });
  }

  // Oil fills the quota bar; food fills the store bar; a full store turns into population.
  let shown = turn.stockpile;
  let store = turn.food;
  let population = turn.population;
  let mp = e.supplied;
  document.body.classList.add('paying');
  payout.start(
    tiles,
    (tile) => {
      if (tile.oil) {
        shown += tile.oil;
        showOil(shown, true);
      }
      if (tile.food) {
        store += tile.food;
        showStore(store, growthCost(population), true);
      }
      if (tile.population) {
        flyChip(capital);
        store -= growthCost(population);
        population++;
        showStore(store, growthCost(population), true, population);
        $('resMp').textContent = ++mp;
        bump($('resMp'));
      }
    },
    () => {
      document.body.classList.remove('paying');
      onDone();
    },
  );
}

/** Tiles that hop even without a number of their own (they boost their neighbours). */
const EFFECT_TILES = new Set(['pump', 'oasis', 'tarpit', 'refinery']);

/** Why the city collapses at the end of the year (checked after Winter only), or null. Food: the store is emptied by a shortfall. Manpower: none supplied at all. */
function collapseReason(e) {
  if (e.foodBalance < 0 && e.storeAfter <= 0) return 'Your food ran out. The people starved.';
  if (e.supplied <= 0) return 'Your manpower ran out. The city could not be worked.';
  return null;
}

function gameOver(reason) {
  turn.over = true;
  hand.select(-1);
  $('gameoverReason').textContent = reason;
  $('gameoverStats').textContent =
    `Survived to ${SEASONS[turn.season]}, round ${turn.round} · ${turn.total} barrels delivered in total`;
  $('gameover').classList.remove('hidden');
}

function settleTurn(e) {
  // The city can only fall at the end of the year (after Winter); earlier shortfalls just cut output.
  const reason = turn.season === 3 ? collapseReason(e) : null;
  if (reason) {
    gameOver(reason);
    return;
  }
  const label = `${SEASONS[turn.season]}, round ${turn.round}`;
  turn.stockpile += e.oil;
  turn.total += e.oil;
  turn.food = e.storeAfter;
  turn.population += e.popGrowth;

  const sgn = (n) => {
    const r = Math.round(n);
    return r > 0 ? `+${r}` : `${r}`;
  };
  const tag = (n) => `<span class="${Math.round(n) < 0 ? 'bad' : 'good'}">${sgn(n)}</span>`;
  const lines = [
    `<b>${label}</b>`,
    `Food ${tag(e.foodBalance)} · Manpower ${tag(e.spare)} · Oil ${tag(e.oil)}`,
  ];
  let msg = `${label}: +${e.oil} oil`;
  let kind = 'good';
  if (e.popGrowth) {
    lines.push(`<span class="good">Population +${e.popGrowth} (now ${turn.population}).</span>`);
    msg += ` · Population +${e.popGrowth}`;
  }

  // Tribute after Winter.
  if (turn.season === 3) {
    const quota = turn.quota;
    const delivered = turn.stockpile;
    turn.stockpile = 0; // the Overlord takes everything; the new year starts from empty
    // The Overlord's greed grows with what he receives: excess raises next year's quota.
    turn.quota = nextQuota(quota, delivered);
    const rise = turn.quota - quota;
    if (delivered >= quota) {
      lines.push(`<span class="good">Tribute of ${quota} met. The Overlord seized all ${delivered} barrels.</span>`);
      msg += ` · Tribute of ${quota} met. The Overlord seized all ${delivered} barrels.`;
    } else {
      const short = quota - delivered;
      const lost = nukeRandomTile(true);
      lines.push(
        `<span class="bad">Tribute short by ${short}. ${lost ? `The Overlord nuked your ${lost}.` : ''}</span>`,
      );
      msg += ` · Tribute short by ${short}! ${lost ? `The Overlord nuked your ${lost}.` : ''}`;
      kind = 'bad';
    }
    const greed = delivered > quota ? "Your excess whetted the Overlord's appetite. " : '';
    lines.push(`<span class="bad">${greed}Next tribute: ${turn.quota} (+${rise}).</span>`);
    msg += ` · ${greed}Next tribute: ${turn.quota} (+${rise}).`;
  }

  $('report').innerHTML = lines.join('<br />');

  turn.season = (turn.season + 1) % 4;
  if (turn.season === 0) turn.round++;
  turn.rerolls = 0;
  turn.rerollSpent = 0;
  hand.deal(HAND_SIZE);
  updateHUD();
  pop($('oilStock'));
  toast(msg, kind, 3200);
}

// ---------- input ----------
const pointer = new THREE.Vector2();
let pointerInside = false;
const raycaster = new THREE.Raycaster();
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();

renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerInside = true;
});
renderer.domElement.addEventListener('pointerleave', () => (pointerInside = false));
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 2) hand.rotate(1);
});

function hoveredCell() {
  if (!pointerInside) return null;
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(boardPlane, hit)) return null;
  return [Math.round(hit.x), Math.round(hit.z)];
}

// ---------- territory expansion ----------
function checkExpansion() {
  if (!grid.isFull() || expansion.active) return;
  expansion.show(grid);
  toast('Territory full: pick a plot on the edge to expand', 'good');
}

function expand(option) {
  grid.unlock(option.px, option.pz);
  expansion.clear();
  // Mystery sites in the new plot turn into real tiles.
  const found = mysteries.reveal(option.px, option.pz);
  found.forEach(({ x, z, terrain }, i) => addTile(x, z, terrain, 0.25 + i * 0.15));
  frontier.rebuild(grid);
  placement.cell = null; // force ghost revalidation
  rig.focus(...grid.territoryCenter());
  toast(
    found.length
      ? `Territory expanded · found ${found.map((f) => `a ${TERRAINS[f.terrain].name}`).join(', ')}!`
      : 'Territory expanded',
    'good',
  );
  updateHUD();
}

function tryPlace() {
  if (turn.over) return;
  if (payout.active) {
    payout.skip(); // clicking the board during the payout fast-forwards it
    return;
  }
  if (expansion.active) {
    const option = expansion.optionAt(hoveredCell());
    if (option) expand(option);
    else toast('Territory full: click a highlighted plot to expand');
    return;
  }
  const piece = hand.piece;
  if (!piece) {
    toast(hand.isEmpty ? 'Hand used up: press Next turn' : 'Pick a piece from your hand');
    return;
  }
  const cell = hoveredCell();
  if (!cell) return;
  const cells = placement.cellsAt(cell);
  const result = placement.validate(cells);
  if (!result.ok) {
    placement.reject();
    toast(result.reason, 'bad');
    return;
  }
  cells.forEach(([x, z], i) => addTile(x, z, piece.terrain, i * 0.05));
  piecesPlaced++;
  hand.consume();
  frontier.rebuild(grid);
  updateHUD();
  checkExpansion();
}

rig.onClick = tryPlace;

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  const tgt = e.target;
  // Space: replay the payout sequence (debug). Works even with a debug slider focused.
  if (k === ' ' && !tgt.matches?.('select, textarea, input:not([type=range])')) {
    e.preventDefault();
    if (!e.repeat) previewPayout();
    return;
  }
  if (tgt.matches?.('input, select, textarea')) return; // typing in the debug panel
  if (k === '`') {
    debug.toggle();
    return;
  }
  if (payout.active) {
    if (k === 'enter') endTurn();
    return; // no placing / rotating / nuking mid-payout
  }
  if (k >= '1' && k <= String(HAND_SIZE)) {
    const i = Number(k) - 1;
    hand.select(hand.selected === i ? -1 : i);
  } else if (k === 'r') hand.rotate(e.shiftKey ? -1 : 1);
  else if (k === 'f') hand.rotate(-1);
  else if (k === 'escape') hand.select(-1);
  else if (k === 'c') rig.focus(...grid.centroid());
  else if (k === 'n') nukeRandomTile();
  else if (k === 'enter') endTurn();
});

$('btnReroll').addEventListener('click', () => {
  if (hand.isEmpty || payout.active || turn.over) return;
  const cost = rerollCost();
  if (economyNow().supplied - cost < 1) {
    toast(`Not enough manpower to reroll (costs ${cost})`, 'bad');
    return;
  }
  hand.reroll();
  turn.rerolls++;
  turn.rerollSpent += cost;
  updateHUD();
  toast(`Hand rerolled: -${cost} manpower (next reroll costs ${rerollCost()})`);
});
$('btnNext').addEventListener('click', (e) => {
  e.currentTarget.blur(); // so Space doesn't re-click it
  endTurn();
});
$('btnReset').addEventListener('click', resetIsland);
$('btnRestart').addEventListener('click', resetIsland);

// ---------- lifecycle ----------
function resetIsland() {
  payout.cancel(); // stop a running payout without settling it
  previewing = false;
  document.body.classList.remove('paying');
  tiles.clear();
  grid.clear();
  anims.length = 0;
  expansion.clear();
  piecesPlaced = 0;
  Object.assign(turn, {
    round: 1,
    season: 0,
    stockpile: 0,
    rerolls: 0,
    rerollSpent: 0,
    total: 0,
    food: 0,
    population: 0,
    quota: FIRST_QUOTA,
    over: false,
  });
  $('gameover').classList.add('hidden');
  $('report').textContent = 'No seasons played yet.';
  addTile(0, 0, SEED_TERRAIN);
  mysteries.reset();
  frontier.rebuild(grid);
  hand.deal(HAND_SIZE);
  rig.focus(0, 0);
  updateHUD();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const time = now / 1000;

  rig.update(dt);
  followTarget(rig.target, rig.distance, dt);
  updateDropAnims(dt);
  frontier.update(dt, time);
  mysteries.update(time);
  const cell = rig.isDragging ? null : hoveredCell();
  expansion.update(cell, dt, time);
  updateInspect(cell);
  // Hide the ghost while choosing a plot or while the payout plays.
  placement.update(expansion.active || payout.active ? null : cell, dt, time);

  renderer.render(scene, camera);
  payout.update(dt); // after render so labels use this frame's camera
  requestAnimationFrame(frame);
}

resetIsland();
requestAnimationFrame(frame);

// Handy for debugging in the console.
window.tileIsland = { grid, hand, placement, rig, expansion, mysteries, turn, economy: economyNow };
