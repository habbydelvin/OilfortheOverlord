/** Release build stand-in for debugPanel.js (vite.config.js): no Game Debug panel is shipped. */
export function createDebugPanel() {
  return { toggle() {}, refresh() {}, refreshMode() {} };
}
