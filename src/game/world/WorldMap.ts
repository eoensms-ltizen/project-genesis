import type { TileType, Vec2 } from "../types";
import type { Tile } from "./Tile";

const TREE_CLUSTER_COUNT = 22;
const WATER_CLUSTER_COUNT = 4;
const BERRY_CLUSTER_COUNT = 7;
const ROCK_REGION_COUNT = 5;

// RimWorld-style per-tile movement cost. Lower is faster; Infinity is impassable.
// Roads are far quicker than open ground, so a road network is worth building —
// off-road travel works but is slow, which is what drives roads to grow.
const MOVE_COSTS: Record<TileType, number> = {
  Road: 0.6,
  Plaza: 0.55,
  Lamp: 0.6,
  Dirt: 0.9,
  Rail: 1.4,
  Grass: 2,
  HouseSite: 1.5,
  HouseFoundation: 2,
  House: 1.2, // applies to the door tile only; other house tiles are impassable
  Wall: Number.POSITIVE_INFINITY,
  Floor: 1, // interior of a room — comfortable walking
  Door: 1.2, // a doorway: passable, with a touch of open/close friction
  // Solid rock and ore are impassable until mined; the rough floor left behind
  // walks like packed ground.
  RockSandstone: Number.POSITIVE_INFINITY,
  RockLimestone: Number.POSITIVE_INFINITY,
  RockGranite: Number.POSITIVE_INFINITY,
  OreIron: Number.POSITIVE_INFINITY,
  RockFloor: 1,
  // Furniture is solid for transit — you don't walk through it. A bed can be
  // climbed onto from an adjacent tile to sleep (handled by the sleep logic), but
  // pathfinding never routes through it; a stove is cooked at from beside it. A
  // reserved bed site is still bare floor until built, so it stays walkable.
  Stove: Number.POSITIVE_INFINITY,
  Counter: Number.POSITIVE_INFINITY,
  Bed: Number.POSITIVE_INFINITY,
  BedFoot: Number.POSITIVE_INFINITY,
  BedSite: 1,
  // Furniture is solid: a table is a surface you stand beside, and a chair is
  // climbed onto from an adjacent tile to sit (handled by the dining logic) —
  // pathfinding never routes through either.
  Table: Number.POSITIVE_INFINITY,
  Chair: Number.POSITIVE_INFINITY,
  // A fence rail is solid; its gate is passable for people (animals are kept in
  // by the animal-movement logic, which refuses to step onto fence or gate).
  Fence: Number.POSITIVE_INFINITY,
  FenceGate: 1.3,
  Berry: 2,
  FieldEmpty: 2.2,
  FieldGrowing: 2.2,
  FieldRipe: 2.2,
  Stump: 2.2,
  Tree: Number.POSITIVE_INFINITY,
  Water: Number.POSITIVE_INFINITY,
  Fountain: Number.POSITIVE_INFINITY,
  Statue: Number.POSITIVE_INFINITY,
};

export const MIN_MOVE_COST = MOVE_COSTS.Road;

// Single-character codes for compact save data.
const TILE_CODES: Record<TileType, string> = {
  Grass: "G",
  Tree: "T",
  Water: "W",
  Dirt: "D",
  Road: "R",
  HouseSite: "S",
  HouseFoundation: "F",
  House: "H",
  Wall: "#",
  Floor: ".",
  Door: "+",
  RockSandstone: "a",
  RockLimestone: "k",
  RockGranite: "g",
  OreIron: "i",
  RockFloor: ",",
  Stove: "v",
  Counter: "n",
  Bed: "b",
  BedFoot: "f",
  BedSite: "m",
  Table: "t",
  Chair: "h",
  Fence: "x",
  FenceGate: "j",
  Berry: "B",
  FieldEmpty: "e",
  FieldGrowing: "c",
  FieldRipe: "p",
  Stump: "u",
  Plaza: "z",
  Fountain: "o",
  Statue: "y",
  Lamp: "l",
  Rail: "=",
};

const CODE_TILES: Record<string, TileType> = Object.fromEntries(
  Object.entries(TILE_CODES).map(([type, code]) => [code, type as TileType]),
);

export class WorldMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: Tile[];

  // Bumped on every tile change so the renderer can skip redrawing an unchanged world.
  private changeVersion = 0;
  // Tile indices changed since the renderer last consumed them, so it can redraw
  // just those (chunked) instead of the whole map. `dirtyAll` forces a full
  // redraw (first frame, or after a wholesale rebuild like load/generation).
  private dirtyTiles = new Set<number>();
  private dirtyAll = true;
  // Built buildings are solid except their door tile, so residents enter only
  // through the doorway. Maintained by the simulation as buildings come and go.
  private doorTiles = new Set<number>();

  constructor(width = 64, height = 64) {
    this.width = width;
    this.height = height;
    this.tiles = [];

    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        this.tiles.push({ x, y, type: "Grass" });
      }
    }
  }

  static createRandom(width = 64, height = 64): WorldMap {
    const map = new WorldMap(width, height);

    for (let i = 0; i < TREE_CLUSTER_COUNT; i += 1) {
      const center = map.randomLandPosition();
      map.paintCluster(center, 2 + Math.floor(Math.random() * 4), "Tree", 0.65);
    }

    for (let i = 0; i < WATER_CLUSTER_COUNT; i += 1) {
      const center = map.randomPosition();
      map.paintCluster(center, 2 + Math.floor(Math.random() * 3), "Water", 0.78);
    }

    // Rocky regions: solid outcrops of stone with iron veins inside. Granite and
    // limestone carry more ore; sandstone is mostly bare soft rock.
    const rockTypes: { type: TileType; ore: number }[] = [
      { type: "RockSandstone", ore: 0.02 },
      { type: "RockLimestone", ore: 0.07 },
      { type: "RockGranite", ore: 0.11 },
    ];
    for (let i = 0; i < ROCK_REGION_COUNT; i += 1) {
      const rock = rockTypes[i % rockTypes.length];
      map.seedRockRegion(rock.type, rock.ore);
    }

    for (let i = 0; i < BERRY_CLUSTER_COUNT; i += 1) {
      map.seedBerryCluster();
    }

    return map;
  }

  /**
   * A solid outcrop of one rock kind, kept away from the map centre (where the
   * first resident settles), with iron-ore tiles veining through it.
   */
  private seedRockRegion(rockType: TileType, oreChance: number) {
    let center: Vec2 | undefined;
    for (let tries = 0; tries < 20; tries += 1) {
      const candidate = this.randomLandPosition();
      const dx = candidate.x - this.width / 2;
      const dy = candidate.y - this.height / 2;
      if (Math.hypot(dx, dy) > Math.min(this.width, this.height) * 0.22) {
        center = candidate;
        break;
      }
    }
    if (!center) {
      return;
    }
    const radius = 3 + Math.floor(Math.random() * 4);
    for (let y = center.y - radius; y <= center.y + radius; y += 1) {
      for (let x = center.x - radius; x <= center.x + radius; x += 1) {
        const position = { x, y };
        const tile = this.getTile(position);
        // Rock sits on land — never carve into water.
        if (!tile || tile.type === "Water") {
          continue;
        }
        const distance = Math.hypot(center.x - x, center.y - y);
        if (distance <= radius && Math.random() < 0.82 - distance * 0.06) {
          this.setTile(position, Math.random() < oreChance ? "OreIron" : rockType);
        }
      }
    }
  }

  getTile(position: Vec2): Tile | undefined {
    if (!this.inBounds(position)) {
      return undefined;
    }
    return this.tiles[position.y * this.width + position.x];
  }

  setTile(position: Vec2, type: TileType) {
    const tile = this.getTile(position);
    if (tile && tile.type !== type) {
      tile.type = type;
      this.changeVersion += 1;
      if (!this.dirtyAll) {
        this.dirtyTiles.add(position.y * this.width + position.x);
      }
    }
  }

  get version(): number {
    return this.changeVersion;
  }

  /** Force the next render to redraw every tile (after a wholesale rebuild). */
  markAllDirty() {
    this.dirtyAll = true;
    this.dirtyTiles.clear();
  }

  /**
   * Hand the renderer the tiles changed since last call and reset the set.
   * `all` true means redraw everything; otherwise `tiles` lists changed indices.
   */
  consumeDirty(): { all: boolean; tiles: number[] } {
    if (this.dirtyAll) {
      this.dirtyAll = false;
      this.dirtyTiles.clear();
      return { all: true, tiles: [] };
    }
    const tiles = [...this.dirtyTiles];
    this.dirtyTiles.clear();
    return { all: false, tiles };
  }

  inBounds(position: Vec2): boolean {
    return (
      position.x >= 0 &&
      position.y >= 0 &&
      position.x < this.width &&
      position.y < this.height
    );
  }

  isWalkable(position: Vec2): boolean {
    return Number.isFinite(this.moveCost(position));
  }

  moveCost(position: Vec2): number {
    const tile = this.getTile(position);
    if (!tile) {
      return Number.POSITIVE_INFINITY;
    }
    // A built house is solid; only its door tile can be walked through.
    if (tile.type === "House" && !this.doorTiles.has(position.y * this.width + position.x)) {
      return Number.POSITIVE_INFINITY;
    }
    return MOVE_COSTS[tile.type];
  }

  /** Register which House tiles are passable doorways. */
  setDoors(positions: Vec2[]) {
    this.doorTiles = new Set(positions.map((p) => p.y * this.width + p.x));
  }

  findNearestType(origin: Vec2, type: TileType): Vec2 | undefined {
    let best: Vec2 | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const tile of this.tiles) {
      if (tile.type !== type) {
        continue;
      }
      const distance = Math.abs(tile.x - origin.x) + Math.abs(tile.y - origin.y);
      if (distance < bestDistance) {
        best = { x: tile.x, y: tile.y };
        bestDistance = distance;
      }
    }

    return best;
  }

  /**
   * Best top-left corner for a width x height building. The footprint must be
   * Grass and unclaimed, the surrounding ring keeps a one-tile gap from other
   * buildings and water, and the tile in front of the door must be walkable.
   * Scoring prefers sites close to the resident, next to roads, and near
   * existing houses, so villages cluster along streets.
   */
  findBuildingSite(
    origin: Vec2,
    width: number,
    height: number,
    isBlocked?: (position: Vec2) => boolean,
    options?: {
      far?: boolean;
      minDistance?: number;
      extraScore?: (cx: number, cy: number) => number;
      cluster?: boolean;
    },
  ): Vec2 | undefined {
    // Existing buildings are now walled rooms (Wall tiles); use those to pull new
    // buildings into a cohesive cluster (with the gap enforced by ringInfo).
    const houseTiles: Vec2[] = this.tiles.filter(
      (tile) => tile.type === "Wall" || tile.type === "House",
    );
    const far = options?.far ?? false;
    const minDistance = options?.minDistance ?? 0;
    const extraScore = options?.extraScore;

    let best: Vec2 | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let y = 1; y <= this.height - height - 1; y += 1) {
      for (let x = 1; x <= this.width - width - 1; x += 1) {
        if (!this.isFootprintFree(x, y, width, height, isBlocked)) {
          continue;
        }

        const placement = this.placementClear(x, y, width, height, isBlocked);
        if (!placement.ok) {
          continue;
        }
        const ring = placement;

        const doorFront = { x, y: y + height };
        if (!this.isWalkable(doorFront) || isBlocked?.(doorFront)) {
          continue;
        }

        const cx = x + width / 2;
        const cy = y + height / 2;
        const distance = Math.abs(cx - origin.x) + Math.abs(cy - origin.y);
        let score: number;
        if (far) {
          // Want it set apart on the outskirts: just beyond the comfort radius
          // (not the far map corner) and clear of housing — a nuisance plot.
          if (distance < minDistance) {
            continue;
          }
          score = -distance - houseProximityBonus(houseTiles, cx, cy);
        } else {
          score = -distance + houseProximityBonus(houseTiles, cx, cy);
          if (ring.touchesPath) {
            score += 14;
          }
        }
        if (extraScore) {
          score += extraScore(cx, cy);
        }
        // A little jitter so buildings don't all stack in one deterministic line —
        // gives the neighbourhood an organic, less regimented spread.
        score += Math.random() * 4;

        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }

    return best;
  }

  private isFootprintFree(
    x: number,
    y: number,
    width: number,
    height: number,
    isBlocked?: (position: Vec2) => boolean,
  ): boolean {
    for (let fy = 0; fy < height; fy += 1) {
      for (let fx = 0; fx < width; fx += 1) {
        const position = { x: x + fx, y: y + fy };
        const tile = this.getTile(position);
        if (!tile || tile.type !== "Grass" || isBlocked?.(position)) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Free-standing placement keeps a clear gap (≥2 tiles) from other buildings:
   * abutting a neighbour (gap 0) just builds a redundant second wall right beside
   * theirs (an ugly double-wall "ladder" with thin walls), and a 1-tile sliver is
   * worse. True wall-sharing is done separately (findAdjoiningSite, by overlapping
   * the neighbour's wall). Water, rock and claimed footprints also force a gap.
   */
  private placementClear(
    x: number,
    y: number,
    width: number,
    height: number,
    isBlocked?: (position: Vec2) => boolean,
  ): { ok: boolean; touchesPath: boolean } {
    let touchesPath = false;
    let buildingAdjacent = false; // a built building flush against us (gap 0)
    let buildingOneAway = false; // a building exactly one tile away (gap 1 — the sliver)
    const isBuildingTile = (t: TileType): boolean =>
      t === "Wall" ||
      t === "Door" ||
      t === "Floor" ||
      t === "House" ||
      t === "HouseSite" ||
      t === "HouseFoundation";
    const isObstacle = (t: TileType): boolean =>
      t === "Water" ||
      t === "RockSandstone" ||
      t === "RockLimestone" ||
      t === "RockGranite" ||
      t === "OreIron";
    for (let ry = y - 2; ry <= y + height + 1; ry += 1) {
      for (let rx = x - 2; rx <= x + width + 1; rx += 1) {
        const dx = rx < x ? x - rx : rx > x + width - 1 ? rx - (x + width - 1) : 0;
        const dy = ry < y ? y - ry : ry > y + height - 1 ? ry - (y + height - 1) : 0;
        const dist = Math.max(dx, dy);
        if (dist !== 1 && dist !== 2) {
          continue;
        }
        const tile = this.getTile({ x: rx, y: ry });
        if (!tile) {
          continue;
        }
        const blocked = isBlocked?.({ x: rx, y: ry }) ?? false;
        if (dist === 1) {
          // Never flush against water, cliffs, or an in-progress footprint.
          if (isObstacle(tile.type) || blocked) {
            return { ok: false, touchesPath: false };
          }
          if (isBuildingTile(tile.type)) {
            buildingAdjacent = true; // flush against a neighbour — a double wall
          }
          if (tile.type === "Road" || tile.type === "Dirt" || tile.type === "Plaza") {
            touchesPath = true;
          }
        } else if (isBuildingTile(tile.type) || blocked) {
          buildingOneAway = true;
        }
      }
    }
    // Forbid both a flush double-wall (gap 0) and a 1-tile sliver (gap 1); only a
    // clear gap (≥2) is allowed here. Genuine wall-sharing goes through
    // findAdjoiningSite, which overlaps a neighbour's wall instead of abutting it.
    if (buildingAdjacent || buildingOneAway) {
      return { ok: false, touchesPath };
    }
    return { ok: true, touchesPath };
  }

  serializeTiles(): string {
    return this.tiles.map((tile) => TILE_CODES[tile.type]).join("");
  }

  static fromSerializedTiles(width: number, height: number, codes: string): WorldMap | undefined {
    if (codes.length !== width * height) {
      return undefined;
    }

    const map = new WorldMap(width, height);
    for (let i = 0; i < codes.length; i += 1) {
      const type = CODE_TILES[codes[i]];
      if (!type) {
        return undefined;
      }
      map.tiles[i].type = type;
    }
    map.changeVersion += 1;
    return map;
  }

  countType(type: TileType): number {
    let count = 0;
    for (const tile of this.tiles) {
      if (tile.type === type) {
        count += 1;
      }
    }
    return count;
  }

  seedBerryCluster() {
    const center = this.randomLandPosition();
    for (let y = center.y - 1; y <= center.y + 1; y += 1) {
      for (let x = center.x - 1; x <= center.x + 1; x += 1) {
        const tile = this.getTile({ x, y });
        if (tile && tile.type === "Grass" && Math.random() < 0.65) {
          this.setTile({ x, y }, "Berry");
        }
      }
    }
  }

  private paintCluster(center: Vec2, radius: number, type: TileType, chance: number) {
    for (let y = center.y - radius; y <= center.y + radius; y += 1) {
      for (let x = center.x - radius; x <= center.x + radius; x += 1) {
        const position = { x, y };
        if (!this.inBounds(position)) {
          continue;
        }

        const distance = Math.hypot(center.x - x, center.y - y);
        if (distance <= radius && Math.random() < chance - distance * 0.08) {
          this.setTile(position, type);
        }
      }
    }
  }

  private randomPosition(): Vec2 {
    return {
      x: Math.floor(Math.random() * this.width),
      y: Math.floor(Math.random() * this.height),
    };
  }

  private randomLandPosition(): Vec2 {
    return {
      x: 4 + Math.floor(Math.random() * (this.width - 8)),
      y: 4 + Math.floor(Math.random() * (this.height - 8)),
    };
  }
}

function houseProximityBonus(houseTiles: Vec2[], cx: number, cy: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const tile of houseTiles) {
    const distance = Math.abs(tile.x - cx) + Math.abs(tile.y - cy);
    if (distance < nearest) {
      nearest = distance;
    }
  }
  if (nearest <= 8) {
    return 10 - nearest;
  }
  return 0;
}
