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
- Tree clusters
- Small water clusters
- Resident creation through UI buttons
- Map-click resident placement mode
- Resident state machine
- Autonomous tree search
- Straight-line movement to target
- Wood chopping
- Tree tile conversion to Grass after chopping
- House site candidate selection
- HouseSite tile marking
- React side panel
- Resident status display
- Game log display
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

## Current Agent Flow

```text
Idle
-> FindTree
-> MoveToTree
-> ChopTree
-> FindHouseSite
-> MoveToHouseSite
-> PlanHouse
-> Idle
```

Rest exists as a state, but survival pressure is still shallow.

## Known Limitations

- Movement is straight-line and can pass through blocked terrain visually.
- Water and tree blocking are not fully respected during movement.
- There is no A* pathfinding yet.
- There is no real house construction beyond marking a site.
- There is no road drawing yet.
- Road tiles exist only as a prepared tile type.
- Dirt tile exists only as a prepared tile type.
- Hunger is tracked but does not yet drive meaningful food behavior.
- LocalStorage save/load is not implemented.
- Multiple residents can act, but the design has only been validated for the early single-resident MVP feel.

## Verification Already Performed

- `npm install`: passed
- `npm run build`: passed
- `npm run dev`: passed locally
- Browser check: map and UI rendered
- Resident add button worked
- Resident found a tree
- Resident moved and chopped wood
- Tree changed to grass
- Resident selected and marked a house site
- Game log updated with behavior changes
- GitHub Pages returned HTTP 200
- Deployed JS and CSS assets returned HTTP 200

## Next Recommended Work

### 1. Road Drawing

Add a road-drawing mode to the UI.

Expected behavior:

- Player toggles road tool.
- Clicking or dragging on Grass turns tiles into Road.
- Agent movement should later prefer Road tiles.

Likely files:

```text
src/game/systems/RoadSystem.ts
src/game/Simulation.ts
src/game/render/PixiRenderer.ts
src/App.tsx
src/ui/ControlPanel.tsx
```

### 2. Road-Biased Movement

Add simple path scoring before full pathfinding.

Initial acceptable approach:

- Keep straight movement for short range.
- Prefer house sites near roads.
- Later replace with A*.

### 3. House Construction

Turn `PlanHouse` into a staged building loop.

Possible states:

```text
GatherWood
MoveToHouseSite
BuildHouse
```

Possible new tiles:

```text
HouseFoundation
House
```

### 4. Hunger And Food

Make hunger affect decisions.

Add:

- Berry/food source tile or farm plot
- Eat behavior
- More meaningful Rest behavior

## Suggested Development Rule

Keep every new feature observable in the GameLog. This prototype is more fun when internal decisions are visible.

Example:

```text
[01:12] Mina chose a road-side house site.
[01:20] Mina started building a shelter.
[01:26] Mina needs more wood.
```

## Handoff Summary

The project is in a healthy first-MVP state. The strongest next step is road drawing, because it directly reinforces the intended player fantasy: the player guides the settlement, while residents remain autonomous.
