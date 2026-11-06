/** Release build stand-in for perfOverlay.js (vite.config.js): same calls, no overlay, no code shipped. */
const noop = () => {};
export class Perf {
  enabled = false;
  counter = noop;
  toggle = noop;
  frameBegin = noop;
  begin = noop;
  end = noop;
  frameEnd = noop;
  gpuBegin = noop;
  gpuMark = noop;
  gpuEnd = noop;
  capture = noop;
  setOpen = noop;
  refreshToggles = noop;
}
