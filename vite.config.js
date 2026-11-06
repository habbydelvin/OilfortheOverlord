import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Release build (`npm run build` = `vite build --mode release`, then zipped): nothing dev-only is shipped.
 *  - index.html: the tile library link, the Game Debug dock and the debug "destroy Hive" buttons are removed.
 *  - debugPanel.js and perfOverlay.js are swapped for empty stubs (src/releaseStubs), so their code isn't bundled.
 *  - CSS: rules only for those removed elements are dropped.
 *  - library.html, sounds.html and the test pages are never build inputs (only index.html is).
 * The build fails if any of it is still found in the output.
 */
const DEV_HTML = [
  /^[ \t]*<a id="libraryLink"[^\n]*<\/a>[ \t]*\n/m,
  /^[ \t]*<!-- Game Debug[^\n]*-->[ \t]*\n/m,
  /^[ \t]*<div id="debugDock">[\s\S]*?<\/div>\s*<\/div>[ \t]*\n/m,
  /^[ \t]*<!-- Debug only[^\n]*-->[ \t]*\n/gm,
  /^[ \t]*<button id="btn(Globe|Rival)Destroy"[^\n]*<\/button>[ \t]*\n/gm,
];
const DEV_SELECTOR = /#(debug|btnDebug|debugDock|libraryLink|btnGlobeDestroy|btnRivalDestroy)(?![\w-])|\.dbg-|\.globe-debug/;
const LEFTOVERS = ['libraryLink', 'library.html', 'btnDebug', 'debugDock', 'Game Debug', 'dbg-', 'globe-debug', 'btnGlobeDestroy', 'btnRivalDestroy', 'tileIsland', 'Tile library'];

const STUBS = {
  'debugPanel.js': fileURLToPath(new URL('./src/releaseStubs/debugPanel.js', import.meta.url)),
  'perfOverlay.js': fileURLToPath(new URL('./src/releaseStubs/perfOverlay.js', import.meta.url)),
};

/** Index of the brace closing the block that opens at `open`, skipping comments and strings. */
function closeOf(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') i = css.indexOf('*/', i + 2) + 1 || css.length;
    else if (c === '"' || c === "'") {
      for (i++; i < css.length && css[i] !== c; i++) if (css[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return css.length;
}

/** The next `{` (as [index, -1]) or `;` (as [-1, index]) from `from`, outside comments and strings. */
function nextToken(css, from) {
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') i = css.indexOf('*/', i + 2) + 1 || css.length;
    else if (c === '"' || c === "'") {
      for (i++; i < css.length && css[i] !== c; i++) if (css[i] === '\\') i++;
    } else if (c === '{') return [i, -1];
    else if (c === ';') return [-1, i];
  }
  return [-1, -1];
}

/** Split a selector list on its top-level commas. */
function splitSelectors(list) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Drop rules (and selectors in a list) that only style the dev elements removed from index.html. */
function stripDevCss(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const [brace, semi] = nextToken(css, i);
    if (brace < 0) {
      // a statement such as @import, or trailing text
      const end = semi < 0 ? css.length : semi + 1;
      out += css.slice(i, end);
      i = end;
      continue;
    }
    // Keep comments before the prelude as they are; work on the prelude itself.
    let prelude = css.slice(i, brace);
    let lead = '';
    const comments = prelude.match(/^(\s*\/\*[\s\S]*?\*\/)*\s*/);
    if (comments) {
      lead = comments[0];
      prelude = prelude.slice(lead.length);
    }
    const close = closeOf(css, brace);
    const body = css.slice(brace + 1, close);
    i = close + 1;
    if (prelude.trimStart().startsWith('@')) {
      out += `${lead}${prelude}{${/^@(media|supports|container|layer)/.test(prelude.trim()) ? stripDevCss(body) : body}}`;
      continue;
    }
    // `:not(#debugDock)` matches everything once the dock is gone.
    const kept = splitSelectors(prelude.replace(/\/\*[\s\S]*?\*\//g, ''))
      .map((s) => s.replace(/:not\(#debugDock\)/g, '*'))
      .filter((s) => !DEV_SELECTOR.test(s));
    if (kept.length) out += `${lead}${kept.join(',\n')} {${body}}`;
  }
  return out;
}

const releaseStrip = {
  name: 'release-strip-dev',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!importer || importer.includes('releaseStubs')) return null;
    const file = source.split('/').pop();
    return source.startsWith('.') && STUBS[file] ? STUBS[file] : null;
  },
  transform(code, id) {
    if (!/\.css($|\?)/.test(id)) return null;
    return { code: stripDevCss(code), map: null };
  },
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      let out = html;
      for (const re of DEV_HTML) out = out.replace(re, '');
      return out;
    },
  },
  generateBundle(_opts, bundle) {
    const found = [];
    for (const [name, chunk] of Object.entries(bundle)) {
      if (/library|sounds|combat-test|capital-test/i.test(name)) found.push(`${name} (dev page)`);
      const text = chunk.type === 'chunk' ? chunk.code : typeof chunk.source === 'string' ? chunk.source : null;
      if (!text) continue;
      for (const s of LEFTOVERS) if (text.includes(s)) found.push(`${name}: "${s}"`);
    }
    if (found.length) this.error(`release: dev-only content still in the build:\n  ${found.join('\n  ')}`);
  },
};

// The repo lives on a Windows drive mounted into WSL, where native file
// events do not fire. Poll so the game and the tile library pick up edits.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'release' ? [releaseStrip] : [],
  server: {
    watch: {
      usePolling: true,
      interval: 400,
    },
  },
}));
