# Roadmap

The roadmap is organized around **eras**, not the original MVP phases. The
canonical design and the up-to-date implementation status live in
[`DESIGN.md`](./DESIGN.md). This file is the short version.

## Shipped — eras 0–4

The village now auto-progresses through all five eras. Promotion thresholds are
in `checkEraPromotion` (`Simulation.ts`); labels in `ERA_NAMES`.

- **0 Pioneer** — chopping, first houses, foraging, stamina/hunger.
- **1 Settlement** — farming fields, communal warehouse, demand-driven jobs.
- **2 Town** — road paving, cook + kitchen + cooked meals, hunters.
- **3 City** — morning worship (church), a plaza that grows along roads.
- **4 Industrial** — power plant (radius electrification), factory (canned food),
  rail + trade train.

Plus: desire-path roads with decay, land-pressure housing density (house → villa
→ apartment), marriage / family births / aging & death, wildlife
hunting/taming/pasture, click inspector, mobile pan-zoom UI.

## Next (Backlog)

Ordered by how much visible, accumulating trace each adds. See `DESIGN.md` for
detail.

1. Seasons & weather (palette, snow/rain, seasonal farming).
2. Building repair & disrepair visuals (durability already tracked).
3. Aesthetic jobs (carpenter, painter, gardener) with map decorations.
4. Markets & resident-to-resident trade.
5. Hygiene/cleaning need + cleaner; expand needs from 2 to 5.
6. Fishing behavior (the `fisher` job type exists but is inert).
7. Tests / CI (no automated regression coverage yet).
