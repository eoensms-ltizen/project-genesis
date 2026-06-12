import { AgentBrain } from "./agents/AgentBrain";
import { createRandomAgent } from "./agents/Agent";
import type { Agent, GameLogEntry, SimulationSnapshot, TileType, Vec2 } from "./types";
import { WorldMap } from "./world/WorldMap";

type SimulationOptions = {
  onChange: (snapshot: SimulationSnapshot) => void;
};

// Crossings needed before grass wears into a footpath, then into a road.
const PATH_WEAR_THRESHOLD = 6;
const ROAD_WEAR_THRESHOLD = 16;
const PATH_LOG_COOLDOWN_SECONDS = 8;

const NATURE_TICK_SECONDS = 5;
const BERRY_CAP = 140;
const TREE_CAP = 320;

const BIRTH_COOLDOWN_SECONDS = 45;
const POPULATION_CAP = 30;

export class Simulation {
  readonly world: WorldMap;
  readonly agents: Agent[] = [];

  private readonly brain = new AgentBrain();
  private readonly onChange: SimulationOptions["onChange"];
  private readonly logs: GameLogEntry[] = [];
  private readonly claimedTiles = new Set<string>();
  private readonly traffic = new Map<number, number>();
  private elapsedSeconds = 0;
  private natureTimer = 0;
  private lastBirthAt = 0;
  private lastPathLogAt = -PATH_LOG_COOLDOWN_SECONDS;
  private nextLogId = 1;
  private dirty = true;

  constructor(options: SimulationOptions) {
    this.world = WorldMap.createRandom();
    this.onChange = options.onChange;
    this.log("A new valley is ready.");
  }

  addRandomAgent(position: Vec2) {
    const spawn = this.findSpawnPosition(position);
    const agent = createRandomAgent(spawn);
    this.agents.push(agent);
    this.log(`${agent.name} spawned.`);
    this.notifyChanged();
  }

  update(deltaSeconds: number) {
    this.elapsedSeconds += deltaSeconds;
    for (const agent of this.agents) {
      this.brain.update(agent, this, deltaSeconds);
    }

    this.natureTimer += deltaSeconds;
    if (this.natureTimer >= NATURE_TICK_SECONDS) {
      this.natureTimer = 0;
      this.regrowNature();
      this.tryBirth();
    }

    if (this.dirty) {
      this.emitChange();
    }
  }

  claimTile(position: Vec2) {
    this.claimedTiles.add(claimKey(position));
  }

  releaseClaim(position: Vec2) {
    this.claimedTiles.delete(claimKey(position));
  }

  isTileClaimed(position: Vec2): boolean {
    return this.claimedTiles.has(claimKey(position));
  }

  recordTraffic(position: Vec2) {
    const tile = this.world.getTile(position);
    if (!tile || (tile.type !== "Grass" && tile.type !== "Dirt")) {
      return;
    }

    const index = tile.y * this.world.width + tile.x;
    const count = (this.traffic.get(index) ?? 0) + 1;
    this.traffic.set(index, count);

    if (tile.type === "Grass" && count >= PATH_WEAR_THRESHOLD) {
      this.world.setTile(tile, "Dirt");
      this.logPathEvent("A footpath is being worn into the grass.");
    } else if (tile.type === "Dirt" && count >= ROAD_WEAR_THRESHOLD) {
      this.world.setTile(tile, "Road");
      this.traffic.delete(index);
      this.logPathEvent("A well-trodden path has become a road.");
    }
  }

  log(message: string) {
    this.logs.push({
      id: `log-${this.nextLogId++}`,
      time: this.elapsedSeconds,
      message,
    });

    while (this.logs.length > 80) {
      this.logs.shift();
    }

    this.notifyChanged();
  }

  notifyChanged() {
    this.dirty = true;
  }

  getSnapshot(): SimulationSnapshot {
    return {
      agents: this.agents.map((agent) => ({
        ...agent,
        position: { ...agent.position },
        target: agent.target ? { ...agent.target } : undefined,
        path: agent.path ? agent.path.map((point) => ({ ...point })) : undefined,
        home: agent.home ? { ...agent.home } : undefined,
        homeSite: agent.homeSite ? { ...agent.homeSite } : undefined,
        personality: { ...agent.personality },
        health: { ...agent.health },
        inventory: { ...agent.inventory },
      })),
      logs: [...this.logs],
    };
  }

  private logPathEvent(message: string) {
    if (this.elapsedSeconds - this.lastPathLogAt < PATH_LOG_COOLDOWN_SECONDS) {
      return;
    }
    this.lastPathLogAt = this.elapsedSeconds;
    this.log(message);
  }

  private regrowNature() {
    const berries: Vec2[] = [];
    const trees: Vec2[] = [];
    for (const tile of this.world.tiles) {
      if (tile.type === "Berry") {
        berries.push(tile);
      } else if (tile.type === "Tree") {
        trees.push(tile);
      }
    }

    if (berries.length === 0) {
      this.world.seedBerryCluster();
      this.log("Wild berries sprouted in the valley.");
      return;
    }

    if (berries.length < BERRY_CAP) {
      for (const berry of berries) {
        if (Math.random() < 0.06) {
          this.spreadTile(berry, "Berry");
        }
      }
    }

    if (trees.length > 0 && trees.length < TREE_CAP) {
      for (const tree of trees) {
        if (Math.random() < 0.012) {
          this.spreadTile(tree, "Tree");
        }
      }
    }
  }

  private spreadTile(origin: Vec2, type: TileType) {
    const dx = Math.floor(Math.random() * 3) - 1;
    const dy = Math.floor(Math.random() * 3) - 1;
    if (dx === 0 && dy === 0) {
      return;
    }

    const position = { x: origin.x + dx, y: origin.y + dy };
    const tile = this.world.getTile(position);
    if (!tile || tile.type !== "Grass") {
      return;
    }
    if (this.isTileClaimed(position)) {
      return;
    }
    if (
      this.agents.some(
        (agent) =>
          Math.round(agent.position.x) === position.x &&
          Math.round(agent.position.y) === position.y,
      )
    ) {
      return;
    }

    this.world.setTile(position, type);
  }

  private tryBirth() {
    if (this.agents.length < 2 || this.agents.length >= POPULATION_CAP) {
      return;
    }
    if (this.elapsedSeconds - this.lastBirthAt < BIRTH_COOLDOWN_SECONDS) {
      return;
    }

    const houses = this.world.tiles.filter((tile) => tile.type === "House");
    if (houses.length === 0) {
      return;
    }

    const berries = this.world.countType("Berry");
    if (berries < this.agents.length * 2) {
      return;
    }

    const house = houses[Math.floor(Math.random() * houses.length)];
    const spawn = this.findSpawnPosition({ x: house.x, y: house.y });
    const child = createRandomAgent(spawn);
    this.agents.push(child);
    this.lastBirthAt = this.elapsedSeconds;
    this.log(`${child.name} was born. The village is growing.`);
    this.notifyChanged();
  }

  private emitChange() {
    this.dirty = false;
    this.onChange(this.getSnapshot());
  }

  private findSpawnPosition(preferred: Vec2): Vec2 {
    const rounded = {
      x: Math.max(0, Math.min(this.world.width - 1, Math.round(preferred.x))),
      y: Math.max(0, Math.min(this.world.height - 1, Math.round(preferred.y))),
    };

    if (this.world.isWalkable(rounded)) {
      return rounded;
    }

    for (let radius = 1; radius < 12; radius += 1) {
      for (let y = rounded.y - radius; y <= rounded.y + radius; y += 1) {
        for (let x = rounded.x - radius; x <= rounded.x + radius; x += 1) {
          const candidate = { x, y };
          if (this.world.isWalkable(candidate)) {
            return candidate;
          }
        }
      }
    }

    return { x: 0, y: 0 };
  }
}

function claimKey(position: Vec2): string {
  return `${position.x},${position.y}`;
}
