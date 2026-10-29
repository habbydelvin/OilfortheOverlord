/**
 * Moves the glint on the metal panels (src/theme.css, "sheen") with the mouse, like the hand cards' sheen
 * follows their tilt. Sets --dp-shine only on the few elements that show it, at most once per frame.
 */
const HOSTS = '#top, #panel, #help, #gameover .box, .shop-band, .btn';
let hosts = null;
let x = 0.5;
let queued = false;
let last = '';

function apply() {
  queued = false;
  const value = `${(15 + x * 70).toFixed(1)}%`;
  if (value === last) return;
  last = value;
  hosts ??= [...document.querySelectorAll(HOSTS)];
  for (const el of hosts) el.style.setProperty('--dp-shine', value);
}

window.addEventListener(
  'pointermove',
  (e) => {
    x = e.clientX / window.innerWidth;
    if (!queued) {
      queued = true;
      requestAnimationFrame(apply);
    }
  },
  { passive: true },
);
