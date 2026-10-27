# Oil for the Overlord

Game proposal · Internal greenlight review

A dieselpunk tile-placement roguelike where you build a self-sustaining city-state outward from a single capital, balance manpower and food, and feed an oil cascade to meet an overlord whose demands keep rising.

| | |
| --- | --- |
| **Genre** | Tile-placement roguelike |
| **Setting** | Dieselpunk city-state |
| **Turn** | One season |
| **Round** | Four seasons, then tribute |

Working title. Concept proposal, for internal review. Numbers below are placeholders, used to show the shape of the systems.

## The original game

### Lost and Mail

I like the idea of placing down a stamp to create a path. The original game also required strategic thinking in the placement of the stamps in order to fulfill a set so that players could get a higher score the more they played.

However, the goal of just getting the highest score did not appeal and I felt that more could be done with the stamp placing aspect of the game.

Therefore, I wanted to add more city building elements into the game, so that players would be more invested in the tiles that they placed, rather than just a means of increasing their overall score.

| Lost and Mail does well | What can be improved | Change in Oil for the Overlord |
| --- | --- | --- |
| Placing stamps to create a path is simple and satisfying. | Stamps only exist to raise the score. | Tiles become parts of a city (farms, villages, derricks, refineries) that the player builds and cares about. |
| Placement needs strategic thinking to complete sets. | Completing a set only adds points. | Sets form districts that change how the economy runs, such as refinery multipliers and windmill food bonuses. |
| A clear, focused loop. | Could use a stronger setting. | A dieselpunk setting, an overlord who retaliates, and narrative events that affect the city's growth. |

## Concept

### Govern. Grow. Pay tribute.

You govern a small city-state in a dieselpunk world, under an overlord who demands oil. You start with one city tile. Each tile you place grows your world outward: farmland, villages, oil derricks, refineries, windmills.

Your land has to support itself. Cities supply the workers, workers run the farms and oil fields, and farms feed the cities. Whatever oil the economy produces goes to the overlord. Failure to do so will prompt retaliation from the overlord.

**Cities → Workers → Farms & oil → Food → Cities**

From one capital outward. Each tile is placed where it has a reason to be. In the concept animation, tiles prefer certain neighbors and the city grows compactly:

| Tile | Prefers to sit next to |
| --- | --- |
| Derrick | Derrick, refinery |
| Refinery | Derrick |
| Farm | Farm, windmill, village |
| Windmill | Farm |
| Village | Farm, city |
| City | Village, city |

## Design pillars

### Three directives

1. **Build a world.** The map grows organically from your capital, and every tile has a reason to be where it is.
2. **Self-sustainment.** Each tile has upkeep. Growth only lasts if the economy can support it.
3. **Spatial sets.** Where you put a tile matters as much as which tile it is. Districts outperform scattered tiles.

## Core loop

### Every expansion has to pay for itself

More oil needs more manpower → more manpower needs more cities → more cities need more food → more food needs farms, which use manpower.

Four parts feed each other in a ring: cities, manpower, farms and food. Oil leaves the ring and goes to the overlord.

| From | To | Link |
| --- | --- | --- |
| Cities | Manpower | Supply workers |
| Manpower | Farms | Run |
| Farms | Food | Grow |
| Food | Cities | Feeds |
| Manpower | Oil | Run derricks |
| Oil | Overlord | Tribute |
| Overlord | Farms | Retaliation |

- **Cities.** Cities supply the workers, and every city has to be fed. More cities means more manpower, but also more mouths.
- **Manpower.** A cap, not a resource you spend. Housing raises the cap; every farm, derrick and refinery takes one slot. Past the cap, the newest buildings sit idle and produce nothing.
- **Farms.** Farms use manpower to grow food. Placing them next to a windmill gives a food bonus.
- **Food.** Food feeds the cities. Food and manpower are checked together each turn, so an imbalance stalls the whole economy.
- **Oil.** Derricks pump crude and refineries multiply it. Whatever the economy produces goes to the overlord.
- **The Overlord.** Collects oil at the end of each round. The better you do, the higher the next quota. Failure to deliver prompts retaliation.

Manpower decides how many buildings you can support. Free slots are room to grow; idle buildings are wasted tiles.

## Structure

### A turn is a season. A round is a year.

A round is four turns: Spring, Summer, Autumn, Winter. Tribute is due at the end of Winter.

1. **Build.** Place tiles from your hand next to existing land. Tiles come in Tetris-like pieces, so you can rotate them to get the adjacency you want. The only rule is that each tile must connect to the other.
2. **Calculate.** Food, manpower and oil are calculated. The turn ends.
3. **New hand.** You draw fresh tiles, and you can spend oil to refresh (reroll) them.

### Tribute to the overlord

Oil is delivered to the overlord. The better you do, the higher the next quota. Fall short and the overlord retaliates.

The Overlord takes the whole stockpile after Winter; nothing carries over. The next quota grows with what he received:

```
excess    = max(0, delivered - quota)
nextQuota = round(quota × 1.5 + 20 + excess × 0.75)
```

The first quota is 20. The quota always grows (×1.5 + 20), even if you fall short, and every barrel of excess raises it further. Numbers to be tuned.

| Delivered vs quota | Next quota |
| --- | --- |
| 20 / 20 (exactly met) | 50 |
| 30 / 20 (10 excess) | 58 |
| 15 / 20 (missed, plus a strike) | 50 |
| 50 / 50 (exactly met) | 95 |

## Build phase

### Rotate, fit, connect

Pieces are Tetris-like shapes of a single tile type. Rotate a piece to line up the adjacency you want, then attach it to your land. Try to feed the capital, staff the derricks and put a refinery among them.

The interactive mock-up is an 11×9 grid. It starts with one capital city in the center. The hand holds three pieces.

- Pick a piece, hover the grid, click to place.
- **R** rotates. **1–3** select a piece.
- On touch: tap to preview, tap again to place.
- Reroll spends oil (1, then 2, 3… rising for the whole run) and draws three new pieces.
- A piece places only if every cell is empty and at least one cell touches existing land on a side.

Each piece is one tile type. Shape draw weights (singles about 32%, dominoes about 16%, trominoes about 16%, tetrominoes about 37%):

| Shape | Cells | Weight |
| --- | --- | --- |
| Single | 1 | 6 |
| Domino | 2 in a line | 3 |
| V | 3 | 1.5 |
| I3 | 3 in a line | 1.5 |
| I, O, T, L, J, S, Z | 4 (standard tetrominoes) | 1 each |

Tile-type draw weights: farm 3, oil derrick 3, village 2, city 1.1, windmill 1, refinery 1.

### Tiles (placeholder numbers)

| Tile | Rule |
| --- | --- |
| City | +4 worker slots, eats 3 food |
| Village | +2 worker slots, eats 1 food |
| Farm | 1 worker, +2 food, and +2 more if it touches a windmill |
| Windmill | No workers. Boosts adjacent farms |
| Oil derrick | 1 worker, +2 crude |
| Refinery | 2 workers, +0.5× per adjacent derrick |

### This turn's calculation

Food balance is food grown minus food eaten. Below zero, the store covers the gap; once the store is empty, the city is starving.

### Pre-war Ruins

Ruins are hidden on the map as "?" mystery sites; building next to a site reveals it. They can't be built on. Once a building stands next to a ruin, a **Clear ruins** button appears above it. Clearing empties the cell and tops your hand back up to 5 with random pieces that ignore shop unlocks: pure luck.

### Raiders

Starving doesn't end the run. If the year ends while the people are starving, a **Raider Camp** appears: on an empty cell next to your land if there is one, otherwise on a Wasteland, otherwise it razes a building (never the Capital). Each camp drains 2 worker slots, so your newest buildings go idle. Every season with a non-negative food balance, the oldest camp leaves and its cell is empty again. Running out of manpower doesn't end the run either; only three missed tributes do.

Manpower is a cap: worker slots come from housing and population. Worker buildings are staffed in the order they were placed; any beyond the cap are idle and produce nothing (an idle derrick doesn't feed a refinery either).

```
cap = housing + population - craters - raiders
oil = round(crude from staffed derricks × refinery multiplier × fed)
```

The refinery multiplier starts at 1 and gains 0.5 for each derrick orthogonally adjacent to a refinery. Linked derrick–refinery pairs and linked farm–windmill pairs are what the mock-up highlights.

## Set collection

### Districts beat scattered tiles

Placement matters as much as which tile you draw. The same tiles, grouped around a hub, beat the same tiles spread out. All values are placeholders.

### Oil field + refinery

Several oil tiles with a refinery next to them get an oil multiplier. Derricks fire, refineries multiply.

The comparison uses four derricks and one refinery, all staffed.

District, refinery touching all four derricks:

```
. . D . .
. D R D .
. . D . .
```

Scattered, refinery touching one derrick:

```
D . . . D
. D R . .
. . . . D
```

| Step | District | Scattered |
| --- | --- | --- |
| Crude (2 per derrick) | 8 | 8 |
| Refinery | ×3.0 (four neighbors) | ×1.5 (one neighbor) |
| **Barrels** | **24** | **12** |

Same tiles: the district produces 2× the scattered layout.

### Farms + windmill

Several farms next to a windmill get a food bonus. Farms harvest, then the windmill adds a bonus for each farm next to it.

The comparison uses four farms and one windmill.

District, windmill touching all four farms:

```
. . F . .
. F W F .
. . F . .
```

Scattered, windmill touching one farm:

```
F . . . F
. F W . .
. . . . F
```

| Step | District | Scattered |
| --- | --- | --- |
| Harvest (2 per farm) | 8 | 8 |
| Windmill (+2 per adjacent farm) | +8 | +2 |
| **Food** | **16** | **10** |

Same tiles: the district produces 1.6× the scattered layout.

## Events and choices

### Dispatches from the realm

Slight narrative choices and events occur between turns that affect the growth of your city. These are examples only. Content and effects are still to be designed.

| Kind | Event | Choice |
| --- | --- | --- |
| Event | Refugees at the gate | Take them in for +2 manpower and −2 food each turn, or turn them away. |
| Choice | The overlord's envoy | Pay a bribe of oil now to lower next round's quota, or refuse and risk his displeasure. |
| Event | Blight in the fields | Burn the affected farms to save the rest, or gamble that the harvest holds. |
