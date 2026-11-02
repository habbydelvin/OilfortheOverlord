# Combat Plan: Rival City-States & Nuclear War

## Vision
Three AI rival city-states, all vassals of the Overlord, compete with the player.
- **Your board:** the contested land. Rivals can only plant outposts here (Rival Derricks, Forward Camps). Militia and garrisons clear them.
- **Rival cities:** each one lives on its own screen, reached from a War Map. The only way to hit a rival city is a long-range missile strike, planned with strike cards and launched with an Attack button. Their defenses fight back.
- **Nuclear tripwire:** the first nuke anyone fires triggers Doomsday. Every AI knows nuclear war is now inevitable, world fallout rises, and if fallout reaches 100 everyone loses (Nuclear Winter).

## Phase roadmap
| Phase | Scope | Playable result |
|---|---|---|
| **1** | **War Map overlay + read-only rival city views** | Browse the continent and inspect 3 rival cities |
| 2 | Rival simulation per turn: economy, build-up, tension | Rival cities grow between seasons |
| 3 | Missile Silo, strike cards, strike planning, Attack, resolver, cinematic | First combat loop |
| 4 | Interceptors and shields on both sides; rival counterstrikes | Defense matters |
| 5 | Rival outposts on the player board; Barracks/garrison/militia | Ground pressure |
| 6 | Nukes, Doomsday, fallout, Nuclear Winter ending | Shared-loss endgame |
| 7 | Dialogue, events, Chinese text, tuning sliders | Polish |

---

# Phase 1: War Map & Rival City Views

## Goal
The player opens a War Map, sees their city and 3 rival nodes, clicks a rival, and looks at that rival's city. The view is rendered with the same tile models as the player board, and the camera can orbit and zoom. Back/Esc returns the player to the map, then to the game.

Phase 1 has no combat, no simulation and no gameplay effects. The player's board must not change.

## Architecture decisions
1. **Separate `THREE.Scene` for rival views, drawn with the same renderer and camera.**
   - Hiding the player's `tiles` group isn't enough. These all draw at player coordinates:
     - fog of war
     - traffic, frontier, mysteries and expansion outlines
     - the placement ghost and boost hints
     - the DOM map icons and ruin buttons
   - A second scene avoids all of that. The frame loop just switches which scene it renders.
2. **Reuse the existing `factory` (`TileFactory`) instance.**
   - Never call `loadBundle` or `loadCoreModels` again: nothing is cached across calls, and the assets are hundreds of MB.
   - Tile clones must sit inside a Scene so `factory.update` keeps animating them (`src/tiles.js:655-673`).
3. **Each rival is a plain `Grid` instance** (`src/grid.js:23` is pure data). Phase 2+ can then pass it to `computeEconomy(grid, …)`.
4. **The War Map is a DOM/SVG overlay**, built the same way as the shop and card pick (`.hidden` toggle, inside `#ui`, `pointer-events:auto`).
5. **Phase 1 rival layouts come from a seeded generator** using the rival's personality. Phase 2 swaps this for turn-by-turn growth.

## New files

### `src/rivals.js`: rival data and layout generation
- `RIVALS`: static definitions.

  | id | name | leader | personality | color | map position |
  |---|---|---|---|---|---|
  | margrave | Iron Margrave | The Margrave | Hawk | rust red | NE |
  | syndicate | Brass Syndicate | Chairman Vell | Merchant | brass | SW |
  | synod | Ashen Synod | The Ash Abbess | Paranoid | ash blue | NW |

  Each definition also has `zh` names. The `leader` names are placeholders.
- `createRivals(seed)` returns `[{ id, def, grid: Grid, stats, tension: 0 }]`.
- `generateLayout(grid, personality, rng, size)`:
  - Capital at (0,0), then rings of buildings placed on frontier cells.
  - Weighted by personality: Hawk favours housing and refineries, Merchant derricks and stations, Synod farms and housing.
  - Uses only existing building keys, so no new models are needed.
  - No Wasteland, because wasteland pieces need the extra bundle.
- `rivalStats(grid)` gives display-only numbers: tile counts per category. Optional: estimated oil from `computeEconomy`.
- A seeded RNG (mulberry32) so layouts stay the same for the whole run.

### `src/rivalView.js`: the rival city 3D view
- Creates a `rivalScene` once, with:
  - a black background and fog to match the main scene
  - a hemisphere light plus a shadowed sun sized to cover the rival layout
  - a sand ground plane
- `build(rival)`:
  - Clears the previous root group.
  - For each grid cell, calls `factory.create(terrain)` and positions it at `(x,0,z)`.
  - Rebuilds every time a view opens. This is cheap, and models that finished loading since the last open appear automatically.
- `enter(rival)`:
  1. Save the rig state: `goal`, `goalDistance`, `goalYaw`, `bounds`.
  2. Set `rig.bounds` to the rival's extent and focus on its centroid.
  3. Set `body.rival-view`.
- `exit()`: restore the rig state and remove the body class.
- `scene` getter, plus `active` flag.

### `src/warMap.js`: War Map overlay
- `open()`, `close()`, `isOpen`.
- Renders an inline SVG continent in the dieselpunk war-table style: parchment/brass, grid lines, placeholder coastline path.
- **Nodes:**
  - The player's city (gold, "Hive City", always first).
  - 3 rival nodes in their own colors.
  - Dashed supply lines between all nodes, for flavour.
- **Hovering a node** shows a card with: name, leader, personality, building count, tension (shows "—" in Phase 1).
- **Clicking:**
  - A rival node: `onSelectRival(id)` closes the map and enters that rival's view.
  - The player node: closes the map.
- Builds its strings at open time with `L()`, and re-renders on `onLangChange`.

## Edits to existing files

### `src/scene.js`
- Export the ground and light builders (`createGround`, a new `createLights(scene)`) so `rivalView.js` can reuse them.
- `followTarget` currently changes the main scene's fog, sun and ground directly (`src/scene.js:61-86`). For Phase 1 the rival scene uses fixed lighting and framing and does not follow the camera. (Later option: `followTarget(target, distance, which)`.)

### `src/main.js`
- **State:**
  - `state.rivals = createRivals(seed)` at run start, wherever the run is initialised and reset.
  - A view flag: `view = 'board' | 'warmap' | 'rival'`.
- **Input gating:** add `view !== 'board'` to:
  - `busy()` (`src/main.js:247`)
  - `tryPlace` (`src/main.js:2626`)
  - the hand guard
- **Frame loop** (`src/main.js:3168-3238`): when `view === 'rival'`:
  - Run `renderer.render(rivalView.scene, camera)`.
  - Skip `fog.render`, `renderGhost`, `placement.update`, `boostHints`, `zoomIcons`, `checkExpansion` and `followTarget`.
  - Keep running `rig.update` and `factory.update`.
- **Hotkeys** (`src/main.js:2751`):
  - `G` toggles the War Map. WASD, Q and E are taken by the camera; R, F, C and the number keys by gameplay.
  - Escape goes back one level: rival view → map → board.
- **Button:** `#btnWarMap` opens the War Map. It uses the existing `refused` shake when `busy()`. The War Map must not open during a payout, strike, shop, event or game over.

### `index.html`
- `#btnWarMap`: a round button in the bottom-left stack at `bottom: 218px`, with `data-zh-title`.
- `#warMap` overlay inside `#ui`: SVG container, node info card and close button.
- `#rivalBar` header for the rival view: rival name, personality, small stats, "◀ War Map" button. Shown only with `body.rival-view`.
- `#help`: add the `G` War Map line (EN and ZH).

### `src/ui.css`
- `#warMap`: `position:fixed; inset:0; z-index:45`, plus the opening animation, following the `#shop` pattern (`src/ui.css:1017`).
- `body.warmap`, `body.rival-view`: slide or hide `#top`, `#panel`, `#leftcol` and `#hand`. Also hide `#mapIcons`, `#ruinBtns` and `#floaters`.
- Node, hover-card and `#rivalBar` styles that match `theme.css`.

## Flow
1. **Board:** press G or `#btnWarMap`. `view='warmap'`, the overlay is shown, `rig.locked=true`.
2. **War Map:** click a rival.
   - The overlay hides and `rivalView.enter(rival)` runs.
   - `view='rival'` and `rig.locked=false`, so the player can orbit and zoom within the rival's bounds.
   - Clicks are ignored because `rig.onClick` is guarded.
3. **Rival view:** "◀ War Map" or Esc runs `rivalView.exit()` and returns to `view='warmap'`.
4. **War Map:** close, Esc or clicking your own node sets `view='board'`. The overlay hides and the rig is restored.

## Implementation steps
1. `src/rivals.js`: definitions, seeded RNG, layout generator, stats.
2. `src/scene.js`: export ground/light builders.
3. `src/rivalView.js`: rival scene, build/enter/exit.
4. `index.html` + `src/ui.css`: `#btnWarMap`, `#warMap`, `#rivalBar`, body classes, help line.
5. `src/warMap.js`: SVG map, nodes, hover card, click handlers, i18n.
6. `src/main.js`: rivals state, `view` flag, input gating, frame-loop branch, hotkeys, button wiring.
7. Manual test pass + `npm run build` / release build.

## Acceptance criteria
- [ ] War Map opens with G or the button, and only when the game isn't busy.
- [ ] 4 nodes are shown, each with the correct name, color and hover info in both EN and ZH.
- [ ] Clicking a rival shows a distinct, consistent city built from real tile models with shadows. The same rival looks identical every time it's opened during a run.
- [ ] Orbit and zoom work in the rival view, and the camera stays inside the rival's bounds.
- [ ] Nothing from the player's board leaks into the rival view: fog, ghost, icons, ruin buttons, traffic, hand.
- [ ] Returning to the board puts the camera back exactly where it was (position, zoom, yaw). The board and its state are untouched.
- [ ] Clicking in the rival view can't place tiles or play cards. The hand can't be used while the map is open.
- [ ] No new model fetches happen in the network tab when opening rival views.
- [ ] `npm run build` and the release build work, and the frame rate in the rival view is about the same as on the board.

## Manual test checklist
- Open the map during each blocked state (payout, shop, event, strike, game over). It should refuse with the shake.
- Open a rival before the extra/waste bundles finish loading. Stand-in blocks should appear, and the real models should show on the next open.
- Switch language while the map is open.
- Resize the window in the rival view, so the view offset for the side panel is still correct.
- Run several open/close cycles and check memory, making sure tile clones are released when a view is rebuilt.

## Risks
- `followTarget` changes the main scene's fog, sun and ground directly. It must not run against the rival scene by accident.
- `camera.setViewOffset` reserves space for the side panel and hand. If those are hidden in rival view, the framing may need a temporary offset.
- The `CameraRig` keyboard listener stays attached the whole time. Q/E/WASD should work in rival view, which is fine, but must not trigger anything on the board.

## Out of scope for Phase 1
Rival turn simulation, tension changes, missiles, strike cards, defenses, outposts, nukes, fallout, rival leader dialogue.

## Open decisions
- Map style: flat SVG war-table (assumed) vs 3D globe.
- Rival camera: free orbit/zoom within bounds (assumed) vs fixed showcase angle.
- Rival and leader names are placeholders.

---

# Later phases (outline)

## Phase 2: Rival simulation
- Each rival grid grows each season through simple build rules weighted by personality.
- Rival economy via `computeEconomy(rival.grid, …)` if it works off-board; otherwise a simplified model.
- Tension (0–100) per rival, shown on the War Map.

## Phase 3: First combat loop
- Missile Silo tile builds strike cards over seasons (oil cost).
- Rival view gets a strike hand: drag cards onto tiles to place target markers; undo/retarget freely.
- Attack button → pure `resolveStrike(loadout, defenderCity)` decides every result, then the cinematic plays it back (reuse `MissileStrike`, `craterAt`).
- Damage report: buildings destroyed, production denied, tension change.

## Phase 4: Defenses
- Interceptor Battery and Shield Generator on both sides, resolved by the same `resolveStrike`.
- `missiles.js`: per-strike bearing, interceptor counter-missiles, mid-air bursts, shield hit effects.
- Rival counterstrikes against the player board.

## Phase 5: Ground pressure
- Rival outposts on the player board (Rival Derrick, Forward Camp, Spotter Post), reusing camp spawn/clear code (`spawnRaider`, `spawnBandits`, `clearCamp`).
- Barracks + Garrison; Militia, Short-Range Rocket, Seize Outpost, Raid cards.

## Phase 6: Nuclear war
- Nuclear Silo upgrade and Nuke card.
- First nuke by anyone triggers Doomsday: all rivals turn hostile and launch.
- Fallout meter (0–100): lowers farm output, spreads craters, creates Wasteland, raises Overlord quotas.
- Fallout 100 → Nuclear Winter shared-loss ending.

## Phase 7: Polish
- Rival leader portraits and dialogue (`PORTRAITS` in `src/dialogue.js:17`), year events, Chinese text, tuning sliders in `SCALE_PARAMS` (`src/scalingConfig.js:50`).

---

## Appendix A: Strike cards (Phase 3+)
| Card | Tier | Effect | Vs interceptors | Vs shields | Cost |
|---|---|---|---|---|---|
| Conventional ▲ | 1 | Destroys 1 tile | Normal | 1 charge | 3 oil |
| Cluster ⁂ | 1 | 3 random hits in a 3×3 area | Normal | 1 charge each | 5 |
| Decoy ◇ | 1 | Draws the first interceptor shot | Always targeted | — | 2 |
| Bunker Buster ▼ | 2 | 1 tile; destroys a Shield Generator it hits | Normal | 3 charges | 6 |
| EMP ϟ | 2 | Shuts down defenses in a 3×3 area for this strike | Normal | Disables | 6 |
| Incendiary ✹ | 2 | Fire spreads 1 tile per season | Normal | 1 charge | 5 |
| Saboteur ☍ | 2 | Disables 1 building for 2 seasons | Can't be intercepted | Blocked | 4 |
| Hypersonic ➶ | 3 | 1 tile | Half the intercept chance | 1 charge | 9 |
| Nuke ☢ | 3 | 3×3 area; triggers Doomsday, +25 fallout | Lower intercept chance | Goes through | 20 + 2 seasons |

## Appendix B: New buildings (Phase 3–5)
| Tile | Workers | Upkeep | Effect |
|---|---|---|---|
| Missile Silo | 1 | 1 oil | Builds Tier 1 cards; +2 missiles per strike |
| Long-Range / Nuclear upgrade | — | +1 / +2 oil | Unlocks Tier 2 / Tier 3 cards |
| Interceptor Battery | 1 | 1 oil | 3 interceptors per season, 60% chance each, radius 2 |
| Shield Generator | 1 | 2 oil | 3×3 dome, absorbs 3 hits per year |
| Barracks | 2 | 1 food | Garrison +1 per season (max 5); clears camps and outposts |
| Radar Station | 1 | 1 oil | 1 season early warning; +15% interception nearby |
| Bunker | 0 | — | 50% chance a hit in its 3×3 area does no damage |

## Appendix C: Board action cards (Phase 5+)
| Card | Effect | Price |
|---|---|---|
| Send in the Militia ⚔ (exists) | Clears 1 bandit/rebel camp or rival outpost | 2 |
| Short-Range Rocket ↟ | Destroys a rival outpost at range | 3 |
| Seize Outpost ⚑ | Turns a Rival Derrick into yours; tension +20 | 4 |
| Raid ⚒ | Spend 2 Garrison to steal oil from a rival | 3 |
| Emergency Recharge ⟳ | Fully recharges 1 Shield Generator | 3 |
| Decontaminate ✚ | Turns 1 irradiated tile or crater back into Wasteland | 3 |
| Peace Envoy ☮ | Tension with one rival −30; not after Doomsday | 4 |

## Appendix D: Rival outposts (Phase 5)
| Outpost | Effect on you | Benefit to the rival | Cleared by |
|---|---|---|---|
| Rival Derrick | −2 oil/season | Faster missile production | Militia, Rocket, Seize |
| Forward Camp | −2 worker slots; raids an adjacent tile | Builds their army | Militia, Rocket, Barracks |
| Spotter Post | −20% intercept chance within 3 tiles | Better accuracy | Militia, Rocket |
| Sapper Nest (Doomsday only) | Drains 1 shield charge per season nearby | Weakens defenses | Rocket only |

## Appendix E: Rival personalities
| Rival | Personality | Favoured cards | Defenses | Tendency |
|---|---|---|---|---|
| Iron Margrave | Hawk | Cluster, Bunker Buster | Few | Strikes early; most likely to fire the first nuke |
| Brass Syndicate | Merchant | Decoy, Saboteur | Medium | Mostly sends Derricks; can be bought off with Envoys |
| Ashen Synod | Paranoid | EMP, Hypersonic | Heavy shields | Rarely strikes first, retaliates hard |
