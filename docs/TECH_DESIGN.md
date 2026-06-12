# Technical Design

## Architecture

Simulation owns world state, residents, state updates, and logs. PixiRenderer only reads state and draws it. React owns UI controls and display panels.

## Main Modules

- `src/game/Simulation.ts`: world and resident update loop.
- `src/game/world/WorldMap.ts`: tile storage, random generation, and tile queries.
- `src/game/agents/AgentBrain.ts`: resident state machine.
- `src/game/render/PixiRenderer.ts`: PixiJS rendering.
- `src/App.tsx`: React shell and UI integration.

## Constraints

- No backend.
- No server persistence.
- No multiplayer.
- No LLM-based AI.
- Keep the prototype simple and runnable.

