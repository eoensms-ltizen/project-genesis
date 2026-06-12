import { AgentBrain } from "./agents/AgentBrain";
import { bumpAgentIdCounter, createRandomAgent } from "./agents/Agent";
import type {
  Agent,
  Building,
  BuildingKind,
  BuildingStage,
  GameClock,
  GameLogEntry,
  SimulationSnapshot,
  TileType,
  Vec2,
} from "./types";
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

// One in-game day passes in five real minutes; the clock starts at 08:00.
const DAY_LENGTH_SECONDS = 300;
const DAYS_PER_YEAR = 20;
const CLOCK_START_OFFSET_SECONDS = (8 / 24) * DAY_LENGTH_SECONDS;
const NIGHT_START_HOUR = 21;
const NIGHT_END_HOUR = 6;

export const SAVE_KEY = "project-genesis-save";
const SAVE_VERSION = 2;
const AUTOSAVE_INTERVAL_SECONDS = 15;

type SavedAgent = Omit<Agent, "target" | "path" | "state" | "actionTimer">;

type SaveData = {
  version: number;
  elapsedSeconds: number;
  lastBirthAt: number;
  worldWidth: number;
  worldHeight: number;
  tiles: string;
  traffic: [number, number][];
  agents: SavedAgent[];
  buildings: Building[];
  nextBuildingId: number;
};

export class Simulation {
  readonly world: WorldMap;
  readonly agents: Agent[] = [];
  readonly buildings: Building[] = [];

  private nextBuildingId = 1;
  private readonly brain = new AgentBrain();
  private readonly onChange: SimulationOptions["onChange"];
  private readonly logs: GameLogEntry[] = [];
  private readonly claimedTiles = new Set<string>();
  private traffic = new Map<number, number>();
  private elapsedSeconds = 0;
  private natureTimer = 0;
  private autosaveTimer = 0;
  private lastBirthAt = 0;
  private lastPathLogAt = -PATH_LOG_COOLDOWN_SECONDS;
  private nextLogId = 1;
  private dirty = true;

  constructor(options: SimulationOptions) {
    this.onChange = options.onChange;

    const saved = loadSaveData();
    if (saved) {
      this.world =
        WorldMap.fromSerializedTiles(saved.worldWidth, saved.worldHeight, saved.tiles) ??
        WorldMap.createRandom();
      this.elapsedSeconds = saved.elapsedSeconds;
      this.lastBirthAt = saved.lastBirthAt;
      this.traffic = new Map(saved.traffic);
      this.nextBuildingId = saved.nextBuildingId;
      for (const building of saved.buildings) {
        this.buildings.push(building);
        if (building.stage !== "built") {
          this.claimBuildingFootprint(building);
        }
      }
      for (const savedAgent of saved.agents) {
        const agent: Agent = {
          ...savedAgent,
          state: "Idle",
          actionTimer: 0,
        };
        this.agents.push(agent);
        const idNumber = Number(agent.id.split("-")[1]);
        if (Number.isFinite(idNumber)) {
          bumpAgentIdCounter(idNumber + 1);
        }
      }
      this.log("The village awakens.");
    } else {
      this.world = WorldMap.createRandom();
      this.log("A new valley is ready.");
    }
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

    this.autosaveTimer += deltaSeconds;
    if (this.autosaveTimer >= AUTOSAVE_INTERVAL_SECONDS) {
      this.autosaveTimer = 0;
      this.saveNow();
    }

    // The clock display changes every frame's worth of game minutes.
    this.notifyChanged();

    if (this.dirty) {
      this.emitChange();
    }
  }

  getClock(): GameClock {
    const total = this.elapsedSeconds + CLOCK_START_OFFSET_SECONDS;
    const dayFloat = total / DAY_LENGTH_SECONDS;
    const dayIndex = Math.floor(dayFloat);
    const hourFloat = (dayFloat - dayIndex) * 24;
    const hour = Math.floor(hourFloat);
    const minute = Math.floor((hourFloat - hour) * 60);
    return {
      year: Math.floor(dayIndex / DAYS_PER_YEAR) + 1,
      day: (dayIndex % DAYS_PER_YEAR) + 1,
      hour,
      minute,
      isNight: hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR,
    };
  }

  isNight(): boolean {
    return this.getClock().isNight;
  }

  /** 0 in daylight, 1 in deep night, with dusk/dawn ramps. */
  getDarkness(): number {
    const total = this.elapsedSeconds + CLOCK_START_OFFSET_SECONDS;
    const hourFloat = ((total / DAY_LENGTH_SECONDS) % 1) * 24;
    if (hourFloat >= 22 || hourFloat < 4) {
      return 1;
    }
    if (hourFloat >= 19) {
      return (hourFloat - 19) / 3;
    }
    if (hourFloat < 7) {
      return (7 - hourFloat) / 3;
    }
    return 0;
  }

  registerBuilding(input: {
    kind: BuildingKind;
    x: number;
    y: number;
    width: number;
    height: number;
    door: Vec2;
    ownerId?: string;
  }): Building {
    const building: Building = {
      id: `building-${this.nextBuildingId++}`,
      stage: "site",
      ...input,
    };
    this.buildings.push(building);
    return building;
  }

  getBuilding(id: string): Building | undefined {
    return this.buildings.find((building) => building.id === id);
  }

  setBuildingStage(building: Building, stage: BuildingStage) {
    building.stage = stage;
    const tileType: TileType =
      stage === "site" ? "HouseSite" : stage === "foundation" ? "HouseFoundation" : "House";
    for (const position of footprintTiles(building)) {
      this.world.setTile(position, tileType);
    }
    this.notifyChanged();
  }

  claimBuildingFootprint(building: Building) {
    for (const position of footprintTiles(building)) {
      this.claimTile(position);
    }
  }

  releaseBuildingFootprint(building: Building) {
    for (const position of footprintTiles(building)) {
      this.releaseClaim(position);
    }
  }

  saveNow() {
    try {
      const data: SaveData = {
        version: SAVE_VERSION,
        elapsedSeconds: this.elapsedSeconds,
        lastBirthAt: this.lastBirthAt,
        worldWidth: this.world.width,
        worldHeight: this.world.height,
        tiles: this.world.serializeTiles(),
        traffic: [...this.traffic.entries()],
        agents: this.agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          age: agent.age,
          gender: agent.gender,
          job: agent.job,
          personality: { ...agent.personality },
          health: { ...agent.health },
          position: { ...agent.position },
          inventory: { ...agent.inventory },
          home: agent.home ? { ...agent.home } : undefined,
          homeSite: agent.homeSite ? { ...agent.homeSite } : undefined,
          homeBuildingId: agent.homeBuildingId,
        })),
        buildings: this.buildings.map((building) => ({
          ...building,
          door: { ...building.door },
        })),
        nextBuildingId: this.nextBuildingId,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // Storage may be full or unavailable; the game keeps running without saves.
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
      clock: this.getClock(),
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

    const houses = this.buildings.filter((building) => building.stage === "built");
    if (houses.length === 0) {
      return;
    }

    const berries = this.world.countType("Berry");
    if (berries < this.agents.length * 2) {
      return;
    }

    const house = houses[Math.floor(Math.random() * houses.length)];
    const spawn = this.findSpawnPosition({ x: house.door.x, y: house.door.y + 1 });
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

function loadSaveData(): SaveData | undefined {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      return undefined;
    }
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== SAVE_VERSION || typeof data.tiles !== "string") {
      return undefined;
    }
    return data;
  } catch {
    return undefined;
  }
}

function claimKey(position: Vec2): string {
  return `${position.x},${position.y}`;
}

export function footprintTiles(building: Building): Vec2[] {
  const tiles: Vec2[] = [];
  for (let y = building.y; y < building.y + building.height; y += 1) {
    for (let x = building.x; x < building.x + building.width; x += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}
