# Project Genesis Handoff

## Current Status

Project Genesis is a Vite + React + TypeScript + PixiJS web game prototype.

The first MVP is implemented and deployed. A resident can be added to a randomly generated 64x64 tile map, autonomously find a tree, move to it, chop wood, remove the tree tile, select a house site, and log each action.

## Important Links

- GitHub repository: https://github.com/eoensms-ltizen/project-genesis
- Public build: https://eoensms-ltizen.github.io/project-genesis/
- Local canonical project path: `F:\Projects\project-genesis`
- Original Codex workspace path: `C:\Users\user\Documents\Codex\2026-06-12\project-genesis-codex-0-1-2`

## Tech Stack

- Vite
- React
- TypeScript
- PixiJS
- GitHub Pages
- No backend
- No server persistence
- No multiplayer

## Run Locally

```powershell
cd F:\Projects\project-genesis
npm install
npm run dev
```

Default local URL:

```text
http://127.0.0.1:5173/
```

## Build

```powershell
npm run build
```

The production output is generated in `dist/`.

## Deployment

Deployment is handled by GitHub Actions.

Workflow:

```text
.github/workflows/deploy.yml
```

Trigger:

- Push to `main`
- Manual workflow dispatch

Deployment target:

```text
GitHub Pages
https://eoensms-ltizen.github.io/project-genesis/
```

Note: The repository was changed to `PUBLIC` because the current GitHub plan did not support GitHub Pages for a private repository.

## Implemented MVP Features

- Random 64x64 tile map generation
- Tile types:
  - Grass
  - Tree
  - Water
  - Dirt
  - Road
  - HouseSite
  - HouseFoundation
  - House
  - Berry
- Tree, water, and berry clusters
- Resident creation through UI buttons
- Map-click resident placement mode
- Resident state machine (see Current Agent Behavior)
- A* pathfinding with per-tile movement costs
- Wood chopping from adjacent tiles
- Multi-tile building system: Building registry (footprint, door, stage) owned by Simulation
- Houses are 2x2 buildings (site -> foundation -> built, costs 8 wood) with door, roof, window
- Building placement keeps a one-tile ring gap and prefers road-adjacent, house-adjacent sites (villages cluster into streets)
- Hunger-driven berry foraging and eating
- Berry/tree natural regrowth, berry reseeding if extinct
- Emergent roads from traffic (Grass -> Dirt -> Road)
- Autonomous population growth (births when housing + food allow)
- Tile claiming so residents do not pick the same tree/berry/site
- Game clock (1 day = 5 real minutes, 20 days = 1 year) with date/time UI
- Day/night cycle: darkness overlay, warm window lights on houses at night
- Sleep schedule: residents head home at 21:00 and sleep until 06:00
- Save/load via localStorage, schema v2 with buildings (autosave every 15s, on tab hide, on unmount; "New world" button resets; older save versions are discarded)
- React side panel, resident status display, game log display
- PixiJS map rendering
- Separation between simulation and renderer

## Main Files

```text
src/App.tsx
src/game/GameApp.ts
src/game/Simulation.ts
src/game/types.ts
src/game/world/WorldMap.ts
src/game/world/Tile.ts
src/game/world/Pathfinder.ts
src/game/agents/Agent.ts
src/game/agents/AgentBrain.ts
src/game/render/PixiRenderer.ts
src/ui/ControlPanel.tsx
src/ui/AgentCreator.tsx
src/ui/GameLog.tsx
```

## Architecture Notes

`Simulation` owns world state, agents, updates, and logs.

`AgentBrain` owns the resident state machine.

`PixiRenderer` reads simulation state and draws the world. It should not own gameplay rules.

`App.tsx` connects React UI to `GameApp`, handles button actions, and mirrors simulation snapshots into React state.

The current design is deliberately simple. Do not introduce ECS, server state, complex pathfinding frameworks, or LLM behavior until the core game loop is more proven.

## Current Agent Behavior

Decision priority in `AgentBrain.decideNextAction` (checked in Idle):

1. Hunger >= 65 -> find berries and eat (>= 40 if they already have a home)
2. Stamina < 25 -> rest (go home first if they have one; rest is faster at home)
3. No home: claim a house site -> gather 5 wood -> build (HouseSite -> HouseFoundation -> House)
4. Has home: rest when tired, snack, stockpile wood up to 8, otherwise walk home and loiter

The walk-home loitering matters: it creates commuting traffic, which is what wears footpaths and roads into the map.

States: Idle, FindTree, MoveToTree, ChopTree, FindHouseSite, MoveToHouseSite, PlanHouse, BuildHouse, FindFood, MoveToFood, Eat, MoveHome, Rest.

## Pathfinding (RimWorld-style, implemented)

- `src/game/world/Pathfinder.ts` implements grid A* (8-directional, octile heuristic, no corner cutting).
- Tiles have per-tile movement costs in `WorldMap` (`MOVE_COSTS`): Road 0.6 < Dirt 0.75 < Grass 1 < HouseFoundation 1.2 < Berry 1.25. Tree and Water are impassable.
- Agents path around blocked terrain and move faster on cheaper tiles, so roads are automatically preferred once they exist.
- Work targets that cannot be stood on (trees) are reached by standing on an adjacent walkable tile (`stopAdjacent`), RimWorld-style.
- Agents replan if a waypoint becomes unwalkable, and back off a few seconds when no target is reachable.

## Emergent Roads (implemented)

`Simulation.recordTraffic` counts waypoint crossings per tile. Grass becomes Dirt after 6 crossings; Dirt becomes Road after 16 cumulative crossings. Path-event logs are throttled to one per 8 seconds. Because Dirt/Road are cheaper for A*, traffic funnels onto existing paths (positive feedback, RimWorld desire-path style). Roads take a few minutes of commuting to appear — that pacing is intentional.

## Population Growth (implemented)

`Simulation.tryBirth` runs on the 5-second nature tick: requires 2+ residents, at least one House, berries >= residents x 2, a 45-second cooldown, and a population cap of 30. Newborns spawn near a random house and behave as normal residents.

## Nature Regrowth (implemented)

Every 5 seconds berries spread to adjacent grass (cap 140) and trees regrow slowly (cap 320). If berries go extinct a new wild cluster is seeded so the food loop cannot dead-end.

## Known Limitations

- Newborn residents are functionally adults (age/growth is cosmetic).
- One house per resident; houses never upgrade or get shared.
- No starvation or death; hunger only redirects behavior.
- Saves drop in-flight tasks: agents reload as Idle and re-decide (claims for reserved house sites are restored).

## Verification Already Performed

- `npm run build`: passed (type-check + bundle)
- Browser check (2026-06-12): with 3 spawned residents, observed in GameLog —
  - house sites chosen, wood gathered, houses started and finished
  - berries foraged and eaten when hungry
  - footpaths worn into grass, then upgraded to a road (~4 min)
  - births grew the village from 3 to 9 residents autonomously
- GitHub Pages returned HTTP 200 (initial MVP deploy)

## Design Direction (updated)

The player only spawns residents. Everything else — houses, roads, food, population growth — must emerge from resident behavior. Do not add player tools (road drawing, building placement). The basics follow RimWorld: per-tile movement costs, A* pathfinding, working from adjacent tiles.

The full content roadmap (era system, multi-tile buildings, day/night, needs, jobs, production chains, industry) lives in `docs/DESIGN.md`. M1 is complete (game time, day/night, sleep, save/load, multi-tile 2x2 houses). Next is M2: farming, small warehouse, eating schedule, era promotion system.

## Next Recommended Work

(House construction, hunger/food, emergent roads, and population growth are done — see Implemented MVP Features.)

### 1. Jobs And Specialization

Use the existing `job` field: woodcutters stockpile communal wood, farmers tend berry plots, builders pave high-traffic dirt into roads deliberately (`BuildRoad` state).

### 2. Survival Pressure

Starvation consequences (slowed work, eventually death), aging from birth to adulthood, day/night cycle with sleep at home.

### 3. Village Economy

Shared stockpile instead of per-resident inventory; houses requiring wood deliveries; trading or storage buildings.

### 4. Persistence

LocalStorage save/load of world tiles, agents, and traffic counters.

## Suggested Development Rule

Keep every new feature observable in the GameLog. This prototype is more fun when internal decisions are visible.

Example:

```text
[01:12] Mina chose a road-side house site.
[01:20] Mina started building a shelter.
[01:26] Mina needs more wood.
```

## Handoff Summary

The autonomous-village loop is complete: residents build homes, eat, wear roads into the map by commuting, and the population grows on its own. The player only spawns residents. The strongest next step is jobs/specialization or survival pressure to deepen the simulation.
