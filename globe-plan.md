# Globe Plan: A Hex Planet Bent from a Flat Map

Source: [Sphere cannot be build from hexes, but game dev is magic](https://www.reddit.com/r/Unity3D/comments/1w4761b/sphere_cannot_be_build_from_hexes_but_game_dev_is/) (madhumster, Tile Crawl). The clip is a hex meta-planet. Underneath it is a flat plane, bent in a shader.

## Vision
The War Map is a planet of hexagons. Hive City and the three rivals sit on it. Scroll out past max zoom on the board and the city falls away into the planet; click a city on the planet and the camera flies down into it. Dragging spins the planet. The old SVG war table and its button are gone.

A closed surface of regular hexes needs 12 pentagons, and the hexes beside those pentagons stop being regular. Tile Crawl refused that and bent a plane instead. So does this: every cell is a true hexagon, and there are no pentagons, because the plane is never really closed.

The player's board does not change. The globe is a view, like `src/rivalView.js`.

## How it works (built)
1. **One flat plane of hexes** (`src/globeView.js`). 24 × 28 pointy-top cells in one `InstancedMesh`; the row count is even so the stagger repeats. Each city is a thin brass medallion (canvas-drawn badge: crown for Hive City, hawk / coin / eye by rival personality) lying on its hex, plus dashed routes; all on the same plane and bent with it.
2. **One bend** (`src/globeBend.js`). Injected with `onBeforeCompile` into every globe material (`bend.patch`). Azimuthal-equidistant: a plane point at offset (u, v) from the scroll lands on the sphere at arc length |(u, v)| from the point facing the camera. The sphere sits at the origin; the camera looks down −Z and only moves in and out.
3. **Spinning is scrolling.** Dragging writes `uGlobeScroll`; nothing on the plane moves. Inertia carries a flick.
4. **Wrap in the shader, no clones.** Each object (or instance) is shifted by whole periods so its anchor is within half a period of the scroll. Whole tiles move together, so nothing tears. The period is the circumference, so everything past the limb folds onto the far side, behind the opaque core sphere. This is phase 5 of the old plan; the 3×3 copies were never needed.
5. **Normals are rebuilt** in the same chunk: two neighbours are bent, and the tangent frame turns the flat normal into the bent one. Tile tops shade as a smooth ball.
6. **Picking is inverted.** A ray hits a sphere of the planet's radius, `bend.unbend` maps that point back to the plane, and the nearest node (periodic distance) wins. HTML labels follow `bend.project` and also take clicks.
7. **The core sphere** (slightly smaller, dark) shows through the gaps as the hex lines and hides the folded far side. A back-face rim shader is the atmosphere.

## Flow
| From | Input | To |
|---|---|---|
| Board | Scroll out past max zoom (`CameraRig.onZoomPastMax`), or `G` | Globe, starting just above Hive City and pulling back |
| Globe | Click a rival, or scroll in past min zoom with the cursor on it | Fly down, fade, rival city |
| Globe | Click Hive City, scroll in on it, `Esc`, or `G` | Fly down, fade, board (camera pulled out, then settles) |
| Rival city | Scroll out past max zoom, `Esc`, or the War Map button | Globe, starting above that rival |

The board refuses while another screen owns it (`screenBusy()`: dialogue, shop, payout, tutorial, strike). The camera stretches a little past max as you overscroll and cloud wisps creep in from the edges. Every switch goes through a white cloud bank (`src/cloudTransition.js`, `#viewClouds`): clouds rush in, the view swaps behind them, they part. The globe opens with the city you left dead centre and only pulls straight back; wheel zoom on the globe is straight in/out, so the grid never slides. Only dragging spins it.

## Architecture
- `main.js`: `view` is `'board' | 'globe' | 'rival'`. `openGlobe`, `closeGlobe`, `enterRival`, `leaveRival` go through `swapView` (clouds cover, change, clouds part). A reset (`resetView`) cancels a fade in flight.
- The frame loop renders only the globe while it is open. `followTarget` does not run on it. The globe has its own camera, so the board's view offset does not apply.
- Node positions come from `src/rivals.js` (`PLAYER_NODE`, each rival's `map`), scaled onto the plane (`NODE_SPAN`) and snapped to a cell. That cell takes the city's colour.
- Hover card text (name, leader, personality, buildings, tension `—`) stays in `L()` and redraws on a language change.

## Still to do
- Terrain on the blank cells (sketch trees and hills, as in the clip). Blank for now by choice.
- Clouds on the same bend, casting onto the surface; they can also hide anything odd near the limb.
- VFX and water must use `bend.patch`. A material that animates its own vertices must bend after that animation.
- Tension, routes that mean something, and rival simulation stay in `combat-plan.md`.

## Tuning
In `src/globeView.js`: `COLS`/`ROWS` (planet size in cells; radius follows from the period), `NODE_SPAN` (how spread the cities are), `D_DEFAULT`/`D_MIN`/`D_MAX` (camera distances), `OVERSCROLL` (wheel needed to dive into a city). In `src/controls.js`: `CameraRig.OVERSCROLL` (wheel needed to leave the board).
