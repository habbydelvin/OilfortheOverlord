# Oil for the Overlord: art-led, wordless onboarding review

Research date: 4 November 2026.

## Main recommendation

**Make the first playable lesson a short, readable production loop: place a farm, place an oil station, advance the season, and watch the city produce. Then let the player repeat it with less help.** Introduce exploration, additional workers, markets and warfare at the moment they become useful.

The project already has useful visual teaching machinery. The largest opportunity is to connect actions to consequences, reduce simultaneous information, and verify learning through subsequent play.

## Evidence and project context

This review uses the working-tree implementation, the project proposal and visual/combat/globe plans, the supplied 27 October card sheet, direct GitHub source inspection, GitHub issue reports, and original X posts. The code is the authority where older documents disagree. Design judgments below are hypotheses to validate with new players; source examples are not proof of improved retention for this game.

### Browser walkthrough

A fresh, isolated Chromium session at 1280×800 completed the guided Spring through actual keyboard selection, pointer placement, wheel zoom, rival navigation, missile drag/aim, next turn and return home. The natural introduction was inspected, then the guide was restarted with `intro: false` to exercise its steps. Automation used internal state to identify the intended actions, so this verifies functionality, not novice comprehension.

Observed results:

- The guide completed and the next hand was dealt, with **4 oil**, **4 food in store**, **−1 seasonal food balance**, and **4 free workers out of 6**. No JavaScript page errors were recorded in this walkthrough.
- A text-based First Strike/Field Report interrupted the military portion of the guide.
- The Black Market hint appeared immediately after the first settled season, while the food deficit remained.
- At a 390×844 viewport, the resource sidebar remained **300px wide** and the board/hand area was **90px wide**; controls and cards overlapped heavily. This was a layout probe, not a touch-device usability test.
- Current cards already use detailed building snapshots, much stronger visual identification than the older supplied card sheet. Their metal frames, small footprint panels and rule regions still compete for space.

Focused browser probes also confirmed three implementation findings below: selecting the unrestricted Settlement hides the guide hand and leaves no coach cell marks; merely validating a disallowed preview resets the hand loop and sets its flash; displaying then dismissing the rotation hint leaves `rotate` persisted as seen despite no rotation. These probes deliberately arranged state to isolate the behaviours and were separate from the end-to-end walkthrough.

Screenshots and diagnostic observations are stored locally in `/tmp/opencode/oto-tutorial-research/`. The fresh profile used the project's default Chinese locale; several glyphs rendered as boxes/decorative fallback glyphs in this headless environment. That font result should be checked on target browsers rather than treated as an intentional wordless design.

Do not use this automation's wall-clock time as a player benchmark: it ran with software rendering and screenshot capture. Timed tutorial updates are capped to 0.1 seconds/frame (`tutorial.js:516`), and main-loop animation time is capped to 0.05 seconds/frame (`main.js:5356`), so low frame rates can stretch the apparent duration.

### What the current game actually asks players to understand

- A Three.js/Vite dieselpunk tile-placement strategy game, with a hex board and six neighbouring cells.
- Buildings are single-hex cards; Wasteland alone uses multi-hex shapes. Rotation advances in 60-degree increments. See `src/pieces.js:7–8, 92–104` and `src/grid.js:11–19`.
- The opening hand has a Farm, Settlement, Oil Station and two randomly shaped Wasteland cards, shuffled into random order. See `src/main.js:432–449, 5108–5111`.
- The Capital provides four worker slots and consumes three food. A Settlement provides two slots and consumes two food. Farms and stations each need one worker. Capacity is assigned in placement order; it is not currency spent once. See `src/tiles.js:28–81` and `src/economy.js:115–125`.
- Farms produce food; stations produce oil. A Capital doubles adjacent farms and stations. A staffed Refinery produces additional oil based on neighbouring staffed stations. See `src/economy.js:147–219`.
- Food has both a seasonal balance and a store. A shortage first consumes the store, then reduces oil output. Empty stores with a non-positive balance can spawn rebels at season settlement. See `src/economy.js:229–244` and `src/main.js:2274, 2523–2541`.
- The first oil quota is **26**. The year ends after Winter **or early when settlement meets the quota**. The Overlord takes the stockpile, and future quotas rise. See `src/economy.js:366–386` and `src/main.js:2473–2484, 2556–2581`.
- Mystery discoveries, purchases/unlocks, two markets, rival cities, missile production/aiming, and attack resolution add further systems.
- The implemented victory checks whether all rivals are eliminated (`src/main.js:4621–4624, 4683–4689`). Oil production is the foundational opening lesson; the broader conquest goal needs its own clear visual introduction when warfare becomes relevant.

The opening needs to establish three questions visually: **What can I do? What changes when I do it? What am I trying to achieve?**

### Older references that could mislead a redesign

| Reference | Difference from the current implementation |
| --- | --- |
| `proposal.md` | Describes square/Tetris-style placement, a three-card hand, a quota of 20 and several older economy rules. |
| Supplied `tile-cards.jpg` | Shows square footprints, an older Refinery multiplier and an older build-on-Ruins rule. Current Ruins are cleared from beside them and refill the hand. |
| Supplied card art | Uses small coloured block symbols. The current runtime already has model-rendered card pictures: `src/tiles.js:666–678`. Build on those assets. |
| Comments in `index.html`, `ui.css`, `theme.css` | Still refer to a Year 0 tutorial/advisor bubble. The current tutorial guides Year 1 Spring with a ghost hand. |
| Some combat documentation/comments | Say scoring precedes combat. Current `endTurn()` runs combat before the production payout: `src/main.js:2054–2069`. |
| Capital card rule | Says “Adjacent buildings trigger twice,” while the economy explicitly applies the double trigger to farms and stations. Confirm the intended rule before illustrating a universal building bonus. |

## How the tutorial currently works

### Entry and persistence

`src/tutorial.js` owns a step-based guide and one-time hints. `src/main.js` supplies game state through an API, gates input with `allows()`/`placeGuard()`, sends notifications, and updates the tutorial each frame.

- First visit, or a replay, starts the tutorial using `oto.tutorialDone.v3`.
- The Overlord's multi-line introduction and three-answer dialogue happen first (`src/main.js:5283–5330`).
- Skip ends guidance and continues the current Spring (`src/main.js:5125–5129`).
- Replay starts a new run (`src/main.js:4996–5005`).
- Hint IDs are stored separately in `oto.hintsSeen.v1`.

### Guided Spring, in actual order

`src/tutorial.js:55–78` defines 20 non-terminal states and an end state:

1. Spotlight tribute for 2.6 seconds.
2. Highlight the Capital's free neighbours for 2.8 seconds.
3. Place Farm beside Capital; show “×2”.
4. Place Oil Station beside Capital; show “×2”.
5. Place Settlement.
6. Spotlight workers for 2 seconds.
7. Spotlight food for 2.2 seconds, red if the balance is negative.
8. Focus a nearby mystery site for 3.4 seconds, when available.
9. Place one Wasteland piece toward it.
10. Place another Wasteland piece.
11. Grant a missile and spotlight its HUD row for 2.2 seconds.
12. Zoom past the board limit to the globe.
13. Visit a rival.
14. Spotlight the rival bar for 2.2 seconds.
15. Aim a missile using a card.
16. End turn in the rival city.
17. Wait for the attack to finish.
18. Return to the War Map.
19. Return home.
20. End turn at home if it was not already ended away.

The seven timed steps total **17.4 seconds of tutorial update time**, excluding introduction, actions, transitions and combat. The first placement is blocked behind the first **5.4 seconds** after the introduction. These are authored timings, not measured human completion times.

The first payout deliberately waits for the return home (`src/main.js:2062–2069`). That ensures it is visible, but puts a long, unrelated sequence between building and seeing production.

### Later hints

Eleven contextual hints cover rotation, mysteries, food, reroll, globe zoom, missiles, aiming, salvo, market entry, the Black Market tour and next turn (`src/tutorial.js:767–870`). Most run for roughly 2.6–9 seconds. The market tour has a 90-second budget and reacts to shopping state.

The game pauses guide/hint updates during several blocking screens and hides its guide hand during active missile dragging. Those are useful behaviours to retain.

## What is already strong

1. **A real game opening.** Actions construct the player's actual city; skipping continues that city.
2. **Visual correspondence.** The ghost hand carries the card's own picture, and placement previews use the tile models.
3. **Context-sensitive placement.** `#pathPlan()` searches actual legal Wasteland placements, instead of relying entirely on hard-coded coordinates.
4. **A promising output animation.** Tiles hop, Capital-adjacent producers trigger twice, and oil flies into the quota gauge. See `src/payout.js`, `src/main.js:2166–2234`, and `src/barrelGauge.js`.
5. **Persistent world feedback.** Boost hints, neon links and idle shading continue outside onboarding.
6. **A strong thematic vocabulary.** Riveted metal, a gloved hand, machinery, barrels, the Overlord portrait and the illustrated season clock already belong to this world.
7. **Some recovery paths.** Missing cards/sites and an early return from the rival trip can skip inapplicable guide steps.

## Prioritized findings

P0 = first-pass clarity work. P1 = next iteration. P2 = refinement/robustness.

### P0 — teach a shorter, causally readable opening

| Finding and evidence | Why it matters | Recommended change |
| --- | --- | --- |
| **Combat precedes the first production reward.** `tutorial.js:66–75`; `main.js:2062–2069`. | The player has to remember why they placed buildings while learning a second mode, zoom gesture, targeting and return navigation. | Complete a home-board production cycle first. Trigger the military lesson when a missile is available after the core loop is understood. |
| **The wordless guide starts after substantial dialogue.** `main.js:5291–5323`. | The first-visit experience still depends on reading and choosing a text answer. | Use a short visual commission: Overlord portrait, empty oil receiver, winter/collection emblem, city. Let the first card become usable promptly. |
| **The first missile triggers another text tutorial inside the guide.** `main.js:4589–4590,4628–4671`. | The launch demonstration pauses for three Field Report lines, including an instruction to visit the rival city even when the player is already there. | Make the first-strike introduction context-aware and visual: launch → flight timer/arc → impact. Coordinate it with the tutorial lesson rather than stacking a second teaching system over it. |
| **The guide demands premature housing.** `tutorial.js:58–62`; `tiles.js:28–81`. | Before discoveries/modifiers, Farm + Station use only 2 of the Capital's 4 workers. Farm food is 4 against 3 upkeep: +1. Adding the required Settlement changes upkeep to 5: −1 food, while increasing already-spare workers to 4 of 6. It creates a problem without a clear need or repair lesson. | Move Settlement teaching to the first genuine staffing need. Show its food trade-off before placement and pair the lesson with an available food solution. |
| **Spotlights identify locations without teaching relationships.** `tutorial.js:56,61–62`. | A glowing ratio does not explain free/total workers, seasonal food balance or stored oil. | Animate the exact change beside the action: worker silhouette occupies a persistent slot; crop output satisfies food demand; oil moves to the quota tank on settlement. |
| **No independent repetition verifies understanding.** The guided placement stages advance after a permitted placement. | Following the hand does not establish that the player can choose a productive location or predict its effect. | After one demonstration, offer a simple second placement with multiple legal positions and retire guidance only after a successful unprompted use of the rule. |
| **Hints are persisted as seen when displayed.** `tutorial.js:592–600`. | A player may miss a 4-second cue forever. Deselecting a card or changing screens can end a hint without completing its action. | Store exposure, completion and dismissal separately. Complete from semantic events/outcomes; re-offer incomplete hints after a cooldown when relevant. |

The default five-food reserve means the required Settlement does **not** immediately starve the city. The concern is the lesson it teaches and the unresolved deficit it leaves, rather than an immediate-loss claim.

### P0/P1 — make the visual signals truthful and actionable

| Finding and evidence | Why it matters | Recommended change |
| --- | --- | --- |
| **Gold guide cells, green valid footprints and coloured boost glows can overlap.** `tutorial.js:163–169,623–626`; `placement.js:11–12`; `boostHints.js`; `neonGlow.js`. | “Allowed”, “recommended” and “boosted” can look like competing versions of the same instruction. | Define distinct shapes: dotted footprint = suggestion, solid outline = legal placement, connected resource icon = production relationship, hatched crossed footprint = invalid. Keep colour as reinforcement. |
| **Selection can remove the Settlement cue entirely.** `tutorial.js:553–562`: a held piece only receives a tap cue if `this.cells` exists. | Settlement has unrestricted cells. Click-to-select can leave no explicit destination guidance. | Keep one valid ghost destination available until a placement succeeds or the player clearly starts their own placement. Apply to unrestricted Wasteland too. |
| **Wrong actions receive a generic nudge.** `tutorial.js:237–242,267–276`; `placement.js:214–232`. | The same shake can mean wrong card, tutorial restriction, occupied hex or disconnected land. | Respond at the cause: bring forward the intended card; outline the blocking tile; show a broken connection for disconnected land; demonstrate rotation for an orientation problem. |
| **Preview validation itself calls `nudge()`.** `placement.js:261` → `tutorial.js:placeGuard()`. | Moving over disallowed cells can restart the hand loop and flash targets, even before an attempted drop. | Keep preview validation free of feedback side effects. Use quiet footprint feedback on hover and an explicit error cue on an actual rejected action. |
| **The rotate animation turns 90 degrees; pieces rotate 60 degrees.** `ui.css:2458–2465`; `pieces.js:7–8`. | The instructional motion contradicts the hex interaction. | Animate a six-position dial/hex footprint through the same angle as the piece. |
| **Food warning timing does not match all rebel conditions.** Hint: `tutorial.js:795`, shortage strictly below zero. Rule: `main.js:2274`, non-positive balance and empty resulting store. | Exactly consuming the last stored food, or having zero balance with empty stores, can trigger rebels without this hint. | Derive the cue from the same projected consequence as settlement. Show the empty store and threatened worker silhouette, with an actionable Farm/boost option. |
| **The first choice is gated but other cards still look usable.** `tutorial.js:224–235`; `hand.js:284–309`. | Players discover the restrictions through failure clicks. | Stage one salient card at a time or visually park unavailable cards. Let normal legal choices return as soon as the lesson allows them. |

### P1 — improve pacing, controls and strategic understanding

| Finding and evidence | Why it matters | Recommended change |
| --- | --- | --- |
| **Opening order, Wasteland shape/rotation, site position and discovery outcome vary.** `main.js:5108–5111`; `hand.js:152–168`; `mystery.js:199–233`. | Different players face different first lessons, sometimes including unfamiliar extra Capitals/Refineries. `spare()` only excludes missiles. | Author a deterministic opening layout/hand and a controlled beneficial first discovery. Use random content after the first learned loop. |
| **Wasteland can communicate the wrong strategic value.** The guide uses it to reach a mystery; current rules make it unbuildable and potentially a bandit cluster. | It can look like useful foundation land, or suggest that mystery routes are its only purpose. | Illustrate it as permanent rocky obstruction/expansion material. Show the multi-hex footprint, its required-play status, and the unavailable build surface. Explain clustering risk later at the first relevant near-cluster. |
| **No dedicated `siteRevealed` learning condition.** `tutorial.js:64–65,261`. | Two successful Wasteland placements can finish the exploration portion without verifying the intended discovery result. | Complete exploration on a revealed site and its visible consequence, not the number of cards played. Use a guaranteed reachable first site. |
| **The “×2” popup lacks an explicit source.** `tutorial.js:58–59,480–487`. | Players can see that a bonus occurred without learning that the Capital and shared hex edge caused it. | Briefly connect Capital → producer, then show two separated output beats. Use hollow forecast tokens during placement and solid tokens only on actual payout. |
| **All boost glows imply similar effects.** Station glow includes Capital, Tar Pit and Refinery; the economy treats these differently. | A Refinery adds its own oil; it does not simply increase a Station's own output. Repeated same-type pumps/capitals also do not stack like distinct bonuses. | Drive visual links from actual economy contributions. Show Station → Refinery → additional oil, and do not increase a promised reward merely because another non-stacking booster is present. |
| **Reroll advice is based on lacking a Station.** `tutorial.js:798–805`. | It may encourage spending tribute oil when food or housing is the actual need. | Show reroll when the player is stalled or seeks a different hand, with a ghost oil deduction and the next hand silhouette. Make the increasing cost and retained pinned cards visually legible. |
| **Next-turn hint requires an empty hand.** `tutorial.js:865–868`; actual gate only checks placeable Wasteland in `main.js:2046–2050`. | Players can think every ordinary card must be played, even when they should stop building. | Cue the turn lever when required Wasteland is cleared and the player is idle. Show which optional cards will be discarded when ending the turn. |
| **Every tap demonstration contains two presses.** `tutorial.js:716–724`. | It can suggest double-clicking; clicking again during payout fast-forwards the result (`main.js:2037–2042,3748–3750`). | Use one press for a single-click action. Keep select-then-place and drag-release demonstrations distinct. |
| **Touch controls do not match desktop hints.** `tutorial.js:109–124`; `controls.js:124–184`; `main.js:3628–3651`. | A touch player is shown an R key/right mouse button and wheel. The inspected camera code has no pinch handler and the coach icons are not rotate/zoom buttons. | Add usable rotate and globe controls with icon affordances. Choose demonstrations by actual input modality; a pinch animation requires working pinch input. |
| **The fixed sidebar overwhelms narrow viewports.** Browser probe: 300px sidebar inside a 390px viewport; `ui.css:13,226,1052–1055`. | The world and card hand are compressed into 90px; a clear hand animation cannot repair inaccessible layout. | For supported small screens, use a compact resource strip, collapsible inspection and a usable card tray with reachable rotate/confirm/home controls. Treat this as P0 if phone play is a release target. |
| **HUD quantities have different semantics.** `main.js:1782–1821`. | Food is a net rate; workers are free/total capacity; oil is stored amount plus projected yield; missiles are inventory/capacity. A generic resource spotlight hides those distinctions. | Establish recurring visual containers: tank = stock, slot rack = capacity, small season-clock marker = per-season flow. |
| **Tribute can arrive earlier than the Winter imagery suggests.** `main.js:2473–2484`; `seasonClock.js:99–101`. | Players expecting four guaranteed build phases can be surprised by an early year end. | Show quota-full → collection, as well as winter → deadline. Demonstrate early collection when it first occurs. |
| **The gauge's barrels are not necessarily single units.** `barrelGauge.js:8,51–55`. The initial quota of 26 becomes 13 gauge barrels. | A numberless design cannot assume that counting illustrated barrels yields the exact quota. | Use the gauge as a continuous fill-to-mark goal, or make segment units explicit if quantities are shown. Do not invent one-icon/one-unit teaching that disagrees with the renderer. |
| **Black Market guidance picks the first affordable aisle/card.** Military is considered before resource (`tutorial.js:855–860`). | The guide can appear to recommend a strategically poor purchase; affordability is not usefulness. | Teach opening, inspection, price and exchange. Let the player choose, or author one clearly relevant introductory offer. Show oil leaving the same stockpile that tribute uses. |
| **A discovery can reveal Ruins that cannot yet be acted on.** `mystery.js:5–12`; `main.js:1214–1220` disables clearing during the tutorial. | The player is led toward a reward, but the new object may require an adjacent building and a later interaction before it does anything. | Choose an immediately legible first discovery, or add a short contextual clearing lesson when its real prerequisites are met. |

### P2 — reduce dependence on transient cues

- **Replay without restarting the city.** Current replay calls `resetIsland()`. Provide an icon-indexed collection of short mechanical demonstrations, with replay confined to the lesson animation.
- **Reveal one HUD instrument when it becomes relevant.** Keep its eventual layout stable; avoid sliding existing controls to new positions as sections appear.
- **Keep tutorial targets visible.** `#screen()` projects coordinates without a safe-viewport/occlusion check; `#hudRect()` only checks rectangle size. Account for HUD, cards, the Capital silhouette, camera rotation and narrow windows; provide a recenter icon.
- **Respect reduced motion in the coach itself.** Existing card motion has a preference check and CRT CSS has a reduced-motion branch; the ghost hand and coach animations do not. A static sequence of footprint/arrow/result frames can retain the lesson.
- **Pause lesson timing when its target is obscured.** Dialogue/payout handling already exists. Extend target visibility checks to other panels and document visibility instead of consuming hint time invisibly.
- **Keep informational timings usable at low frame rates.** Tutorial timing is accumulated from a capped frame delta. Separate active-visible dwell time from capped animation time, and verify that slow rendering does not turn brief spotlights into long input locks.
- **Reset run-scoped tutorial state coherently.** `start()`/`stop()` do not reset all of `sawPlanet`, `played`, `idle`, `check`, `unseen`, and `inRival`. These can affect hints after a same-session replay.
- **Give skip and repeat distinct visual meanings.** The fast-forward icon should not resemble the turn/payout action. Retain accessible names without visible instructional prose.
- **Use consistent event names.** `notify('aimed')` does not match a step waiting for `'aim'`; the state check in `#away()` currently advances it. Consolidate the semantic event so behaviour is easier to reason about.

## Proposed wordless storyboard

### First Spring: one production loop

Aim for a first usable action within a few seconds and a first payout within roughly 60–90 seconds in novice playtests. These are initial design targets, not measured benchmarks.

| Beat | What the player sees | What they do | What teaches the rule |
| --- | --- | --- | --- |
| 1. Commission | Overlord portrait glances toward an empty industrial oil receiver with a clear fill mark. A small collection/winter emblem establishes the deadline. | Begin interacting immediately after the brief visual beat. | Oil is the goal; the city serves a demand. |
| 2. Farm | One large Farm card rises. A matching translucent model sits on a free hex touching the Capital. A dotted shared edge shows attachment. | Drag and release, or select then click. | Card becomes building; it must touch existing land. |
| 3. Consequence preview | One worker slot fills. A Capital-to-Farm connection gives two hollow crop-output pulses; food demand silhouettes become covered. | Observe while retaining camera/selection control. | Workers enable production; the Capital doubles this producer; forecast is not already-earned food. |
| 4. Oil Station | The Station card becomes salient. All valid Capital-adjacent choices are readable; one is suggested. | Place the Station. | The player reuses the placement rule; a second worker slot fills; forecast oil is shown. |
| 5. Wasteland | Two simple, authored pieces appear, or are unparked from the existing hand. Their whole footprints are visible on an outer route. | Place both; one deliberately requires a 60-degree rotation. | Required junk must be fitted without consuming valuable inner production space. |
| 6. Advance | A mechanical season lever becomes available; any remaining mandatory-card silhouettes would visibly block its latch. | Pull/tap once. | Building ends when the player advances the season. |
| 7. Actual production | Farm produces food, consumption/store are resolved, Station emits two separated batches, oil reaches the gauge. The clock advances. | Watch or replay the short demonstration. | Construction → season → output → progress toward tribute. |
| 8. Independent application | A second simple Farm or Station is dealt with multiple legal locations. The hand stays absent initially. | Choose a location and play it. | Confirm whether the player can transfer the rule, then fade remaining assistance. |

This storyboard changes the tutorial opening deal: delay the Settlement and avoid forcing an unexplained extra card. If all five existing cards must remain visible for presentation, park later-lesson cards visibly and define when they become playable; do not leave an invisible gate on an apparently active card.

If an exploration reveal remains in this opening, make it a predictable, nearby outcome that supports the production lesson. The simplest first pass can move discovery to the following season.

### Later contextual lessons

| Trigger | One concept | Visual treatment |
| --- | --- | --- |
| Worker capacity is about to be exceeded | Housing enables additional staffed buildings, at a food cost | Worker rack fills; new building has an empty socket; Settlement preview adds slots and food-demand icons. |
| First reachable mystery | Side adjacency uncovers it | A short dotted path reaches beside a fog silhouette; the shared boundary dissolves the cover. |
| First Pump/Tar Pit/Refinery | Specific adjacency benefit | Two-model micro-diorama with a shared hex edge and the real direction of resource flow. |
| Forecast store exhaustion | Shortfall, buffer and recovery | Food tank drops to a ghost future level; available Farm/boost solution becomes salient. |
| First affordable market visit | Exchanging oil for a card | Gauge/tank loses ghost oil on inspection; accepting a purchase transfers solid oil and the card. |
| First usable missile after core competence | Navigate, aim, launch, return | Stable globe/home icons; card → target reticle → season lever → launch → visible result. |
| First tribute | Collection and reset | Oil transfers to the Overlord's receiver; the target changes; the new-year dial opens. |
| First optional unused cards at turn end | You may stop building | Mandatory-card rack is empty, ordinary cards show a discard preview, turn lever is ready. |

## Art direction: make mechanics readable in the game's own style

### A compact visual vocabulary

Use the existing metal-and-machinery language. Avoid adding a new symbol for every sentence.

| Meaning | Visual form |
| --- | --- |
| Suggested placement | Dotted hex footprint with a translucent copy of the actual building |
| Legal placement | Stable solid footprint/shared-edge connector |
| Impossible placement | Hatched footprint, crossed obstructed cell, restrained recoil |
| Forecast | Hollow/translucent resource tokens and tank fill |
| Real production/payment | Solid tokens that travel and settle |
| Worker capacity | A rack of worker-shaped slots; occupied slots remain occupied |
| Starved/unstaffed machine | Distinct missing-food or empty-worker badge plus stopped mechanical motion |
| Adjacency | A short line across the shared hex edge, ending in the relevant resource symbol |
| Turn completion | A mechanical latch/lever advancing the illustrated season dial |
| Lesson complete | One brief stamped check/settled connection; stop pulsing that target |

Keep instructional overlays crisp against the CRT effects. Let muted environmental motion continue, but reduce competing high-contrast pulses while the player is learning one action. Sound should reinforce an already readable visual event.

Worker capacity and food support are global economy rules. Illustrative worker/resource flights must not accidentally imply that road paths, travel distance or housing adjacency are required.

### Applying this to the supplied card sheet and current cards

1. **Make building identity the largest element.** Reuse the current model snapshots and distinct silhouettes: Farm domes, Station pump, Settlement dwellings, Capital spire, Refinery tanks. The old coloured-square presentation cannot carry a wordless lesson.
2. **Keep input and output distinct.** A worker slot required to operate is different from food consumed every season and oil paid immediately. The generic cost badge groups these (`src/hand.js:12–33`): blue in the old sheet, a metal dial in current cards. Use a slot/socket visual for capacity and a clock-tagged arrow for recurring consumption.
3. **Teach timing graphically.** A small season-dial emblem can mark recurring output. A persistent connection can represent passive adjacency. A card-to-target burst can represent an on-play effect. Establish each in play before relying on its icon.
4. **Draw adjacency on hexes.** Show two relevant miniatures sharing an edge; avoid the obsolete square or 3×3 illustrations in the reference sheet.
5. **Use contrast on dark cards.** Station and Tar Pit need recognizable forms and clean negative space; dark colour alone is not a sufficient identifier.
6. **Give Wasteland an unmistakable whole-piece footprint.** All four cosmetic variants can share the same rule presentation. Mark its mandatory-play nature and blocked build surface separately from its shape.
7. **Use contextual animated inspection.** An unfamiliar card can show a short before/after diorama, using the actual board if possible, rather than shrinking a rule paragraph into many unfamiliar pictograms.
8. **Derive diagrams from rules.** Refinery, Ruins, Spark ranges and the Capital bonus have changed. Generate footprints and output previews from the same state used for gameplay.
9. **Spend card space on the decision.** The current ornate frame is attractive, but should not outweigh building identity, footprint and consequence. Keep those three visible in the resting fan and on small supported layouts; use the raised/inspected card for secondary detail.

For the tutorial itself, essential learning should work with **no visible words**. Small amounts can be represented by repeated icons, and exact large quantities can use counters if desired. If the requirement also excludes numerals, present fill-to-mark gauges and grouped icons, and verify that decisions remain possible without counting dozens of tiny objects. Screen-reader labels can remain non-visible.

## Research findings: GitHub

### G1. shapez: check the functioning relationship

[Interactive tutorial source](https://github.com/tobspr-games/shapez.io/blob/8a79de5255fb6756f3a1d26579b1e9bc36e0c811/src/js/game/hud/parts/interactive_tutorial.js#L24-L57)

The extractor-to-hub step examines belt paths and the miner's ejector connection. It tests whether production is connected, rather than merely whether a conveyor was placed. The same file provides contextual world highlights and animated helper GIFs.

**Apply here:** complete “produce oil” after the intended staffed/boosted producer yields oil into the player's gauge; complete exploration on discovery; verify the learning outcome beyond a click.

**Boundary:** shapez also uses tutorial text. It is an implementation reference for outcome checks and visual demonstrations, not evidence that all its onboarding is wordless.

### G2. shapez: replay visual help without restarting

[Tutorial video hints](https://github.com/tobspr-games/shapez.io/blob/8a79de5255fb6756f3a1d26579b1e9bc36e0c811/src/js/game/hud/parts/tutorial_hints.js)

Contextual looping videos can be opened/closed, and the enlarged hint requests a gameplay pause.

**Apply here:** a small replayable animated diorama for placement, adjacency, staffing, shops and aiming. Recover a forgotten rule without destroying the current city.

### G3. Mindustry: separate visibility from completion

[HintsFragment.java](https://github.com/Anuken/Mindustry/blob/b873c01ed559a8803c2dad5c5c79d7ad750d5b95/core/src/mindustry/ui/fragments/HintsFragment.java)

Hints distinguish `show()`, `complete()`, `valid()`, `finish()` and `hide()`. Gameplay events record actions, desktop/mobile eligibility is explicit, and hiding a hint is different from completing it.

**Apply here:** split hint exposure from learned state, use input-specific visuals, and credit actions performed before a prompt appears.

**Boundary:** this is a text-based hint implementation. Its lifecycle is the useful transferable idea.

### G4. Sweaty Chair: modular gesture/animation tasks

[SC-Tutorial-Manager](https://github.com/Sweaty-Chair/SC-Tutorial-Manager/tree/842e94c7447224b290cf9fb123288e2456619505/Assets/SweatyChair/Tutorials/Scripts/Tasks)

The task catalog separates animated hands, drag, pinch, highlighting and event completion. `TutorialPinchTask` couples the depicted gesture to measured input, including configurable thresholds.

**Apply here:** keep reusable visual demonstrations separate from the condition proving the player completed the task. Adopt the structure within the existing JavaScript tutorial API.

### G5. Silent Teacher: inference and repeated application

[Original design explanation](https://silentteacher.toxicode.fr/about) · [Independent Elm implementation](https://github.com/Janiczek/silent-teacher/blob/d9dd50578a45215948099c011421cdbb670b0d8e/src/Main.elm)

The original explains that mistakes produce related questions, repeated mistakes lead to more reinforcement, numbers are kept simple, and positive feedback is stronger than error feedback. The Elm remake has explicit answer evaluation and advances on correct answers; it does not reproduce every adaptive feature described by the original.

**Apply here:** after a mistaken placement, offer another small use of the same rule. After success, test a slightly different layout. Do not treat one observed demonstration as mastery.

**Boundary:** arithmetic/code symbols require prior literacy of their own, and the remake includes progress/end-screen text. Neither is a ready-made visual strategy tutorial.

### G6. Roblox's published onboarding guidance

[Onboarding techniques, source on GitHub](https://github.com/Roblox/creator-docs/blob/main/content/en-us/production/game-design/onboarding-techniques.md)

Useful techniques include in-world visual cues, persistent guidance until the task is done, contextual tutorials, and hint delays tuned through observation. Its examples make room for players who act without help.

**Apply here:** one relevant cue at a time; begin with subtle world feedback, then show the glove only after hesitation or repeated errors. Treat example timing numbers as tunable hypotheses.

### G7. Failure evidence from issue trackers

- [shapez #1126: wires tutorial reappears when switches are off](https://github.com/tobspr-games/shapez.io/issues/1126), reported 26 March 2021. This illustrates the other side of adaptive guidance: current state alone can repeatedly reopen an already learned lesson. Retain durable mastery alongside contextual eligibility.
- [Mindustry #10023: player lost in map fog](https://github.com/Anuken/Mindustry/issues/10023), reported 12 July 2024. This is a navigation report, not a tutorial evaluation. It supports checking visible recenter/home recovery when allowing large camera movement.

These are individual historical user reports, not prevalence estimates or claims about current releases.

## Research findings: X

The following post text, authors and publication dates were checked against the original X pages. The media clips are useful references to view; no gameplay effectiveness is inferred from post engagement or attached-video existence.

| Source | Verified point | Application and qualification |
| --- | --- | --- |
| [Lone Piggy Games, 7 May 2026](https://x.com/LonePiggyGames/status/2052451147038720220), “Game onboarding doesn't have to suck” | Describes introducing systems one by one, animating relevant UI into view, integrating learning into play, and using contextual teaching where bespoke scenes are too expensive. | Strong fit for a shorter production opening followed by just-in-time military/market lessons. This is the author's design argument; the article's unmeasured “99%” rhetoric and willingness to abandon confused players should not be adopted as evidence. |
| [Nick Bentley, 25 July 2024](https://x.com/Nick__Bentley/status/1816552117542297871) | Recommends observed blind tests, including people who do not read rules, reducing clutter, and using illustrative/comic-like setup sequences. | Use a wordless action/result storyboard and test with no coaching. The post is about board-game rulebooks, so its transferable value is presentation/testing rather than a video-game implementation. |
| [Occulto / Sirio Art Games, 18 July 2026](https://x.com/SirioArtGames/status/2078360845109670234) | Describes a non-verbal game using visual storytelling, hand-drawn animation and comic-style thought bubbles. | A concrete art-direction reference for the Overlord's visual commission and a character's unmet need. Its promotional statement is not a usability study. |
| [Too Dark Studios, 23 March 2026](https://x.com/TooDarkStudios/status/2036140929648624037) | Posts “Interactive and intuitive tutorial > text-heavy tutorial,” with an attached clip. | A visual reference and developer opinion. The inspected post does not provide test results or a reusable state machine. |

### Supporting designer case study

[Stuart Burfield, Tutorial Design in Puzzledorf: Reflections](https://stuartspixelgames.com/2021/09/19/tutorial-design-in-puzzledorf-reflections/) describes constrained early puzzles, consistent positive feedback, and observation of both gamers and non-gamers. Its controls remain available as a reference. In a September 2024 reply, the author says some players still needed an additional, slower beginner progression.

**Implication:** a textless lesson still needs carefully staged difficulty and a recovery route. The right balance here is a short guided first action, a visible consequence, then increasing freedom with adaptive help.

## Implementation direction

Keep the existing `Tutorial`/game API boundary and evolve it into outcome-based lessons. A large tutorial framework is unnecessary for the proposed changes.

### Lesson state

Use named lessons such as `place.connected`, `capital.production`, `season.payout`, `workers.capacity`, `explore.reveal`, and `war.aim` instead of relying on one long positional sequence for everything.

Each lesson needs:

- **Eligibility:** Is the mechanic relevant and can the player act now?
- **Target:** Which visible card/building/UI control best demonstrates it?
- **Completion:** Which game event or verified outcome proves the action happened?
- **Assistance level:** Quiet affordance → ghost destination → gesture demonstration → replayable micro-diorama.
- **Persistence:** Exposed, action completed, independently repeated, or explicitly dismissed.
- **Recovery:** Re-target missing/off-screen elements; defer lessons whose required action is unavailable.

Useful events include `pieceSelected`, `pieceRotated`, `placementRejected(reason)`, `buildingPlaced`, `siteRevealed`, `productionPaid`, `seasonSettled`, `marketPurchased`, `missileAimed`, `missileResolved` and `returnedHome`. Include the terrain, cells and relevant result so completion can test the actual rule.

Separate preview evaluation from mutations. Preview animations must not spend resources, add buildings or mark mastery. Use `computeEconomy()` to derive forecast differences rather than maintaining a second set of tutorial economy numbers.

### Suggested order of work

1. Shorten Spring and move first payout before the military trip; stage the opening deal around the revised lesson.
2. Repair seen-vs-completed hint state, Settlement selected-state cue and hover-triggered nudges.
3. Make one Farm → food and one Station → oil demonstration fully readable; connect Capital adjacency to double output.
4. Add an independent second placement and tune assistance from observed errors/hesitation.
5. Unify footprint/connection/error visuals; use the actual 60-degree rotation; provide input-appropriate controls.
6. Add contextual staffing, discovery, market and military lessons, with replayable visual help.
7. Update old card/reference diagrams and rule descriptions to the live hex mechanics.

## How to verify that it became understandable

### Human playtest

Run an initial formative round with roughly 6–8 new players spanning strategy experience and low game familiarity. This is a practical iteration sample, not a statistically powered retention experiment.

Observe an ordinary first visit with no spoken instructions. After the opening, ask players to demonstrate or predict:

1. Place another productive building without the guide hand.
2. Choose between a boosted and an unboosted location.
3. Show how another building gets workers and what housing costs.
4. Identify the action that produces resources and advances time.
5. Indicate the oil goal and what happens when the quota fills or the deadline arrives.
6. Recover from an invalid placement and a changed camera position.

Repeat a short sample with sound off and visible instructional prose suppressed. On touch-capable targets, use an actual supported touch path. Evaluate reduced-motion and colour-independent versions of the essential cues.

### Instrument the uncertainty

Record lesson entry, first meaningful input, rejected action/reason, hint escalation, successful outcome, independent repetition, skip, and last completed lesson. Measure:

- Time to first placement and first payout.
- Number and kind of incorrect actions per lesson.
- Ability to repeat a mechanic after the hand disappears.
- Whether a highlighted resource change can be predicted correctly.
- Where players ask for help or leave.

First-pass acceptance goals can be: first productive placement within about 20 seconds after loading, first payout in roughly 60–90 seconds, and at least 80% of the small formative sample repeating the placement/production loop without help. These are proposed targets to revise after observing the baseline, not industry benchmarks.

### Focused functional checks after implementation

- Mouse drag-release and select-click both complete the same lesson.
- Rotating/cancelling/placing incorrectly leaves a recoverable state.
- A lesson may be exposed without being marked completed; a successful unprompted action is credited.
- Hints hidden by another screen resume when relevant.
- Wasteland with no valid placement does not block progression; a missing discovery target is handled.
- Leaving combat early, skipping at each lesson and replaying after visiting the globe do not strand payout or input gates.
- Narrow layouts, camera movement and reduced motion keep the intended target and control visible.
- Wordless forecasts and actual resource changes agree, including food-store exhaustion and early tribute.

**The decisive result is that a player can make the next useful decision after guidance disappears.**
