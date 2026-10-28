# Year Events

## Status

Implemented in `src/events.js` (14): **Early Collection, Tithe of Men, Show of Force, Famine, Drought, Dust Storm, Earthquake, Bumper Harvest, Oil Boom, Refugees at the Gate, Mercenaries, Prospectors, Black Market Caravan, Tax the Settlements**. Everything else in this file is the backlog.

Percentage effects scale with the year (strength = year-2 value + per-year step, up to a max); every value is a slider in Game Debug → Scaling (`src/scalingConfig.js`). Event text shows the percentage and what it means right now. Events with nothing to act on are skipped in the draw (`when`), e.g. Mercenaries with no camps. (Overlord's Offer was removed: the yearly tribute target in `src/targets.js` replaces it.)

## Tribute target (every year from year 2)

After the shop (or the Overlord's failure speech) and before the year event, the Overlord lets you set this year's target. The base quota comes from `nextQuota()` as before; the tier scales it for this year only, and next year's base grows from the base.

| Tier | Quota | Reward if met (one rolled each year) |
| --- | --- | --- |
| Low | 85% | None |
| Medium | 100% | +50% market oil, +6 food, 2 free rerolls, or +1 population |
| High | 125% | Free pick of 1 of 3 market tiles, a good-fortune event next year, double market oil, or +2 population and +8 food |

Rewards are paid at tribute, and only if the target is met. Three Lows in a row force the next target to High.

Decisions: core set first; choice events included; no advance warning (events are a surprise); year 1 is event-free.

At the start of every year (after the shop closes, before the first hand is dealt), one event is drawn and shown as a card. It lasts until the next tribute. All numbers are placeholders.

Every event uses systems the game already has: worker slots, the food store, raiders, ruins, the quota, rerolls, the shop and the Overlord.

## Pressure: the Overlord pushes harder

| Event | Effect |
| --- | --- |
| **Early Collection** ✅ | Tribute is due after Autumn: 3 seasons instead of 4. |
| **Overlord's Inspection** | The quota is 25% higher, but meeting it gives double shop coins. |
| **Tithe of Men** ✅ | −20% worker slots (+5%/year, max 50%). The Overlord has drafted your workers. |
| **Requisition** | At the start of each season, the Overlord takes 3 oil from your stockpile. |
| **Show of Force** ✅ | Pre-war Ruins surface on an empty cell next to your land; a dormant missile in their silo launches from them and turns one of your buildings (never the Capital) into a Toxic Crater. |
| **Martial Law** | Rerolls are disabled for the year. |

## Disasters

| Event | Effect |
| --- | --- |
| **Famine** ✅ | Farms −40% food (+5%/year, max 75%). |
| **Drought** ✅ | Pumps and Oases give no bonus this year. |
| ~~**Great Raid**~~ | Removed: too punishing with no counterplay. |
| **Dust Storm** ✅ | Every hand this year has one extra Wasteland (on top of the normal hand). |
| **Plague** | Lose 2 population, and settlements eat 1 extra food. |
| **Pipeline Fire** | Each refinery link counts for half this year. |
| **Earthquake** ✅ | 3 random empty cells next to your land turn into Cliffs (slider). |

## Good fortune

| Event | Effect |
| --- | --- |
| **Bumper Harvest** ✅ | Farms +10% food (+5%/year, max 25%). |
| **Oil Boom** ✅ | Stations +10% crude (+5%/year, max 25%). |
| **Lenient Overlord** | The quota is 20% lower, but next year's jump is bigger. |
| **Refugee Wave** | +3 worker slots for the year, and +2 food upkeep. (Overlaps "Take them in" of Refugees at the Gate.) |
| **Salvage Season** | Clearing ruins this year also gives +1 worker slot permanently. |
| **Grace Period** | The tribute deadline moves to 5 seasons: you get an extra "Late Winter". |
| **Free Hands** | The first 3 rerolls this year are free. |

## Choice events: pick one of two

| Event | Option A | Option B |
| --- | --- | --- |
| **Refugees at the Gate** ✅ | Take them in: +20% worker slots, food upkeep 20% of food grown (+5%/year, max 50%) | Turn them away: +1 raider camp |
| ~~**Overlord's Offer**~~ | Removed: replaced by the yearly tribute target. | |
| **Mercenaries** ✅ | Hire them: every rebel and bandit camp is cleared; their fee is added to the tribute (+15%, +2%/year, max 30%). The stockpile is empty at the start of the year, so the fee is paid at tribute. Only drawn when there is a camp. | Refuse them: the camps stay |
| **Prospectors** ✅ | Buy the map: reveal the "?" site closest to your land (disabled if none are left) | Take the oil: oil in the stockpile now, 10% of the tribute (+2%/year, max 25%) |
| **Black Market Caravan** ✅ | Shop prices halved at this year's tribute (rounded, at least 1) | +1 card in every hand this year |
| **Tax the Settlements** ✅ | Tax them: +2 oil per settlement each season, and −1 worker slot per settlement (people flee the work). Only drawn with a settlement. | Spare them: nothing changes |

## Escalation

These events keep coming back, harder each time.

- **The Overlord's Patience:** each year without a missed tribute, the chance of a pressure event rises.

## How events are drawn

- **Year 1:** no event, so new players learn the basics first.
- **Year 2 onward:** draw from a mix weighted by how you're doing. Struggling players get more good fortune and choice events; players doing very well get more pressure and disasters.
- **Warning:** none. Events are a surprise.
- **Display:** shown as a card when the year starts, with a "Year event" line in the top bar for the rest of the year.

## Implementation notes

- **Data:** `src/events.js`. Each event: `{ name, kind, weight, scale?, text(p, e, info), mods, lines, replies | choices, when?(info), apply?(ctx) }`. `mods` may be a function of this year's strength `p`.
- **Live values:** `turn.event` keeps the key and choice; its `mods` and `summary` are getters, so the Scaling sliders apply straight away. The board counts in the text (camps, settlements, quota) are frozen when the event starts.
- **Economy mods** (read in `computeEconomy`): `farmPct`, `stationPct`, `capPct`, `foodUpkeepPct`, `drought`, `settlementOil`, `settlementSlots`.
- **Turn mods** (read in `main.js`): `yearLength`, `quotaMult` (applied once), `coinMult`, `shopMult` (copied to `turn.shopMult` at tribute), `extraWaste` and `handBonus` (`dealNewHand`).
- **One-off effects:** `apply(ctx)` with helpers `spawnRaider`, `clearAllCamps`, `prospect`, `earthquake`, `showOfForce`. Async follow-ups (the Show of Force missile) are returned by `applyYearEvent` and awaited by `startYearEvent`.
- **Ground-launched missiles:** a strike target may carry `from: { x, z }`; `missiles.js` then lobs it from that cell instead of from the Overlord's side of the world.
- **Debug:** `tileIsland.debugEvent.force = 'drought'` then press V (or call `tileIsland.debugEvent()`) to play a given event.
