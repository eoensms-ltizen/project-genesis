import type { TileType, Vec2 } from "../types";
import type { Tile } from "./Tile";

const TREE_CLUSTER_COUNT = 22;
const WATER_CLUSTER_COUNT = 4;
const BERRY_CLUSTER_COUNT = 7;

// RimWorld-style per-tile movement cost. Lower is faster; Infinity is impassable.
const MOVE_COSTS: Record<TileType, number> = {
  Road: 0.6,
  Dirt: 0.75,
  Grass: 1,
  HouseSite: 1,
  House: 1,
  HouseFoundation: 1.2,
  Berry: 1.25,
  Tree: Number.POSITIVE_INFINITY,
  Water: Number.POSITIVE_INFINITY,
};

export const MIN_MOVE_COST = MOVE_COSTS.Road;

export class WorldMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: Tile[];

  // Bumped on every tile change so the renderer can skip redrawing an unchanged world.
  private changeVersion = 0;

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

    for (let i = 0; i < BERRY_CLUSTER_COUNT; i += 1) {
      map.seedBerryCluster();
    }

    return map;
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
    return tile ? MOVE_COSTS[tile.type] : Number.POSITIVE_INFINITY;
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

  findHouseSiteCandidate(origin: Vec2, isBlocked?: (position: Vec2) => boolean): Vec2 | undefined {
    const radiusLimit = 12;
    for (let radius = 2; radius <= radiusLimit; radius += 1) {
      for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
        for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
          const position = { x, y };
          const tile = this.getTile(position);
          if (!tile || tile.type !== "Grass") {
            continue;
          }
          if (isBlocked?.(position)) {
            continue;
          }
          if (this.hasOpenArea(position)) {
            return position;
          }
        }
      }
    }

    return this.findNearestType(origin, "Grass");
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

  private hasOpenArea(position: Vec2): boolean {
    for (let y = position.y - 1; y <= position.y + 1; y += 1) {
      for (let x = position.x - 1; x <= position.x + 1; x += 1) {
        const tile = this.getTile({ x, y });
        if (!tile || tile.type !== "Grass") {
          return false;
        }
      }
    }
    return true;
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
