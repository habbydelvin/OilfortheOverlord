# Visual Design: The Capital (Hive City)

Reference for the Capital tile and the style other tiles should follow.
Source: `src/capitalMesh.js` (`buildHiveCapital`), shown in `capital-test.html`.

## 1. Concept

A gothic-industrial hive city: a cathedral stacked on a factory. It reads as
**one tall shape** from the board camera, a stepped cone that ends in a needle spire.
The look borrows from tabletop terrain such as grimdark resin hive cities:
matte grey stone, dense small detail, warm lit windows.

Three layers, from bottom to top:

| Layer | Meaning | Read |
|---|---|---|
| Plinth | Industry, the foundations | Square, heavy, mechanical |
| Tiers | Where people live | Round, repeating, crowded |
| Spire | Power, the Overlord | Thin, vertical, glowing |

## 2. Silhouette and proportions

Modelled in a 10-unit space, then scaled to one board cell (0.97 world units).

- **Footprint:** a square plinth fills the cell. Nothing hangs over the cell edge
  except the 0.125-unit bottom lip.
- **Height:** about 1.06× the footprint width (10.9 units). The capital should be
  the tallest tile on the board.
- **Stepping:** each tier is about 0.8 units narrower in radius than the one below,
  so the outline stays a cone at any yaw.

| Part | Radius / size | Height |
|---|---|---|
| Plinth | 10 × 10 | 1.0 (+0.05 lip) |
| Tier 1 | r 4.0 | 1.35 |
| Tier 2 | r 3.15 | 1.30 |
| Tier 3 | r 2.3 | 1.25 |
| Tier 4 | r 1.5 | 1.15 |
| Spire stages | r 0.95 → 0.36 (octagonal) | 1.5 / 1.4 / 1.2 / 1.0 |
| Spire cone + needle | r 0.36 | 3.0 + 0.7 |
| Buttress towers (×8) | 0.36 square | reach to 70% up tier 3 |
| Front needle tower | 0.3 square | 4.4 + 1.1 cap |

Rule of thumb: **tiers get shorter as they go up, spire stages get shorter as they go up,
and the spire cone is the tallest single part.**

## 3. Palette

Mostly grey and matte. The only colour comes from lit windows.

| Role | Hex | Material |
|---|---|---|
| Stone (main mass) | `#8f949b` | roughness 0.88 |
| Trim (rims, frames, pilasters, roofs) | `#747981` | roughness 0.80 |
| Recess (windows, gates, vents) | `#2a2d33` | roughness 0.95 |
| Metal (pipes, ships, machinery) | `#5b5f66` | roughness 0.55, metalness 0.45 |
| Glow (lit windows, engines) | `#ffb347`, emissive `#ff8f26` ×1.4 | roughness 0.60 |

Guidelines:
- About **18%** of tier windows and **25%** of rooftop windows are lit. Spire windows
  alternate lit and dark, so the spire is the brightest point.
- Trim is always **darker** than stone, so every edge and band reads as a line.
- Keep it to **five materials**. Merging by material keeps the whole tile at 5 draw calls.

## 4. Motifs

### Gothic
- **Round-topped arch**: a slab plus a half-buried disc (`arch()`). Used for every
  window, gate and base bay. Frames are trim, panes are recess or glow.
- **Pilasters** between windows on every tier wall and between base bays.
- **Pinnacles**: 4-sided cones on tower tops, spire corners and rooftops.
- **Flying buttresses**: a straight beam from tower to tier with a half-torus
  arch underneath.
- **Octagonal spire** with corner piers and a pinnacle on each corner.

### Industrial
- **Machinery bays** in the base: vent housing, two round fans, riser pipes.
  Two out of every six bays on each side.
- **Deck pipes** running from the edge in toward the tiers (4 per side).
- **Raised deck plates** snapped to a 0.5 grid. Use them to break up flat areas.
- **Landing pads**: stepped octagons in the corners.

### Life
- **Rooftop blocks** fill each tier ring, randomised by seed: plain, pitched roof,
  spire, chimney or dome. Each gets one window strip facing out.
- **Ships**: a small hull, nose cone, wings, bridge, two glowing engines.
  Parked on pads and docked along the first ring, pointing along the ring.

## 5. How detail is spread

- **Repeat, then vary.** Window rhythm is even (about one per 0.55 units of
  circumference). Rooftop blocks get random size and roof type.
- **Big shapes first.** From the board camera the cone, towers and spire must read
  without the small detail. Detail is texture, not shape.
- **Keep sight lines clear.** No rooftop blocks within ±0.14 rad of a buttress or
  ±0.3 rad of a docked ship or the front needle.
- **Front faces +z** (the default camera). The front needle and a gate sit at angle 0.
- **Fixed seed** (`1337`), so the capital looks the same every session.
  Use a different seed for variants, such as a free capital from a mystery site.

## 6. Construction rules

- Build from primitives only (box, cylinder, cone, torus, half sphere), placed with `put()`.
- **No coplanar faces** (prevents z-fighting):
  - Rims and cornices stick up at least 0.01 above the surface they sit on.
  - Panes sit at least 0.02 in front of their frames.
  - Facade details are offset at least 0.01 from the wall.
  - Stacked discs (pads) differ in height by at least 0.02.
- Hidden faces (bottoms, buried ends) can overlap freely.
- **Budget:** about 23k triangles, 5 draw calls, built in under 20 ms.
  New tiles in this style should aim for 5–25k triangles.
- Base sits on y = 0, footprint centred on the origin.
  Note that the FBX blockouts include a dirt slab under the tile; line the two up
  before mixing them on the board.

## 7. Applying the style to other tiles

| Tile | Keep | Change |
|---|---|---|
| Settlement | Arched windows, pitched roofs, glow | One low tier, no spire |
| Refinery / Oil Station | Plinth bays, pipes, metal | Tanks and stacks instead of tiers, more metal |
| Hydro-farm | Plinth, deck plates | Domes and green glow instead of amber |
| Ruins | Same pieces as the capital | Broken tiers, no glow, tilted pinnacles |

The capital sets the ceiling: the most detail, the tallest outline, the most glow.
Other tiles should be lower and simpler so the capital stays the focus of the board.
