# Technical Design

## Architecture

Simulation owns world state, residents, state updates, and logs. PixiRenderer only reads state and draws it. React owns UI controls and display panels.

## Main Modules

- `src/game/Simulation.ts`: world/resident update loop, era promotion, buildings,
  animals, industry, save/load, and the snapshot emitted to React.
- `src/game/GameApp.ts`: owns the simulation + renderer, drives ticks, routes input.
- `src/game/world/WorldMap.ts`: tile storage, random generation, tile queries.
- `src/game/world/Pathfinder.ts`: A* pathfinding around water.
- `src/game/agents/AgentBrain.ts`: resident state machine (decision + per-state logic).
- `src/game/agents/Agent.ts`: resident data model and random creation.
- `src/game/types.ts`: shared types (tiles, agents, buildings, animals, snapshot).
- `src/game/render/PixiRenderer.ts`: PixiJS rendering (canvas redraws every tick).
- `src/App.tsx` + `src/ui/*`: React shell, HUD, panels, and the inspector.

The `src/game/systems/*` and `src/game/world/Tile.ts` files are early stubs; the
logic actually lives in `Simulation.ts` / `AgentBrain.ts`.

## Constraints

- No backend.
- No server persistence.
- No multiplayer.
- No LLM-based AI.
- Keep the prototype simple and runnable.

