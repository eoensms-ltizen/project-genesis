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

