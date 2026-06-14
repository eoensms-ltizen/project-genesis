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
  // Furniture sits on a room floor and is walkable (you stand at / lie on it).
  Stove: 1,
  Bed: 1,
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
  Bed: "b",
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
    }
  }

  get version(): number {
    return this.changeVersion;
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
    const houseTiles: Vec2[] = this.tiles.filter((tile) => tile.type === "House");
    const far = options?.far ?? false;
    const minDistance = options?.minDistance ?? 0;
    const extraScore = options?.extraScore;
    // Cluster mode lets buildings sit shoulder-to-shoulder (a hamlet feel); the
    // only hard rule is that the door (bottom-left, in front) stays clear so the
    // building is never sealed in. Otherwise a one-tile gap is kept all around.
    const cluster = options?.cluster ?? false;

    let best: Vec2 | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let y = 1; y <= this.height - height - 1; y += 1) {
      for (let x = 1; x <= this.width - width - 1; x += 1) {
        if (!this.isFootprintFree(x, y, width, height, isBlocked)) {
          continue;
        }

        const ring = this.ringInfo(x, y, width, height, isBlocked);
        if (!cluster && !ring.clear) {
          continue;
        }

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

  private ringInfo(
    x: number,
    y: number,
    width: number,
    height: number,
    isBlocked?: (position: Vec2) => boolean,
  ): { clear: boolean; touchesPath: boolean } {
    let touchesPath = false;
    for (let ry = y - 1; ry <= y + height; ry += 1) {
      for (let rx = x - 1; rx <= x + width; rx += 1) {
        const inFootprint = rx >= x && rx < x + width && ry >= y && ry < y + height;
        if (inFootprint) {
          continue;
        }
        const tile = this.getTile({ x: rx, y: ry });
        if (!tile) {
          continue;
        }
        // A claimed tile is another building's footprint that hasn't been typed
        // yet (e.g. a site staked the same tick), so treat it as occupied —
        // otherwise two buildings stake flush and seal each other's doors.
        if (
          tile.type === "Water" ||
          tile.type === "House" ||
          tile.type === "HouseSite" ||
          tile.type === "HouseFoundation" ||
          isBlocked?.({ x: rx, y: ry })
        ) {
          return { clear: false, touchesPath: false };
        }
        if (tile.type === "Road" || tile.type === "Dirt" || tile.type === "Plaza") {
          touchesPath = true;
        }
      }
    }
    return { clear: true, touchesPath };
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
