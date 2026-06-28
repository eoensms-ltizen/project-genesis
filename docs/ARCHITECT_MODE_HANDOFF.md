# Architect Mode Handoff

## Purpose

This document hands off the current Architect-mode direction: the player should be able to author infrastructure explicitly, while residents use that infrastructure rather than inventing it on their own.

The most recent design target is closer to RimWorld's planning flow:

- The player paints building floor zones.
- The player paints walls and doors separately.
- The player paints fields separately.
- The player places furniture manually.
- Residents should use available rooms, fields, beds, stoves, tables, and chairs, but in Architect mode they should not create those things by themselves.

## Current Working State

The current local worktree contains implementation changes that are not yet committed in this handoff:

- Manual Architect furniture tools were added.
- Architect-mode automatic bed/dining furniture creation was blocked.
- Architect-mode automatic kitchen stove/counter creation was blocked.
- Furniture deletion now preserves the floor beneath furniture.
- `npm run build` passes.
- Browser verification on `http://127.0.0.1:5173/` confirmed manual `Bed`, `Stove`, `Table`, and `Chair` placement through `Apply`.

Untracked `.codex-remote-attachments/` can be ignored.

## Important Files

- `src/App.tsx`
  - Owns Architect draft state.
  - Maintains persistent draft strokes.
  - Clicking/dragging an already-drafted tile removes it from the draft.
  - Converts active tool drafts into simulation calls on `Apply`.

- `src/ui/ArchitectPanel.tsx`
  - Shows Architect controls.
  - New `Furniture` section includes `Bed`, `Stove`, `Counter`, `Table`, `Chair`.

- `src/ui/DevPanel.tsx`
  - Defines `DevTileTool`.
  - `DevTileTool` now includes `FurnitureKind`.

- `src/game/types.ts`
  - Defines `FurnitureKind = "bed" | "stove" | "counter" | "table" | "chair"`.

- `src/game/GameApp.ts`
  - Exposes `devPaintFurnitureTiles(kind, positions)` to the React app.

- `src/game/Simulation.ts`
  - Implements `devPaintFurnitureTiles`.
  - Preserves furniture during custom floor repaint.
  - Clears furniture safely while keeping underlying `Floor`.
  - Blocks automatic kitchen stove/counter stamping in Architect mode.

- `src/game/agents/AgentBrain.ts`
  - `tryBuildBed`, `tryBuildDiningSet`, and `tryExpandDiningSet` now return `false` in Architect mode.
  - Residents can still use existing furniture.

- `src/game/render/PixiRenderer.ts`
  - Architect draft preview supports furniture modes and colors.

## Current Architect Rules

### Building Zones

Architect building placement is tile-painted, not fixed rectangle placement.

- House/warehouse/granary/kitchen/funfair/pasture buttons paint floor zones.
- These zones become custom-layout buildings with `customLayout: true`.
- Walls and doors are independent tools.
- A building floor zone alone has no door.
- A building floor zone can still function as the building kind, but comfort/usable quality should later depend on walls, doors, furniture, and enclosure.

### Draft Flow

Architect tools use a draft system:

- Select a tool.
- Left-drag paints one-tile-at-a-time draft tiles.
- Additional drags with the same tool accumulate into the same draft.
- Starting on an already-drafted tile removes tiles instead of adding them.
- `Apply` commits the draft.
- `Cancel draft` discards it.
- Right drag remains camera movement.

### Fields

Fields are now user-authored terrain, not resident-authored terrain.

- `Field` is in Architect tools.
- Residents farm only existing `FieldEmpty`/`FieldRipe` tiles.
- Residents no longer automatically pick a 3x3 site and till new fields.
- Hungry residents can still forage berries naturally.

### Furniture

Furniture is now user-authored in Architect mode.

Current tools:

- `Bed`
- `Stove`
- `Counter`
- `Table`
- `Chair`

Current implementation details:

- Furniture can be placed on `Floor` or over existing furniture.
- Replacing furniture clears the old furniture and keeps the tile as floor first.
- Deleting furniture with tile erase returns the tile to `Floor`, not `Grass`.
- `Bed` places a two-tile bed: `Bed` plus an adjacent `BedFoot`.
- Bed orientation is currently automatic. The code picks the first valid adjacent tile from right, down, left, up.
- There is no rotation UI yet.
- There is no furniture blueprint/material workflow yet; `Apply` places furniture instantly.

## Auto Mode vs Architect Mode

The project currently has two different design personalities:

- Auto mode: residents can still behave like an autonomous village simulation.
- Architect mode: the player controls infrastructure; residents should use what exists.

Keep this distinction unless the design changes explicitly.

Known Architect-mode automation that has already been disabled:

- Residents do not create new fields.
- Residents do not build beds.
- Residents do not create dining tables/chairs.
- Built kitchens do not auto-spawn stoves/counters.
- Private bedroom auto-annexing already had an Architect-mode guard from an earlier pass.

Automation that still exists and is probably okay:

- Residents can use beds if manually placed.
- Residents can use stoves if manually placed.
- Residents can sit/eat if manually placed table/chairs exist.
- Residents can build walls/floors/doors for non-instant building workflows if a building plan exists.
- Residents can forage berries when hungry.

## RimWorld Comparison

RimWorld is blueprint-first. The player marks designs, stockpiles, zones, furniture, production stations, priorities, bills, and work permissions. Pawns execute those orders based on schedules, skills, needs, reachability, and priorities.

Project Genesis is still more autonomous and village-story-driven. It has:

- A softer simulation loop.
- Stronger resident self-direction in Auto mode.
- Less explicit work priority control.
- Less production-chain depth.
- Fewer hard survival consequences.
- More emphasis on emergent settlement growth and mood/ambience.

After the latest Architect-mode changes, the main difference is:

- RimWorld: most things are blueprints that pawns build with materials.
- Project Genesis Architect mode: many things are still instant `Apply` edits.

The next big step toward RimWorld feel is to turn Architect edits into build jobs.

## Recommended Next Implementation

### 1. Furniture Blueprints — DONE (phase 1)

Implemented. The Architect panel's `주민 건설 / 즉시` (resident-build / instant) toggle
now actually drives `Apply`:

- `즉시` (instant): stamps the final tile at once, as before.
- `주민 건설` (resident-build): queues a `Blueprint` (see `types.ts`) per tile.
  Residents fulfil them in `AgentBrain.tryBuildBlueprint` / `buildBlueprint`,
  hauling the wood it costs (`BLUEPRINT_COST` in `Simulation.ts`) and laying each
  tile by hand. Until built they render as translucent blue ghosts.

Scope: walls, doors, and furniture (Bed/Stove/Counter/Table/Chair) are blueprinted.
Beds queue a single `Bed` blueprint; the foot is placed automatically when built.
Blueprints are saved/loaded and cancelled when their tile is demolished/overwritten.

Still instant even in resident-build mode (NEXT phase candidates):

- Building floor zones (`devPaintFloorZone` — entangled with the customLayout
  merge/bounds machinery; defer to its own pass).
- Fields and roads (terrain designations).

Possible follow-ups:

- Make floor zones resident-built (lay `Floor` blueprints; building "site" state).
- Material variety (stone for stove/counter) instead of wood-only.

Possible model:

- Add `FurnitureSite` or specific planned tile types:
  - `BedSite` already exists.
  - Add `StoveSite`, `CounterSite`, `TableSite`, `ChairSite`, or a generic furniture build plan.
- Add cost mapping:
  - Bed: wood 4
  - Table: wood 4
  - Chair: wood 1
  - Stove/counter: probably stone/wood, depending on desired tech.
- Extend `AgentBrain` furnish/build job logic to consume explicit player sites instead of inventing them.

### 2. Furniture Rotation

Current state:

- Bed orientation is automatic.
- Chair facing is inferred visually from adjacent table.

Recommended next state:

- Add a rotation state to Architect tools.
- Use `R` or a UI button to rotate.
- For beds, use rotation to choose the `BedFoot` tile.
- For chairs, store or infer direction more deliberately.

### 3. Room Quality

Current state:

- Custom floor zones can function even if unwalled.
- Furniture comfort exists, but enclosure penalties need clearer player-facing consequences.

Recommended next state:

- Detect enclosed rooms from walls/doors around custom zones.
- Penalize exposed sleeping/eating/work areas.
- Show room quality in inspector:
  - Enclosed / exposed
  - Has door / no door
  - Bed count
  - Stove/table/chair availability
  - Comfort score

### 4. Tool UX

Current state:

- Draft color distinguishes furniture types, but all use simple tile overlays.
- Furniture tool labels are text buttons.

Recommended next state:

- Add icons for furniture tools.
- Add rotation indicator in cursor preview.
- Add invalid placement feedback.
- Make `Apply` show count/type summary.

### 5. Save/Load Review

Tile types are already saveable through `WorldMap` tile codes, and furniture tile types existed before this work. Still test:

- Manual furniture persists after reload.
- Custom buildings preserve furniture after floor-zone edits.
- Deleting a bed clears resident `bedPos`/`bedFoot`.
- Deleting a stove clears stove claims and current cook state.
- Deleting a chair clears chair claims and diner state.

## Verification Checklist

Run:

```powershell
npm run build
```

Manual browser checks:

1. Open `http://127.0.0.1:5173/`.
2. Start or load an Architect world.
3. Paint a house floor zone and `Apply`.
4. Wait briefly with residents present; no bed should appear automatically.
5. Paint `Bed`, `Stove`, `Table`, `Chair` and `Apply`.
6. Verify furniture appears only after `Apply`.
7. Use `Erase tile` on furniture; floor should remain.
8. Build a kitchen floor zone; stove/counter should not auto-appear in Architect mode.
9. Place a stove manually; cooking should use that stove when ingredients exist.

## Caution Areas

- Many Korean strings in source files appear garbled in some PowerShell output, but the files may still be valid UTF-8. Prefer small patches around ASCII code when editing those areas.
- Do not revert `.codex-remote-attachments/`; it is untracked user/session data.
- Existing `docs/HANDOFF.md` is broad and older. Use this document for the current Architect-mode thread.
- The current implementation preserves Auto mode behavior intentionally. Avoid disabling automation globally unless the design asks for it.

