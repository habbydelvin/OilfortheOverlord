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

/** Portrait per speaker. A string starting with '<svg' is inlined; anything else is used as an image URL. */
export const PORTRAITS = {
  // Bump ?v= when the image file changes, so browsers drop the cached copy.
  'The Overlord': '/portraits/TheOverlord01.png?v=20261027-1828',
  'Rebel Leader': '/portraits/TheRebel01.png?v=20261028-2054',
  'Bandit Leader': '/portraits/TheRaider01.png?v=20261028-2057',
  // No art yet: add an image path here to give them a portrait.
  'Field Report': '',
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
    // Already showing: keep the portrait and box in place and just swap the banner (re-dropping it).
    const continuing = this.active;
    this.active = true;
    this.root.classList.remove('hidden');
    this.root.className = banner?.kind ? `kind-${banner.kind}` : '';
    const b = this.$('.dlg-banner');
    b.classList.toggle('hidden', !banner);
    if (banner) {
      this.$('.dlg-kind').textContent = banner.kindLabel ?? banner.kind ?? '';
      this.$('.dlg-title').textContent = banner.title ?? '';
      this.$('.dlg-effect').innerHTML = banner.effect ?? '';
      if (continuing) {
        b.style.animation = 'none';
        void b.offsetWidth;
        b.style.animation = '';
      }
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
    this.selected = Math.max(0, choices?.findIndex((c) => !c.disabled) ?? 0);
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
    // Start time comes from the first frame's own timestamp: rAF's `now` can be slightly earlier
    // than performance.now(), and a negative count made slice(0, -1) flash almost the whole line.
    let start = null;
    const step = (now) => {
      start ??= now;
      this.shown = Math.max(0, Math.min(text.length, Math.floor(((now - start) / 1000) * CHARS_PER_SEC)));
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
          `<button class="dlg-choice${i === this.selected ? ' on' : ''}${c.disabled ? ' off' : ''}" data-i="${i}" style="animation-delay:${i * 60}ms">` +
          `<span class="dlg-label">${c.text}${c.tag ? ` <span class="dlg-tag">[${c.tag}]</span>` : ''}</span></button>`,
      )
      .join('');
  }

  #select(i) {
    if (!this.choices) return;
    const n = this.choices.length;
    const dir = i < this.selected ? -1 : 1;
    i = (i + n) % n;
    // Skip disabled choices (a choice can be disabled, e.g. "not enough food").
    for (let k = 0; k < n && this.choices[i].disabled; k++) i = (i + dir + n) % n;
    if (this.choices[i].disabled) return;
    this.selected = i;
    for (const b of this.$('.dlg-choices').children) b.classList.toggle('on', Number(b.dataset.i) === this.selected);
  }

  /** Click / Enter: finish typing first, then advance or confirm the selected choice. */
  #advance(pick = null) {
    if (!this.active || !this.resolve) return;
    if (this.typing) return this.#finishTyping();
    if (this.choices) {
      if (pick !== null) {
        if (this.choices[pick]?.disabled) return;
        this.selected = pick;
      }
      if (this.choices[this.selected]?.disabled) return;
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
