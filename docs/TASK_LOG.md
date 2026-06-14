# Task Log

## 2026-06-13

- Added job system + village kitchen with cooked meals.
- Added time-speed controls, marriage, and family-based births.
- Added click inspection, life stages with natural death, and stumps.
- Added church, morning worship, a growing plaza, and stump transplanting.
- Added wildlife with hunting, taming, and a livestock pasture.
- Improved mobile UX: camera pan/zoom, floating HUD, tabbed panel.
- Added the industrial era (power, factory, rail/train); throttled UI updates.
- Added land-pressure housing density and infrastructure decay.
- Brought the docs in line with the code (eras 0–4 shipped); marked DESIGN.md
  milestone status and recorded the remaining backlog.
- Replaced the scripted decision ladder with a needs-driven utility arbiter:
  six soft needs (social, purpose, faith, leisure + hunger, energy) that drain
  by personality and refill through activity; inspector need bars + motivation;
  needs persisted (save v10).
- Spatial-efficiency growth, Phase A: buildings gained a `level`; houses
  redevelop in place (cottage→villa→apartment→tower) when housing headroom is
  low, driven by crowding rather than distant empty land; builders perform the
  rebuild as work; tower visual + inspector tier/level. Capacity redefined as
  residents.
- Settled the scale direction (attachment-first; city-at-scale is a later LOD
  tier) and shipped the organic-growth population engine (Increment 1): removed
  the flat population cap; births now require supported population (housing ∩
  per-era ceiling), housing headroom, and high mean wellbeing. HUD shows
  population / supported. Verified the housing/era → population loop in-browser.
- Spread-out city, Slice 1: added the cemetery — a nuisance building sited on
  the outskirts once residents die, with homes avoiding its radius so the town
  spreads away from it; steepened redevelopment cost by tier so stacking is no
  longer the cheap default; cut road decay so infrastructure persists. Verified
  in-browser (cemetery sited apart, no homes in its shadow, costs escalate).
- Density-needs loop (comfort + parks): added a 7th need, comfort, that drains
  faster when homes are crowded and refills at a park; builders lay out parks
  near housing when the town feels cramped (one per ~10 residents). Closes the
  population→density→amenity→space loop. Verified in-browser (comfort crashed to
  28 as the town packed in, parks were built, comfort recovered).
- Ambiance zoning: a blurred ambiance grid (amenities positive, nuisances like
  power plants / fields / stumps / cemeteries negative) now drives comfort, home
  siting (seek pleasant), and field siting (seek low-ambiance, so fields cluster
  away from homes). The town zones itself. Verified: avg house ambiance +26 vs
  field −9.9, fields contiguous (2.67/4 neighbours). Inspector shows surroundings.
- Workplace relocation: new power plants/factories site away from homes and new
  fields keep a 4-tile buffer from housing; existing misplaced work moves out
  over time — crowded-in field tiles are cleared (re-sown further out) and a
  power plant/factory within 6 tiles of homes is decommissioned and rebuilt on
  the outskirts. Verified (8 injected near-home fields cleared to 0; a forced
  near-home power plant was relocated outward).
- Roads as a movement driver: built houses are now solid except their door tile
  (WorldMap tracks door tiles; residents enter only through the doorway), and
  off-road travel is much slower (grass 1→2, roads ~3× faster). Foot traffic
  concentrates and wears desire paths into a growing road network. Verified
  (door cost 1.2 vs impassable interior; road tiles grew 17→63 by 40 residents,
  no deadlock).
- Hygiene loop (litter + cleaner): busy activity drops litter (scaling with
  population), which is negative ambiance until collected; a littered town takes
  on cleaners (1–2 by litter level) who walk to and clear the nearest litter.
  Reworked assignJobs to allocate roles by priority within the adult workforce,
  so cleaning preempts hunting/building when workers are scarce — the cost of the
  need. HUD shows litter. Verified (litter 16→6 under cleaners; cleaners scale
  0↔2 with litter).
- Safety loop (unrest + police): crowding and discontent build unrest (an eased
  meter, no runaway); a restless town builds a police station (amenity) and takes
  on police officers, who patrol and break up quarrels — unpoliced quarrels dent
  comfort instead. HUD shows unrest. While integrating it, found and fixed two
  growth-blockers: an era-0 deadlock (Pioneer cap of 8 fit in 3 houses but era 1
  wanted 4 → lowered to 3) and redevelopment starvation (housing upgrades sat
  behind communal builds → reordered so a full town redevelops housing first).
  Verified a 40-resident town holds unrest ~19 with one officer and a station.
- Guaranteed building entrances: every building's door tile and the tile in
  front of it are paved to Road (the door stays Road through redevelopment too),
  so a building can never be sealed in — other footprints only take grass, and
  plaza growth now skips entrances when placing impassable decor (statue,
  fountain). Reverted the short-lived founder-sharing change (each founder stakes
  their own plot again, the preferred behaviour). A house costs 8 wood plus
  gather/build labour. Verified: 0 of 16 built homes sealed; doors are always
  walkable (road/plaza/lamp); long-run growth unaffected (era 4, 0 homeless).
- Apartments grow their footprint + cheaper roads + sealing fix: apartments and
  towers (level 3+) now occupy 2×3 (vs a cottage's 2×2), expanding upward on
  redevelopment and clearing roads/trees/neighbouring houses (rehoming their
  residents) while sparing critical infrastructure. Lowered the desire-path wear
  thresholds (6/16 → 4/9) so roads form readily. Fixed the root cause of sealed
  doorways: ringInfo now treats claimed (in-progress) tiles as occupied, so
  buildings staked the same tick keep a one-tile gap instead of packing flush.
  Verified: 7 founders reach era 4 with 0 sealed homes; apartments report 2×3.
- Natural-look pass: buildings render in 2.5D (each rises above its footprint by
  a kind/level height, with roof, facade, lit windows and rooftop accents —
  spires, chimneys, cooling towers; drawn north-to-south for depth). Houses may
  now cluster shoulder-to-shoulder (hamlet feel) while their doorway is reserved
  as road the instant a site is staked, so clustering never seals anyone in.
  Fixed police stations being built several at once (any-stage check) and
  lowered road wear thresholds so streets form more readily.
- Spread vs vertical, gated by steel: apartments/towers (level 3+) now require
  steel, forged by a powered factory (which is now sited next to the power plant
  so it's electrified). Without steel, redevelopment caps at villas and grown,
  unmarried residents move out of overcrowded homes to build nearby — the town
  spreads into a low-rise cluster; once steel flows it redevelops upward instead.
  Population is now paced by the era ceiling (not current housing), so it never
  deadlocks waiting on a material. Parks enlarged to 3×3; overcrowded homes lose
  comfort. Verified: low-rise spread through eras 1–3, then apartments/towers in
  the industrial era, no deadlock to pop 40.
- Roads, phase 1 (orthogonal + single-lane): pathfinding is now 4-directional, so
  residents travel along the grid and the desire paths/roads they wear run
  straight instead of diagonally. Paving is blocked where it would complete a
  2×2 block, keeping streets a single lane (crossroads still allowed). Verified:
  no diagonal roads, zero 2×2 road blocks in a grown town. (Planned grid avenues
  + rectangular plaza are phase 2.)
- Roads, phase 2 (planned avenue grid): from the Town era a planner paves
  avenues along a fixed grid (every 6 tiles) through the built-up area, and all
  buildings now keep off the grid lines so they settle into the blocks between
  streets. The town reads as a deliberate, real-city layout. Verified: most
  roads (122/154) lie on the grid, buildings sit in blocks, growth to era 4 with
  no deadlock.
- Plaza rework (phase 2c): the plaza is now a clean square centred on the grid
  intersection nearest the village centre (the avenue hub), growing with the
  population (3×3 → 5×5) with a fountain at its heart, corner lamps and a statue,
  instead of an absorbing blob. Removed the old road-density seeding and the
  now-unused helpers. Verified: a 5×5 square plaza with a grid-aligned fountain.
- Bigger blocks, growing parks, house clustering: widened the avenue grid (6→8)
  so each block holds several buildings. Parks now scale with population by
  growing ONE park bigger (a larger park reaches farther; it can pave over the
  avenue between two parks to merge them) rather than scattering many small ones,
  and they're laid out/grown as civic projects. Home comfort now follows a
  cluster curve: a few close neighbours are cosy, an overpacked crush is not.
  Verified: blocks with multiple buildings, a single ~5×6 park scaled to the
  population, growth to era 4 with no deadlock.

## 2026-06-14

- Town planning is now a resident's job, not invisible system magic (restoring
  the autonomy pillar): a mayor (assigned from the Town era) must be on duty for
  the planned avenue grid, plaza, parks and workplace relocation to happen — all
  gated on hasMayor(). The mayor surveys the town on foot, has trees/berries that
  block an avenue transplanted onto nearby grass so streets run straight, and
  tidies stray off-grid roads back to grass. Jobs are now colour-coded on the
  map (mayor gold, police blue, cleaner teal, ...). Verified: no mayor before the
  Town era; once one is on duty the grid forms (179 avenue tiles), avenues are
  clear of trees, growth reaches era 4 with no deadlock.

## 2026-06-12

- Created Vite + React + TypeScript + PixiJS prototype structure.
- Added random 64x64 tile world generation.
- Added basic resident data model and random resident creation.
- Implemented a state-machine AgentBrain.
- Implemented PixiJS tile and resident renderer.
- Added React control panel, resident list, and game log.
- Made villages fully autonomous (A*, housing, food, roads, births).
- Added game clock, day/night cycle, sleep schedule, and save/load.
- Added multi-tile building system with 2x2 houses; resident chats and names.
- Added era system, farming, communal warehouse, and road paving.
- Added the content design document with the era-progression roadmap.
- Added GitHub Pages deployment; fixed a mobile crash (Graphics leak).

