# Year Events

## Status

A core set of 7 is implemented in `src/events.js`: **Early Collection, Tithe of Men, Famine, Bumper Harvest, Oil Boom, Refugees at the Gate, Overlord's Offer**. The rest of this file is the backlog.

Decisions: core set first; choice events included; no advance warning (events are a surprise); year 1 is event-free.

At the start of every year (after the shop closes, before the first hand is dealt), one event is drawn and shown as a card. It lasts until the next tribute. All numbers are placeholders.

Every event uses systems the game already has: worker slots, the food store, raiders, ruins, the quota, rerolls, the shop and the Overlord.

## Pressure: the Overlord pushes harder

| Event | Effect |
| --- | --- |
| **Early Collection** | Tribute is due after Autumn: 3 seasons instead of 4. |
| **Overlord's Inspection** | The quota is 25% higher, but meeting it gives double shop coins. |
| **Tithe of Men** | −3 worker slots for the whole year. The Overlord has drafted your workers. |
| **Requisition** | At the start of each season, the Overlord takes 3 oil from your stockpile. |
| **Show of Force** | A Toxic Crater lands on a random tile right away. |
| **Martial Law** | Rerolls are disabled for the year. |

## Disasters

| Event | Effect |
| --- | --- |
| **Famine** | Farms produce half food this year. |
| **Drought** | Pumps and Oases give no bonus this year. |
| ~~**Great Raid**~~ | Removed: too punishing with no counterplay. |
| **Dust Storm** | Every hand this year has one extra Wasteland. |
| **Plague** | Lose 2 population, and settlements eat 1 extra food. |
| **Pipeline Fire** | Each refinery link counts for half this year. |
| **Earthquake** | 3 random empty cells next to your land turn into Cliffs. |

## Good fortune

| Event | Effect |
| --- | --- |
| **Bumper Harvest** | Farms produce +50% food this year. |
| **Oil Boom** | Stations give +1 oil each. |
| **Lenient Overlord** | The quota is 20% lower, but next year's jump is bigger. |
| **Refugee Wave** | +3 worker slots for the year, and +2 food upkeep. |
| **Salvage Season** | Clearing ruins this year also gives +1 worker slot permanently. |
| **Grace Period** | The tribute deadline moves to 5 seasons: you get an extra "Late Winter". |
| **Free Hands** | The first 3 rerolls this year are free. |

## Choice events: pick one of two

| Event | Option A | Option B |
| --- | --- | --- |
| **Refugees at the Gate** | Take them in: +3 worker slots, −3 food per season | Turn them away: a raider camp spawns |
| **Overlord's Offer** | Quota −30% this year | Quota +30%, but double shop coins |
| **Mercenaries** | Pay 10 oil: all raider camps leave | Refuse them |
| **Prospectors** | Reveal the "?" site closest to your land | +5 oil now |
| **Black Market Caravan** | Shop prices halved this year | +1 extra card in every hand this year |
| **Tax the Settlements** | +2 oil per settlement each season | Each settlement drains 1 worker slot this year |

## Escalation

These events keep coming back, harder each time.

- **The Overlord's Patience:** each year without a missed tribute, the chance of a pressure event rises.

## How events are drawn

- **Year 1:** no event, so new players learn the basics first.
- **Year 2 onward:** draw from a mix weighted by how you're doing. Struggling players get more good fortune and choice events; players doing very well get more pressure and disasters.
- **Warning:** none. Events are a surprise.
- **Display:** shown as a card when the year starts, with a "Year event" line in the top bar for the rest of the year.

## Implementation notes

- **Data:** define events in a new `src/events.js`, alongside `TERRAINS` and `ACTIONS`: `{ key, name, kind: 'pressure' | 'disaster' | 'fortune' | 'choice', weight, text, apply(turn, grid), modifiers }`.
- **Modifiers:** most events are just numbers the economy reads. Store them on `turn.event`, e.g. `{ farmMult: 0.5 }`, `{ capDelta: -3 }`, `{ seasonsInYear: 3 }`, and pass them into `computeEconomy` through `state`.
- **One-off effects:** Show of Force, Earthquake and Plague run once in `apply` when the year starts. Show of Force reuses `nukeRandomTile()`.
- **Season length:** Early Collection and Grace Period need the hard-coded `turn.season === 3` checks in `main.js` replaced by a `yearLength()` helper.
- **Hand effects:** Dust Storm and Black Market Caravan hook into `dealNewHand()`. Martial Law and Free Hands change `rerollCost()`.
- **Choice events** need a two-button modal, styled like the shop overlay.
- **Draw point:** draw in `settleTurn` when `turn.season` wraps to 0, and show the card after `openShop()` closes, before `dealNewHand()`.
