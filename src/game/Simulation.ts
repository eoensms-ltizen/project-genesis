import { AgentBrain } from "./agents/AgentBrain";
import { bumpAgentIdCounter, createRandomAgent } from "./agents/Agent";
import type {
  Agent,
  AgentJob,
  Animal,
  AnimalKind,
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

const BIRTH_COOLDOWN_SECONDS = 12;
// Attachment-first scale ladder: population is kept small and earned. The
// village only supports more residents as it advances through the eras, and
// even then only up to what its housing can shelter (see supportedPopulation).
const ERA_POP_CEILING = [8, 14, 22, 30, 40];
// Couples only have children when the village is, on average, content — so
// growth follows happiness, and an overstretched settlement naturally pauses.
const BIRTH_WELLBEING = 55;

// One in-game day passes in five real minutes; the clock starts at 08:00.
const DAY_LENGTH_SECONDS = 300;
const DAYS_PER_YEAR = 20;
const CLOCK_START_OFFSET_SECONDS = (8 / 24) * DAY_LENGTH_SECONDS;
const NIGHT_START_HOUR = 21;
const NIGHT_END_HOUR = 6;

export const SAVE_KEY = "project-genesis-save";
const SAVE_VERSION = 10;

// Residents age one year per in-game day; children come of age at 12,
// retire at 60, and pass away when they outlive their personal lifespan.
export const ADULT_AGE = 12;
export const ELDER_AGE = 60;
const COUPLE_BIRTH_COOLDOWN_SECONDS = 90;
const STUMP_REGROW_CHANCE = 0.03;
const DURABILITY_DECAY_PER_TICK = 0.012;
const EPISODE_CAP = 15;

// A 3x3 block of roads becomes a plaza; it then grows along adjacent roads.
const PLAZA_DECOR_INTERVAL = 12;

const ANIMAL_CAP = 8;
const ANIMAL_MOVE_INTERVAL = 0.6;
const ANIMAL_SPAWN_CHANCE = 0.5;
const PASTURE_HERD_CAP = 6;
const PASTURE_YIELD_CHANCE = 0.25;

const ANIMAL_FOOD: Record<AnimalKind, number> = { deer: 3, boar: 4, rabbit: 1 };
const ANIMAL_HEALTH: Record<AnimalKind, number> = { deer: 3, boar: 4, rabbit: 2 };
const TAMEABLE: Record<AnimalKind, boolean> = { deer: true, boar: false, rabbit: true };

// Industrial era: a power plant electrifies nearby buildings; a factory
// cans surplus food; a station's trade train delivers goods each pass.
const POWER_RADIUS = 14;
const FACTORY_FOOD_PER_TICK = 3;
const TRAIN_SPEED = 9;
const TRAIN_DELIVER_FOOD = 8;

export const ERA_NAMES = ["Pioneer", "Settlement", "Town", "City", "Industrial"];
const CROP_RIPEN_CHANCE = 0.05;
const AUTOSAVE_INTERVAL_SECONDS = 15;
// Throttle React panel updates; the Pixi canvas renders independently every tick.
const UI_EMIT_INTERVAL_SECONDS = 0.25;
const FOOD_CAP = 400;

// Land pressure: when the nearest open plot to the village centre is farther
// than this, residents densify existing housing instead of sprawling.
const SPRAWL_LIMIT = 9;
// Houses redevelop in place up the tier ladder, packing more residents into the
// same footprint: cottage -> villa -> apartment -> tower. Capacity counts
// individual residents (a family shares a home), so it can be compared directly
// against how many people actually live there.
const HOUSE_MAX_LEVEL = 4;
const HOUSE_CAPACITY_BY_LEVEL = [0, 3, 6, 12, 24];
// Building taller is a steeply escalating investment, so stacking is never the
// cheap default — the village is nudged to spread outward instead. Indexed by
// the target level (the level being upgraded TO).
const REDEVELOP_COST_BY_LEVEL = [0, 0, 16, 30, 50];
// Builders proactively rebuild taller once the village has at most this many
// spare beds — crowding, not distant empty land, is what drives growing upward.
const REDEVELOP_HEADROOM = 2;
// Roads/paths with no recent traffic weather back toward nature — kept very
// slow for now so infrastructure (e.g. the road out to the cemetery) persists
// and decay is barely noticeable.
const DECAY_CHANCE = 0.004;
const ABANDON_DECAY_PER_TICK = 6;

// The cemetery is a nuisance: sited far from the village centre, and homes avoid
// settling within its shadow — one of the reasons the town spreads out.
const CEMETERY_MIN_DISTANCE = 16;
const CEMETERY_NUISANCE_RADIUS = 9;

// Ambiance: how pleasant a spot feels. Amenities radiate positive ambiance,
// nuisances negative. Homes seek high ambiance; fields/workshops seek low (so
// they cluster together, away from housing). A blurred grid is recomputed
// periodically so lookups are O(1).
const AMBIANCE_RADIUS = 7;
const BUILDING_AMBIANCE: Partial<Record<BuildingKind, number>> = {
  park: 6,
  church: 5,
  police: 4,
  station: 1,
  powerplant: -8,
  factory: -7,
  cemetery: -10,
};
const TILE_AMBIANCE: Partial<Record<TileType, number>> = {
  Plaza: 4,
  Fountain: 5,
  Statue: 3,
  Lamp: 2,
  FieldEmpty: -3,
  FieldGrowing: -3,
  FieldRipe: -3,
  Stump: -2,
};
const TILE_AMBIANCE_RADIUS = 4;

// Relocation: workplaces that ended up too close to housing are moved out over
// time, freeing the land for homes and amenities.
const FIELD_RELOCATE_RADIUS = 4;
const FIELD_RELOCATE_PER_TICK = 3;
const WORKSHOP_RELOCATE_RADIUS = 6;

// Litter: daily life leaves refuse, more of it the busier the town. It is an
// eyesore (negative ambiance) until a cleaner clears it — a need with a cost.
const LITTER_AMBIANCE = -1.5;
const LITTER_AMBIANCE_RADIUS = 3;
const LITTER_SPAWN_CHANCE_PER_CAPITA = 0.01;
const LITTER_THRESHOLD = 6;
const LITTERABLE: ReadonlySet<TileType> = new Set([
  "Grass",
  "Road",
  "Dirt",
  "Plaza",
  "Lamp",
  "Stump",
]);

// Ground that may be paved into a building's entrance road. Excludes water,
// trees, decor and other buildings' tiles so paving never destroys anything.
const ROADABLE: ReadonlySet<TileType> = new Set([
  "Grass",
  "Dirt",
  "Road",
  "Stump",
  "FieldEmpty",
  "FieldGrowing",
  "FieldRipe",
  "Plaza",
  "Lamp",
]);

// Public order: crowding and discontent breed friction; police and a station
// keep it in check. Unrest is a 0..100 meter that drives the police job and
// occasionally erupts into a quarrel that dents the participants' comfort.
const UNREST_THRESHOLD = 30; // a quarrel can erupt above this
const POLICE_ON_THRESHOLD = 10; // keep officers on duty above this (hysteresis vs the quarrel line)
const POLICE_STATION_THRESHOLD = 15; // build a station once friction recurs
const QUARREL_COMFORT_HIT = 16;

type SavedAgent = Omit<
  Agent,
  "target" | "path" | "state" | "actionTimer" | "socialCooldown" | "resumeState"
>;

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
  era: number;
  foodStock: number;
  meals: number;
  animals: Animal[];
  nextAnimalId: number;
  trainX: number | null;
  trainRow: number;
  trainDir: number;
};

export class Simulation {
  readonly world: WorldMap;
  readonly agents: Agent[] = [];
  readonly buildings: Building[] = [];
  readonly animals: Animal[] = [];
  readonly litter: Vec2[] = [];
  unrest = 0;
  era = 0;
  foodStock = 0;
  meals = 0;
  deaths = 0;

  private nextBuildingId = 1;
  private nextAnimalId = 1;
  private trainX: number | null = null;
  private trainRow = 0;
  private trainDir = 1;
  private readonly brain = new AgentBrain();
  private readonly onChange: SimulationOptions["onChange"];
  private readonly logs: GameLogEntry[] = [];
  private readonly claimedTiles = new Set<string>();
  private readonly episodes = new Map<string, GameLogEntry[]>();
  private traffic = new Map<number, number>();
  private ambianceGrid = new Float32Array(0);
  private elapsedSeconds = 0;
  private natureTimer = 0;
  private autosaveTimer = 0;
  private uiEmitTimer = UI_EMIT_INTERVAL_SECONDS;
  private lastBirthAt = 0;
  private lastPathLogAt = -PATH_LOG_COOLDOWN_SECONDS;
  private nextLogId = 1;
  private dirty = true;
  private savingDisabled = false;
  private lastAgedDayIndex = -1;
  private lastWorshipLogDay = -1;

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
      this.era = saved.era;
      this.foodStock = saved.foodStock;
      this.meals = saved.meals;
      this.nextAnimalId = saved.nextAnimalId ?? 1;
      this.trainX = saved.trainX ?? null;
      this.trainRow = saved.trainRow ?? 0;
      this.trainDir = saved.trainDir ?? 1;
      for (const animal of saved.animals ?? []) {
        this.animals.push({ ...animal, path: undefined });
      }
      for (const building of saved.buildings) {
        // Older saves predate the tier ladder; recover the level from capacity.
        if (building.kind === "house" && building.stage === "built" && !building.level) {
          building.level = this.houseLevel(building);
          building.capacity = this.houseCapacity(building);
        }
        this.buildings.push(building);
        if (building.stage !== "built") {
          this.claimBuildingFootprint(building);
        }
      }
      for (const savedAgent of saved.agents) {
        const agent: Agent = {
          ...savedAgent,
          // Older saves predate some soft needs; default any missing to content.
          needs: {
            social: savedAgent.needs?.social ?? 70,
            purpose: savedAgent.needs?.purpose ?? 70,
            faith: savedAgent.needs?.faith ?? 70,
            leisure: savedAgent.needs?.leisure ?? 70,
            comfort: savedAgent.needs?.comfort ?? 70,
          },
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
    this.refreshDoors();
    this.recomputeAmbiance();
  }

  addRandomAgent(position: Vec2) {
    const spawn = this.findSpawnPosition(position);
    const agent = createRandomAgent(spawn, this.takenNames());
    this.agents.push(agent);
    this.log(`${agent.name} spawned.`, [agent]);
    this.notifyChanged();
  }

  update(deltaSeconds: number) {
    this.elapsedSeconds += deltaSeconds;
    for (const agent of this.agents) {
      this.brain.update(agent, this, deltaSeconds);
    }

    this.updateAnimals(deltaSeconds);
    this.updateTrain(deltaSeconds);

    this.natureTimer += deltaSeconds;
    if (this.natureTimer >= NATURE_TICK_SECONDS) {
      this.natureTimer = 0;
      this.regrowNature();
      this.growCrops();
      this.tryBirth();
      this.checkEraPromotion();
      this.assignJobs();
      this.ageResidents();
      this.updatePlaza();
      this.spawnAnimals();
      this.runFactories();
      this.decayInfrastructure();
      this.recomputeAmbiance();
      this.relocateMisplacedWork();
      this.spawnLitter();
      this.updateUnrest();
    }

    this.autosaveTimer += deltaSeconds;
    if (this.autosaveTimer >= AUTOSAVE_INTERVAL_SECONDS) {
      this.autosaveTimer = 0;
      this.saveNow();
    }

    // Refresh the React panel on a fixed cadence rather than every event, so a
    // busy industrial city does not thrash React. The canvas stays smooth
    // because GameApp re-renders the Pixi scene every tick regardless.
    this.uiEmitTimer += deltaSeconds;
    if (this.uiEmitTimer >= UI_EMIT_INTERVAL_SECONDS && deltaSeconds > 0) {
      this.uiEmitTimer = 0;
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
    if (stage === "built") {
      building.builtAtDay = Math.floor(
        (this.elapsedSeconds + CLOCK_START_OFFSET_SECONDS) / DAY_LENGTH_SECONDS,
      );
      building.durability = 100;
      if (building.kind === "house" && !building.level) {
        building.level = 1;
        building.capacity = HOUSE_CAPACITY_BY_LEVEL[1];
      }
    }
    const tileType: TileType =
      stage === "site" ? "HouseSite" : stage === "foundation" ? "HouseFoundation" : "House";
    for (const position of footprintTiles(building)) {
      this.world.setTile(position, tileType);
    }
    // The entrance is always a road: the door tile and the tile in front of it
    // become Road, so a building can never be sealed in by neighbours (other
    // footprints only take grass) and residents can always get out.
    const front = { x: building.door.x, y: building.door.y + 1 };
    const frontTile = this.world.getTile(front);
    if (frontTile && ROADABLE.has(frontTile.type)) {
      this.world.setTile(front, "Road");
    }
    if (stage === "built") {
      this.world.setTile(building.door, "Road");
    }
    if (stage === "built" && building.kind === "station") {
      this.layStationRail(building);
    }
    this.refreshDoors();
    this.notifyChanged();
  }

  /** A built building is solid except its door; tell the world which tiles those are. */
  private refreshDoors() {
    const doors: Vec2[] = [];
    for (const building of this.buildings) {
      if (building.stage === "built") {
        doors.push(building.door);
      }
    }
    this.world.setDoors(doors);
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

  /** Stops all future saves; used by "New world" so the wiped save stays wiped. */
  disableSaving() {
    this.savingDisabled = true;
  }

  saveNow() {
    if (this.savingDisabled) {
      return;
    }
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
          needs: { ...agent.needs },
          position: { ...agent.position },
          inventory: { ...agent.inventory },
          home: agent.home ? { ...agent.home } : undefined,
          homeSite: agent.homeSite ? { ...agent.homeSite } : undefined,
          homeBuildingId: agent.homeBuildingId,
          spouseId: agent.spouseId,
          lifespan: agent.lifespan,
          lastChildAt: agent.lastChildAt,
          projectBuildingId: agent.projectBuildingId,
          eatPlan: undefined,
        })),
        buildings: this.buildings.map((building) => ({
          ...building,
          door: { ...building.door },
        })),
        nextBuildingId: this.nextBuildingId,
        era: this.era,
        foodStock: this.foodStock,
        meals: this.meals,
        animals: this.animals.map((animal) => ({
          ...animal,
          position: { ...animal.position },
          path: undefined,
        })),
        nextAnimalId: this.nextAnimalId,
        trainX: this.trainX,
        trainRow: this.trainRow,
        trainDir: this.trainDir,
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

  log(message: string, participants?: { id: string }[]) {
    const entry: GameLogEntry = {
      id: `log-${this.nextLogId++}`,
      time: this.elapsedSeconds,
      message,
    };
    this.logs.push(entry);

    while (this.logs.length > 80) {
      this.logs.shift();
    }

    if (participants) {
      for (const participant of participants) {
        const history = this.episodes.get(participant.id) ?? [];
        history.push(entry);
        while (history.length > EPISODE_CAP) {
          history.shift();
        }
        this.episodes.set(participant.id, history);
      }
    }

    this.notifyChanged();
  }

  getEpisodes(agentId: string): GameLogEntry[] {
    return [...(this.episodes.get(agentId) ?? [])];
  }

  getTrafficAt(position: Vec2): number {
    const tile = this.world.getTile(position);
    if (!tile) {
      return 0;
    }
    return this.traffic.get(tile.y * this.world.width + tile.x) ?? 0;
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
      era: this.era,
      foodStock: this.foodStock,
      meals: this.meals,
      buildings: this.buildings.map((building) => ({
        ...building,
        door: { ...building.door },
      })),
      animals: this.animals.map((animal) => ({
        ...animal,
        position: { ...animal.position },
        path: undefined,
      })),
      trains: this.getTrainPositions(),
      poweredBuildingIds: this.getPoweredBuildingIds(),
      supportedPopulation: this.supportedPopulation(),
      litter: this.litter.length,
      unrest: Math.round(this.unrest),
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

    for (const tile of this.world.tiles) {
      if (tile.type === "Stump" && Math.random() < STUMP_REGROW_CHANCE) {
        if (!this.isTileClaimed(tile)) {
          this.world.setTile(tile, "Tree");
        }
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
        if (Math.random() < 0.008) {
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

  private growCrops() {
    for (const tile of this.world.tiles) {
      if (tile.type === "FieldGrowing" && Math.random() < CROP_RIPEN_CHANCE) {
        this.world.setTile(tile, "FieldRipe");
      }
    }
  }

  private checkEraPromotion() {
    if (this.era === 0) {
      const builtHouses = this.buildings.filter(
        (building) => building.kind === "house" && building.stage === "built",
      ).length;
      // Three homes shelter the eight-resident Pioneer cap, so requiring four
      // would deadlock: the population can never grow enough to build a fourth.
      if (this.agents.length >= 6 && builtHouses >= 3) {
        this.era = 1;
        this.log("The village entered the Settlement era! Fields and a warehouse are now possible.");
      }
      return;
    }

    if (this.era === 1) {
      const hasWarehouse = this.buildings.some(
        (building) => building.kind === "warehouse" && building.stage === "built",
      );
      if (this.agents.length >= 12 && hasWarehouse && this.foodStock >= 20) {
        this.era = 2;
        this.log("The village entered the Town era! Residents will start paving roads.");
      }
      return;
    }

    if (this.era === 2) {
      if (this.agents.length >= 20 && this.getChurch() && this.getKitchen()) {
        this.era = 3;
        this.log("The village blossomed into a City! A plaza will grow at its heart.");
      }
      return;
    }

    if (this.era === 3) {
      if (this.agents.length >= 26 && this.hasAnyPasture()) {
        this.era = 4;
        this.log("The Industrial age dawns! Power, factories, and railways are coming. ⚙️");
      }
    }
  }

  // --- Industry ---------------------------------------------------------

  getPowerPlant(): Building | undefined {
    return this.buildings.find(
      (building) => building.kind === "powerplant" && building.stage === "built",
    );
  }

  hasAnyPowerPlant(): boolean {
    return this.buildings.some((building) => building.kind === "powerplant");
  }

  hasAnyFactory(): boolean {
    return this.buildings.some((building) => building.kind === "factory");
  }

  hasAnyCemetery(): boolean {
    return this.buildings.some((building) => building.kind === "cemetery");
  }

  /** Once residents have died, the village needs a place to lay them to rest. */
  needsCemetery(): boolean {
    return this.deaths > 0 && !this.hasAnyCemetery();
  }

  /** Wood needed to redevelop a house to its next tier (escalates by level). */
  redevelopCost(building: Building): number {
    const next = Math.min(this.houseLevel(building) + 1, HOUSE_MAX_LEVEL);
    return REDEVELOP_COST_BY_LEVEL[next] ?? REDEVELOP_COST_BY_LEVEL[HOUSE_MAX_LEVEL];
  }

  hasAnyPark(): boolean {
    return this.buildings.some((building) => building.kind === "park");
  }

  /** Built houses within `radius` tiles of a point — a local crowding measure. */
  localHouseDensity(position: Vec2, radius: number): number {
    let count = 0;
    for (const building of this.buildings) {
      if (building.kind !== "house" || building.stage !== "built") {
        continue;
      }
      const cx = building.x + building.width / 2;
      const cy = building.y + building.height / 2;
      if (Math.hypot(position.x - cx, position.y - cy) <= radius) {
        count += 1;
      }
    }
    return count;
  }

  /** Nearest built park to a point, for residents seeking some breathing room. */
  nearestPark(position: Vec2): Building | undefined {
    let best: Building | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const building of this.buildings) {
      if (building.kind !== "park" || building.stage !== "built") {
        continue;
      }
      const d = Math.hypot(position.x - (building.x + building.width / 2), position.y - (building.y + building.height / 2));
      if (d < bestDist) {
        bestDist = d;
        best = building;
      }
    }
    return best;
  }

  private meanComfort(): number {
    let sum = 0;
    let count = 0;
    for (const agent of this.agents) {
      if (agent.age < ADULT_AGE) {
        continue;
      }
      sum += agent.needs.comfort;
      count += 1;
    }
    return count === 0 ? 100 : sum / count;
  }

  /**
   * A growing town that feels cramped wants green space. One park is warranted
   * per ~10 residents, and only once people are actually short on comfort.
   */
  needsPark(): boolean {
    if (this.agents.length < 6) {
      return false;
    }
    const parks = this.buildings.filter((b) => b.kind === "park").length;
    return parks < Math.ceil(this.agents.length / 10) && this.meanComfort() < 60;
  }

  /** Net pleasantness of a spot: positive near amenities, negative near nuisances. */
  ambianceAt(position: Vec2): number {
    const w = this.world.width;
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    if (x < 0 || y < 0 || x >= w || y >= this.world.height) {
      return 0;
    }
    return this.ambianceGrid[y * w + x] ?? 0;
  }

  /** Rebuild the ambiance grid by scattering each source over a falloff radius. */
  private recomputeAmbiance() {
    const w = this.world.width;
    const h = this.world.height;
    if (this.ambianceGrid.length !== w * h) {
      this.ambianceGrid = new Float32Array(w * h);
    } else {
      this.ambianceGrid.fill(0);
    }

    const scatter = (cx: number, cy: number, weight: number, radius: number) => {
      const minX = Math.max(0, Math.floor(cx - radius));
      const maxX = Math.min(w - 1, Math.ceil(cx + radius));
      const minY = Math.max(0, Math.floor(cy - radius));
      const maxY = Math.min(h - 1, Math.ceil(cy + radius));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const d = Math.hypot(x - cx, y - cy);
          if (d <= radius) {
            this.ambianceGrid[y * w + x] += weight * (1 - d / radius);
          }
        }
      }
    };

    for (const building of this.buildings) {
      if (building.stage !== "built") {
        continue;
      }
      const weight = BUILDING_AMBIANCE[building.kind];
      if (weight) {
        scatter(building.x + building.width / 2, building.y + building.height / 2, weight, AMBIANCE_RADIUS);
      }
    }
    for (const tile of this.world.tiles) {
      const weight = TILE_AMBIANCE[tile.type];
      if (weight) {
        scatter(tile.x + 0.5, tile.y + 0.5, weight, TILE_AMBIANCE_RADIUS);
      }
    }
    for (const spot of this.litter) {
      scatter(spot.x + 0.5, spot.y + 0.5, LITTER_AMBIANCE, LITTER_AMBIANCE_RADIUS);
    }
  }

  /** True if a built house centre lies within `radius` tiles of a point. */
  hasHouseNear(position: Vec2, radius: number): boolean {
    return this.buildings.some(
      (b) =>
        b.kind === "house" &&
        b.stage === "built" &&
        Math.hypot(position.x - (b.x + b.width / 2), position.y - (b.y + b.height / 2)) <= radius,
    );
  }

  /**
   * Move workplaces that ended up too close to housing out toward the edges:
   * clear a few crowded-in field tiles (farmers re-sow them further out), and
   * decommission a misplaced power plant/factory so it is rebuilt away from
   * homes. The freed land becomes pleasant ground for houses and amenities.
   */
  private relocateMisplacedWork() {
    let cleared = 0;
    for (const tile of this.world.tiles) {
      if (cleared >= FIELD_RELOCATE_PER_TICK) {
        break;
      }
      const isField = tile.type === "FieldEmpty" || tile.type === "FieldGrowing";
      if (!isField || this.isTileClaimed(tile)) {
        continue;
      }
      if (this.hasHouseNear(tile, FIELD_RELOCATE_RADIUS)) {
        this.world.setTile(tile, "Grass");
        cleared += 1;
      }
    }
    if (cleared > 0) {
      this.logPathEvent("Fields crowding the homes were cleared, to be re-sown further out. 🌱");
    }

    const misplaced = this.buildings.find(
      (b) =>
        (b.kind === "powerplant" || b.kind === "factory") &&
        b.stage === "built" &&
        this.hasHouseNear({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, WORKSHOP_RELOCATE_RADIUS),
    );
    if (misplaced) {
      const kind = misplaced.kind;
      this.removeBuilding(misplaced);
      this.log(`The ${kind} was too close to the homes — it will be rebuilt on the outskirts. 🏗️`);
    }
  }

  /** Busy daily life drops refuse near residents; the busier the town, the more. */
  private spawnLitter() {
    const cap = Math.min(40, 4 + this.agents.length);
    if (this.litter.length >= cap) {
      return;
    }
    if (Math.random() > LITTER_SPAWN_CHANCE_PER_CAPITA * this.agents.length) {
      return;
    }
    const adults = this.agents.filter((a) => a.age >= ADULT_AGE);
    if (adults.length === 0) {
      return;
    }
    const source = adults[Math.floor(Math.random() * adults.length)];
    const spot = { x: Math.round(source.position.x), y: Math.round(source.position.y) };
    const tile = this.world.getTile(spot);
    if (tile && LITTERABLE.has(tile.type) && !this.litter.some((l) => l.x === spot.x && l.y === spot.y)) {
      this.litter.push(spot);
    }
  }

  /** Nearest piece of litter to a point, for a cleaner to collect. */
  nearestLitter(position: Vec2): Vec2 | undefined {
    let best: Vec2 | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const spot of this.litter) {
      const d = Math.hypot(position.x - spot.x, position.y - spot.y);
      if (d < bestDist) {
        bestDist = d;
        best = spot;
      }
    }
    return best;
  }

  /** Remove the litter at a tile once a cleaner has collected it. */
  clearLitterAt(position: Vec2) {
    const index = this.litter.findIndex((l) => l.x === position.x && l.y === position.y);
    if (index >= 0) {
      this.litter.splice(index, 1);
      this.notifyChanged();
    }
  }

  litterCount(): number {
    return this.litter.length;
  }

  /** Litter past this level warrants assigning cleaners. */
  get litterIsHigh(): boolean {
    return this.litter.length >= LITTER_THRESHOLD;
  }

  policeCount(): number {
    return this.agents.filter((a) => a.job === "police").length;
  }

  hasPoliceStation(): boolean {
    return this.buildings.some((b) => b.kind === "police" && b.stage === "built");
  }

  /** Police are wanted on duty while there is meaningful friction. */
  get unrestIsHigh(): boolean {
    return this.unrest >= POLICE_ON_THRESHOLD;
  }

  needsPoliceStation(): boolean {
    return this.unrest >= POLICE_STATION_THRESHOLD && !this.hasPoliceStation();
  }

  /**
   * Unrest eases toward a target set by friction (crowding + discontent) minus
   * the order that police and a station can keep — so it settles at an
   * equilibrium instead of running away. High unrest occasionally erupts into a
   * quarrel; officers break it up, otherwise comfort takes the hit.
   */
  private updateUnrest() {
    const friction =
      Math.max(0, this.agents.length - 10) * 0.3 + Math.max(0, 60 - this.meanWellbeing()) * 0.2;
    const order = this.policeCount() * 15 + (this.hasPoliceStation() ? 20 : 0);
    const target = Math.max(0, Math.min(100, friction * 6 - order));
    this.unrest += (target - this.unrest) * 0.3;
    if (this.unrest < 0.5) {
      this.unrest = 0;
    }

    if (this.unrest >= UNREST_THRESHOLD && Math.random() < this.unrest / 280) {
      this.stirQuarrel();
    }
  }

  private stirQuarrel() {
    const adults = this.agents.filter((a) => a.age >= ADULT_AGE);
    if (adults.length < 2) {
      return;
    }
    const a = adults[Math.floor(Math.random() * adults.length)];
    let b = a;
    while (b === a) {
      b = adults[Math.floor(Math.random() * adults.length)];
    }
    if (this.policeCount() > 0) {
      this.unrest = Math.max(0, this.unrest - 12);
      this.logPathEvent(`An officer broke up a quarrel between ${a.name} and ${b.name}. 👮`);
    } else {
      a.needs.comfort = Math.max(0, a.needs.comfort - QUARREL_COMFORT_HIT);
      b.needs.comfort = Math.max(0, b.needs.comfort - QUARREL_COMFORT_HIT);
      this.log(`${a.name} and ${b.name} quarreled — the village needs some order. 😠`);
    }
  }

  /** Tear a building down, returning its footprint to open ground. */
  private removeBuilding(building: Building) {
    this.releaseBuildingFootprint(building);
    for (const position of footprintTiles(building)) {
      this.world.setTile(position, "Grass");
    }
    const index = this.buildings.indexOf(building);
    if (index >= 0) {
      this.buildings.splice(index, 1);
    }
    this.refreshDoors();
    this.notifyChanged();
  }

  /** True if the position sits within the shadow of a cemetery (a nuisance). */
  isNearNuisance(position: Vec2): boolean {
    for (const building of this.buildings) {
      if (building.kind !== "cemetery") {
        continue;
      }
      const cx = building.x + building.width / 2;
      const cy = building.y + building.height / 2;
      if (Math.hypot(position.x - cx, position.y - cy) < CEMETERY_NUISANCE_RADIUS) {
        return true;
      }
    }
    return false;
  }

  hasAnyStation(): boolean {
    return this.buildings.some((building) => building.kind === "station");
  }

  getStation(): Building | undefined {
    return this.buildings.find(
      (building) => building.kind === "station" && building.stage === "built",
    );
  }

  isPowered(building: Building): boolean {
    const plants = this.buildings.filter(
      (b) => b.kind === "powerplant" && b.stage === "built",
    );
    const cx = building.x + building.width / 2;
    const cy = building.y + building.height / 2;
    return plants.some((plant) => {
      const px = plant.x + plant.width / 2;
      const py = plant.y + plant.height / 2;
      return Math.hypot(px - cx, py - cy) <= POWER_RADIUS;
    });
  }

  getPoweredBuildingIds(): string[] {
    if (!this.hasAnyPowerPlant()) {
      return [];
    }
    return this.buildings
      .filter((building) => building.stage === "built" && this.isPowered(building))
      .map((building) => building.id);
  }

  getTrainPositions(): Vec2[] {
    return this.trainX !== null ? [{ x: this.trainX, y: this.trainRow }] : [];
  }

  private runFactories() {
    for (const building of this.buildings) {
      if (building.kind === "factory" && building.stage === "built" && this.isPowered(building)) {
        this.foodStock = Math.min(FOOD_CAP, this.foodStock + FACTORY_FOOD_PER_TICK);
      }
    }
  }

  /** Lays a rail line across the map through the station's row. */
  layStationRail(station: Building) {
    const row = station.y - 1 >= 1 ? station.y - 1 : station.y + station.height;
    this.trainRow = row;
    for (let x = 0; x < this.world.width; x += 1) {
      const tile = this.world.getTile({ x, y: row });
      if (tile && (tile.type === "Grass" || tile.type === "Dirt" || tile.type === "Stump")) {
        this.world.setTile({ x, y: row }, "Rail");
      }
    }
    if (this.trainX === null) {
      this.trainX = 0;
      this.trainDir = 1;
    }
    this.log("A railway now crosses the valley. 🚂");
  }

  private updateTrain(deltaSeconds: number) {
    if (this.trainX === null || !this.getStation()) {
      return;
    }
    const prev = this.trainX;
    this.trainX += this.trainDir * TRAIN_SPEED * deltaSeconds;

    const stationX = (() => {
      const s = this.getStation();
      return s ? s.x + s.width / 2 : this.world.width / 2;
    })();
    // Deliver goods when the train passes the station.
    if ((prev < stationX && this.trainX >= stationX) || (prev > stationX && this.trainX <= stationX)) {
      this.foodStock = Math.min(FOOD_CAP, this.foodStock + TRAIN_DELIVER_FOOD);
      this.log("A trade train rolled through the station. 🚃 +" + TRAIN_DELIVER_FOOD + " food");
    }

    if (this.trainX > this.world.width + 3) {
      this.trainDir = -1;
    } else if (this.trainX < -3) {
      this.trainDir = 1;
    }
    this.notifyChanged();
  }

  /**
   * A 3x3 cluster of roads condenses into a plaza, then keeps absorbing any
   * road tiles that touch it. Decorations (fountain, lamps, statue) appear as
   * the plaza grows, giving the town centre its civic landmark.
   */
  /** A built building's door tile or the tile directly in front of it. */
  private isEntrance(position: Vec2): boolean {
    for (const b of this.buildings) {
      if (b.stage !== "built") {
        continue;
      }
      if (b.door.x === position.x && (b.door.y === position.y || b.door.y + 1 === position.y)) {
        return true;
      }
    }
    return false;
  }

  private updatePlaza() {
    const world = this.world;
    let plazaCount = world.countType("Plaza");

    if (plazaCount === 0) {
      // A dense cluster of roads (a 3x3 window mostly paved) seeds a plaza.
      for (let y = 1; y < world.height - 3 && plazaCount === 0; y += 1) {
        for (let x = 1; x < world.width - 3 && plazaCount === 0; x += 1) {
          if (this.roadDensity(x, y, 3) >= 7) {
            for (let dy = 0; dy < 3; dy += 1) {
              for (let dx = 0; dx < 3; dx += 1) {
                const position = { x: x + dx, y: y + dy };
                if (world.getTile(position)?.type === "Road") {
                  world.setTile(position, "Plaza");
                }
              }
            }
            const fountain = { x: x + 1, y: y + 1 };
            if (!this.isEntrance(fountain)) {
              world.setTile(fountain, "Fountain");
            }
            world.setTile({ x, y }, "Lamp");
            world.setTile({ x: x + 2, y: y + 2 }, "Lamp");
            this.log("A village plaza has formed at the town's heart! ⛲");
            plazaCount = world.countType("Plaza");
          }
        }
      }
      return;
    }

    // Grow: absorb roads adjacent to the plaza.
    const toPromote: Vec2[] = [];
    for (const tile of world.tiles) {
      if (tile.type !== "Road") {
        continue;
      }
      if (this.hasOrthatType(tile, "Plaza")) {
        toPromote.push({ x: tile.x, y: tile.y });
      }
    }
    for (const position of toPromote) {
      world.setTile(position, "Plaza");
    }

    // Add decorations as the plaza grows past size thresholds.
    plazaCount += toPromote.length;
    if (plazaCount >= PLAZA_DECOR_INTERVAL && !world.tiles.some((t) => t.type === "Statue")) {
      const spot = world.tiles.find(
        (t) => t.type === "Plaza" && this.hasOrthatType(t, "Plaza") && !this.isEntrance(t),
      );
      if (spot) {
        world.setTile(spot, "Statue");
        this.log("A statue was raised in the plaza. 🗽");
      }
    }
    if (toPromote.length > 0 && plazaCount % PLAZA_DECOR_INTERVAL < toPromote.length) {
      // Sprinkle a lamp on a fresh plaza edge for night lighting.
      const edge = toPromote.find((p) => this.hasOrthatType(p, "Grass"));
      if (edge) {
        world.setTile(edge, "Lamp");
      }
    }
  }

  private roadDensity(x: number, y: number, size: number): number {
    let count = 0;
    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        const type = this.world.getTile({ x: x + dx, y: y + dy })?.type;
        if (type === "Road" || type === "Plaza") {
          count += 1;
        }
      }
    }
    return count;
  }

  private hasOrthatType(position: Vec2, type: TileType): boolean {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (this.world.getTile({ x: position.x + dx, y: position.y + dy })?.type === type) {
        return true;
      }
    }
    return false;
  }

  getWarehouse(): Building | undefined {
    return this.buildings.find(
      (building) => building.kind === "warehouse" && building.stage === "built",
    );
  }

  hasAnyWarehouse(): boolean {
    return this.buildings.some((building) => building.kind === "warehouse");
  }

  getKitchen(): Building | undefined {
    return this.buildings.find(
      (building) => building.kind === "kitchen" && building.stage === "built",
    );
  }

  hasAnyKitchen(): boolean {
    return this.buildings.some((building) => building.kind === "kitchen");
  }

  getChurch(): Building | undefined {
    return this.buildings.find(
      (building) => building.kind === "church" && building.stage === "built",
    );
  }

  hasAnyChurch(): boolean {
    return this.buildings.some((building) => building.kind === "church");
  }

  /** Worship gathers on alternating mornings once a church exists. */
  isWorshipMorning(): boolean {
    const clock = this.getClock();
    return clock.day % 2 === 0 && clock.hour >= 6 && clock.hour < 9;
  }

  noteWorshipGathering() {
    const day = this.getClock().day;
    if (this.lastWorshipLogDay === day) {
      return;
    }
    this.lastWorshipLogDay = day;
    this.log("The villagers gathered for morning worship. 🙏");
  }

  /**
   * Demand-driven job assignment. Quotas grow with population; existing
   * holders keep their job, spare residents fill openings, excess holders
   * are released back to general work.
   */
  private assignJobs() {
    if (this.era < 1) {
      return;
    }

    const population = this.agents.length;
    // Order is priority: when workers are scarce, earlier jobs are filled first.
    // Food and wood come first, then cleaning a dirty town (the need drives the
    // job), then hunting and building.
    const quotas: [AgentJob, number][] = [
      ["farmer", Math.min(3, Math.max(1, Math.floor(population / 4)))],
      ["cook", this.hasAnyKitchen() ? 1 : 0],
      ["woodcutter", Math.min(2, Math.max(1, Math.floor(population / 5)))],
      ["cleaner", this.litterIsHigh ? Math.min(2, Math.ceil(this.litter.length / 10)) : 0],
      ["police", this.unrestIsHigh ? Math.min(2, 1 + Math.floor(this.unrest / 40)) : 0],
      ["hunter", population >= 8 ? Math.min(2, Math.floor(population / 8)) : 0],
      ["builder", this.era >= 2 ? 1 : 0],
    ];

    const adults = this.agents.filter(
      (agent) => agent.age >= ADULT_AGE && agent.age < ELDER_AGE,
    );

    // Allocate slots to jobs in priority order, capped by how many adults exist,
    // so a scarce workforce fills the most important roles first (and cleaning a
    // dirty town outranks hunting/building).
    const target = new Map<AgentJob, number>();
    let supply = adults.length;
    for (const [job, quota] of quotas) {
      const n = Math.min(quota, supply);
      target.set(job, n);
      supply -= n;
    }

    // Keep adults in a role that still has a slot; release the rest to refill.
    for (const agent of adults) {
      const left = target.get(agent.job) ?? 0;
      if (agent.job !== "none" && left > 0) {
        target.set(agent.job, left - 1);
      } else {
        agent.job = "none";
      }
    }

    // Fill the remaining slots from freed adults, in priority order.
    const free = adults.filter((agent) => agent.job === "none");
    let next = 0;
    for (const [job] of quotas) {
      let need = target.get(job) ?? 0;
      while (need > 0 && next < free.length) {
        const agent = free[next];
        next += 1;
        agent.job = job;
        need -= 1;
        this.log(`${agent.name} became a ${job}.`, [agent]);
      }
    }
  }

  /** Babies are born to married couples with a shared home and enough food. */
  private tryBirth() {
    // Growth is gated by what the village can shelter and support, not a flat
    // cap — build and redevelop housing, advance an era, and keep residents
    // content, and only then does the population earn another member.
    if (this.agents.length >= this.supportedPopulation()) {
      return;
    }
    if (this.elapsedSeconds - this.lastBirthAt < BIRTH_COOLDOWN_SECONDS) {
      return;
    }
    if (this.meanWellbeing() < BIRTH_WELLBEING) {
      return;
    }

    const couples: [Agent, Agent][] = [];
    for (const agent of this.agents) {
      if (!agent.spouseId || !agent.home || agent.id >= agent.spouseId) {
        continue;
      }
      const spouse = this.agents.find((other) => other.id === agent.spouseId);
      if (!spouse) {
        continue;
      }
      if (agent.age >= ELDER_AGE || spouse.age >= ELDER_AGE) {
        continue;
      }
      const lastChildAt = Math.max(agent.lastChildAt ?? -Infinity, spouse.lastChildAt ?? -Infinity);
      if (this.elapsedSeconds - lastChildAt < COUPLE_BIRTH_COOLDOWN_SECONDS) {
        continue;
      }
      couples.push([agent, spouse]);
    }
    if (couples.length === 0) {
      return;
    }

    const berries = this.world.countType("Berry");
    if (
      berries < this.agents.length * 2 &&
      this.foodStock + this.meals < this.agents.length
    ) {
      return;
    }

    const [parentA, parentB] = couples[Math.floor(Math.random() * couples.length)];
    const home = parentA.home;
    if (!home) {
      return;
    }
    const spawn = this.findSpawnPosition(home);
    const baby = createRandomAgent(spawn, this.takenNames());
    baby.age = 0;
    baby.home = { ...home };
    baby.homeBuildingId = parentA.homeBuildingId;
    parentA.lastChildAt = this.elapsedSeconds;
    parentB.lastChildAt = this.elapsedSeconds;
    this.agents.push(baby);
    this.lastBirthAt = this.elapsedSeconds;
    this.log(`${parentA.name} and ${parentB.name} had a baby: ${baby.name}! 👶`, [
      parentA,
      parentB,
      baby,
    ]);
    this.notifyChanged();
  }

  private ageResidents() {
    const total = this.elapsedSeconds + CLOCK_START_OFFSET_SECONDS;
    const dayIndex = Math.floor(total / DAY_LENGTH_SECONDS);
    if (this.lastAgedDayIndex === -1) {
      this.lastAgedDayIndex = dayIndex;
      return;
    }
    if (dayIndex === this.lastAgedDayIndex) {
      return;
    }
    this.lastAgedDayIndex = dayIndex;

    const deceased: Agent[] = [];
    for (const agent of this.agents) {
      agent.age += 1;
      if (agent.age === ADULT_AGE) {
        this.log(`${agent.name} came of age. 🎓`, [agent]);
      } else if (agent.age === ELDER_AGE) {
        agent.job = "none";
        this.log(`${agent.name} retired as an elder. 🦳`, [agent]);
      }
      if (agent.age > agent.lifespan) {
        deceased.push(agent);
      }
    }
    for (const agent of deceased) {
      this.passAway(agent);
    }
    this.notifyChanged();
  }

  private passAway(agent: Agent) {
    this.deaths += 1;
    this.log(`${agent.name} passed away peacefully at ${agent.age}. 🕯️`);

    // Release whatever the agent was holding onto.
    if (agent.target) {
      this.releaseClaim(agent.target);
    }
    if (agent.projectBuildingId) {
      const pending = this.getBuilding(agent.projectBuildingId);
      if (pending && pending.stage !== "built") {
        this.cancelBuilding(pending);
      }
    }

    // The spouse is widowed; their shared house passes to them.
    const spouse = agent.spouseId
      ? this.agents.find((other) => other.id === agent.spouseId)
      : undefined;
    if (spouse) {
      spouse.spouseId = undefined;
    }
    for (const building of this.buildings) {
      if (building.ownerId === agent.id) {
        building.ownerId =
          spouse && spouse.homeBuildingId === building.id ? spouse.id : undefined;
      }
    }

    this.episodes.delete(agent.id);
    const index = this.agents.indexOf(agent);
    if (index >= 0) {
      this.agents.splice(index, 1);
    }
  }

  /** Removes an unbuilt building and reverts its tiles (used when plans are abandoned). */
  cancelBuilding(building: Building) {
    if (building.stage === "built") {
      return;
    }
    this.releaseBuildingFootprint(building);
    for (const position of footprintTiles(building)) {
      const tile = this.world.getTile(position);
      if (tile && (tile.type === "HouseSite" || tile.type === "HouseFoundation")) {
        this.world.setTile(position, "Grass");
      }
    }
    const index = this.buildings.indexOf(building);
    if (index >= 0) {
      this.buildings.splice(index, 1);
    }
    this.notifyChanged();
  }

  // --- Wildlife ---------------------------------------------------------

  getAnimal(id: string): Animal | undefined {
    return this.animals.find((animal) => animal.id === id);
  }

  getPasture(): Building | undefined {
    return this.buildings.find(
      (building) => building.kind === "pasture" && building.stage === "built",
    );
  }

  hasAnyPasture(): boolean {
    return this.buildings.some((building) => building.kind === "pasture");
  }

  tamedHerdSize(): number {
    return this.animals.filter((animal) => animal.state === "tamed").length;
  }

  isTameable(kind: AnimalKind): boolean {
    return TAMEABLE[kind];
  }

  animalFoodValue(kind: AnimalKind): number {
    return ANIMAL_FOOD[kind];
  }

  /** A hunter strikes an animal; returns true once it is felled. */
  strikeAnimal(animal: Animal): boolean {
    animal.health -= 1;
    animal.state = "fleeing";
    if (animal.health <= 0) {
      this.foodStock += ANIMAL_FOOD[animal.kind];
      this.removeAnimal(animal.id);
      return true;
    }
    this.notifyChanged();
    return false;
  }

  tameAnimal(animal: Animal): boolean {
    const pasture = this.getPasture();
    if (!pasture || !TAMEABLE[animal.kind]) {
      return false;
    }
    animal.state = "tamed";
    animal.penId = pasture.id;
    animal.path = undefined;
    this.notifyChanged();
    return true;
  }

  removeAnimal(id: string) {
    const index = this.animals.findIndex((animal) => animal.id === id);
    if (index >= 0) {
      this.animals.splice(index, 1);
    }
    this.notifyChanged();
  }

  private spawnAnimals() {
    const wild = this.animals.filter((animal) => animal.state !== "tamed").length;
    if (wild >= ANIMAL_CAP || Math.random() > ANIMAL_SPAWN_CHANCE) {
      return;
    }

    const edge = this.randomEdgeTile();
    if (!edge) {
      return;
    }
    const roll = Math.random();
    const kind: AnimalKind = roll < 0.5 ? "rabbit" : roll < 0.8 ? "deer" : "boar";
    this.animals.push({
      id: `animal-${this.nextAnimalId++}`,
      kind,
      position: edge,
      state: "wild",
      health: ANIMAL_HEALTH[kind],
      moveTimer: Math.random() * ANIMAL_MOVE_INTERVAL,
      path: undefined,
    });
    this.notifyChanged();
  }

  private updateAnimals(deltaSeconds: number) {
    for (const animal of this.animals) {
      animal.moveTimer -= deltaSeconds;
      if (animal.moveTimer > 0) {
        continue;
      }
      animal.moveTimer = ANIMAL_MOVE_INTERVAL * (animal.kind === "rabbit" ? 0.7 : 1);

      if (animal.state === "tamed") {
        this.stepTamedAnimal(animal);
      } else {
        this.stepWildAnimal(animal);
      }
    }

    // Tamed herds graze and slowly yield food into the village stock.
    if (Math.random() < 0.04) {
      const herd = this.tamedHerdSize();
      if (herd > 0 && Math.random() < PASTURE_YIELD_CHANCE) {
        this.foodStock += 1;
        this.notifyChanged();
      }
    }
  }

  private stepWildAnimal(animal: Animal) {
    // Flee from the nearest hunter, otherwise wander.
    let flee: Vec2 | undefined;
    let nearest = 5;
    for (const agent of this.agents) {
      if (agent.job !== "hunter") {
        continue;
      }
      const d = Math.abs(agent.position.x - animal.position.x) +
        Math.abs(agent.position.y - animal.position.y);
      if (d < nearest) {
        nearest = d;
        flee = agent.position;
      }
    }

    let dir: Vec2;
    if (flee) {
      dir = {
        x: Math.sign(animal.position.x - flee.x) || (Math.random() < 0.5 ? 1 : -1),
        y: Math.sign(animal.position.y - flee.y) || (Math.random() < 0.5 ? 1 : -1),
      };
      animal.state = "wild";
    } else {
      const steps = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ];
      dir = steps[Math.floor(Math.random() * steps.length)];
    }

    const next = { x: animal.position.x + dir.x, y: animal.position.y + dir.y };
    if (this.world.isWalkable(next)) {
      animal.position = next;
      this.notifyChanged();
    }
  }

  private stepTamedAnimal(animal: Animal) {
    const pasture = animal.penId ? this.getBuilding(animal.penId) : this.getPasture();
    if (!pasture) {
      animal.state = "wild";
      animal.penId = undefined;
      return;
    }
    const cx = pasture.x + pasture.width / 2;
    const cy = pasture.y + pasture.height / 2;
    const dx = cx - animal.position.x;
    const dy = cy - animal.position.y;
    // Stay loosely near the pasture, drifting back when wandering too far.
    let dir: Vec2;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      dir = { x: Math.sign(dx), y: 0 };
      if (dir.x === 0) {
        dir = { x: 0, y: Math.sign(dy) };
      }
    } else {
      const steps = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ];
      dir = steps[Math.floor(Math.random() * steps.length)];
    }
    const next = { x: animal.position.x + dir.x, y: animal.position.y + dir.y };
    if (this.world.isWalkable(next)) {
      animal.position = next;
      this.notifyChanged();
    }
  }

  private randomEdgeTile(): Vec2 | undefined {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const onVertical = Math.random() < 0.5;
      const position = onVertical
        ? { x: Math.random() < 0.5 ? 1 : this.world.width - 2, y: 1 + Math.floor(Math.random() * (this.world.height - 2)) }
        : { x: 1 + Math.floor(Math.random() * (this.world.width - 2)), y: Math.random() < 0.5 ? 1 : this.world.height - 2 };
      if (this.world.isWalkable(position)) {
        return position;
      }
    }
    return undefined;
  }

  // --- Land use: density and decay --------------------------------------

  /** Centroid of built houses; the gravitational centre of the settlement. */
  villageCenter(): Vec2 {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const building of this.buildings) {
      if (building.kind === "house" && building.stage === "built") {
        sx += building.x + building.width / 2;
        sy += building.y + building.height / 2;
        n += 1;
      }
    }
    if (n === 0) {
      return { x: this.world.width / 2, y: this.world.height / 2 };
    }
    return { x: sx / n, y: sy / n };
  }

  occupantsOf(buildingId: string): number {
    return this.agents.filter((agent) => agent.homeBuildingId === buildingId).length;
  }

  houseLevel(building: Building): number {
    if (building.level) {
      return building.level;
    }
    // Older saves stored only capacity; recover the tier from it.
    const cap = building.capacity ?? 1;
    return cap >= 24 ? 4 : cap >= 12 ? 3 : cap >= 6 ? 2 : 1;
  }

  houseCapacity(building: Building): number {
    return HOUSE_CAPACITY_BY_LEVEL[this.houseLevel(building)] ?? 1;
  }

  /** Total residents the built houses can shelter. */
  housingCapacity(): number {
    let capacity = 0;
    for (const building of this.buildings) {
      if (building.kind === "house" && building.stage === "built") {
        capacity += this.houseCapacity(building);
      }
    }
    return capacity;
  }

  /**
   * How many residents the village can currently support: never more than its
   * housing can shelter, and never past the era's ceiling. This is the soft cap
   * that keeps the settlement small and makes each new birth feel earned.
   */
  supportedPopulation(): number {
    const eraCeiling = ERA_POP_CEILING[this.era] ?? ERA_POP_CEILING[ERA_POP_CEILING.length - 1];
    return Math.min(this.housingCapacity(), eraCeiling);
  }

  /** Average contentment of working-age residents, 0..100. Gates births. */
  meanWellbeing(): number {
    let sum = 0;
    let count = 0;
    const churchOpen = Boolean(this.getChurch());
    for (const agent of this.agents) {
      if (agent.age < ADULT_AGE || agent.age >= ELDER_AGE) {
        continue;
      }
      const parts = [
        100 - agent.health.hunger,
        agent.health.stamina,
        agent.needs.social,
        agent.needs.purpose,
        agent.needs.leisure,
        agent.needs.comfort,
      ];
      if (churchOpen) {
        parts.push(agent.needs.faith);
      }
      sum += parts.reduce((a, b) => a + b, 0) / parts.length;
      count += 1;
    }
    return count === 0 ? 100 : sum / count;
  }

  /** Residents currently living in a built house. */
  private housedCount(): number {
    let occupied = 0;
    for (const building of this.buildings) {
      if (building.kind === "house" && building.stage === "built") {
        occupied += this.occupantsOf(building.id);
      }
    }
    return occupied;
  }

  /** Spare resident slots across all built houses. */
  housingHeadroom(): number {
    return this.housingCapacity() - this.housedCount();
  }

  /** 0 = roomy, 1 = full. Surfaced in the inspector as housing pressure. */
  housingPressure(): number {
    const capacity = this.housingCapacity();
    return capacity === 0 ? 0 : Math.min(1, this.housedCount() / capacity);
  }

  /**
   * The driving force: when land is tight and housing is nearly full, the
   * village should grow upward (redevelop) rather than sprawl outward.
   */
  shouldRedevelopHousing(): boolean {
    return this.housingHeadroom() <= REDEVELOP_HEADROOM;
  }

  /** A central, upgradeable house no one is already rebuilding. */
  findRedevelopableHouse(): Building | undefined {
    const inProgress = new Set(
      this.agents
        .filter((a) => a.state === "MoveToRedevelop" || a.state === "Redevelop")
        .map((a) => a.projectBuildingId),
    );
    const center = this.villageCenter();
    return this.buildings
      .filter(
        (b) =>
          b.kind === "house" &&
          b.stage === "built" &&
          this.houseLevel(b) < HOUSE_MAX_LEVEL &&
          !inProgress.has(b.id),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - center.x, a.y - center.y) -
          Math.hypot(b.x - center.x, b.y - center.y),
      )[0];
  }

  /** Is there an open building plot near the village centre? */
  hasOpenPlotNear(radius: number): boolean {
    const center = this.villageCenter();
    const site = this.world.findBuildingSite(center, 2, 2, (position) =>
      this.isTileClaimed(position),
    );
    if (!site) {
      return false;
    }
    const d = Math.hypot(site.x + 1 - center.x, site.y + 1 - center.y);
    return d <= radius;
  }

  /** A built house with room for another household, nearest the centre. */
  findHouseWithSpareCapacity(): Building | undefined {
    const center = this.villageCenter();
    return this.buildings
      .filter(
        (b) =>
          b.kind === "house" &&
          b.stage === "built" &&
          this.occupantsOf(b.id) < this.houseCapacity(b),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - center.x, a.y - center.y) -
          Math.hypot(b.x - center.x, b.y - center.y),
      )[0];
  }

  /** A built house that can still be upgraded to a denser tier. */
  findDensifiableHouse(): Building | undefined {
    const center = this.villageCenter();
    return this.buildings
      .filter(
        (b) =>
          b.kind === "house" &&
          b.stage === "built" &&
          this.houseLevel(b) < HOUSE_MAX_LEVEL,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - center.x, a.y - center.y) -
          Math.hypot(b.x - center.x, b.y - center.y),
      )[0];
  }

  /** Redevelop a house one tier taller, packing more households per tile. */
  levelUpHouse(building: Building) {
    const next = Math.min(this.houseLevel(building) + 1, HOUSE_MAX_LEVEL);
    building.level = next;
    building.capacity = HOUSE_CAPACITY_BY_LEVEL[next];
    building.durability = 100;
    // Keep the doorway a road so the rebuilt block is never sealed in.
    this.world.setTile(building.door, "Road");
    const label =
      next >= 4
        ? "A block was rebuilt into a residential tower. 🗼"
        : next === 3
          ? "A house grew into an apartment block. 🏢"
          : "A house was extended into a villa. 🏘️";
    this.log(label);
    this.notifyChanged();
  }

  isLandTight(): boolean {
    return !this.hasOpenPlotNear(SPRAWL_LIMIT + Math.sqrt(this.agents.length));
  }

  private decayInfrastructure() {
    // Traffic memory fades; unused paths weather back toward nature.
    for (const [index, count] of [...this.traffic.entries()]) {
      const next = count - 1;
      if (next <= 0) {
        this.traffic.delete(index);
      } else {
        this.traffic.set(index, next);
      }
    }

    for (const tile of this.world.tiles) {
      if (tile.type !== "Road" && tile.type !== "Dirt") {
        continue;
      }
      const idx = tile.y * this.world.width + tile.x;
      if ((this.traffic.get(idx) ?? 0) > 0 || this.adjacentToStructure(tile)) {
        continue;
      }
      if (Math.random() < DECAY_CHANCE) {
        this.world.setTile(tile, tile.type === "Road" ? "Dirt" : "Grass");
      }
    }

    // Houses are maintained while lived in, but abandoned ones crumble away.
    for (const building of this.buildings) {
      if (building.stage !== "built" || building.durability === undefined) {
        continue;
      }
      if (building.kind !== "house") {
        building.durability = 100;
        continue;
      }
      if (this.occupantsOf(building.id) > 0) {
        building.durability = Math.min(100, building.durability + DURABILITY_DECAY_PER_TICK);
      } else {
        building.durability -= ABANDON_DECAY_PER_TICK;
        if (building.durability <= 0) {
          this.collapseHouse(building);
        }
      }
    }
  }

  private collapseHouse(building: Building) {
    for (const position of footprintTiles(building)) {
      this.world.setTile(position, Math.random() < 0.4 ? "Stump" : "Grass");
    }
    const index = this.buildings.indexOf(building);
    if (index >= 0) {
      this.buildings.splice(index, 1);
    }
    this.refreshDoors();
    this.log("An abandoned house crumbled back into the land. 🍂");
    this.notifyChanged();
  }

  private adjacentToStructure(position: Vec2): boolean {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const type = this.world.getTile({ x: position.x + dx, y: position.y + dy })?.type;
      if (
        type === "House" ||
        type === "HouseFoundation" ||
        type === "Plaza" ||
        type === "Rail"
      ) {
        return true;
      }
    }
    return false;
  }

  private takenNames(): Set<string> {
    return new Set(this.agents.map((agent) => agent.name));
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
