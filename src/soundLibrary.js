/**
 * Sound library (sounds.html, dev only): every sound the game plays, grouped by where it's heard.
 * "Play" calls the same function the game calls (synthesised sounds are generated live by src/sfx.js, so this is
 * exactly what the player hears); recordings also list each file so every take can be auditioned on its own.
 * Keep this in step with src/sfx.js, src/combatAudio.js, src/ambience.js and src/music.js when sounds change.
 */
import * as sfx from './sfx.js';
import { createCombatAudio } from './combatAudio.js';

const combat = createCombatAudio();

// ---------- unlocking: browsers only allow sound after a click ----------
let unlocked = null;
const status = document.getElementById('status');
function unlock() {
  unlocked ??= (async () => {
    status.textContent = 'Loading sounds…';
    sfx.unlockSfx();
    combat.unlock();
    await Promise.all([sfx.whenSfxRunning(), sfx.sfxLoaded(), combat.load()]);
    await new Promise((r) => setTimeout(r, 400)); // the place / transition / title recordings decode after unlock
    status.textContent = 'Sound on';
  })();
  return unlocked;
}

// ---------- plain file playback (each take, music, ambience loops) ----------
let current = null; // the looping track playing, if any
function playFile(path, { loop = false } = {}) {
  if (loop) stopLoop();
  const a = new Audio(path);
  a.loop = loop;
  a.volume = loop ? 0.6 : 0.9;
  a.play();
  if (loop) current = a;
}
function stopLoop() {
  current?.pause();
  current = null;
}

// ---------- the library ----------
const S = 'synth';
const R = 'rec';
const M = 'music';
const LP = 'loop';
const files = (dir, names) => names.map((n) => `/audio/${dir}/${n}`);

/** [group, note, entries]; entry: { name, fn, kind, where, play: [[label, () => …]], files } */
const LIBRARY = [
  [
    'Cards and hand',
    'src/hand.js, src/main.js',
    [
      { name: 'Card hover', fn: 'sfx.hover()', kind: S, where: 'Pointer moves onto a card in the hand.', play: [['Play', sfx.hover]] },
      { name: 'Card select / deselect', fn: 'sfx.tick(up)', kind: S, where: 'Selecting (higher) or deselecting a card. Also every good toast.', play: [['Select', () => sfx.tick(true)], ['Deselect', () => sfx.tick(false)]] },
      { name: 'Deal', fn: 'sfx.deal()', kind: S, where: 'A new hand slides in (start of a season, a shop or strike hand).', play: [['Play', sfx.deal]] },
      { name: 'Reroll', fn: 'sfx.shuffle()', kind: S, where: 'The reroll button.', play: [['Play', sfx.shuffle]] },
      { name: 'Rotate piece', fn: 'sfx.rotateClick()', kind: R, where: 'Rotating the held piece (R / F).', play: [['Play (random take)', sfx.rotateClick]], files: files('sfx', ['rotate-1.wav', 'rotate-2.wav', 'rotate-3.wav']) },
    ],
  ],
  [
    'Placing tiles',
    'src/main.js',
    [
      { name: 'Tile lands', fn: 'sfx.thud()', kind: R, where: 'A single non-building tile hits the sand; also the stand-in while the rock drops load.', play: [['Play', () => sfx.thud()], ['Heavy', () => sfx.thud(true)]], files: files('sfx', ['thud-1.wav', 'thud-2.wav', 'thud-3.wav', 'thud-4.wav', 'thud-heavy-1.wav', 'thud-heavy-2.wav', 'thud-heavy-3.wav']) },
      { name: 'Wasteland / building lands', fn: 'sfx.wasteThud()', kind: R, where: 'A Wasteland piece or any building hits the sand (rock drop).', play: [['Play (random take)', sfx.wasteThud]], files: files('place', ['wasteland-1.ogg', 'wasteland-2.ogg', 'wasteland-3.ogg']) },
      { name: 'Illegal placement', fn: 'sfx.buzz()', kind: R, where: 'Trying to place a piece where it can\'t go.', play: [['Play (random take)', sfx.buzz]], files: files('sfx', ['buzz-1.wav', 'buzz-2.wav', 'buzz-3.wav', 'buzz-4.wav', 'buzz-5.wav']) },
      { name: 'Demolition', fn: 'sfx.demolition(heavy)', kind: S, where: 'Demolish, and the Wrecking Crew (heavy).', play: [['Play', () => sfx.demolition()], ['Heavy', () => sfx.demolition(true)]] },
    ],
  ],
  [
    'Economy and seasons',
    'src/main.js',
    [
      { name: 'Oil / purchase', fn: 'sfx.coin()', kind: S, where: 'Oil produced, and buying in the shop or Black Market.', play: [['Play', sfx.coin]] },
      { name: 'Food', fn: 'sfx.food()', kind: S, where: 'Food produced.', play: [['Play', sfx.food]] },
      { name: 'Tribute barrel', fn: 'sfx.barrel(level)', kind: S, where: 'A barrel lands in the tribute gauge; higher pitch as it fills.', play: [['Empty', () => sfx.barrel(0)], ['Half', () => sfx.barrel(0.5)], ['Full', () => sfx.barrel(1)]] },
      { name: 'Season latch', fn: 'sfx.latch()', kind: S, where: 'The season clock locks into the next season; a missile docking in the silo.', play: [['Play', sfx.latch]] },
      { name: 'Turn resolves', fn: 'sfx.confirm()', kind: S, where: 'Ending the turn.', play: [['Play', sfx.confirm]] },
      { name: 'Error / bad news', fn: 'sfx.deny()', kind: S, where: 'Every bad toast (not enough oil, "Incoming!", the first-tribute reminder, …).', play: [['Play', sfx.deny]] },
      { name: 'Game over', fn: 'sfx.doom()', kind: S, where: 'The city falls.', play: [['Play', sfx.doom]] },
    ],
  ],
  [
    'Dialogue',
    'src/dialogue.js',
    [
      { name: 'Typewriter', fn: 'sfx.speak()', kind: S, where: 'Each letter tick while a line is spoken.', play: [['Play', sfx.speak], ['Burst', () => { for (let i = 0; i < 8; i++) setTimeout(sfx.speak, i * 45); }]] },
      { name: 'Advance', fn: 'sfx.click()', kind: S, where: 'Clicking to the next line.', play: [['Play', sfx.click]] },
      { name: 'Choice hover', fn: 'sfx.choiceHover()', kind: S, where: 'Moving onto a reply.', play: [['Play', sfx.choiceHover]] },
      { name: 'Choice confirm', fn: 'sfx.choiceClick()', kind: S, where: 'Picking a reply.', play: [['Play', sfx.choiceClick]] },
    ],
  ],
  [
    'Main menu and transitions',
    'src/titleScreen.js, src/main.js',
    [
      { name: 'FTL jump', fn: 'sfx.ftlJump()', kind: R, where: 'Each Mothership dropping out of FTL on the main menu. Placeholder: licence unconfirmed.', play: [['Play', sfx.ftlJump]], files: files('title', ['ftl-jump.ogg']) },
      { name: 'Zoom out (city → planet)', fn: 'sfx.zoomWhoosh(false)', kind: R, where: 'Cloud transition to the War Map.', play: [['Play', () => sfx.zoomWhoosh(false)]], files: files('transition', ['zoom-out.ogg']) },
      { name: 'Zoom in (planet → city)', fn: 'sfx.zoomWhoosh(true)', kind: R, where: 'Cloud transition into a city; Start / Continue on the main menu.', play: [['Play', () => sfx.zoomWhoosh(true)]], files: files('transition', ['zoom-in.ogg']) },
    ],
  ],
  [
    'Overlord strikes',
    'src/main.js, src/laserStrike.js',
    [
      { name: 'Laser charge-up', fn: 'sfx.laserCharge(seconds)', kind: R, where: 'Each laser, from the beams appearing to the blast firing (random variation, fitted to the charge time).', play: [['Play (random, 3.0 s)', () => sfx.laserCharge(3.02)]], files: files('laser', ['charge-1.ogg', 'charge-2.ogg', 'charge-3.ogg', 'charge-4.ogg']) },
      { name: 'Strike explosion', fn: 'combatAudio.explosion()', kind: R, where: 'Laser blast or missile hitting the ground (see Combat below).', play: [['Large', () => combat.explosion('large')]] },
    ],
  ],
  [
    'Combat (War Map attacks)',
    'src/combatAudio.js; synthesised stand-ins play until the recordings have loaded',
    [
      { name: 'Missile launch', fn: 'combatAudio.launch()', kind: R, where: 'Missiles leaving a launcher.', play: [['Play', () => combat.launch()]], files: files('combat-test', ['missile-launch.wav']) },
      { name: 'Missile incoming', fn: 'combatAudio.incoming(s)', kind: R, where: 'A rising whoosh that peaks as the missile lands or is shot down.', play: [['Play (2 s)', () => combat.incoming(2)]], files: files('combat-test', ['incoming-1.wav', 'incoming-2.wav', 'incoming-3.wav', 'incoming-4.wav']) },
      { name: 'Explosion, large', fn: "combatAudio.explosion('large')", kind: R, where: 'A missile or laser hitting a city.', play: [['Play', () => combat.explosion('large')]], files: files('combat-test', ['explosion-large-1.wav', 'explosion-large-2.wav', 'explosion-large-3.wav', 'explosion-large-4.wav', 'explosion-large-5.wav']) },
      { name: 'Explosion, small', fn: "combatAudio.explosion('small')", kind: R, where: 'An intercept or a decoy popping.', play: [['Play', () => combat.explosion('small')]], files: files('combat-test', ['explosion-small-1.wav', 'explosion-small-2.wav']) },
      { name: 'CIWS gun', fn: 'combatAudio.gunBurst(s)', kind: R, where: 'Intercept turrets firing.', play: [['Play (1 s)', () => combat.gunBurst(1)]], files: files('combat-test', ['gun-burst-1.wav', 'gun-burst-2.wav', 'gun-burst-3.wav', 'gun-burst-4.wav', 'gun-burst-5.wav', 'gun-burst-6.wav']) },
      { name: 'Air-raid siren', fn: 'combatAudio.sirenOn()', kind: R, where: 'Missiles aimed at Hive City, from launch until the last is down.', play: [['On', () => combat.sirenOn()], ['Off', () => combat.sirenOff()]], files: files('combat-test', ['siren-tornado.wav']) },
      { name: 'Explosion (stand-in)', fn: 'sfx.boom()', kind: S, where: 'Launches and explosions before the combat recordings load.', play: [['Play', sfx.boom]] },
      { name: 'CIWS (stand-in)', fn: 'sfx.ciws(s)', kind: S, where: 'Turret fire before the combat recordings load.', play: [['Play (0.8 s)', () => sfx.ciws(0.8)]] },
    ],
  ],
  [
    'Music',
    'src/music.js; looped with a crossfade in game',
    [
      { name: 'Main menu theme', fn: "playTrack('title')", kind: M, where: 'The main menu.', loop: '/audio/title/menu-theme.mp3' },
      { name: 'Game theme', fn: "playTrack('game')", kind: M, where: 'Playing (board, War Map, rival cities).', loop: '/audio/game-theme.mp3' },
    ],
  ],
  [
    'Board ambience',
    'src/ambience.js; fades out as you zoom out and off the board',
    [
      { name: 'Traffic bed', fn: 'ambience: bed', kind: LP, where: 'Background hum, thicker with more ships in flight.', loop: '/audio/ambience/traffic-bed.m4a' },
      { name: 'Engine idle', fn: 'ambience: idle', kind: LP, where: 'The nearest ships\' engines, slow.', loop: '/audio/ambience/engine-idle.m4a' },
      { name: 'Engine cruise', fn: 'ambience: cruise', kind: LP, where: 'The nearest ships\' engines, fast.', loop: '/audio/ambience/engine-1000.m4a' },
      { name: 'Rain', fn: 'ambience: rain', kind: LP, where: 'A calm rain loop underneath everything.', loop: '/audio/ambience/ambience-rain.m4a' },
    ],
  ],
];

/** In the code or files but never played by the game (listed so they aren't mistaken for missing sounds). */
const UNUSED = [
  { name: 'Chirp', fn: 'sfx.chirp()', kind: S, where: 'Old rotate sound (replaced by Rotate piece).', play: [['Play', sfx.chirp]] },
  { name: 'Silo', fn: 'sfx.silo()', kind: S, where: 'Old missile lift-off.', play: [['Play', sfx.silo]] },
  { name: 'Building lands', fn: 'sfx.buildThud()', kind: R, where: 'Buildings use the Wasteland rock drops instead.', play: [['Play', sfx.buildThud]], files: files('place', ['building-1.ogg', 'building-2.ogg']) },
  { name: 'Illegal placement (alt)', fn: "playTake('buzz-alt')", kind: R, where: 'The unchosen alternative.', play: [['Play', () => sfx.playTake('buzz-alt')]], files: files('sfx', ['buzz-alt-1.wav', 'buzz-alt-2.wav', 'buzz-alt-3.wav', 'buzz-alt-4.wav', 'buzz-alt-5.wav']) },
  { name: 'Rotate clicks (old)', fn: '—', kind: R, where: 'Earlier rotate takes.', files: files('ui', ['rotate-click-001.ogg', 'rotate-click-002.ogg', 'rotate-click-003.ogg', 'rotate-click-005.ogg']) },
  { name: 'Overlord Is Watching', fn: '—', kind: M, where: 'An older music track.', loop: '/audio/OverlordIsWatching-v2.mp3' },
];

const TAG = { synth: 'Synthesised', rec: 'Recording', music: 'Music', loop: 'Loop' };
const actions = new Map();
let nextId = 0;
const act = (fn) => {
  const id = String(nextId++);
  actions.set(id, fn);
  return id;
};

function row(e, unused = false) {
  const buttons = [
    ...(e.play ?? []).map(([label, fn]) => `<button data-a="${act(fn)}">${label}</button>`),
    ...(e.loop ? [`<button data-a="${act(() => playFile(e.loop, { loop: true }))}">Play</button>`, `<button class="stop" data-a="${act(stopLoop)}">Stop</button>`] : []),
  ].join('');
  const takes = e.files?.length
    ? `<div class="files">${e.files.map((f) => `<button data-a="${act(() => playFile(f))}" title="${f}">${f.split('/').pop()}</button>`).join('')}</div>`
    : e.loop ? `<div class="files">${e.loop}</div>` : '';
  return `<tr class="${unused ? 'unused' : ''}">
    <td class="name">${e.name}<small>${e.fn}</small></td>
    <td class="kind"><span class="tag ${e.kind}">${TAG[e.kind]}</span></td>
    <td>${e.where}</td>
    <td class="play">${buttons}${takes}</td>
  </tr>`;
}

const used = LIBRARY.reduce((n, [, , list]) => n + list.length, 0);
const synth = LIBRARY.flatMap(([, , l]) => l).filter((e) => e.kind === S).length;
document.getElementById('lib').innerHTML =
  `<p class="note">${used} sounds in use (${synth} synthesised live, the rest recordings, music and loops). <b>Play</b> calls the same code the game calls; the file names under a recording play each take on its own.</p>` +
  LIBRARY.map(([group, note, list]) => `<h2>${group}</h2><p class="note">${note}</p><table>${list.map((e) => row(e)).join('')}</table>`).join('') +
  `<h2>Not in use</h2><p class="note">In the code or the audio folders, but never played by the game.</p><table>${UNUSED.map((e) => row(e, true)).join('')}</table>`;

document.addEventListener('click', async (e) => {
  const fn = actions.get(e.target.closest('button')?.dataset.a);
  if (!fn) return;
  await unlock();
  fn();
});
