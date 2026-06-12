import type { TileType, Vec2 } from "../types";
import type { Tile } from "./Tile";

const TREE_CLUSTER_COUNT = 22;
const WATER_CLUSTER_COUNT = 4;

export class WorldMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: Tile[];

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
    if (tile) {
      tile.type = type;
    }
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
    const tile = this.getTile(position);
    return Boolean(tile && tile.type !== "Water" && tile.type !== "Tree");
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

  findHouseSiteCandidate(origin: Vec2): Vec2 | undefined {
    const radiusLimit = 12;
    for (let radius = 2; radius <= radiusLimit; radius += 1) {
      for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
        for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
          const position = { x, y };
          const tile = this.getTile(position);
          if (!tile || tile.type !== "Grass") {
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
