/**
 * What the player has learnt, kept apart from what has been on screen (tutorial.js shows the lessons; this only
 * remembers them). A lesson can be:
 *   shown      its hint has been on screen this many times (it stays open: being shown is not learning it)
 *   done       the game saw it done (a meaningful event: placed, rotated, revealed, aimed...)
 *   solo       ...and how many of those times the player did it without its hint on screen
 *   dismissed  the player put it aside (the skip button during a hint), or it was shown MAX_SHOWS times unfinished
 * An unfinished lesson waits a cooldown after each showing before it may be offered again. Learnt or dismissed
 * lessons never come back by themselves (a changing city doesn't reopen them), but can still be replayed by hand.
 *
 * Pure: no DOM, no game state. The storage is passed in (localStorage in the game, a stub in the tests).
 */
export const LESSONS_KEY = 'oto.lessons.v1';
/** The old record: a list of hint ids marked "seen" as soon as they were displayed (done or not). */
export const LEGACY_HINTS_KEY = 'oto.hintsSeen.v1';

/** Seconds of play before an unfinished lesson may be offered again, times the number of showings so far. */
export const COOLDOWN = 30;
/** Unfinished showings before a lesson stops offering itself. */
export const MAX_SHOWS = 4;

/** Old hint ids that are now part of a lesson with another name. */
const RENAMED = { aim: 'war', missiles: 'war', salvo: 'salvo', zoom: 'globe', next: 'next', marketTour: 'marketTour' };

const blank = () => ({ shown: 0, done: false, solo: 0, dismissed: false });

export class LessonBook {
  /** storage: { getItem, setItem, removeItem } */
  constructor(storage) {
    this.storage = storage;
    this.state = load(storage);
    this.wait = {}; // id -> play clock (seconds) before which it isn't offered again (this session only)
  }

  #rec(id) {
    return (this.state[id] ??= blank());
  }

  #save() {
    try {
      this.storage.setItem(LESSONS_KEY, JSON.stringify(this.state));
    } catch {
      /* private mode: the lessons just aren't remembered */
    }
  }

  get(id) {
    return { ...blank(), ...this.state[id] };
  }

  learnt(id) {
    return Boolean(this.state[id]?.done);
  }

  /** Not learnt and not put aside: it may still be taught (now or later). */
  open(id) {
    const r = this.state[id];
    return !r || (!r.done && !r.dismissed);
  }

  /** May its hint start now? Open, not shown too often, and its cooldown (on the play clock) has run out. */
  ready(id, clock = Infinity) {
    const r = this.state[id];
    if (!this.open(id)) return false;
    if (r && r.shown >= MAX_SHOWS) return false;
    return clock >= (this.wait[id] ?? 0);
  }

  /** Its hint went on screen (and was seen: the caller only counts visible time). */
  shown(id, clock = 0) {
    const r = this.#rec(id);
    r.shown++;
    this.wait[id] = clock + COOLDOWN * r.shown;
    if (r.shown >= MAX_SHOWS && !r.done) r.dismissed = true;
    this.#save();
  }

  /** The game saw it done. prompted: while its own hint was on screen (otherwise the player found it alone). */
  complete(id, prompted = false) {
    const r = this.#rec(id);
    const first = !r.done;
    r.done = true;
    if (!prompted) r.solo++;
    this.#save();
    return first;
  }

  /** The player put this lesson aside. */
  dismiss(id) {
    this.#rec(id).dismissed = true;
    this.#save();
  }

  /** A replayed tutorial teaches everything again. */
  reset() {
    this.state = {};
    this.wait = {};
    try {
      this.storage.removeItem(LESSONS_KEY);
    } catch {
      /* nothing stored */
    }
  }
}

function load(storage) {
  try {
    const saved = JSON.parse(storage.getItem(LESSONS_KEY) ?? 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
  } catch {
    /* unreadable: start again */
  }
  // Migrate the old list: those hints were marked as soon as they appeared, so each counts as shown once, not learnt
  // (the player gets the credit as soon as they do it, prompted or not).
  const state = {};
  try {
    const old = JSON.parse(storage.getItem(LEGACY_HINTS_KEY) ?? '[]');
    if (Array.isArray(old)) {
      for (const id of old) {
        const to = RENAMED[id] ?? id;
        state[to] = { ...blank(), shown: 1 };
      }
    }
    storage.removeItem(LEGACY_HINTS_KEY);
    if (Object.keys(state).length) storage.setItem(LESSONS_KEY, JSON.stringify(state));
  } catch {
    /* nothing to migrate */
  }
  return state;
}
