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
          // Older saves predate soft needs; start such residents content.
          needs: savedAgent.needs ?? { social: 70, purpose: 70, faith: 70, leisure: 70 },
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
    if (stage === "built" && building.kind === "station") {
      this.layStationRail(building);
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
      if (this.agents.length >= 6 && builtHouses >= 4) {
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
            world.setTile({ x: x + 1, y: y + 1 }, "Fountain");
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
        (t) => t.type === "Plaza" && this.hasOrthatType(t, "Plaza"),
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
    const quotas: [AgentJob, number][] = [
      ["farmer", Math.min(3, Math.max(1, Math.floor(population / 4)))],
      ["woodcutter", Math.min(2, Math.max(1, Math.floor(population / 5)))],
      ["cook", this.hasAnyKitchen() ? 1 : 0],
      ["builder", this.era >= 2 ? 1 : 0],
      ["hunter", population >= 8 ? Math.min(2, Math.floor(population / 8)) : 0],
    ];

    for (const [job, quota] of quotas) {
      const holders = this.agents.filter((agent) => agent.job === job);
      for (let i = holders.length; i > quota; i -= 1) {
        const released = holders[i - 1];
        released.job = "none";
      }
      let missing = quota - Math.min(holders.length, quota);
      for (const agent of this.agents) {
        if (missing <= 0) {
          break;
        }
        if (agent.job === "none" && agent.age >= ADULT_AGE && agent.age < ELDER_AGE) {
          agent.job = job;
          missing -= 1;
          this.log(`${agent.name} became a ${job}.`, [agent]);
        }
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
    this.world.setTile(building.door, "House");
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
