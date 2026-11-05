// The payout's ui.css keyframes, played without remove-class / offsetWidth / add-class reflows.
// Property-less endpoint frames use the underlying style, just like the CSS animations.
const effects = {
  oil: [[{ offset: 0.5, transform: 'scale(1.25)' }], 350],
  food: [[{ offset: 0.5, transform: 'scale(1.25)' }], 400],
  quota: [[{ offset: 0.4, transform: 'scale(1.12)', color: '#ffd27a' }], 300],
  hit: [[
    { offset: 0.3, transform: 'scale(1.2) rotate(-5deg)', filter: 'drop-shadow(0 0 6px rgba(255, 170, 70, 0.9))' },
    { offset: 0.65, transform: 'scale(0.96) rotate(3deg)' },
  ], 500],
  filled: [[{ offset: 0.25, transform: 'scale(1.35)', filter: 'drop-shadow(0 0 10px #ffcf70)' }], 700],
  glow: [[{ offset: 0, background: 'linear-gradient(90deg, #8a5a14, #ffc05a 45%, #b8741c)' }], 600],
  fullGlow: [[{ offset: 0, background: 'linear-gradient(90deg, #8a5a14, #ffc05a 45%, #b8741c)' }], 900],
};
for (const [frames] of Object.values(effects)) {
  if (frames[0].offset > 0) frames.unshift({ offset: 0 });
  frames.push({ offset: 1 });
  // CSS eases each keyframe interval, rather than the whole animation timeline.
  for (const frame of frames) frame.easing = 'ease-out';
}
const playing = new WeakMap();

export function payoutPulse(el, kind) {
  playing.get(el)?.cancel();
  const [frames, duration] = effects[kind];
  playing.set(el, el.animate(frames, { duration }));
}
