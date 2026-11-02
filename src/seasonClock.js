/**
 * The season clock (top, right of the tribute plate): a four-sided dial (Spring top, Summer right, Autumn bottom,
 * Winter left), each a small landscape lit up while it's the season, with an iron hand on a geared hub. A lock bolt at the hand's tip sits in a notch of the outer ring.
 * When the season changes the bolt pulls back, the hand swings forward (a little wind-up and overshoot, the gear
 * spinning), and the bolt snaps into the next notch with a clunk. The season the tribute is due in has a red mark.
 */
const R = 44; // dial radius (the viewBox hugs it: -45.5..45.5)

// Each season is a small upright scene filling its quarter of the dial (drawn in dial units, clipped to the quarter):
// Spring top, Summer right, Autumn bottom, Winter left.
const SCENES = [
  // Spring: teal sky, green hills, a budding tree
  `<rect x="-36" y="-36" width="72" height="36" fill="#8ea7a0"/>
   <circle cx="-10" cy="-27" r="3.4" fill="#ece4c4" opacity="0.85"/>
   <path d="M-36-11Q-14-21 4-14T36-16V0H-36z" fill="#6f8a4a"/>
   <path d="M-36-5Q0-12 36-6V0H-36z" fill="#566f37"/>
   <path d="M7-12V-20" stroke="#3a2a1c" stroke-width="1.6"/>
   <circle cx="7" cy="-23" r="4.3" fill="#a3bf66"/>
   <circle cx="4.6" cy="-21.2" r="2.4" fill="#d7b6ab"/>
   <circle cx="9.4" cy="-24.6" r="1.8" fill="#d7b6ab"/>`,
  // Summer: amber sky, a big sun, golden dunes, a small oil derrick
  `<rect x="0" y="-36" width="36" height="72" fill="#c4954e"/>
   <circle cx="21" cy="-9" r="8.5" fill="#f3cf78" opacity="0.3"/>
   <circle cx="21" cy="-9" r="5.4" fill="#f6d585"/>
   <path d="M0 6Q12 1 22 5T36 3V36H0z" fill="#a8783a"/>
   <path d="M0 12Q16 8 36 12V36H0z" fill="#8a612f"/>
   <path d="M27.5 5L29.5-3.5L31.5 5M28.3 1.5H30.7" stroke="#2e2116" stroke-width="0.9" fill="none"/>`,
  // Autumn: dusky sky, rust hills, an orange tree dropping leaves
  `<rect x="-36" y="0" width="72" height="36" fill="#93664a"/>
   <path d="M-36 21Q-10 14 10 19T36 17V36H-36z" fill="#774826"/>
   <path d="M-36 28Q0 23 36 28V36H-36z" fill="#5c361b"/>
   <path d="M-4 22V15" stroke="#2e2116" stroke-width="1.6"/>
   <circle cx="-4" cy="12.5" r="4.6" fill="#cf7a30"/>
   <circle cx="-6.5" cy="14.2" r="2.6" fill="#b85f22"/>
   <ellipse cx="4.5" cy="15" rx="1.3" ry="0.8" fill="#e2943f" transform="rotate(30 4.5 15)"/>
   <ellipse cx="8.5" cy="20" rx="1.3" ry="0.8" fill="#d8853a" transform="rotate(-20 8.5 20)"/>`,
  // Winter: cold sky, snowfields, a dark pine, falling snow
  `<rect x="-36" y="-36" width="36" height="72" fill="#7b8894"/>
   <path d="M-36 7Q-20 2 0 6V36H-36z" fill="#d5dcdf"/>
   <path d="M-36 14Q-18 11 0 14V36H-36z" fill="#b6c0c5"/>
   <path d="M-22-9L-26 0H-18zM-22-5L-27.5 5H-16.5z" fill="#2f3d3a"/>
   <path d="M-22 5V8" stroke="#2e2116" stroke-width="1.4"/>
   <g fill="#eef3f5"><circle cx="-12" cy="-6" r="0.95"/><circle cx="-28" cy="-14" r="0.95"/><circle cx="-9" cy="-16" r="0.85"/><circle cx="-17" cy="-21" r="0.95"/><circle cx="-30" cy="-3" r="0.8"/></g>`,
];

/** A quarter of the dial around the side at `deg` (0 = top), out to radius r. */
function sector(deg, r) {
  const p = (a) => {
    const t = ((a - 90) * Math.PI) / 180;
    return `${(Math.cos(t) * r).toFixed(2)} ${(Math.sin(t) * r).toFixed(2)}`;
  };
  return `M0 0L${p(deg - 45)}A${r} ${r} 0 0 1 ${p(deg + 45)}z`;
}

function gear(teeth, r1, r2) {
  let d = '';
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 ? r1 : r2;
    for (const k of [-0.28, 0.28]) {
      const a = ((i + 0.5 + k) / (teeth * 2)) * Math.PI * 2;
      d += `${d ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
    }
  }
  return `${d}z`;
}

export class SeasonClock {
  season = -1;
  angle = 0; // the hand's angle, always growing (it only ever turns forward)
  #timers = [];

  constructor(el, onLock = null) {
    this.el = el;
    this.onLock = onLock;
    const sides = [0, 1, 2, 3];
    el.innerHTML = `
      <svg viewBox="-45.5 -45.5 91 91" aria-hidden="true">
        <defs>${sides.map((i) => `<clipPath id="sc-clip-${i}"><path d="${sector(i * 90, 36)}"/></clipPath>`).join('')}</defs>
        <circle class="sc-face" r="${R}"/>
        ${sides.map((i) => `<g class="sc-scene" data-i="${i}" clip-path="url(#sc-clip-${i})">${SCENES[i]}</g>`).join('')}
        ${[45, 135, 225, 315].map((a) => `<path class="sc-div" d="M0 0V-36" transform="rotate(${a})"/>`).join('')}
        <circle class="sc-ring" r="39.5"/>
        ${sides.map((i) => `<rect class="sc-notch" x="-3" y="-43" width="6" height="7" transform="rotate(${i * 90})"/>`).join('')}
        <circle class="sc-tribute" r="2.6" cx="10" cy="-27"/>
        <path class="sc-gear" d="${gear(10, 9, 12)}"/>
        <g class="sc-hand">
          <g class="sc-bolt"><rect x="-2.4" y="-42" width="4.8" height="8" rx="0.8"/></g>
          <path class="sc-arm" d="M-2.6 0L-1.1-34H1.1L2.6 0z"/>
          <circle class="sc-hub" r="5.5"/>
          <circle class="sc-pin" r="1.6" cx="-0.6" cy="-0.6"/>
        </g>
        <circle class="sc-rim" r="${R}"/>
      </svg>`;
    this.hand = el.querySelector('.sc-hand');
    this.gear = el.querySelector('.sc-gear');
    this.tribute = el.querySelector('.sc-tribute');
  }

  /** Show `season` (0-3); `tribute`: the season the tribute is due in. Animated once it is showing something. */
  set(season, tribute = 3) {
    this.tribute.setAttribute('transform', `rotate(${tribute * 90})`);
    if (season === this.season) return;
    const first = this.season < 0;
    const steps = first ? season : (season - this.season + 4) % 4;
    this.season = season;
    this.angle += steps * 90;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers = [];
    if (first) {
      this.el.classList.add('instant');
      this.#turn();
      this.#light();
      void this.el.offsetWidth;
      this.el.classList.remove('instant');
      return;
    }
    // Unlock, swing, lock.
    this.el.classList.add('unlocked');
    this.#timers.push(
      setTimeout(() => this.#turn(), 180),
      setTimeout(() => {
        this.el.classList.remove('unlocked');
        this.#light();
        this.el.classList.remove('clunk');
        void this.el.offsetWidth;
        this.el.classList.add('clunk');
        this.onLock?.();
      }, 180 + 900),
    );
  }

  #turn() {
    this.hand.style.transform = `rotate(${this.angle}deg)`;
    this.gear.style.transform = `rotate(${-this.angle * 2.2}deg)`;
  }

  #light() {
    for (const q of this.el.querySelectorAll('[data-i]')) q.classList.toggle('on', Number(q.dataset.i) === this.season);
  }
}
