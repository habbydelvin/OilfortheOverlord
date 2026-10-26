import { defineConfig } from 'vite';

// The repo lives on a Windows drive mounted into WSL, where native file
// events do not fire. Poll so the game and the tile library pick up edits.
export default defineConfig({
  server: {
    watch: {
      usePolling: true,
      interval: 400,
    },
  },
});
