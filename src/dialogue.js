/**
 * Visual-novel style dialogue: a large portrait bottom-left, a name plate on a dark text box along
 * the bottom, typewriter text, and reply choices stacked on the right (the selected one sits on a
 * white plate). Mouse and keyboard: click / Enter / Space advances or confirms,
 * Up / Down (or W / S) moves between choices, 1–4 picks one directly.
 *
 *   await dialogue.open({ kind, title, effect })      // optional banner at the top
 *   await dialogue.say('The Overlord', 'Line of text')
 *   const i = await dialogue.ask('The Overlord', 'Question?', [{ text, tag }])
 *   dialogue.close()
 */

/** Placeholder portrait: a gas-masked officer in a peaked cap. Swap for art via PORTRAITS. */
const OVERLORD_SVG = `
<svg viewBox="0 0 300 380" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="dlgLens" cx="45%" cy="40%" r="60%">
      <stop offset="0" stop-color="#ffd2a0"/>
      <stop offset="0.35" stop-color="#ff5a1f"/>
      <stop offset="1" stop-color="#5a0f08"/>
    </radialGradient>
    <linearGradient id="dlgCoat" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2c3034"/>
      <stop offset="1" stop-color="#121416"/>
    </linearGradient>
    <linearGradient id="dlgMask" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4a4f54"/>
      <stop offset="1" stop-color="#1f2225"/>
    </linearGradient>
  </defs>
  <!-- coat and shoulders -->
  <path d="M20 380 C24 300 60 268 112 256 L150 300 L188 256 C240 268 276 300 280 380 Z" fill="url(#dlgCoat)"/>
  <path d="M112 256 L150 300 L188 256 L176 246 L150 270 L124 246 Z" fill="#7a1e16"/>
  <!-- epaulettes -->
  <path d="M40 300 C60 276 90 266 116 262 L120 280 C92 284 66 296 50 312 Z" fill="#b8913a"/>
  <path d="M260 300 C240 276 210 266 184 262 L180 280 C208 284 234 296 250 312 Z" fill="#b8913a"/>
  <g stroke="#8a6a2a" stroke-width="3">
    <path d="M48 312 v14 M58 304 v14 M68 298 v14 M78 292 v14"/>
    <path d="M252 312 v14 M242 304 v14 M232 298 v14 M222 292 v14"/>
  </g>
  <!-- medals -->
  <circle cx="214" cy="318" r="7" fill="#e8bf68"/><rect x="209" y="300" width="10" height="12" fill="#7a1e16"/>
  <circle cx="234" cy="330" r="6" fill="#c9c9c9"/><rect x="230" y="314" width="8" height="10" fill="#34496e"/>
  <!-- hoses -->
  <path d="M118 214 C92 236 96 262 110 280" fill="none" stroke="#1a1c1e" stroke-width="12" stroke-linecap="round"/>
  <path d="M182 214 C208 236 204 262 190 280" fill="none" stroke="#1a1c1e" stroke-width="12" stroke-linecap="round"/>
  <!-- mask -->
  <path d="M96 128 C96 92 120 74 150 74 C180 74 204 92 204 128 L204 176 C204 214 180 238 150 240 C120 238 96 214 96 176 Z" fill="url(#dlgMask)"/>
  <!-- lenses -->
  <circle cx="124" cy="146" r="22" fill="#8a6a2a"/><circle cx="176" cy="146" r="22" fill="#8a6a2a"/>
  <circle cx="124" cy="146" r="17" fill="url(#dlgLens)"/><circle cx="176" cy="146" r="17" fill="url(#dlgLens)"/>
  <circle cx="118" cy="140" r="4" fill="#fff" opacity="0.7"/><circle cx="170" cy="140" r="4" fill="#fff" opacity="0.7"/>
  <!-- filter canister -->
  <path d="M130 196 h40 l-4 40 h-32 Z" fill="#3a3e42"/>
  <g stroke="#1a1c1e" stroke-width="3"><path d="M132 206 h36 M133 216 h34 M134 226 h32"/></g>
  <rect x="140" y="236" width="20" height="8" rx="2" fill="#8a6a2a"/>
  <!-- peaked cap -->
  <path d="M84 104 C84 60 216 60 216 104 L222 112 L78 112 Z" fill="#24272a"/>
  <rect x="88" y="98" width="124" height="14" fill="#7a1e16"/>
  <path d="M74 112 C110 124 190 124 226 112 L218 126 C186 136 114 136 82 126 Z" fill="#0e0f10"/>
  <!-- cap badge: an oil drop -->
  <path d="M150 64 C142 76 138 82 138 88 a12 12 0 0 0 24 0 c0 -6 -4 -12 -12 -24 Z" fill="#e8bf68"/>
  <path d="M150 74 C146 80 144 84 144 88 a6 6 0 0 0 12 0 c0 -4 -2 -8 -6 -14 Z" fill="#1c1c1c"/>
</svg>`;

/** Portrait per speaker. A string starting with '<svg' is inlined; anything else is used as an image URL. */
export const PORTRAITS = {
  'The Overlord': OVERLORD_SVG,
};

const CHARS_PER_SEC = 55;

export class Dialogue {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="dlg-shade"></div>
      <div class="dlg-banner hidden"><div class="dlg-kind"></div><div class="dlg-title"></div><div class="dlg-effect"></div></div>
      <div class="dlg-portrait"></div>
      <div class="dlg-choices"></div>
      <div class="dlg-box">
        <div class="dlg-name"></div>
        <div class="dlg-text"></div>
        <div class="dlg-next">▼</div>
      </div>
      <div class="dlg-hints"><span><b>↑↓</b> Select</span><span><b>Enter</b> Confirm</span></div>`;
    this.$ = (s) => root.querySelector(s);
    this.active = false;
    this.#bindInput();
  }

  /** Show the overlay, with an optional banner ({ kind, title, effect } — effect may contain HTML). */
  open(banner = null) {
    this.active = true;
    this.root.classList.remove('hidden');
    this.root.className = banner?.kind ? `kind-${banner.kind}` : '';
    const b = this.$('.dlg-banner');
    b.classList.toggle('hidden', !banner);
    if (banner) {
      this.$('.dlg-kind').textContent = banner.kindLabel ?? banner.kind ?? '';
      this.$('.dlg-title').textContent = banner.title ?? '';
      this.$('.dlg-effect').innerHTML = banner.effect ?? '';
    }
    document.body.classList.add('dialogue');
  }

  /** The speaker exits: portrait slides away, then the overlay closes. Resolves when gone. */
  leave(ms = 600) {
    this.$('.dlg-choices').innerHTML = '';
    this.root.classList.add('leaving');
    return new Promise((r) =>
      setTimeout(() => {
        this.root.classList.remove('leaving');
        this.close();
        r();
      }, ms),
    );
  }

  close() {
    this.active = false;
    this.#stopTyping();
    this.root.classList.add('hidden');
    document.body.classList.remove('dialogue');
    this.$('.dlg-choices').innerHTML = '';
  }

  /** One line; resolves when the player clicks / presses Enter after it has finished typing. */
  say(speaker, text) {
    return new Promise((resolve) => {
      this.#show(speaker, text, null, resolve);
    });
  }

  /** A line followed by reply choices ([{ text, tag? }], tag may contain HTML). Resolves with the index. */
  ask(speaker, text, choices) {
    return new Promise((resolve) => {
      this.#show(speaker, text, choices, resolve);
    });
  }

  // ---------- internals ----------

  #show(speaker, text, choices, resolve) {
    if (!this.active) this.open();
    this.resolve = resolve;
    this.choices = choices;
    this.selected = 0;
    this.$('.dlg-name').textContent = speaker;
    const art = PORTRAITS[speaker];
    const portrait = this.$('.dlg-portrait');
    if (portrait.dataset.who !== speaker) {
      portrait.dataset.who = speaker;
      portrait.innerHTML = !art ? '' : art.trim().startsWith('<svg') ? art : `<img src="${art}" alt="">`;
      portrait.classList.remove('enter');
      void portrait.offsetWidth;
      portrait.classList.add('enter');
    }
    this.$('.dlg-choices').innerHTML = '';
    this.$('.dlg-next').classList.add('hidden');
    this.#type(text);
  }

  #type(text) {
    this.#stopTyping();
    const el = this.$('.dlg-text');
    this.full = text;
    this.shown = 0;
    this.typing = true;
    el.textContent = '';
    const start = performance.now();
    const step = (now) => {
      this.shown = Math.min(text.length, Math.floor(((now - start) / 1000) * CHARS_PER_SEC));
      el.textContent = text.slice(0, this.shown);
      if (this.shown < text.length) this.raf = requestAnimationFrame(step);
      else this.#finishTyping();
    };
    this.raf = requestAnimationFrame(step);
  }

  #stopTyping() {
    cancelAnimationFrame(this.raf);
    this.typing = false;
  }

  #finishTyping() {
    this.#stopTyping();
    this.$('.dlg-text').textContent = this.full;
    if (this.choices) this.#renderChoices();
    else this.$('.dlg-next').classList.remove('hidden');
  }

  #renderChoices() {
    const box = this.$('.dlg-choices');
    box.innerHTML = this.choices
      .map(
        (c, i) =>
          `<button class="dlg-choice${i === this.selected ? ' on' : ''}" data-i="${i}" style="animation-delay:${i * 60}ms">` +
          `<span class="dlg-label">${c.text}${c.tag ? ` <span class="dlg-tag">[${c.tag}]</span>` : ''}</span></button>`,
      )
      .join('');
  }

  #select(i) {
    if (!this.choices) return;
    this.selected = (i + this.choices.length) % this.choices.length;
    for (const b of this.$('.dlg-choices').children) b.classList.toggle('on', Number(b.dataset.i) === this.selected);
  }

  /** Click / Enter: finish typing first, then advance or confirm the selected choice. */
  #advance(pick = null) {
    if (!this.active || !this.resolve) return;
    if (this.typing) return this.#finishTyping();
    if (this.choices) {
      if (pick !== null) this.selected = pick;
      const done = this.resolve;
      this.resolve = null;
      done(this.selected);
      return;
    }
    const done = this.resolve;
    this.resolve = null;
    done();
  }

  #bindInput() {
    this.root.addEventListener('pointermove', (e) => {
      const b = e.target.closest('.dlg-choice');
      if (b && Number(b.dataset.i) !== this.selected) this.#select(Number(b.dataset.i));
    });
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('.dlg-choice');
      if (this.choices && !this.typing && !b) return; // with choices up, only a choice confirms
      this.#advance(b ? Number(b.dataset.i) : null);
    });
    // Capture phase so the game's own key handler never sees keys while dialogue is open.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.active) return;
        e.stopImmediatePropagation();
        const k = e.key.toLowerCase();
        if (k === 'enter' || k === ' ' || k === 'z') {
          e.preventDefault();
          if (!e.repeat) this.#advance();
        } else if (k === 'arrowup' || k === 'w') this.#select(this.selected - 1);
        else if (k === 'arrowdown' || k === 's') this.#select(this.selected + 1);
        else if (this.choices && !this.typing && k >= '1' && k <= String(this.choices.length)) this.#advance(Number(k) - 1);
      },
      true,
    );
  }
}
