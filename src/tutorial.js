import * as THREE from 'three';
import { SHAPES, rotateCells } from './pieces.js';
import { L, onLangChange } from './i18n.js';

/**
 * Year 0: the tutorial. You play the last year of the previous Overseer (the one the Overlord mentions
 * in the Year 1 intro). The year is fully scripted, so it is the same for every player: fixed hands
 * (shapes and rotations too), fixed cells to build on, one hand-placed "?" site, and no random events,
 * bandits or raiders.
 *
 * It is rigged to end badly: in Winter the "?" turns out to be an unexploded missile that destroys the
 * best Oil Station, the tribute comes up 3 barrels short, and the Overlord removes his Overseer.
 *
 *   Spring  Hydro-farm, Oil Station (both next to the Capital)   +4 oil  →  4
 *   Summer  Settlement, 2-cell Wasteland                          +4 oil  →  8
 *   Autumn  Oil Station, L-shaped Wasteland (needs a rotation)    +8 oil  → 16
 *   Winter  reroll → Oil Station next to the "?"                 planned +10 → 26 / 25
 *           the unexploded missile craters the station at (1, 0)       actual   +6 → 22 / 25
 *
 * main.js owns the game; it calls allows() before every player action, notify() when something happens,
 * and update() every frame. The tutorial calls back into main.js only through the `api` object.
 */

// Versioned: bumping it (v2, v3...) makes every player replay the tutorial once on the next release.
export const TUTORIAL_KEY = 'oto.tutorialDone.v2';
export const TUTORIAL_QUOTA = 25;
/** The old Overseer has already missed two tributes: this is his last chance. */
export const TUTORIAL_STRIKES = 2;
/** The buried missile: revealed by the Winter station, it hits the Spring station. */
export const TUTORIAL_SITE = { x: 3, z: 0, terrain: 'missile', target: { x: 1, z: 0 } };

export const tutorialDone = () => localStorage.getItem(TUTORIAL_KEY) === '1';
export const markTutorialDone = () => localStorage.setItem(TUTORIAL_KEY, '1');

const CAPITAL = [[0, 0]];
const rotateHint = () =>
  L(
    '<div class="coach-hint">It does not fit this way round. Rotate it: <b>R</b>, or <b>right-click</b> (also while dragging).</div>',
    '<div class="coach-hint">这个方向放不进去。旋转它：按 <b>R</b> 或<b>右键</b>（拖动时也可以）。</div>',
  );

/**
 * The script. Each step:
 *   text     string or (api) => string (HTML)
 *   target   CSS selector(s) to spotlight, or { cells: [[x, z]] } on the board (place steps target the
 *            card first, then the cells once it is picked)
 *   wait     what moves the tutorial on: next (the Next button / Enter), place, endTurn, reroll,
 *            season (the next hand is about to be dealt), missile (the missile strike is over), end
 *   terrain  place steps: the card to play ('wasteland' matches any Wasteland)
 *   cells    place steps: exactly the cells it must cover
 *   enter    (api) => void, run when the step starts
 *   dim      darken everything but the target (info steps)
 */
const STEPS = [
  // ---------- Spring ----------
  {
    wait: 'next',
    dim: true,
    text: () => L('<b>Year 0 · Tutorial.</b> I am your advisor, Overseer. One year to show you how the Hive City runs, and to keep the Overlord happy.', '<b>第 0 年 · 教程。</b>总督，我是您的顾问。我们有一年时间，让我带您了解蜂巢城如何运转，同时让霸主满意。'),
  },
  {
    wait: 'next',
    dim: true,
    target: '#top .bar, #quotaCount',
    text: () => L('The <b>tribute</b>. Every barrel of oil you make fills this bar. When Winter ends the Overlord takes all of it, and it has to reach <b>25 barrels</b>.', '这是<b>贡品</b>。您产出的每一桶石油都会填进这根条。冬季结束时，霸主会全部收走，而且必须达到 <b>25 桶</b>。'),
  },
  {
    wait: 'next',
    dim: true,
    target: '#strikes',
    text: () => L('Missed tributes. You have already missed <b>two</b>. A third, and the Overlord stops sending warnings.', '这是失职次数。您已经失职<b>两次</b>了。再有第三次，霸主就不会再警告了。'),
  },
  {
    wait: 'next',
    dim: true,
    target: '#panel .stat',
    text: () => L('Your <b>oil stockpile</b>: everything collected so far this year. The Oil row below shows it too, with what this season will add in brackets.', '这是您的<b>石油库存</b>：今年迄今收集的全部石油。下方的石油一栏也会显示它，括号里是本季将增加的数量。'),
  },
  {
    wait: 'next',
    dim: true,
    target: '#panel .res.food',
    text: () => L('<b>Food</b>. Farms grow it; the Capital and Settlements eat it. Spare food goes into the stores. If the stores run dry, people go hungry and your stations slow down.', '<b>食物</b>。农场生产食物，首都和定居点消耗食物。多余的食物会存进粮仓。粮仓一旦见底，人们就会挨饿，采油站也会减产。'),
  },
  {
    wait: 'next',
    dim: true,
    target: '#panel .res.mp',
    text: () => L('<b>Manpower</b>: free worker slots out of the total. The Capital and Settlements provide workers. Every farm and Oil Station needs one, or it sits idle and makes nothing.', '<b>人力</b>：空闲人力 / 总人力。首都和定居点提供人力。每座农场和采油站都需要 1 人力，否则就会闲置，什么也不产出。'),
  },
  {
    wait: 'next',
    dim: true,
    target: { cells: CAPITAL },
    focus: [0.5, 0],
    text: () => L('This is the <b>Capital</b>. Buildings right next to it (not diagonally) work twice: their output is <b>doubled</b>.', '这是<b>首都</b>。紧挨着它（不含斜角）的建筑效率加倍：产出<b>翻倍</b>。'),
  },
  {
    wait: 'place',
    terrain: 'farm',
    cells: [[0, 1]],
    text: () => L('Drag the <b>Hydro-farm</b> onto the glowing cell next to the Capital. (Or click the card, then click the cell.) It grows 2 food, 4 here.', '把<b>水培农场</b>拖到首都旁发光的格子上。（或者先点击卡牌，再点击格子。）它产出 2 食物，在这里是 4 食物。'),
  },
  {
    wait: 'place',
    terrain: 'station',
    cells: [[1, 0]],
    text: () => L('Now the <b>Oil Station</b>, also next to the Capital. Stations pump 2 oil a season, <b>4</b> next to the Capital.', '现在放<b>采油站</b>，同样放在首都旁边。采油站每季产出 2 石油，在首都旁边是 <b>4</b> 石油。'),
  },
  {
    wait: 'next',
    dim: true,
    target: '#panel .res',
    text: () => L('The panel shows what this season will make: <b>+1 food</b>, <b>2 of 4</b> workers free, <b>+4 oil</b>. Hover a row any time to see how it adds up.', '面板显示本季的产出：<b>+1 食物</b>，<b>4 人力中 2 人力</b>空闲，<b>+4 石油</b>。随时把鼠标悬停在某一栏上，就能看到明细。'),
  },
  {
    wait: 'endTurn',
    target: '#btnNext',
    text: () => L('Press <b>Next turn</b> (or <b>Enter</b>). Every tile pays out, then the next season starts with a fresh hand.', '按下<b>下一回合</b>（或 <b>Enter</b>）。每个地块都会结算产出，然后下一季开始，发一手新牌。'),
  },

  // ---------- Summer ----------
  { wait: 'season' },
  {
    wait: 'next',
    dim: true,
    target: '#hand',
    enter: (api) => api.deal([{ terrain: 'settlement' }, { terrain: 'wasteland1', shape: 'domino', rot: 0 }]),
    text: () => L('<b>Summer.</b> Each season brings a new hand. Cards you leave unplayed are lost when the season ends.', '<b>夏季。</b>每一季都会发一手新牌。没有打出的卡牌会在季节结束时作废。'),
  },
  {
    wait: 'place',
    terrain: 'settlement',
    cells: [[0, -1]],
    text: () => L('A <b>Settlement</b> houses workers: <b>+2 manpower</b>. It eats 2 food a season, so it needs farms to feed it.', '<b>定居点</b>为工人提供住所：<b>+2 人力</b>。它每季消耗 2 食物，所以需要农场来供养。'),
  },
  {
    wait: 'place',
    terrain: 'wasteland',
    cells: [[-2, 1], [-1, 1]],
    text: () => L('<b>Wasteland</b> is junk from the dunes. It does nothing, but it <b>must be placed</b> before you can end the turn. Tuck it out of the way here.', '<b>荒地</b>是沙丘里来的废料。它没有任何作用，但结束回合前<b>必须放下</b>。把它塞到这个不碍事的角落吧。'),
  },
  {
    wait: 'next',
    dim: true,
    target: '#panel .res.food',
    text: () => L('Food is now <b>−1</b> a season. That is fine for a while: the stores cover the shortfall. Just never let them run empty.', '现在食物每季 <b>−1</b>。暂时没问题：粮仓会补上缺口。只是千万别让它见底。'),
  },
  { wait: 'endTurn', target: '#btnNext', text: () => L('End the season: <b>Next turn</b>.', '结束本季：<b>下一回合</b>。') },

  // ---------- Autumn ----------
  { wait: 'season' },
  {
    wait: 'place',
    terrain: 'station',
    cells: [[-1, 0]],
    enter: (api) => api.deal([{ terrain: 'station' }, { terrain: 'wasteland3', shape: 'l', rot: 0 }]),
    text: () => L('<b>Autumn.</b> Another <b>Oil Station</b>, on the other side of the Capital: 4 more oil a season.', '<b>秋季。</b>再放一座<b>采油站</b>，放在首都另一侧：每季再多 4 石油。'),
  },
  {
    wait: 'place',
    terrain: 'wasteland',
    cells: [[-1, -1], [-2, -1], [-3, -1], [-3, 0]],
    text: () => L('More Wasteland. Pieces can be <b>rotated</b> before you place them. Fit this one onto the glowing cells.', '又是荒地。板块在放置前可以<b>旋转</b>。把这块对准发光的格子放好。'),
  },
  {
    wait: 'next',
    dim: true,
    target: { cells: [[TUTORIAL_SITE.x, TUTORIAL_SITE.z]] },
    focus: [1.5, 0],
    text: () => L('See that <b>?</b> site? Something is buried there. Build <b>next to</b> a ? to dig it up: a free city, a Tar Pit, Pre-war Ruins... Some are dangerous, but you never know until you dig.', '看到那个 <b>?</b> 神秘地点了吗？那里埋着东西。在神秘地点<b>相邻</b>处建造就能把它挖出来：一座免费的城市、焦油坑、战前遗迹……有些很危险，但不挖开永远不知道。'),
  },
  {
    wait: 'next',
    dim: true,
    target: '#top .bar, #quotaCount',
    text: (api) => {
      const f = api.forecast();
      return L(
        `After this season you will have <b>${f.after} of ${f.quota}</b> barrels. Winter has to bring in the rest.`,
        `本季结束后，您将有 <b>${f.after} / ${f.quota}</b> 桶。剩下的要靠冬季补上。`,
      );
    },
  },
  { wait: 'endTurn', target: '#btnNext', text: () => L('End the season: <b>Next turn</b>.', '结束本季：<b>下一回合</b>。') },

  // ---------- Winter ----------
  { wait: 'season' },
  {
    wait: 'next',
    dim: true,
    target: '#hand',
    enter: (api) => api.deal([{ terrain: 'settlement' }, { terrain: 'farm' }]),
    text: () => L('<b>Winter</b>, the last season before the tribute. And not a single Oil Station in this hand.', '<b>冬季</b>，上缴贡品前的最后一季。可这手牌里一座采油站都没有。'),
  },
  {
    wait: 'reroll',
    target: '#btnReroll',
    enter: (api) => api.setFreeRerolls(1),
    text: () => L('<b>Reroll</b> it. A reroll redraws your whole hand. It normally costs oil (1 barrel, then 2, 3...), but this one is free.', '<b>重抽</b>吧。重抽会重新发一整手牌。通常要花石油（1 桶，然后 2 桶、3 桶……），但这次免费。'),
  },
  {
    wait: 'place',
    terrain: 'station',
    cells: [[2, 0]],
    focus: [1.5, 0],
    text: (api) =>
      L(
        `An Oil Station. Place it next to the <b>?</b> site. That brings Winter's oil to <b>${api.forecast().oil + 2}</b>: <b>${api.forecast().after + 2} of ${api.forecast().quota}</b>, just enough.`,
        `一座采油站。把它放在 <b>?</b> 神秘地点旁边。这样冬季的石油就达到 <b>${api.forecast().oil + 2}</b>：<b>${api.forecast().after + 2} / ${api.forecast().quota}</b>，刚好够。`,
      ),
  },
  { wait: 'missile', text: () => L('Wait. The ground is shaking...', '等等，地面在震动……') },
  {
    wait: 'next',
    dim: true,
    target: '#top .bar, #quotaCount',
    text: (api) => {
      const f = api.forecast();
      return L(
        `An <b>unexploded missile</b> from the old wars. It woke up and flew straight into your best Oil Station. Winter now brings in only <b>${f.oil}</b> oil: <b>${f.after} of ${f.quota}</b>.`,
        `是旧时代战争留下的一枚<b>未爆导弹</b>。它被唤醒了，径直撞上了您最好的采油站。冬季现在只能产出 <b>${f.oil}</b> 石油：<b>${f.after} / ${f.quota}</b>。`,
      );
    },
  },
  {
    wait: 'next',
    dim: true,
    target: '#hand',
    text: () => L('Nothing left in your hand makes oil, and there are no seasons left. All you can do is pay what you have and face the Overlord.', '手牌里已经没有能产油的东西了，也没有剩下的季节了。您只能交出现有的石油，去面对霸主。'),
  },
  { wait: 'endTurn', target: '#btnNext', text: () => L('Press <b>Next turn</b>. Good luck, Overseer.', '按下<b>下一回合</b>。祝您好运，总督。') },
  { wait: 'end' },
];

const keyOf = (cells) => cells.map(([x, z]) => `${x},${z}`).sort().join('|');
/** Shape of a set of cells, moved so its corner is at 0,0 (to compare a piece with its target). */
const shapeKey = (cells) => {
  const mx = Math.min(...cells.map((c) => c[0]));
  const mz = Math.min(...cells.map((c) => c[1]));
  return keyOf(cells.map(([x, z]) => [x - mx, z - mz]));
};
const matches = (step, terrain) =>
  step.terrain === 'wasteland' ? terrain?.startsWith('wasteland') : terrain === step.terrain;

const BOARD_BLOCKED = '.dialogue, .striking, .paying, .shopping';

export class Tutorial {
  active = false; // gating is on (from reset until the year is over)
  index = -1; // -1: the opening scene is still playing

  /** api: { deal(list), forecast(), setFreeRerolls(n), focus(x, z), skip() } */
  constructor({ root, scene, camera, hand, api }) {
    this.root = root;
    this.camera = camera;
    this.hand = hand;
    this.api = api;
    root.innerHTML = `
      <div class="coach-ring hidden"></div>
      <div class="coach-bubble hidden">
        <div class="coach-who"></div>
        <div class="coach-text"></div>
        <div class="coach-foot">
          <button type="button" class="coach-skip"></button>
          <span class="coach-step"></span>
          <button type="button" class="coach-next"></button>
        </div>
      </div>`;
    this.ring = root.querySelector('.coach-ring');
    this.bubble = root.querySelector('.coach-bubble');
    this.textEl = root.querySelector('.coach-text');
    this.nextBtn = root.querySelector('.coach-next');
    this.stepEl = root.querySelector('.coach-step');
    this.whoEl = root.querySelector('.coach-who');
    this.skipBtn = root.querySelector('.coach-skip');
    this.nextBtn.addEventListener('click', () => this.notify('next'));
    this.skipBtn.addEventListener('click', () => this.api.skip());
    this.#labels();
    onLangChange(() => {
      this.#labels();
      this.html = null; // the step text is rebuilt on the next frame
    });
    for (const el of [this.bubble]) el.addEventListener('pointerdown', (e) => e.stopPropagation());

    // Glowing cells on the board for the current step.
    this.marks = new THREE.Group();
    this.marks.visible = false;
    scene.add(this.marks);
    this.markGeo = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
    this.markMat = new THREE.MeshBasicMaterial({ color: 0xe8bf68, transparent: true, opacity: 0.5, depthWrite: false });
    this.edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.98, 0.02, 0.98));
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true });
    this.v = new THREE.Vector3();
  }

  #labels() {
    this.whoEl.textContent = L('Advisor', '顾问');
    this.skipBtn.textContent = L('Skip tutorial', '跳过教程');
    this.nextBtn.innerHTML = L('Next <b>▸</b>', '下一步 <b>▸</b>');
  }

  get step() {
    return this.index >= 0 ? STEPS[this.index] : null;
  }

  /** True while the coach is waiting for its Next button (Enter presses it too). */
  get waitingNext() {
    return this.active && this.step?.wait === 'next' && !document.body.matches(BOARD_BLOCKED);
  }

  /** A tutorial run starts: gate everything until begin() (after the opening scene). */
  start() {
    this.active = true;
    this.index = -1;
    this.#render();
  }

  /** The opening scene is over: the advisor takes over. */
  begin() {
    if (!this.active) return;
    this.#go(0);
  }

  stop() {
    this.active = false;
    this.index = -1;
    this.#render();
  }

  /** May the player do this right now? action: select | rotate | place | endTurn | reroll (anything else: no). */
  allows(action, payload) {
    if (!this.active) return true;
    const s = this.step;
    if (!s) return false;
    if (action === 'select') return s.wait === 'place' && matches(s, payload?.terrain);
    if (action === 'rotate') return s.wait === 'place';
    if (action === 'place') return s.wait === 'place' && matches(s, payload.piece?.terrain) && keyOf(payload.cells) === keyOf(s.cells);
    if (action === 'endTurn') return s.wait === 'endTurn';
    if (action === 'reroll') return s.wait === 'reroll';
    return false;
  }

  /** Placement rule while the tutorial runs: only the glowing cells (null = no objection). */
  placeGuard(cells, piece) {
    if (!this.active || !piece) return null;
    if (this.allows('place', { cells, piece })) return null;
    return { ok: false, reason: L('Place it on the glowing cells', '请放在发光的格子上') };
  }

  /** Something happened in the game: placed | endTurn | reroll | season | missile | next. */
  notify(event) {
    const s = this.step;
    if (!this.active || !s) return;
    const done = (s.wait === 'place' && event === 'placed') || s.wait === event;
    if (done) this.#go(this.index + 1);
  }

  /** The player tried something the tutorial doesn't allow yet: the bubble shakes. */
  nudge() {
    if (!this.step) return;
    this.bubble.classList.remove('nudge');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('nudge');
  }

  #go(i) {
    this.index = Math.min(i, STEPS.length - 1);
    const s = this.step;
    this.side = null;
    s.enter?.(this.api);
    if (s.focus) this.api.focus(...s.focus);
    else if (s.cells) {
      const cx = s.cells.reduce((a, c) => a + c[0], 0) / s.cells.length;
      const cz = s.cells.reduce((a, c) => a + c[1], 0) / s.cells.length;
      this.api.focus((cx + 0.5) / 2, cz / 2); // between the Capital and the target, so both stay in view
    }
    this.#render();
    this.bubble.classList.remove('enter');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('enter');
  }

  /** Cells currently highlighted on the board. */
  #markCells() {
    const s = this.step;
    if (!s) return null;
    if (s.wait === 'place') return s.cells;
    return s.target?.cells ?? null;
  }

  #render() {
    const s = this.step;
    this.marks.clear();
    const cells = this.#markCells();
    if (cells) {
      for (const [x, z] of cells) {
        const plate = new THREE.Mesh(this.markGeo, this.markMat);
        plate.position.set(x, 0.03, z);
        plate.renderOrder = 5;
        const edge = new THREE.LineSegments(this.edgeGeo, this.edgeMat);
        edge.position.set(x, 0.04, z);
        this.marks.add(plate, edge);
      }
    }
    this.html = null;
    const total = STEPS.filter((st) => st.text).length;
    const at = STEPS.slice(0, this.index + 1).filter((st) => st.text).length;
    this.stepEl.textContent = s?.text ? `${at} / ${total}` : '';
  }

  /** Screen rectangle of the current target, or null. */
  #targetRect() {
    const s = this.step;
    if (!s) return null;
    if (s.wait === 'place') {
      const piece = this.hand.piece;
      if (piece && matches(s, piece.terrain)) return this.#cellsRect(s.cells);
      const i = this.hand.cards.findIndex((p) => matches(s, p.terrain));
      const el = i >= 0 ? document.querySelector(`#hand .card[data-i="${i}"]`) : null;
      return el ? el.getBoundingClientRect() : this.#cellsRect(s.cells);
    }
    if (!s.target) return null;
    if (s.target.cells) return this.#cellsRect(s.target.cells);
    const rects = [...document.querySelectorAll(s.target)]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width || r.height);
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  #cellsRect(cells) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const [x, z] of cells) {
      for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        for (const y of [0, 0.5]) {
          this.v.set(x + dx, y, z + dz).project(this.camera);
          const px = (this.v.x * 0.5 + 0.5) * window.innerWidth;
          const py = (-this.v.y * 0.5 + 0.5) * window.innerHeight;
          left = Math.min(left, px);
          right = Math.max(right, px);
          top = Math.min(top, py);
          bottom = Math.max(bottom, py);
        }
      }
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top, board: true };
  }

  /** Text for this frame (some steps show live numbers, place steps add the rotate hint when needed). */
  #text() {
    const s = this.step;
    let html = typeof s.text === 'function' ? s.text(this.api) : s.text ?? '';
    const piece = this.hand.piece;
    if (s.wait === 'place' && piece && matches(s, piece.terrain) && s.cells.length > 1) {
      const now = rotateCells(SHAPES[piece.shape].cells, piece.rot);
      if (shapeKey(now) !== shapeKey(s.cells)) html += rotateHint();
    }
    return html;
  }

  /** Every frame: glow pulse, spotlight and bubble follow their targets (camera moves, cards animate). */
  update(time) {
    const s = this.step;
    const blocked = document.body.matches(BOARD_BLOCKED);
    const show = this.active && s && s.text && !blocked;
    this.marks.visible = Boolean(show && this.marks.children.length);
    if (this.marks.visible) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      this.markMat.opacity = 0.25 + 0.35 * pulse;
      this.edgeMat.opacity = 0.6 + 0.4 * pulse;
    }
    this.bubble.classList.toggle('hidden', !show);
    if (!show) {
      this.ring.classList.add('hidden');
      return;
    }
    const html = this.#text();
    if (html !== this.html) {
      this.textEl.innerHTML = html;
      this.html = html;
    }
    this.nextBtn.classList.toggle('hidden', s.wait !== 'next');

    const rect = this.#targetRect();
    const pad = 8;
    // Board cells are outlined on the floor itself (this.marks); the screen ring is only for the HUD.
    const onBoard = Boolean(rect?.board);
    this.ring.classList.toggle('hidden', onBoard || (!rect && !s.dim));
    this.ring.classList.toggle('dim', Boolean(s.dim));
    this.ring.classList.toggle('empty', !rect);
    if (rect && !onBoard) {
      const st = this.ring.style;
      st.left = `${(rect.left - pad).toFixed(1)}px`;
      st.top = `${(rect.top - pad).toFixed(1)}px`;
      st.width = `${(rect.width + pad * 2).toFixed(1)}px`;
      st.height = `${(rect.height + pad * 2).toFixed(1)}px`;
    }
    this.#placeBubble(rect && { left: rect.left - pad, top: rect.top - pad, right: rect.right + pad, bottom: rect.bottom + pad });
  }

  #placeBubble(r) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const bw = this.bubble.offsetWidth;
    const bh = this.bubble.offsetHeight;
    const gap = 14;
    const m = 10;
    let x;
    let y;
    if (!r) {
      x = (W - 300 - bw) / 2; // centred over the board (the side panel is 300 px)
      y = H * 0.26;
    } else {
      const spots = {
        below: [(r.left + r.right) / 2 - bw / 2, r.bottom + gap + 12, H - r.bottom - 12], // + room for the name plate
        above: [(r.left + r.right) / 2 - bw / 2, r.top - gap - bh, r.top],
        left: [r.left - gap - bw, (r.top + r.bottom) / 2 - bh / 2, r.left],
        right: [r.right + gap, (r.top + r.bottom) / 2 - bh / 2, W - r.right],
      };
      // Keep the side chosen for this step, so the bubble doesn't hop around as the target moves.
      const fits = (k) => {
        const [sx, sy] = spots[k];
        const need = k === 'below' || k === 'above' ? bh + gap : bw + gap;
        return spots[k][2] >= need + m && sx >= -bw / 2 && sy >= -bh / 2;
      };
      if (!this.side || !fits(this.side)) {
        // Side panel targets: to their left. Everything else: above or below (whichever has more room), then the sides.
        const bySpace = (a, b) => spots[b][2] - spots[a][2];
        const order = r.left > W - 340 ? ['left', 'below', 'above'] : [...['below', 'above'].sort(bySpace), ...['left', 'right'].sort(bySpace)];
        this.side = order.find(fits) ?? 'above';
      }
      [x, y] = spots[this.side];
    }
    x = Math.max(m, Math.min(W - bw - m, x));
    y = Math.max(m, Math.min(H - bh - m, y));
    const tf = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (this.bubble._tf !== tf) this.bubble.style.transform = this.bubble._tf = tf;
  }
}
