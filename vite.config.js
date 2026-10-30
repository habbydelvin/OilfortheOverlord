import { defineConfig } from 'vite';

/**
 * Release build (`npm run release` = `vite build --mode release`): strip the dev-only markup from index.html,
 * the tile library link and the Game Debug button and panel, so it isn't even in the shipped page.
 * (src/release.js removes the matching code; library.html is never part of the build.)
 */
const DEV_ONLY = /^\s*<(a|button|div) id="(libraryLink|btnDebug|debug)"[^\n]*<\/\1>\s*\n/gm;
const stripDevMarkup = {
  name: 'strip-dev-markup',
  transformIndexHtml(html) {
    const out = html.replace(DEV_ONLY, '');
    const left = ['libraryLink', 'btnDebug', 'id="debug"'].filter((s) => out.includes(s));
    if (left.length) throw new Error(`release: dev markup still in index.html: ${left.join(', ')}`);
    return out;
  },
};

// The repo lives on a Windows drive mounted into WSL, where native file
// events do not fire. Poll so the game and the tile library pick up edits.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'release' ? [stripDevMarkup] : [],
  server: {
    watch: {
      usePolling: true,
      interval: 400,
    },
  },
}));
