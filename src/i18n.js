/**
 * Language: English or Simplified Chinese, switched live from the button at the bottom left (saved between
 * sessions).
 *
 * Every piece of player-facing text is written in both languages side by side, where it's used:
 *   L('Next turn', '下一回合')
 *   L(`Round ${n}`, `第 ${n} 年`)
 * L() picks the current language when it runs, so text has to be built when it's shown (inside a function or a
 * getter), not once when a module loads. Static text in the HTML pages carries its Chinese in data attributes
 * (data-zh, data-zh-title, data-zh-aria-label, data-zh-placeholder); applyStatic() swaps them.
 *
 * When the language changes, onLangChange listeners redraw what's on screen (HUD, hand, panels).
 *
 * Glossary (keep the Chinese consistent everywhere):
 *   Oil for the Overlord 献给霸主的石油 · Overlord 霸主 · Overseer 总督 · Capital 首都 · Hive City 蜂巢城
 *   Settlement 定居点 · Hydro-farm 水培农场 · Water Pump 水泵站 · Oil Station 采油站 · Refinery 炼油厂
 *   Wasteland 荒地 · Oasis 绿洲 · Tar Pit 焦油坑 · Labour Camp 劳工营 · Cliffs 悬崖 · Pre-war Ruins 战前遗迹
 *   Toxic Crater 毒坑 · Raider Camp 掠夺者营地 · Raider Hideout 掠夺者巢穴 · Siphoner Camp 窃油者营地
 *   Scavenger Camp 拾荒者营地 · Smuggler Den 走私者窝点 · bandit camp 匪营 · rebel 叛军 · raiders 掠夺者
 *   Spark 火花 · Demolish 拆除 · Wrecking Crew 拆迁队 · Send in the Militia 派遣民兵
 *   food 食物 · oil 石油 · barrel(s) 桶 · manpower / worker slot(s) 人力 · population 人口
 *   food stores 粮仓 · oil stockpile 石油库存 · tribute 贡品 · quota 配额 · target 目标
 *   season 季节 · Spring 春 · Summer 夏 · Autumn 秋 · Winter 冬 · year / round 年 (第 N 年)
 *   turn 回合 · hand 手牌 · card 卡牌 · tile 地块 · piece 板块 · reroll 重抽 · shop / market 市场
 *   year event 年度事件 · missed tribute 失职 · missile strike 导弹打击 · idle 闲置 · Passive 被动
 *   On trigger 触发时 · Junk 废料 · On play 打出时 · adjacent 相邻 · "?" site 神秘地点
 * Resource amounts in rule text keep a space before the word ("+2 食物", "-1 人力"), like the English ("+2 food"),
 * so iconize() in tiles.js can swap the word for its icon.
 */

const KEY = 'oto.lang';
let lang = 'en';
try {
  if (localStorage.getItem(KEY) === 'zh') lang = 'zh';
} catch {
  /* no storage: English */
}

export const getLang = () => lang;
export const isZh = () => lang === 'zh';

/**
 * Every pair L() has produced, by its text in either language, so text that was already built and shown (a
 * dialogue line, a toast, a choice button) can be swapped for the other language on a switch: retranslate().
 * Bounded: the oldest pairs go first.
 */
const memory = new Map(); // text -> [en, zh]
const MEMORY_MAX = 6000;
function remember(en, zh) {
  const known = memory.get(en);
  if (known && known[1] === zh) return;
  const pair = [en, zh];
  // Latest wins: a pair made by both() replaces anything recorded for the same text before.
  memory.delete(en);
  memory.delete(zh);
  memory.set(en, pair);
  memory.set(zh, pair);
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
}
let building = 0; // inside both(): the inner L() calls mix languages on purpose, so they aren't remembered

/** The text for the current language. `zh` may be left out (or null) while a translation is missing. */
export function L(en, zh) {
  if (zh == null) return en;
  if (!building && typeof en === 'string' && typeof zh === 'string' && en !== zh) remember(en, zh);
  return lang === 'zh' ? zh : en;
}

/**
 * Text that was made by L() (in either language), in the current language; anything else comes back as it is.
 * For text that was built once and is still on screen when the language changes.
 */
export function retranslate(text) {
  const pair = typeof text === 'string' ? memory.get(text) : null;
  return pair ? (lang === 'zh' ? pair[1] : pair[0]) : text;
}

/**
 * Build a text once in each language and return it in the current one, remembered as a pair so it can switch later
 * (retranslate). For text that mixes in other translated values (tile names, labels, other L() results):
 *   both(() => L(`Found a ${TERRAINS[k].name}`, `发现了${TERRAINS[k].name}`))
 * Each run sees its own language everywhere, so the English never carries a Chinese name or the other way round.
 * `fn` must not have side effects: it runs twice.
 */
export function both(fn) {
  const was = lang;
  let en;
  let zh;
  building++;
  try {
    lang = 'en';
    en = fn();
    lang = 'zh';
    zh = fn();
  } finally {
    lang = was;
    building--;
  }
  return L(en, zh);
}

/** A text field that may be a string or a function returning one (built in the current language). */
export const textOf = (v) => (typeof v === 'function' ? v() : retranslate(v));

const listeners = new Set();
/** Run `fn(lang)` after every language change (redraw what's on screen). */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLang(next) {
  next = next === 'zh' ? 'zh' : 'en';
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* not saved */
  }
  applyStatic();
  for (const fn of listeners) fn(lang);
  retranslateDom();
}

/**
 * Safety net after the redraws: any text left on the page that L() made in the other language (a floating payout
 * word, a fading caption, a line nobody redraws) is swapped for its twin. Only whole text nodes can be matched.
 */
function retranslateDom(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue;
    const trimmed = text.trim();
    if (!trimmed || !memory.has(trimmed)) continue;
    const next = retranslate(trimmed);
    if (next !== trimmed) node.nodeValue = text.replace(trimmed, next);
  }
}

export const toggleLang = () => setLang(lang === 'zh' ? 'en' : 'zh');

const ATTRS = ['title', 'aria-label', 'placeholder'];
/**
 * Static HTML: an element with data-zh has its contents swapped for that text in Chinese (the English is kept in
 * data-en the first time); data-zh-title / data-zh-aria-label / data-zh-placeholder do the same for attributes.
 * Also sets <html data-lang>. <html lang> stays "en" on purpose: a Chinese lang makes browsers resolve the generic
 * fonts (system-ui, sans-serif) to Chinese fonts, which changes the English text too. Chinese characters get their
 * fonts from the "Han" faces in fonts.css instead, which only cover Chinese characters.
 */
export function applyStatic(root = document) {
  document.documentElement.dataset.lang = lang;
  for (const el of root.querySelectorAll('[data-zh]')) {
    if (el.dataset.en === undefined) el.dataset.en = el.innerHTML;
    el.innerHTML = lang === 'zh' ? el.dataset.zh : el.dataset.en;
  }
  for (const attr of ATTRS) {
    const zhKey = `data-zh-${attr}`;
    const enKey = `data-en-${attr}`;
    for (const el of root.querySelectorAll(`[${zhKey}]`)) {
      if (!el.hasAttribute(enKey)) el.setAttribute(enKey, el.getAttribute(attr) ?? '');
      el.setAttribute(attr, lang === 'zh' ? el.getAttribute(zhKey) : el.getAttribute(enKey));
    }
  }
}
