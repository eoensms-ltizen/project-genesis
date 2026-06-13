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
- Natural founding: homeless residents now join a household that is merely
  planned/under construction (not only built) before staking a fresh plot, so a
  group of founders settle into a few shared homes (7 → 3) instead of each
  grabbing a plot at once. A house still costs 8 wood plus the labour to gather
  and build it. Verified 7 founders form 3 homes with no cancelled sites and
  normal long-run growth (era 4, 0 homeless).

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

