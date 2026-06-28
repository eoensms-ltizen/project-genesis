import type { BuildingKind, Vec2 } from "./types";

export type TileRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_BUILDING_SIZE: Partial<Record<BuildingKind, [number, number]>> = {
  house: [3, 3],
  warehouse: [3, 3],
  granary: [3, 3],
  kitchen: [3, 3],
  funfair: [5, 4],
  pasture: [4, 4],
};

export function normalizeDraftRect(kind: BuildingKind, start: Vec2, end: Vec2): TileRect {
  const [minWidth, minHeight] = MIN_BUILDING_SIZE[kind] ?? [3, 3];
  const xDir = end.x >= start.x ? 1 : -1;
  const yDir = end.y >= start.y ? 1 : -1;

  let minX = Math.min(start.x, end.x);
  let maxX = Math.max(start.x, end.x);
  let minY = Math.min(start.y, end.y);
  let maxY = Math.max(start.y, end.y);

  if (maxX - minX + 1 < minWidth) {
    if (xDir >= 0) {
      maxX = minX + minWidth - 1;
    } else {
      minX = maxX - minWidth + 1;
    }
  }
  if (maxY - minY + 1 < minHeight) {
    if (yDir >= 0) {
      maxY = minY + minHeight - 1;
    } else {
      minY = maxY - minHeight + 1;
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function tileKey(tile: Vec2): string {
  return `${tile.x},${tile.y}`;
}

export function lineTiles(from: Vec2, to: Vec2): Vec2[] {
  const tiles: Vec2[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx - dy;

  while (true) {
    tiles.push({ x, y });
    if (x === to.x && y === to.y) {
      break;
    }
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return tiles;
}
