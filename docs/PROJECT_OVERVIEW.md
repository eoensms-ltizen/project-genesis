# Project Genesis Overview

Project Genesis is a small web simulation prototype inspired by RimWorld's autonomous social simulation and Factorio's settlement-building flow.

The player acts as a creator, city planner, and observer. Residents are not directly controlled. They decide simple actions on their own, move through a tile world, gather resources, and begin shaping a settlement.

## Current State

The MVP feeling — a resident appears, gathers wood, and settles without direct
commands — is validated and built well past it. The village now auto-progresses
through five eras (Pioneer → Settlement → Town → City → Industrial) with farming,
jobs, cooked meals, marriage and family births, aging, wildlife, roads that wear
in and decay, housing density, and an industrial layer (power, factory, rail).

See [`DESIGN.md`](./DESIGN.md) for the canonical vision and current implementation
status, and [`ROADMAP.md`](./ROADMAP.md) for what ships next.

## Current Stack

- Vite
- React
- TypeScript
- PixiJS
- In-memory state only
- No backend
- No multiplayer

