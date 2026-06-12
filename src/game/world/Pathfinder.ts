import type { Vec2 } from "../types";
import { MIN_MOVE_COST, type WorldMap } from "./WorldMap";

const DIAGONAL_COST = Math.SQRT2;

const DIRECTIONS: Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export type PathRequest = {
  start: Vec2;
  goal: Vec2;
  /**
   * Stop on a walkable tile next to the goal instead of on it.
   * Used for work targets like trees that cannot be stood on.
   */
  stopAdjacent?: boolean;
};

/**
 * Grid A* with octile heuristic and per-tile movement costs.
 * Returns the list of tile waypoints excluding the start tile,
 * or undefined when the goal is unreachable.
 */
export function findPath(world: WorldMap, request: PathRequest): Vec2[] | undefined {
  const { width, height } = world;
  const start = roundVec(request.start);
  const goal = roundVec(request.goal);

  if (!world.inBounds(start) || !world.inBounds(goal)) {
    return undefined;
  }

  const goalSet = collectGoalIndices(world, goal, request.stopAdjacent ?? false);
  if (goalSet.size === 0) {
    return undefined;
  }

  const size = width * height;
  const gScore = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const fScore = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open: number[] = [];

  const startIndex = start.y * width + start.x;
  gScore[startIndex] = 0;
  fScore[startIndex] = heuristic(start, goal);
  open.push(startIndex);

  while (open.length > 0) {
    let bestSlot = 0;
    for (let i = 1; i < open.length; i += 1) {
      if (fScore[open[i]] < fScore[open[bestSlot]]) {
        bestSlot = i;
      }
    }
    const current = open[bestSlot];
    open[bestSlot] = open[open.length - 1];
    open.pop();

    if (closed[current]) {
      continue;
    }
    closed[current] = 1;

    if (goalSet.has(current)) {
      return reconstructPath(parent, current, startIndex, width);
    }

    const cx = current % width;
    const cy = (current - cx) / width;

    for (const dir of DIRECTIONS) {
      const nx = cx + dir.x;
      const ny = cy + dir.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }

      const moveCost = world.moveCost({ x: nx, y: ny });
      if (!Number.isFinite(moveCost)) {
        continue;
      }

      const isDiagonal = dir.x !== 0 && dir.y !== 0;
      if (isDiagonal) {
        // No cutting corners around blocked tiles.
        if (
          !world.isWalkable({ x: cx + dir.x, y: cy }) ||
          !world.isWalkable({ x: cx, y: cy + dir.y })
        ) {
          continue;
        }
      }

      const next = ny * width + nx;
      if (closed[next]) {
        continue;
      }

      const tentative = gScore[current] + (isDiagonal ? DIAGONAL_COST : 1) * moveCost;
      if (tentative < gScore[next]) {
        gScore[next] = tentative;
        fScore[next] = tentative + heuristic({ x: nx, y: ny }, goal);
        parent[next] = current;
        open.push(next);
      }
    }
  }

  return undefined;
}

export function roundVec(position: Vec2): Vec2 {
  return { x: Math.round(position.x), y: Math.round(position.y) };
}

function collectGoalIndices(world: WorldMap, goal: Vec2, stopAdjacent: boolean): Set<number> {
  const result = new Set<number>();
  if (stopAdjacent) {
    for (const dir of DIRECTIONS) {
      const position = { x: goal.x + dir.x, y: goal.y + dir.y };
      if (world.isWalkable(position)) {
        result.add(position.y * world.width + position.x);
      }
    }
  } else if (world.isWalkable(goal)) {
    result.add(goal.y * world.width + goal.x);
  }
  return result;
}

function heuristic(a: Vec2, b: Vec2): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const octile = dx + dy + (DIAGONAL_COST - 2) * Math.min(dx, dy);
  return octile * MIN_MOVE_COST;
}

function reconstructPath(parent: Int32Array, end: number, start: number, width: number): Vec2[] {
  const path: Vec2[] = [];
  let current = end;
  while (current !== start && current !== -1) {
    path.push({ x: current % width, y: Math.floor(current / width) });
    current = parent[current];
  }
  return path.reverse();
}
