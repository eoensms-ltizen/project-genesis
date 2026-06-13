# Game Design

> The full design rationale and current status live in [`DESIGN.md`](./DESIGN.md)
> (Korean, canonical). This file is a quick reference to the current systems.

## Fantasy

The player is a creator and observer, never a direct controller. Residents act on
their own from simple needs and personalities; the village grows on its own.

## Core loop

A resident appears → forages and chops wood → builds a house → couples form and
have children → jobs are assigned as the population grows → the village paves
roads, cooks meals, worships, hunts, and eventually industrializes. The map
accumulates the traces of all of it.

## Tiles (`TileType`)

- Terrain: `Grass`, `Water`, `Dirt`, `Stump`
- Resources: `Tree`, `Berry`
- Roads: `Road`, `Rail` (grass wears into footpath → road; untrafficked roads decay)
- Farming: `FieldEmpty` → `FieldGrowing` → `FieldRipe`
- Housing/decor: `HouseSite`, `HouseFoundation`, `House`, `Plaza`, `Fountain`,
  `Statue`, `Lamp`

## Buildings (`BuildingKind`)

`house`, `warehouse`, `kitchen`, `church`, `pasture`, `powerplant`, `factory`,
`station`. Stages: `site` → `foundation` → `built`. Durability decays over time.
Houses densify by `capacity` under land pressure (house → villa → apartment).

## Residents

Age, gender, personality (diligence/sociability/curiosity), health
(stamina/hunger), inventory (wood/food), optional job. Life cycle: adult at 12,
elder at 60, death at personal lifespan; married couples with a shared home have
children. Jobs (`AgentJob`): `none`, `builder`, `farmer`, `fisher` (inert),
`woodcutter`, `cook`, `hunter` — assigned by population-scaled demand.

## Resident states (`AgentState`)

A state machine in `AgentBrain.ts`: Idle, foraging/eating, chopping, house
finding/planning/building, farming, paving, cooking, worship, hunting/taming,
stump transplanting, tree planting, chatting, sleeping, wandering, resting.

## Animals

`deer`, `boar`, `rabbit`; states `wild` / `fleeing` / `tamed`. Hunters kill for
food; deer and rabbits can be tamed into a pasture that yields food.

## Time

1 day = 5 real minutes, 20 days/year, clock starts 08:00, night 21:00–06:00.
