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
  BuildPlanTile,
  FoodBatch,
  FoodKind,
  GameMode,
  GameClock,
  GameLogEntry,
  ItemStack,
  ResourceKind,
  SimulationSnapshot,
  TileType,
  Vec2,
  WeatherState,
} from "./types";
import { ROOM_BUILDING_KINDS } from "./types";
import { WorldMap } from "./world/WorldMap";
import { tr } from "../i18n";

type SimulationOptions = {
  onChange: (snapshot: SimulationSnapshot) => void;
};

// Crossings needed before grass wears into a footpath, then into a road.
// Kept low so roads are cheap to "install" — the network forms readily from
// everyday foot traffic.
const PATH_WEAR_THRESHOLD = 4;
const ROAD_WEAR_THRESHOLD = 9;


const PATH_LOG_COOLDOWN_SECONDS = 8;

const NATURE_TICK_SECONDS = 5;
// How long a built structure may sit damaged (a wall/floor/door/fence torn out)
// before the town raises a repair job. Left alone this long, residents mend it.
const REPAIR_GRACE_SECONDS = 25;
// The structural tiles a building is mended for. Interior ground (Plaza, Grass)
// and decor (crops, graves) are deliberately excluded so a scuffed yard never
// looks "damaged" — only a missing wall/floor/door/fence triggers a repair.
const REPAIRABLE_TILES: ReadonlySet<TileType> = new Set([
  "Wall",
  "Door",
  "Floor",
  "Fence",
  "FenceGate",
]);
// Forests are slow to recover so wood is a deliberate resource, not free and
// instant — this is what pushes the colony toward stone and ore over time.
const TREE_CAP = 240;

const BIRTH_COOLDOWN_SECONDS = 12;
// Attachment-first scale ladder: population is kept small and earned. The
// village only supports more residents as it advances through the eras, and
// even then only up to what its housing can shelter (see supportedPopulation).
const ERA_POP_CEILING = [8, 14, 22, 30, 40];

// Observation mode (temporary): births are paused and growth comes instead from
// adult newcomers arriving over time, with the cap lifted, so the town's
// need-driven building can be watched without a glut of children.
const BIRTHS_ENABLED = false;
// Automatic immigration is off: newcomers arrive only when the player adds one
// (the "이주민 추가" / Add immigrant control), so population growth is hand-paced.
const IMMIGRATION_ENABLED = false;
const IMMIGRATION_INTERVAL_SECONDS = 20;
const EXPERIMENT_POP_CAP = 90; // a safety ceiling for performance, not a design cap
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
export const NEW_GAME_MODE_KEY = "project-genesis-new-mode";
const SAVE_VERSION = 10;

// Residents age one year per in-game day; children come of age at 12,
// retire at 60, and pass away when they outlive their personal lifespan.
export const ADULT_AGE = 12;
export const ELDER_AGE = 60;
const COUPLE_BIRTH_COOLDOWN_SECONDS = 90;
// A felled stump takes ~5 years to grow back into a tree, so clearing forest is a
// lasting commitment. regrowNature runs every NATURE_TICK_SECONDS; a year is
// DAY_LENGTH_SECONDS×DAYS_PER_YEAR sim-seconds, so the per-tick chance for a mean
// of 5 years is NATURE_TICK_SECONDS / (5 × 6000) ≈ 0.000167.
const STUMP_REGROW_CHANCE = 0.000167;
const DURABILITY_DECAY_PER_TICK = 0.012;
const EPISODE_CAP = 15;


const ANIMAL_CAP = 8;
const ANIMAL_MOVE_INTERVAL = 0.6;
const ANIMAL_SPAWN_CHANCE = 0.5;
const PASTURE_HERD_CAP = 6;
const PASTURE_YIELD_CHANCE = 0.25;

const ANIMAL_FOOD: Record<AnimalKind, number> = { deer: 3, boar: 4, rabbit: 1 };
// What kind of meat an animal yields when butchered.
const meatKind = (kind: AnimalKind): FoodKind => (kind === "rabbit" ? "rabbit" : "beef");
const ANIMAL_HEALTH: Record<AnimalKind, number> = { deer: 3, boar: 4, rabbit: 2 };
const TAMEABLE: Record<AnimalKind, boolean> = { deer: true, boar: false, rabbit: true };

// Industrial era: a power plant electrifies nearby buildings; a factory
// cans surplus food; a station's trade train delivers goods each pass.
const POWER_RADIUS = 14;
const FACTORY_FOOD_PER_TICK = 3;
// A powered factory also forges steel (rebar). Apartments and towers can only
// be built once the town produces steel — so before industry, growth spreads
// outward into more homes rather than upward.
const FACTORY_STEEL_PER_TICK = 2;
// A smelter forges this much iron ore into steel each nature tick.
const SMELT_ORE_PER_BATCH = 2;

export const ERA_NAMES = ["Pioneer", "Settlement", "Town", "City", "Industrial"];
const CROP_RIPEN_CHANCE = 0.05;
const AUTOSAVE_INTERVAL_SECONDS = 15;
// Throttle React panel updates; the Pixi canvas renders independently every tick.
const UI_EMIT_INTERVAL_SECONDS = 0.25;
const FOOD_CAP = 400;
// Stored food keeps for about two days, then the batch spoils. Eating (or
// cooking with) spoiled food makes a resident sick for a stretch.
const FOOD_SPOIL_SECONDS = DAY_LENGTH_SECONDS * 2;
// Food stocked within this window of an existing fresh batch of the same kind
// merges into it, so the larder doesn't fragment into hundreds of tiny lots.
const FOOD_BATCH_MERGE_SECONDS = 60;
const SICK_DURATION_SECONDS = 90;
// The dining table grows toward one seat per resident, up to this many.
const DINING_SEAT_CAP = 8;
// How much wood the warehouse can physically hold, and how full the village
// tries to keep it (store + loose ground piles) before woodcutters stop felling.
// The store cap sits well above the want target so haulers always have room to
// bring loose piles in — felling stops at the target, then the forest piles
// drain into the warehouse rather than stranding on the ground.
const WOOD_WANT_TARGET = 120;
// Stone and ore: the colony stockpiles a stone reserve from soft rock; ore is
// only mineable once tools exist (Slice 4) so its target stays modest.
const STONE_WANT_TARGET = 90;
const ORE_WANT_TARGET = 40;
// How much of one material a single stockpile tile can hold. The warehouse's
// floor tiles are the stockpile zone, so its footprint sets total capacity.
const TILE_STACK_CAP = 50;
// How far a new building will reach to connect its doorway to an existing path.
const APPROACH_MAX_TILES = 7;

// Houses no longer redevelop into taller tiers — with physical walled rooms the
// town grows by spreading into more homes (spread-out, not stack). Every house
// shelters this many residents (a family shares a home).
const HOUSE_CAPACITY = 3;
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
const QUARREL_COMFORT_HIT = 16;
// A police station (level 1) keeps the peace for residents whose home lies within
// this radius, up to this many of them; people outside any station's reach go
// unpoliced, so a spreading town needs several stations.
const POLICE_RADIUS = 15;
const POLICE_CAPACITY = 10;
const POLICE_MIN_POP = 10;

type SavedAgent = Omit<
  Agent,
  | "target"
  | "path"
  | "state"
  | "actionTimer"
  | "socialCooldown"
  | "resumeState"
  | "fetchAmount"
  | "haulItemId"
  | "carry"
  | "bedPos"
  | "bedFoot"
  | "buildTarget"
  | "gatherWood"
  | "funAt"
  | "rideSlot"
>;

type SaveData = {
  version: number;
  gameMode?: GameMode;
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
  taintedMeals?: number;
  // The typed, perishable larder. Absent in old saves — then `foodStock` is
  // taken as one fresh lot of grain.
  foods?: FoodBatch[];
  hasMiningTools?: boolean;
  items?: ItemStack[];
  nextItemId?: number;
  animals: Animal[];
  nextAnimalId: number;
};

export class Simulation {
  readonly world: WorldMap;
  readonly gameMode: GameMode;
  readonly agents: Agent[] = [];
  readonly buildings: Building[] = [];
  readonly animals: Animal[] = [];
  readonly litter: Vec2[] = [];
  unrest = 0;
  era = 0;
  foodStock = 0;
  meals = 0;
  // Of the cooked meals on hand, how many were made with spoiled ingredients —
  // these are served first and make whoever eats them sick.
  taintedMeals = 0;
  deaths = 0;
  // The larder broken down by kind and freshness. Its total amount is kept in
  // lock-step with `foodStock` (which the wider economy reads as one number).
  readonly foods: FoodBatch[] = [];
  // Materials are stored as physical piles (ItemStacks) sitting on the warehouse
  // floor — the stockpile zone — not as abstract numbers. See stockOf()/store().
  // True once the colony has the tools (a pickaxe) to mine hard rock and ore.
  hasMiningTools = false;
  // A pickaxe is being fashioned right now, so others don't also start one.
  pickaxeInProgress = false;
  private notedNeedTools = false;
  readonly items: ItemStack[] = [];

  private nextBuildingId = 1;
  private nextItemId = 1;
  private nextAnimalId = 1;
  private readonly brain = new AgentBrain();
  private readonly onChange: SimulationOptions["onChange"];
  private readonly logs: GameLogEntry[] = [];
  private readonly claimedTiles = new Set<string>();
  private readonly episodes = new Map<string, GameLogEntry[]>();
  // Which cook (agent id) currently has each stove reserved. Transient — cleared
  // on load so a reservation never outlives the cooking trip that made it.
  private readonly stoveCooks = new Map<string, string>();
  // Which diner (agent id) currently has each chair reserved. Transient too.
  private readonly chairSitters = new Map<string, string>();
  private traffic = new Map<number, number>();
  private ambianceGrid = new Float32Array(0);
  private elapsedSeconds = 0;
  /** Seconds of simulated time elapsed — drives time-based render animation. */
  get elapsedTime(): number {
    return this.elapsedSeconds;
  }
  private natureTimer = 0;
  private autosaveTimer = 0;
  private uiEmitTimer = UI_EMIT_INTERVAL_SECONDS;
  private lastBirthAt = 0;
  private lastImmigrationAt = 0;
  private lastPathLogAt = -PATH_LOG_COOLDOWN_SECONDS;
  private nextLogId = 1;
  private dirty = true;
  private savingDisabled = false;
  private lastAgedDayIndex = -1;
  private lastWorshipLogDay = -1;

  constructor(options: SimulationOptions) {
    this.onChange = options.onChange;

    const newGameMode = loadNewGameMode();
    const saved = loadSaveData();
    const savedGameMode =
      saved?.gameMode === "auto" || saved?.gameMode === "architect" ? saved.gameMode : undefined;
    this.gameMode = savedGameMode ?? newGameMode ?? "auto";
    clearNewGameMode();
    if (saved) {
      this.world =
        WorldMap.fromSerializedTiles(saved.worldWidth, saved.worldHeight, saved.tiles) ??
        WorldMap.createRandom();
      this.elapsedSeconds = saved.elapsedSeconds;
      this.lastBirthAt = saved.lastBirthAt;
      this.traffic = new Map(saved.traffic);
      this.nextBuildingId = saved.nextBuildingId;
      this.era = saved.era;
      this.meals = saved.meals;
      this.taintedMeals = Math.min(this.meals, saved.taintedMeals ?? 0);
      // Restore the typed larder; an old save without one keeps its food as a
      // single fresh lot of grain so totals (and the wider economy) line up.
      if (saved.foods && saved.foods.length > 0) {
        for (const batch of saved.foods) {
          this.foods.push({ ...batch });
        }
        this.foodStock = this.foods.reduce((sum, b) => sum + b.amount, 0);
      } else if (saved.foodStock > 0) {
        this.foods.push({ kind: "wheat", amount: saved.foodStock, ageSeconds: 0, spoiled: false });
        this.foodStock = saved.foodStock;
      }
      this.hasMiningTools = saved.hasMiningTools ?? false;
      for (const stack of saved.items ?? []) {
        // Reservations are transient; drop them so loose piles are haulable again.
        this.items.push({ ...stack, position: { ...stack.position }, reservedBy: undefined });
      }
      this.nextItemId = saved.nextItemId ?? 1;
      this.nextAnimalId = saved.nextAnimalId ?? 1;
      for (const animal of saved.animals ?? []) {
        this.animals.push({ ...animal, path: undefined });
      }
      for (const building of saved.buildings) {
        // Tiers are gone; a saved house's old level/capacity is simply ignored.
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
      this.log(tr("The village awakens.", "마을이 깨어난다."));
    } else {
      this.world = WorldMap.createRandom();
      this.log(tr("A new valley is ready.", "새로운 골짜기가 준비되었다."));
    }
    this.refreshDoors();
    // Heal any rooms a past redevelopment bug had stamped into solid blocks.
    this.repairWalledRooms();
    // Parks and plazas are retired — clear any an older save laid down.
    this.removeParksAndPlazas();
    // The trade train and its railway are retired — tear up any old track.
    this.removeRailways();
    // Tidy any redundant double walls an older save left between two buildings.
    this.remodelDoubleWalls();
    // Shift any stockpile overflow an older save dropped onto a warehouse door.
    this.relocateDoorwayPiles();
    this.recomputeAmbiance();
  }

  addRandomAgent(position: Vec2) {
    const spawn = this.findSpawnPosition(position);
    const agent = createRandomAgent(spawn, this.takenNames());
    this.agents.push(agent);
    this.log(tr(`${agent.name} spawned.`, `${agent.name}이(가) 나타났다.`), [agent]);
    this.notifyChanged();
  }

  update(deltaSeconds: number) {
    this.elapsedSeconds += deltaSeconds;
    for (const agent of this.agents) {
      this.brain.update(agent, this, deltaSeconds);
    }

    this.updateAnimals(deltaSeconds);
    this.ageFood(deltaSeconds);

    this.natureTimer += deltaSeconds;
    if (this.natureTimer >= NATURE_TICK_SECONDS) {
      this.natureTimer = 0;
      this.regrowNature();
      this.growCrops();
      if (BIRTHS_ENABLED) {
        this.tryBirth();
      }
      if (IMMIGRATION_ENABLED) {
        this.immigrate();
      }
      this.checkEraPromotion();
      this.assignJobs();
      this.ageResidents();
      this.spawnAnimals();
      this.runFactories();
      this.runSmelters();
      this.decayInfrastructure();
      this.detectDamage();
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

  getWeather(): WeatherState {
    const period = DAY_LENGTH_SECONDS * 1.35;
    const phase = (this.elapsedSeconds % period) / period;
    const slow = Math.sin(this.elapsedSeconds / 74 + 0.8);
    const slower = Math.sin(this.elapsedSeconds / 151 + 2.2) * 0.65;
    const daily = Math.sin(phase * Math.PI * 2 - 0.9) * 0.35;
    const wetness = Math.max(0, Math.min(1, (slow + slower + daily + 1.18) / 2.55));
    if (wetness > 0.86) {
      return { kind: "storm", intensity: (wetness - 0.86) / 0.14 };
    }
    if (wetness > 0.63) {
      return { kind: "rain", intensity: 0.35 + ((wetness - 0.63) / 0.23) * 0.65 };
    }
    if (wetness > 0.42) {
      return { kind: "cloudy", intensity: 0.3 + ((wetness - 0.42) / 0.21) * 0.45 };
    }
    return { kind: "clear", intensity: 1 - wetness };
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
    annexOf?: string;
    // Explicit entrance(s) — used by an annex, whose door is internal (it opens
    // onto its parent house, not a street) and so can't be auto-sited by road.
    doors?: Vec2[];
  }): Building {
    // Civic buildings get road-facing doors as needed; a home keeps a single
    // entrance (a house with two doors wastes wall and isn't how anyone builds).
    // An annex passes its internal doorway in explicitly.
    const computed = input.doors ?? this.computeDoors(input.x, input.y, input.width, input.height);
    // A house keeps one door; a pasture keeps one gate. Other civic buildings may
    // take the extra road-facing entrance computeDoors offers.
    const single = input.kind === "house" || input.kind === "pasture";
    const doors = input.doors ? input.doors : single ? [computed[0]] : computed;
    const building: Building = {
      id: `building-${this.nextBuildingId++}`,
      stage: "site",
      ...input,
      door: doors[0],
      doors,
    };
    this.buildings.push(building);
    return building;
  }

  /** The interior tile a resident calls home (centre of a walled room). */
  houseInterior(building: Building): Vec2 {
    return {
      x: building.x + Math.floor(building.width / 2),
      y: building.y + Math.floor(building.height / 2),
    };
  }

  /**
   * The wall/floor/door layout of a walled room as a list of tiles. Shared by
   * both the instant paint (paintWalledRoom) and the piecemeal construction plan
   * so the two never disagree about where a wall or doorway belongs.
   */
  private roomLayout(building: Building): BuildPlanTile[] {
    const { x, y, width, height } = building;
    const doorKeys = new Set(this.buildingDoors(building).map((d) => `${d.x},${d.y}`));
    const tiles: BuildPlanTile[] = [];
    for (let fy = 0; fy < height; fy += 1) {
      for (let fx = 0; fx < width; fx += 1) {
        const pos = { x: x + fx, y: y + fy };
        const t: BuildPlanTile["t"] = doorKeys.has(`${pos.x},${pos.y}`)
          ? "Door"
          : fx === 0 || fy === 0 || fx === width - 1 || fy === height - 1
            ? "Wall"
            : "Floor";
        tiles.push({ x: pos.x, y: pos.y, t });
      }
    }
    return tiles;
  }

  /** The fence/gate/interior layout of an open yard (pasture, fairground, etc.). */
  private fencedYardLayout(building: Building, interior: TileType): BuildPlanTile[] {
    const { x, y, width, height } = building;
    const doorKeys = new Set(this.buildingDoors(building).map((d) => `${d.x},${d.y}`));
    const tiles: BuildPlanTile[] = [];
    for (let fy = 0; fy < height; fy += 1) {
      for (let fx = 0; fx < width; fx += 1) {
        const pos = { x: x + fx, y: y + fy };
        const edge = fx === 0 || fy === 0 || fx === width - 1 || fy === height - 1;
        const t: TileType = doorKeys.has(`${pos.x},${pos.y}`)
          ? "FenceGate"
          : edge
            ? "Fence"
            : interior;
        tiles.push({ x: pos.x, y: pos.y, t });
      }
    }
    return tiles;
  }

  /**
   * The full tile layout of ANY building — walled rooms, fenced yards (pasture,
   * cemetery, park), or the fairground plaza. Shared by the instant paint and the
   * piecemeal construction plan, so every building can be raised tile by tile.
   */
  buildingLayout(building: Building): BuildPlanTile[] {
    if (ROOM_BUILDING_KINDS.has(building.kind)) {
      return this.roomLayout(building);
    }
    if (building.kind === "funfair") {
      return this.fencedYardLayout(building, "Plaza");
    }
    // pasture, cemetery, park and any other open yard: a fenced grass plot.
    return this.fencedYardLayout(building, "Grass");
  }

  /** Paint a finished building as a walled room: perimeter walls, doorway(s), floor. */
  private paintWalledRoom(building: Building) {
    for (const tile of this.roomLayout(building)) {
      this.world.setTile({ x: tile.x, y: tile.y }, tile.t);
    }
  }

  /** Stamp a building's full layout (used to assert a finished non-room building). */
  private paintBuildingLayout(building: Building) {
    for (const tile of this.buildingLayout(building)) {
      this.world.setTile({ x: tile.x, y: tile.y }, tile.t);
    }
  }

  /** Furniture tiles that sit on a room's interior and must survive a re-tile. */
  private static readonly FURNITURE_TILES: ReadonlySet<TileType> = new Set([
    "Bed",
    "BedFoot",
    "BedSite",
    "Table",
    "Chair",
    "Stove",
    "Counter",
  ]);

  /** Re-tile a building as a walled room without clobbering interior furniture. */
  private repaintWalledRoomKeepingFurniture(building: Building) {
    for (const tile of this.roomLayout(building)) {
      // Leave a furnished interior tile (a bed, table, stove) as it is.
      if (
        tile.t === "Floor" &&
        Simulation.FURNITURE_TILES.has(this.world.getTile(tile)?.type as TileType)
      ) {
        continue;
      }
      this.world.setTile({ x: tile.x, y: tile.y }, tile.t);
    }
  }

  /**
   * Repair walled-room buildings that were saved as solid "House" blocks (an old
   * redevelopment bug stamped them solid, wiping the room). Repaints any built
   * room building whose interior shows as solid "House" back into walls/floor/
   * door; residents re-furnish. Run once after loading a save.
   */
  repairWalledRooms() {
    for (const building of this.buildings) {
      if (building.stage !== "built" || !ROOM_BUILDING_KINDS.has(building.kind)) {
        continue;
      }
      const centre = this.world.getTile(this.houseInterior(building))?.type;
      if (centre === "House") {
        this.repaintWalledRoomKeepingFurniture(building);
        this.reserveEntrance(building);
      }
    }
    this.refreshDoors();
  }

  getFunfair(): Building | undefined {
    return this.buildings.find((b) => b.kind === "funfair" && b.stage === "built");
  }

  hasAnyFunfair(): boolean {
    return this.buildings.some((b) => b.kind === "funfair");
  }

  // --- The coaster track + train (shared by the renderer and riding residents) ---
  // A compact ride that fits inside the funfair's footprint. (The sprawling
  // map-wide elevated coaster is kept as planned ENDGAME content — build it once
  // all materials are gathered; its design is recorded in DESIGN-recreation.md.)

  private static readonly COASTER_LOOP_SECONDS = 9; // one full circuit of the small loop
  private static readonly COASTER_CARS = 4; // cars in the train (= rider capacity)
  private static readonly COASTER_GAP = 0.05; // spacing between cars, as a loop fraction
  private coasterTilesCache: { key: string; pts: Vec2[] } | null = null;

  /**
   * The coaster loop as a dense, smooth ring of TILE coords laid out inside the
   * funfair's footprint. Empty when no funfair is built.
   */
  coasterTrackTiles(): Vec2[] {
    const f = this.getFunfair();
    if (!f) {
      return [];
    }
    const key = `${f.id}:${f.x},${f.y},${f.width}x${f.height}`;
    if (this.coasterTilesCache && this.coasterTilesCache.key === key) {
      return this.coasterTilesCache.pts;
    }
    const cx = f.x + f.width / 2;
    const cy = f.y + f.height / 2;
    const rx = f.width / 2 - 1.1;
    const ry = f.height / 2 - 1.1;
    const N = 60;
    const pts: Vec2[] = [];
    for (let i = 0; i < N; i += 1) {
      // Start at the bottom (the station, by the entrance) and run a gently lobed
      // oval so it reads as a little circuit rather than a plain ellipse.
      const a = Math.PI / 2 + (2 * Math.PI * i) / N;
      const wob = 1 + 0.08 * Math.cos(2 * a);
      pts.push({ x: cx + rx * wob * Math.cos(a), y: cy + ry * wob * Math.sin(a) });
    }
    this.coasterTilesCache = { key, pts };
    return pts;
  }

  /** Sample the track at a loop fraction (0..1), interpolating between points. */
  private coasterAt(frac: number): Vec2 {
    const pts = this.coasterTrackTiles();
    const N = pts.length;
    if (N === 0) {
      return { x: 0, y: 0 }; // no built coaster — nothing to sample
    }
    const f = (((frac % 1) + 1) % 1) * N;
    const i0 = Math.floor(f) % N;
    const i1 = (i0 + 1) % N;
    const tt = f - Math.floor(f);
    const a = pts[i0];
    const b = pts[i1];
    return { x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt };
  }

  /** Current loop fraction of the train's lead car (advances with sim time). */
  private coasterPhase(): number {
    return this.elapsedSeconds / Simulation.COASTER_LOOP_SECONDS;
  }

  /** How many riders the train holds (one per car). */
  coasterCapacity(): number {
    return Simulation.COASTER_CARS;
  }

  /** Tile position of car `slot` (0 = lead) right now. */
  coasterCarTile(slot: number): Vec2 {
    return this.coasterAt(this.coasterPhase() - slot * Simulation.COASTER_GAP);
  }

  /** Tile positions of every car right now (for the renderer). */
  coasterCarTiles(): Vec2[] {
    return Array.from({ length: Simulation.COASTER_CARS }, (_, c) => this.coasterCarTile(c));
  }

  /**
   * Where riders board the coaster: the front-centre plaza tile just inside the
   * entrance gate, aligned with the track's station segment.
   */
  funfairBoardingTile(building: Building): Vec2 {
    return {
      x: building.x + Math.floor(building.width / 2),
      y: building.y + building.height - 2,
    };
  }

  /** A free interior grass tile of a pasture to drop a tamed animal onto. */
  pastureGrazeSpot(building: Building): Vec2 | undefined {
    for (let fy = 1; fy < building.height - 1; fy += 1) {
      for (let fx = 1; fx < building.width - 1; fx += 1) {
        const pos = { x: building.x + fx, y: building.y + fy };
        if (this.world.getTile(pos)?.type === "Grass") {
          return pos;
        }
      }
    }
    return undefined;
  }

  /**
   * Lazily build the construction plan for a walled-room building: every wall,
   * floor and doorway tile, none yet laid. Residents place these one at a time.
   * Floors and doors are listed before walls so the interior is laid (and the
   * doorway kept passable) before the perimeter closes — nobody walls themself in.
   */
  ensureBuildPlan(building: Building): BuildPlanTile[] {
    if (!building.plan) {
      const layout = this.buildingLayout(building);
      const order = (t: TileType): number =>
        t === "Wall" || t === "Fence" ? 2 : t === "Door" || t === "FenceGate" ? 1 : 0;
      building.plan = layout
        // A tile already showing its target type needs no laying. This is what
        // lets an annex share its parent's wall: those tiles are already Wall, so
        // they start done — only the genuinely new structure (and the doorway
        // punched through the shared wall) is built and paid for. A Floor tile
        // that already holds furniture (a stove, bed, table) is left alone too,
        // so re-planning an enlarged room never lays floor over its fittings.
        .map((tile) => {
          const current = this.world.getTile(tile)?.type;
          const done =
            current === tile.t ||
            (tile.t === "Floor" && Simulation.FURNITURE_TILES.has(current as TileType));
          return { ...tile, done };
        })
        .sort((a, b) => order(a.t) - order(b.t));
    }
    return building.plan;
  }

  /**
   * The nearest not-yet-laid plan tile to a point, floors/doors before walls.
   * Tiles another builder has already claimed (is walking to) are skipped, and
   * the chosen tile is claimed for `builderId` — so several builders raising one
   * room each grab a different tile instead of all converging on the same one.
   */
  nextBuildTile(building: Building, from: Vec2, builderId?: string): BuildPlanTile | undefined {
    const plan = building.plan;
    if (!plan) {
      return undefined;
    }
    let best: BuildPlanTile | undefined;
    let bestKey = Number.POSITIVE_INFINITY;
    for (const tile of plan) {
      if (tile.done) {
        continue;
      }
      // Leave tiles another builder is already on their way to lay.
      if (tile.claimedBy && tile.claimedBy !== builderId) {
        continue;
      }
      // Solids (walls, fences) come last (category 1) so the perimeter closes
      // only once the interior and doorway/gate are in place.
      const category = tile.t === "Wall" || tile.t === "Fence" ? 1 : 0;
      const d = (tile.x - from.x) ** 2 + (tile.y - from.y) ** 2;
      const key = category * 1e6 + d;
      if (key < bestKey) {
        bestKey = key;
        best = tile;
      }
    }
    if (best && builderId) {
      // Release any other tile this builder had claimed, then claim this one.
      for (const tile of plan) {
        if (tile.claimedBy === builderId && tile !== best) {
          tile.claimedBy = undefined;
        }
      }
      best.claimedBy = builderId;
    }
    return best;
  }

  /** Drop every build-tile claim held by a builder (e.g. when they down tools). */
  releaseBuildClaims(building: Building | undefined, builderId: string) {
    if (!building?.plan) {
      return;
    }
    for (const tile of building.plan) {
      if (tile.claimedBy === builderId) {
        tile.claimedBy = undefined;
      }
    }
  }

  /** Lay one plan tile: stamp the real tile and mark it done. */
  placeBuildTile(building: Building, tile: BuildPlanTile) {
    this.world.setTile({ x: tile.x, y: tile.y }, tile.t);
    const entry = building.plan?.find((p) => p.x === tile.x && p.y === tile.y);
    if (entry) {
      entry.done = true;
      entry.claimedBy = undefined;
    }
    this.refreshDoors();
    this.notifyChanged();
  }

  /** True once every tile in the construction plan has been laid. */
  planComplete(building: Building): boolean {
    return !!building.plan && building.plan.every((tile) => tile.done);
  }

  /** The bed tile inside a home, if one has been built. */
  bedOf(building: Building): Vec2 | undefined {
    return this.interiorTiles(building).find(
      (tile) => this.world.getTile(tile)?.type === "Bed",
    );
  }

  hasBed(building: Building): boolean {
    return this.bedOf(building) !== undefined;
  }

  hasTable(building: Building): boolean {
    return this.interiorTiles(building).some(
      (tile) => this.world.getTile(tile)?.type === "Table",
    );
  }

  /** Comfort bonus per second from a home's furniture (a furnished home is cosier). */
  homeFurnitureComfort(building: Building): number {
    return (this.hasBed(building) ? 0.03 : 0) + (this.hasTable(building) ? 0.025 : 0);
  }

  /** A free interior floor tile to put a bed on (prefers the home's centre). */
  bedSpot(building: Building): Vec2 | undefined {
    const interior = this.interiorTiles(building);
    const home = this.houseInterior(building);
    const ordered = interior.sort(
      (a, b) =>
        Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y),
    );
    return ordered.find((tile) => this.world.getTile(tile)?.type === "Floor");
  }

  /**
   * A plot for a 1×2/2×1 bed inside a home: two adjacent free floor tiles (head +
   * foot) with a third free tile beside them to build from (so the builder stands
   * next to the bed, not on it). A bed is always a full two tiles — if one won't
   * fit, nothing is returned (no cramped one-tile cots). Tiles are ranked toward
   * the room's edges, leaving the centre as an aisle.
   */
  reserveBedPlot(
    building: Building,
  ): { head: Vec2; foot?: Vec2; stand: Vec2 } | undefined {
    const home = this.houseInterior(building);
    const free = (p: Vec2): boolean => {
      if (this.world.getTile(p)?.type !== "Floor") {
        return false;
      }
      // Keep doorways clear: never set a bed on a tile touching a door — a bed in
      // front of one would seal the entrance (e.g. a bedroom annex's internal door,
      // trapping its owner inside).
      for (const d of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        if (this.world.getTile({ x: p.x + d.x, y: p.y + d.y })?.type === "Door") {
          return false;
        }
      }
      return true;
    };
    // Place beds toward the edges/corners first, leaving the centre tile clear as
    // an aisle and the home anchor (which must stay walkable) — beds are solid.
    const interior = this.interiorTiles(building)
      .filter(free)
      .sort(
        (a, b) =>
          Math.hypot(b.x - home.x, b.y - home.y) - Math.hypot(a.x - home.x, a.y - home.y),
      );
    const DIRS = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    const key = (p: Vec2) => `${p.x},${p.y}`;
    const doors = this.buildingDoors(building);
    // Every interior cell plus the doorways — the room's navigable space.
    const inRoom = new Set([
      ...this.interiorTiles(building).map(key),
      ...doors.map(key),
    ]);
    // Beds are solid, so a new bed mustn't cut the room: with `block` tiles treated
    // as walls, every remaining free-floor tile (and the build/mount tile) must
    // still be reachable from a doorway. Returns the reachable set, or null if the
    // placement would strand a tile or seal the door.
    const reachableWith = (block: Vec2[]): Set<string> | null => {
      const blocked = new Set(block.map(key));
      const seen = new Set<string>();
      const stack: Vec2[] = [];
      for (const d of doors) {
        if (this.world.isWalkable(d) && !blocked.has(key(d))) {
          seen.add(key(d));
          stack.push(d);
        }
      }
      // A reserved-but-unbuilt bed (BedSite) is treated as a planned solid bed.
      const planned = (p: Vec2): boolean => this.world.getTile(p)?.type === "BedSite";
      while (stack.length) {
        const p = stack.pop()!;
        for (const s of DIRS) {
          const np = { x: p.x + s.x, y: p.y + s.y };
          const k = key(np);
          if (
            seen.has(k) ||
            !inRoom.has(k) ||
            blocked.has(k) ||
            planned(np) ||
            !this.world.isWalkable(np)
          ) {
            continue;
          }
          seen.add(k);
          stack.push(np);
        }
      }
      for (const t of this.interiorTiles(building)) {
        if (blocked.has(key(t))) {
          continue;
        }
        const ty = this.world.getTile(t)?.type;
        // No free floor tile may be cut off...
        if (ty === "Floor" && !seen.has(key(t))) {
          return null;
        }
        // ...and every existing or planned bed must keep a reachable tile beside
        // it to climb on from, so a new bed never boxes another one in.
        if (ty === "Bed" || ty === "BedFoot" || ty === "BedSite") {
          const mountable = DIRS.some((s) => seen.has(key({ x: t.x + s.x, y: t.y + s.y })));
          if (!mountable) {
            return null;
          }
        }
      }
      return seen;
    };

    // Prefer a real two-tile bed: head + an adjacent foot, with a reachable tile
    // beside the HEAD to build from / climb onto (and the room stays connected,
    // and no existing bed gets boxed in).
    for (const head of interior) {
      for (const d of DIRS) {
        const foot = { x: head.x + d.x, y: head.y + d.y };
        if (!free(foot)) {
          continue;
        }
        const reach = reachableWith([head, foot]);
        if (!reach) {
          continue;
        }
        // The mount tile must sit beside the head (where the sleeper lies).
        const stand = DIRS.map((s) => ({ x: head.x + s.x, y: head.y + s.y })).find(
          (s) => reach.has(key(s)) && !(s.x === foot.x && s.y === foot.y),
        );
        if (stand) {
          return { head, foot, stand };
        }
      }
    }
    // No single-tile fallback: a bed is always a full 1×2/2×1 piece. If a real
    // bed won't fit, none is built (the sleeper rests on the floor) — that's the
    // pressure that drives a roomier home or a private bedroom, rather than an
    // ugly one-tile cot.
    return undefined;
  }

  /**
   * Tear out the bed at `pos` (both of its tiles), turning them back to floor and
   * releasing its owner — used to free a resident a bed has sealed in.
   */
  removeBedAt(pos: Vec2): void {
    const isBedTile = (p: Vec2): boolean => {
      const t = this.world.getTile(p)?.type;
      return t === "Bed" || t === "BedFoot" || t === "BedSite";
    };
    if (!isBedTile(pos)) {
      return;
    }
    const pair = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]
      .map((d) => ({ x: pos.x + d.x, y: pos.y + d.y }))
      .find((p) => isBedTile(p));
    this.world.setTile(pos, "Floor");
    if (pair) {
      this.world.setTile(pair, "Floor");
    }
    for (const a of this.agents) {
      const owns = (p?: Vec2) =>
        p && ((p.x === pos.x && p.y === pos.y) || (pair && p.x === pair.x && p.y === pair.y));
      if (owns(a.bedPos) || owns(a.bedFoot)) {
        a.bedPos = undefined;
        a.bedFoot = undefined;
      }
    }
    this.notifyChanged();
  }

  /** The interior (non-wall, non-door) floor tiles of a walled room. */
  interiorTiles(building: Building): Vec2[] {
    const tiles: Vec2[] = [];
    const doorKeys = new Set(this.buildingDoors(building).map((d) => `${d.x},${d.y}`));
    for (let fy = 1; fy < building.height - 1; fy += 1) {
      for (let fx = 1; fx < building.width - 1; fx += 1) {
        const pos = { x: building.x + fx, y: building.y + fy };
        if (!doorKeys.has(`${pos.x},${pos.y}`)) {
          tiles.push(pos);
        }
      }
    }
    return tiles;
  }

  // --- Expansion: enlarge a full warehouse / cramped kitchen in place ---------

  /** A warehouse/kitchen should always keep at least this many free interior tiles. */
  private static readonly MIN_FREE_CIVIC_TILES = 2;

  /**
   * How many interior tiles are still free to use: for a warehouse, tiles with no
   * pile on them (room to stock more); for a kitchen, bare floor tiles (room for
   * the cook to stand and for fittings like a table).
   */
  private freeCivicTiles(building: Building): number {
    if (building.kind === "warehouse") {
      return this.interiorTiles(building).filter((t) => !this.itemAt(t)).length;
    }
    return this.interiorTiles(building).filter(
      (t) => this.world.getTile(t)?.type === "Floor",
    ).length;
  }

  /**
   * A built warehouse or kitchen that has run low on breathing room and has clear
   * ground to grow into. Returns the first one that should be enlarged, if any.
   */
  // --- Demand vs supply: scale the COUNT of amenities with the population ------

  /** Residents one of each amenity can comfortably serve before another is wanted. */
  private static readonly SERVE_PER: Partial<Record<BuildingKind, number>> = {
    warehouse: 18,
    granary: 18,
    kitchen: 14, // each kitchen brings its own stove + dining, so cooking scales too
  };

  /** How many of a civic building the current population warrants (≥1). */
  desiredCivicCount(kind: BuildingKind): number {
    const per = Simulation.SERVE_PER[kind];
    if (!per) {
      return 0;
    }
    return Math.max(1, Math.ceil(this.agents.length / per));
  }

  /**
   * True when the population has outgrown the current supply of `kind` and
   * another should be raised — but never while one of that kind is already going
   * up (so a growing town adds them one at a time, not all at once).
   */
  needsMoreOf(kind: BuildingKind): boolean {
    if (this.buildings.some((b) => b.kind === kind && b.stage !== "built")) {
      return false;
    }
    const built = this.buildings.filter((b) => b.kind === kind && b.stage === "built").length;
    return built >= 1 && built < this.desiredCivicCount(kind);
  }

  civicNeedingExpansion(): Building | undefined {
    for (const building of this.buildings) {
      if (building.stage !== "built") {
        continue;
      }
      if (building.kind !== "warehouse" && building.kind !== "kitchen") {
        continue;
      }
      // A kitchen grows when it can't fit a dining set at all, or when it wants
      // more seats but has no room left to add them — so the dining room keeps up
      // with the village even if it isn't strictly "full".
      const wantsDiningRoom =
        building.kind === "kitchen" &&
        ((!this.hasDiningTable() && !this.diningSetSpot(building)) ||
          (this.wantsMoreSeats() && !this.diningGrowthTile(building)));
      if (this.freeCivicTiles(building) >= Simulation.MIN_FREE_CIVIC_TILES && !wantsDiningRoom) {
        continue;
      }
      if (this.planExpansionRect(building)) {
        return building;
      }
    }
    return undefined;
  }

  /**
   * Pick an enlarged rectangle for `building` at least 1.5× its current area,
   * growing into clear ground on a side that isn't its (south) doorway — so the
   * door stays on the perimeter and the existing structure stays put. Of the
   * directions with room, one is chosen at random so repeated expansions yield
   * varied shapes rather than always stretching the same way. Returns the new
   * footprint, or undefined if hemmed in on every buildable side.
   */
  planExpansionRect(
    building: Building,
  ): { x: number; y: number; width: number; height: number } | undefined {
    const { x, y, width: w, height: h } = building;
    const isGround = (p: Vec2): boolean =>
      this.world.inBounds(p) &&
      this.world.getTile(p)?.type === "Grass" &&
      !this.isTileClaimed(p);
    const stripClear = (x0: number, y0: number, sw: number, sh: number): boolean => {
      for (let yy = y0; yy < y0 + sh; yy += 1) {
        for (let xx = x0; xx < x0 + sw; xx += 1) {
          if (!isGround({ x: xx, y: yy })) {
            return false;
          }
        }
      }
      return true;
    };
    const ex = Math.ceil(w * 0.5); // columns needed to reach ≥1.5× area
    const ey = Math.ceil(h * 0.5); // rows needed to reach ≥1.5× area
    type Rect = { x: number; y: number; width: number; height: number };
    // Growing must not bring a *different* building any closer than it already is:
    // otherwise the new outer wall lands flush against a neighbour (a double wall)
    // or one tile off it (a squeezed sliver). Existing shared walls are preserved
    // because they were already within reach before the expansion.
    const before = this.otherBuildingTilesNear(building, 2);
    const keepsClearance = (rect: Rect): boolean => {
      for (const key of this.otherBuildingTilesNear(rect, 2)) {
        if (!before.has(key)) {
          return false;
        }
      }
      return true;
    };
    const options: Rect[] = [];
    // East: new ground to the right; height (and the south doorway) unchanged.
    if (stripClear(x + w, y, ex, h)) {
      options.push({ x, y, width: w + ex, height: h });
    }
    // West: new ground to the left; origin shifts, door stays on the south row.
    if (stripClear(x - ex, y, ex, h)) {
      options.push({ x: x - ex, y, width: w + ex, height: h });
    }
    // North: new ground above; the south row (with the door) is untouched.
    if (stripClear(x, y - ey, w, ey)) {
      options.push({ x, y: y - ey, width: w, height: h + ey });
    }
    const viable = options.filter(keepsClearance);
    if (viable.length === 0) {
      return undefined;
    }
    return viable[Math.floor(Math.random() * viable.length)];
  }

  /**
   * Building tiles (of OTHER buildings) within `margin` tiles of a rectangle,
   * excluding the rectangle's own footprint. Used to keep an expanding building
   * from planting a new wall flush against — or a sliver from — a neighbour.
   */
  private otherBuildingTilesNear(
    rect: { x: number; y: number; width: number; height: number },
    margin: number,
  ): Set<string> {
    const set = new Set<string>();
    const isBuilding = (t: TileType | undefined): boolean =>
      t === "Wall" ||
      t === "Door" ||
      t === "Floor" ||
      t === "House" ||
      t === "HouseSite" ||
      t === "HouseFoundation";
    for (let yy = rect.y - margin; yy < rect.y + rect.height + margin; yy += 1) {
      for (let xx = rect.x - margin; xx < rect.x + rect.width + margin; xx += 1) {
        const inside =
          xx >= rect.x && xx < rect.x + rect.width && yy >= rect.y && yy < rect.y + rect.height;
        if (inside) {
          continue;
        }
        if (isBuilding(this.world.getTile({ x: xx, y: yy })?.type)) {
          set.add(`${xx},${yy}`);
        }
      }
    }
    return set;
  }

  /**
   * Reopen a finished room as a construction project on an enlarged footprint:
   * the old structure stays, the side wall becomes interior, and the new floor +
   * surrounding walls are laid by hand (RimWorld-style) before it's sealed again.
   * Returns false if there's no room to grow.
   */
  beginExpansion(building: Building): boolean {
    const rect = this.planExpansionRect(building);
    if (!rect) {
      return false;
    }
    // Release the old footprint claim before resizing, then claim the new one.
    this.releaseBuildingFootprint(building);
    building.x = rect.x;
    building.y = rect.y;
    building.width = rect.width;
    building.height = rect.height;
    // The single south doorway sits on a side we never extend, so it stays valid;
    // drop any stale multi-door list so the plan reads the one door.
    building.doors = undefined;
    building.expanding = true;
    building.stage = "foundation";
    building.plan = undefined;
    this.ensureBuildPlan(building); // existing walls/floor/fittings start done
    this.claimBuildingFootprint(building);
    this.reserveEntrance(building);
    this.refreshDoors();
    this.notifyChanged();
    return true;
  }

  /**
   * Remodel away redundant double walls. Where one finished room sits flush
   * against another (or one tile off it) and the neighbour's wall fully covers
   * the shared edge, the redundant wall is torn out and the rooms share a single
   * face: the room grows up to the neighbour's wall, its old edge (and any
   * one-tile gap) becoming interior floor. Furniture is preserved. Runs until no
   * more merges are possible.
   */
  remodelDoubleWalls() {
    const rooms = () =>
      this.buildings.filter((b) => b.stage === "built" && ROOM_BUILDING_KINDS.has(b.kind));
    let changed = false;
    for (let pass = 0; pass < 6; pass += 1) {
      let merged = false;
      outer: for (const a of rooms()) {
        for (const b of rooms()) {
          if (a !== b && this.tryShareWall(a, b)) {
            merged = true;
            changed = true;
            break outer; // footprints moved — restart the scan
          }
        }
      }
      if (!merged) {
        break;
      }
    }
    if (changed) {
      this.refreshDoors();
      this.recomputeAmbiance();
      this.notifyChanged();
    }
  }

  /**
   * If `a` sits flush against (gap 0) or one tile from (gap 1) building `b` on a
   * side whose whole edge `b`'s wall covers, grow `a` up to `b`'s wall so they
   * share it, and report success. Skipped when `a`'s only door is on that side.
   */
  private tryShareWall(a: Building, b: Building): boolean {
    const isGrass = (p: Vec2): boolean =>
      this.world.getTile(p)?.type === "Grass" && !this.isTileClaimed(p);
    const range = (start: number, len: number): number[] =>
      Array.from({ length: len }, (_, i) => start + i);
    const coversCols = b.y <= a.y && b.y + b.height >= a.y + a.height; // for E/W edges
    const coversRows = b.x <= a.x && b.x + b.width >= a.x + a.width; // for N/S edges
    type Side = {
      gap: number;
      covers: boolean;
      doorOnEdge: (d: Vec2) => boolean;
      gapLine: Vec2[]; // the single-tile gap to cross (only used when gap === 1)
      apply: (g: number) => void;
    };
    const sides: Side[] = [
      {
        gap: b.x - (a.x + a.width),
        covers: coversCols,
        doorOnEdge: (d) => d.x === a.x + a.width - 1,
        gapLine: range(a.y, a.height).map((yy) => ({ x: a.x + a.width, y: yy })),
        apply: (g) => {
          a.width += g + 1;
        },
      },
      {
        gap: a.x - (b.x + b.width),
        covers: coversCols,
        doorOnEdge: (d) => d.x === a.x,
        gapLine: range(a.y, a.height).map((yy) => ({ x: a.x - 1, y: yy })),
        apply: (g) => {
          a.x -= g + 1;
          a.width += g + 1;
        },
      },
      {
        gap: b.y - (a.y + a.height),
        covers: coversRows,
        doorOnEdge: (d) => d.y === a.y + a.height - 1,
        gapLine: range(a.x, a.width).map((xx) => ({ x: xx, y: a.y + a.height })),
        apply: (g) => {
          a.height += g + 1;
        },
      },
      {
        gap: a.y - (b.y + b.height),
        covers: coversRows,
        doorOnEdge: (d) => d.y === a.y,
        gapLine: range(a.x, a.width).map((xx) => ({ x: xx, y: a.y - 1 })),
        apply: (g) => {
          a.y -= g + 1;
          a.height += g + 1;
        },
      },
    ];
    const doors = this.buildingDoors(a);
    for (const s of sides) {
      if ((s.gap !== 0 && s.gap !== 1) || !s.covers) {
        continue;
      }
      if (doors.some(s.doorOnEdge)) {
        continue; // would tear out the wall that holds a's entrance
      }
      if (s.gap === 1 && !s.gapLine.every(isGrass)) {
        continue; // the one-tile gap must be open ground to floor over
      }
      s.apply(s.gap);
      this.repaintWalledRoomKeepingFurniture(a);
      return true;
    }
    return false;
  }

  /**
   * A spot for a private 4×4 bedroom annexed onto `parent`, sharing one of its
   * walls (no double wall). Its 2×2 interior fits a proper two-tile bed (no lone
   * single-tile beds). The annex's footprint overlaps the parent's wall line
   * on one side; an internal doorway is punched through that shared wall, opening
   * onto the parent's interior. Returns the annex rectangle and that doorway, or
   * undefined if no side has clear ground for one. Tries each side, then offsets.
   */
  findAnnexSite(
    parent: Building,
  ): { x: number; y: number; width: number; height: number; door: Vec2 } | undefined {
    const { x: px, y: py, width: pw, height: ph } = parent;
    const A = 4; // annex side length (2×2 interior — room for a full two-tile bed)
    const isGrass = (p: Vec2): boolean =>
      this.world.getTile(p)?.type === "Grass" && !this.isTileClaimed(p);
    const isFloor = (p: Vec2): boolean => this.world.getTile(p)?.type === "Floor";
    const isWall = (p: Vec2): boolean => this.world.getTile(p)?.type === "Wall";

    type Cand = { ax: number; ay: number; door: Vec2; sharedTiles: Vec2[]; newTiles: Vec2[] };
    const build = (
      ax: number,
      ay: number,
      door: Vec2,
      parentNeighbor: Vec2,
      sharedAxis: "col" | "row",
      sharedAt: number,
    ): Cand | undefined => {
      // The doorway must open onto an actual interior floor tile of the parent.
      if (!isFloor(parentNeighbor)) {
        return undefined;
      }
      const shared: Vec2[] = [];
      const fresh: Vec2[] = [];
      for (let fy = 0; fy < A; fy += 1) {
        for (let fx = 0; fx < A; fx += 1) {
          const p = { x: ax + fx, y: ay + fy };
          if (!this.world.inBounds(p)) {
            return undefined;
          }
          const onShared = sharedAxis === "col" ? p.x === sharedAt : p.y === sharedAt;
          if (onShared) {
            shared.push(p);
          } else {
            fresh.push(p);
          }
        }
      }
      // The shared edge must lie on the parent's standing wall; every other tile
      // must be open ground we can build on.
      if (!shared.every(isWall) || !fresh.every(isGrass)) {
        return undefined;
      }
      return { ax, ay, door, sharedTiles: shared, newTiles: fresh };
    };

    const candidates: (Cand | undefined)[] = [];
    // Each side shares the parent's outer wall line; slide the annex along that
    // side so its 1-tile interior lines up with a parent interior row/column.
    for (let off = 0; off <= ph - A; off += 1) {
      const ay = py + off;
      const mid = ay + 1;
      // East: shared column = parent's right wall.
      candidates.push(
        build(px + pw - 1, ay, { x: px + pw - 1, y: mid }, { x: px + pw - 2, y: mid }, "col", px + pw - 1),
      );
      // West: shared column = parent's left wall.
      candidates.push(
        build(px - A + 1, ay, { x: px, y: mid }, { x: px + 1, y: mid }, "col", px),
      );
    }
    for (let off = 0; off <= pw - A; off += 1) {
      const ax = px + off;
      const mid = ax + 1;
      // South: shared row = parent's bottom wall.
      candidates.push(
        build(ax, py + ph - 1, { x: mid, y: py + ph - 1 }, { x: mid, y: py + ph - 2 }, "row", py + ph - 1),
      );
      // North: shared row = parent's top wall.
      candidates.push(
        build(ax, py - A + 1, { x: mid, y: py }, { x: mid, y: py + 1 }, "row", py),
      );
    }
    const chosen = candidates.find((c): c is Cand => c !== undefined);
    if (!chosen) {
      return undefined;
    }
    return { x: chosen.ax, y: chosen.ay, width: A, height: A, door: chosen.door };
  }

  /**
   * A site for a width×height room that shares a whole wall with an existing
   * walled building instead of standing apart with its own — terraced housing
   * that saves wall material and space (the shared wall is built once; the new
   * room's plan skips it). The new footprint overlaps the neighbour's wall line
   * on one side; every other tile must be open ground, and a non-shared side must
   * face open ground so a real road-facing door can be cut. Returns the top-left,
   * or undefined if nothing adjoins cleanly. Prefers spots nearest `origin`.
   */
  findAdjoiningSite(
    width: number,
    height: number,
    origin: Vec2,
    isBlocked?: (p: Vec2) => boolean,
  ): { x: number; y: number } | undefined {
    const isGrass = (p: Vec2): boolean =>
      this.world.getTile(p)?.type === "Grass" && !this.isTileClaimed(p) && !(isBlocked?.(p) ?? false);
    const isWall = (p: Vec2): boolean => this.world.getTile(p)?.type === "Wall";
    const isBuilding = (p: Vec2): boolean => {
      const t = this.world.getTile(p)?.type;
      return (
        t === "Wall" ||
        t === "Door" ||
        t === "Floor" ||
        t === "House" ||
        t === "HouseSite" ||
        t === "HouseFoundation"
      );
    };
    // A side has a usable doorway if some tile just outside it is open ground that
    // can reach a street (so the terraced house isn't sealed in).
    const openApproach = (p: Vec2): boolean => {
      const t = this.world.getTile(p)?.type;
      return t === "Grass" || t === "Dirt" || t === "Road" || t === "Plaza" || t === "Stump";
    };

    type Side = "E" | "W" | "S" | "N";
    let best: { x: number; y: number; score: number } | undefined;

    // The line of tiles just outside a footprint side (distance 1) and one beyond
    // (distance 2) — used to keep clearance from OTHER buildings.
    const outsideLine = (ax: number, ay: number, side: Side, d: number): Vec2[] => {
      const line: Vec2[] = [];
      if (side === "S") for (let fx = 0; fx < width; fx += 1) line.push({ x: ax + fx, y: ay + height - 1 + d });
      else if (side === "N") for (let fx = 0; fx < width; fx += 1) line.push({ x: ax + fx, y: ay - d });
      else if (side === "E") for (let fy = 0; fy < height; fy += 1) line.push({ x: ax + width - 1 + d, y: ay + fy });
      else for (let fy = 0; fy < height; fy += 1) line.push({ x: ax - d, y: ay + fy });
      return line;
    };

    const consider = (ax: number, ay: number, shared: Side) => {
      const fresh: Vec2[] = []; // footprint tiles that must be open ground to build
      let overlap = 0; // shared-edge tiles that actually sit on the neighbour's wall
      let sharedOk = true;
      for (let fy = 0; fy < height; fy += 1) {
        for (let fx = 0; fx < width; fx += 1) {
          const p = { x: ax + fx, y: ay + fy };
          if (!this.world.inBounds(p)) {
            return;
          }
          const onShared =
            (shared === "W" && fx === 0) ||
            (shared === "E" && fx === width - 1) ||
            (shared === "N" && fy === 0) ||
            (shared === "S" && fy === height - 1);
          if (onShared) {
            // Each shared-edge tile either overlaps the neighbour's wall (reused)
            // or is open ground that becomes this building's own wall, extending
            // the line — so neighbours of unequal size can still terrace.
            if (isWall(p)) {
              overlap += 1;
            } else if (isGrass(p)) {
              fresh.push(p);
            } else {
              sharedOk = false;
            }
          } else {
            fresh.push(p);
          }
        }
      }
      // Need a genuine stretch of shared wall, and every other tile clear ground.
      if (!sharedOk || overlap < 2 || !fresh.every(isGrass)) {
        return;
      }
      // At least one non-shared edge must open onto reachable ground for a door.
      const edges: { side: Side; approach: Vec2 }[] = [
        { side: "S", approach: { x: ax + Math.floor(width / 2), y: ay + height } },
        { side: "N", approach: { x: ax + Math.floor(width / 2), y: ay - 1 } },
        { side: "E", approach: { x: ax + width, y: ay + Math.floor(height / 2) } },
        { side: "W", approach: { x: ax - 1, y: ay + Math.floor(height / 2) } },
      ];
      if (!edges.some((e) => e.side !== shared && openApproach(e.approach))) {
        return;
      }
      // Keep clearance from OTHER buildings on the non-shared sides so terracing
      // here never leaves a wasteful double wall or a squeezed one-tile sliver
      // against a different building. Corner tiles are skipped — they can be the
      // shared wall's own continuation when the neighbour is the larger building.
      const interior = (line: Vec2[]) => line.slice(1, line.length - 1);
      for (const side of ["S", "N", "E", "W"] as Side[]) {
        if (side === shared) {
          continue;
        }
        if (interior(outsideLine(ax, ay, side, 1)).some(isBuilding)) {
          return; // a second wall flush alongside — a double wall
        }
        if (interior(outsideLine(ax, ay, side, 2)).some(isBuilding)) {
          return; // a building one tile away — the squeezed sliver
        }
      }
      const cx = ax + width / 2;
      const cy = ay + height / 2;
      const score = -(Math.abs(cx - origin.x) + Math.abs(cy - origin.y)) + Math.random() * 2;
      if (!best || score > best.score) {
        best = { x: ax, y: ay, score };
      }
    };

    for (const b of this.buildings) {
      if (b.stage !== "built" || !ROOM_BUILDING_KINDS.has(b.kind)) {
        continue;
      }
      const { x: bx, y: by, width: bw, height: bh } = b;
      // Share the east wall of b: new house sits to the right, its west column on
      // b's east wall column. Slide vertically so the shared column stays on wall.
      for (let ay = by - (height - bh); ay <= by + (bh - 1); ay += 1) {
        consider(bx + bw - 1, ay, "W"); // new house's west edge = b's east wall
        consider(bx - width + 1, ay, "E"); // new house's east edge = b's west wall
      }
      for (let ax = bx - (width - bw); ax <= bx + (bw - 1); ax += 1) {
        consider(ax, by + bh - 1, "N"); // new house's north edge = b's south wall
        consider(ax, by - height + 1, "S"); // new house's south edge = b's north wall
      }
    }
    return best ? { x: best.x, y: best.y } : undefined;
  }

  /**
   * Entrances facing the nearest streets. Each candidate side's door sits on the
   * footprint edge with its approach tile just outside; sides are ranked by how
   * close they are to an actual road, and only sides whose approach is open
   * ground qualify. Big buildings get a second entrance. Falls back to the south
   * side so a building always has at least one door.
   */
  private computeDoors(x: number, y: number, width: number, height: number): Vec2[] {
    const cx = x + Math.floor(width / 2);
    const cy = y + Math.floor(height / 2);
    const xl = x;
    const xr = x + width - 1;
    const yt = y;
    const yb = y + height - 1;
    // Distance from an approach tile to the nearest road, scanning outward.
    const roadDist = (sx: number, sy: number, dx: number, dy: number): number => {
      for (let k = 1; k <= 6; k += 1) {
        const t = this.world.getTile({ x: sx + dx * k, y: sy + dy * k })?.type;
        if (t === "Road" || t === "Dirt" || t === "Plaza") {
          return k;
        }
        if (t === undefined || t === "Water" || t === "Tree" || t === "House") {
          break;
        }
      }
      return 99;
    };
    type Side = { dist: number; door: Vec2; front: Vec2 };
    const candidates: Side[] = [
      { dist: roadDist(cx, yb, 0, 1), door: { x: cx, y: yb }, front: { x: cx, y: yb + 1 } },
      { dist: roadDist(cx, yt, 0, -1), door: { x: cx, y: yt }, front: { x: cx, y: yt - 1 } },
      { dist: roadDist(xr, cy, 1, 0), door: { x: xr, y: cy }, front: { x: xr + 1, y: cy } },
      { dist: roadDist(xl, cy, -1, 0), door: { x: xl, y: cy }, front: { x: xl - 1, y: cy } },
    ];
    const open = (p: Vec2): boolean => {
      const t = this.world.getTile(p)?.type;
      // The tile just outside a doorway must be genuinely open — not another
      // building's wall/door/floor, water, a cliff, or decor. Otherwise a door
      // ends up opening straight into a neighbour's wall.
      return (
        t !== undefined &&
        t !== "Water" &&
        t !== "Tree" &&
        t !== "Fountain" &&
        t !== "Statue" &&
        t !== "House" &&
        t !== "HouseSite" &&
        t !== "HouseFoundation" &&
        t !== "Wall" &&
        t !== "Door" &&
        t !== "Floor" &&
        // Furniture means we're looking into a neighbour's interior — not a street.
        t !== "Stove" &&
        t !== "Bed" &&
        t !== "BedFoot" &&
        t !== "BedSite" &&
        t !== "Table" &&
        t !== "RockSandstone" &&
        t !== "RockLimestone" &&
        t !== "RockGranite" &&
        t !== "OreIron"
      );
    };
    const usable = candidates.filter((s) => this.world.getTile(s.front) && open(s.front));
    usable.sort((a, b) => a.dist - b.dist);
    const chosen = usable.length === 0 ? [candidates[0]] : [usable[0]];
    // A larger building opens a second entrance on the next-closest street.
    if (usable.length > 1 && (width >= 3 || height >= 3)) {
      chosen.push(usable[1]);
    }
    const doors: Vec2[] = [];
    for (const s of chosen) {
      if (!doors.some((d) => d.x === s.door.x && d.y === s.door.y)) {
        doors.push(s.door);
      }
    }
    return doors;
  }

  /** The open tile just outside a door (its approach), based on which edge it's on. */
  private doorFront(building: Building, door: Vec2): Vec2 {
    if (door.y === building.y) {
      return { x: door.x, y: building.y - 1 };
    }
    if (door.y === building.y + building.height - 1) {
      return { x: door.x, y: building.y + building.height };
    }
    if (door.x === building.x) {
      return { x: building.x - 1, y: door.y };
    }
    return { x: building.x + building.width, y: door.y };
  }

  private buildingDoors(building: Building): Vec2[] {
    return building.doors ?? [building.door];
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
    }
    // EVERY building is raised tile by tile: the moment its foundation is laid,
    // draw up the construction plan (walls/floor/door for rooms; fence/gate plus
    // grass or plaza for open yards) so residents place each tile one at a time.
    if (stage === "foundation") {
      this.ensureBuildPlan(building);
    }
    if (stage === "built" && !ROOM_BUILDING_KINDS.has(building.kind)) {
      // Open yards (pasture, fairground, cemetery, park): assert their final
      // fence / gate / interior layout once the tiles are all laid.
      this.paintBuildingLayout(building);
      building.plan = undefined;
    } else if (stage === "built" && ROOM_BUILDING_KINDS.has(building.kind)) {
      // An enlarged room keeps its interior (stockpile, stove, beds); a fresh one
      // is painted blank. Either way the perimeter and floor are asserted.
      if (building.expanding) {
        this.repaintWalledRoomKeepingFurniture(building);
        building.expanding = undefined;
      } else {
        this.paintWalledRoom(building);
      }
      building.plan = undefined;
      // A kitchen comes with a stove to cook at, set on its interior floor — but
      // only if it hasn't got one already (an enlarged kitchen keeps its stove).
      if (building.kind === "kitchen") {
        const interior = this.interiorTiles(building);
        const hasStove = interior.some((t) => this.world.getTile(t)?.type === "Stove");
        if (!hasStove) {
          // The stove is solid, so set it on the interior tile FARTHEST from the
          // doorway — that keeps the entrance and the floor beside it clear for the
          // cook to stand on, rather than walling the room off.
          const door = this.buildingDoors(building)[0];
          const spot = interior
            .slice()
            .sort(
              (a, b) =>
                Math.hypot(b.x - door.x, b.y - door.y) - Math.hypot(a.x - door.x, a.y - door.y),
            )[0];
          if (spot) {
            this.world.setTile(spot, "Stove");
            // Extend it into a 2-tile cooking counter: a prep surface on an
            // adjacent interior floor tile — but only if the stove keeps another
            // free side for the cook to work from (so we never wall the cook out).
            const interiorKeys = new Set(interior.map((t) => `${t.x},${t.y}`));
            const freeAdj = [
              { x: 1, y: 0 },
              { x: -1, y: 0 },
              { x: 0, y: 1 },
              { x: 0, y: -1 },
            ]
              .map((d) => ({ x: spot.x + d.x, y: spot.y + d.y }))
              .filter(
                (n) =>
                  interiorKeys.has(`${n.x},${n.y}`) && this.world.getTile(n)?.type === "Floor",
              );
            if (freeAdj.length >= 2) {
              this.world.setTile(freeAdj[0], "Counter");
            }
          }
        }
      }
    } else {
      // Site or foundation: lay the walkable base residents build over.
      const tileType: TileType = stage === "site" ? "HouseSite" : "HouseFoundation";
      for (const position of footprintTiles(building)) {
        // Never stamp over a finished wall or doorway: an annex's footprint
        // overlaps its parent house's shared wall, which must stay standing while
        // the annex is staked and raised. Only fresh ground gets the site/floor.
        const existing = this.world.getTile(position)?.type;
        if (existing === "Wall" || existing === "Door") {
          continue;
        }
        this.world.setTile(position, tileType);
      }
    }
    // An annex's only door is internal — it opens onto its parent house's
    // interior, not a street — so it needs no road approach reserved or paved.
    const annex = building.kind === "bedroom";
    // Every entrance keeps a clear approach: the tile in front of each door
    // becomes Road, so a building can never be sealed in by neighbours.
    if (!annex && this.gameMode === "auto") {
      this.reserveEntrance(building);
    }
    if (stage === "built" && !annex && this.gameMode === "auto") {
      this.paveApproach(building);
    }
    this.refreshDoors();
    this.notifyChanged();
  }

  /**
   * Pave the tile in front of each door to Road so nothing can build over it.
   * Call this the moment a site is staked (before the footprint tiles are typed),
   * so a clustered neighbour can't drop its footprint onto a doorway first.
   */
  reserveEntrance(building: Building) {
    if (this.gameMode === "architect") {
      return;
    }
    for (const door of this.buildingDoors(building)) {
      const front = this.doorFront(building, door);
      if (ROADABLE.has(this.world.getTile(front)?.type as TileType)) {
        this.world.setTile(front, "Road");
      }
    }
  }

  /**
   * Lay a short footpath from each doorway to the nearest existing road/path, so
   * a new building joins the street network instead of opening onto bare grass.
   * If nothing's close, leaves it — residents' desire paths will connect it.
   */
  private paveApproach(building: Building) {
    for (const door of this.buildingDoors(building)) {
      const route = this.routeToNearestPath(this.doorFront(building, door), APPROACH_MAX_TILES);
      if (!route) {
        continue;
      }
      for (const position of route) {
        const type = this.world.getTile(position)?.type;
        if (type === "Grass" || type === "Stump") {
          this.world.setTile(position, "Dirt");
        }
      }
    }
  }

  /** Breadth-first walk over open ground to the nearest road/path within range. */
  private routeToNearestPath(start: Vec2, maxLen: number): Vec2[] | undefined {
    const key = (p: Vec2) => p.y * this.world.width + p.x;
    const visited = new Set<number>([key(start)]);
    let frontier: { p: Vec2; path: Vec2[] }[] = [{ p: start, path: [] }];
    for (let depth = 0; depth < maxLen && frontier.length > 0; depth += 1) {
      const next: { p: Vec2; path: Vec2[] }[] = [];
      for (const { p, path } of frontier) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const np = { x: p.x + dx, y: p.y + dy };
          if (!this.world.inBounds(np) || visited.has(key(np))) {
            continue;
          }
          visited.add(key(np));
          const type = this.world.getTile(np)?.type;
          if (type === "Road" || type === "Dirt" || type === "Plaza") {
            return [...path, np];
          }
          if (type === "Grass" || type === "Stump") {
            next.push({ p: np, path: [...path, np] });
          }
        }
      }
      frontier = next;
    }
    return undefined;
  }

  /** A built building is solid except its doors; tell the world which tiles those are. */
  private refreshDoors() {
    const doors: Vec2[] = [];
    for (const building of this.buildings) {
      if (building.stage === "built") {
        doors.push(...this.buildingDoors(building));
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
        gameMode: this.gameMode,
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
        taintedMeals: this.taintedMeals,
        foods: this.foods.map((batch) => ({ ...batch })),
        hasMiningTools: this.hasMiningTools,
        items: this.items.map((stack) => ({
          ...stack,
          position: { ...stack.position },
          reservedBy: undefined,
        })),
        nextItemId: this.nextItemId,
        animals: this.animals.map((animal) => ({
          ...animal,
          position: { ...animal.position },
          path: undefined,
        })),
        nextAnimalId: this.nextAnimalId,
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

    // Keep streets a single lane: don't pave a tile if doing so would complete a
    // 2x2 block of paving (a "lane" widening). Crossroads (a + shape) are fine.
    if (this.wouldThickenPaving(tile)) {
      return;
    }
    if (tile.type === "Grass" && count >= PATH_WEAR_THRESHOLD) {
      this.world.setTile(tile, "Dirt");
      this.logPathEvent(tr("A footpath is being worn into the grass.", "풀밭에 오솔길이 나기 시작한다."));
    } else if (this.gameMode === "auto" && tile.type === "Dirt" && count >= ROAD_WEAR_THRESHOLD) {
      this.world.setTile(tile, "Road");
      this.traffic.delete(index);
      this.logPathEvent(tr("A well-trodden path has become a road.", "잘 다져진 길이 도로가 되었다."));
    }
  }

  /** Would paving this tile complete a 2x2 square of paving (a widened lane)? */
  private wouldThickenPaving(tile: Vec2): boolean {
    const paved = (x: number, y: number): boolean => {
      const t = this.world.getTile({ x, y })?.type;
      return t === "Road" || t === "Dirt" || t === "Plaza" || t === "Lamp";
    };
    for (const [ox, oy] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ]) {
      const x0 = tile.x + ox;
      const y0 = tile.y + oy;
      if (
        (x0 !== tile.x || y0 !== tile.y ? paved(x0, y0) : true) &&
        (x0 + 1 !== tile.x || y0 !== tile.y ? paved(x0 + 1, y0) : true) &&
        (x0 !== tile.x || y0 + 1 !== tile.y ? paved(x0, y0 + 1) : true) &&
        (x0 + 1 !== tile.x || y0 + 1 !== tile.y ? paved(x0 + 1, y0 + 1) : true)
      ) {
        return true;
      }
    }
    return false;
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
      weather: this.getWeather(),
      gameMode: this.gameMode,
      era: this.era,
      foodStock: this.foodStock,
      grainStock: this.grainStock,
      meatStock: this.meatStock,
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
      woodStock: this.stockOf("wood"),
      stoneStock: this.stockOf("stone"),
      oreStock: this.stockOf("ironOre"),
      supportedPopulation: this.supportedPopulation(),
      litter: this.litter.length,
      unrest: Math.round(this.unrest),
      steel: this.stockOf("steel"),
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
      this.log(tr("Wild berries sprouted in the valley.", "골짜기에 산딸기가 돋아났다."));
      return;
    }

    // Berry bushes no longer creep across the valley: a picked bush is gone for
    // good. A fresh cluster only seeds when the valley has none left (above), so
    // there's always some forage without a spreading carpet of berries.

    if (trees.length > 0 && trees.length < TREE_CAP) {
      for (const tree of trees) {
        // Forests spread slowly (was 0.008) so cleared land stays cleared.
        if (Math.random() < 0.0015) {
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
        this.log(tr("The village entered the Settlement era! Fields and a warehouse are now possible.", "마을이 정착지 시대에 들어섰다! 이제 밭과 창고를 지을 수 있다."));
      }
      return;
    }

    if (this.era === 1) {
      const hasWarehouse = this.buildings.some(
        (building) => building.kind === "warehouse" && building.stage === "built",
      );
      if (this.agents.length >= 12 && hasWarehouse && this.foodStock >= 20) {
        this.era = 2;
        this.log(tr("The village entered the Town era! Residents will start paving roads.", "마을이 읍내 시대에 들어섰다! 주민들이 도로를 깔기 시작한다."));
      }
      return;
    }

    if (this.era === 2) {
      if (this.agents.length >= 20 && this.getChurch() && this.getKitchen()) {
        this.era = 3;
        this.log(tr("The village blossomed into a City! A plaza will grow at its heart.", "마을이 도시로 피어났다! 그 중심에 광장이 자라난다."));
      }
      return;
    }

    if (this.era === 3) {
      if (this.agents.length >= 26 && this.hasAnyPasture()) {
        this.era = 4;
        this.log(tr("The Industrial age dawns! Power, factories, and railways are coming. ⚙️", "산업 시대가 밝아온다! 전력과 공장, 철도가 찾아온다. ⚙️"));
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
        // A bigger park is pleasanter and reaches farther, so enlarging one
        // beats scattering several.
        const radius =
          building.kind === "park"
            ? AMBIANCE_RADIUS + Math.max(building.width, building.height)
            : AMBIANCE_RADIUS;
        const w =
          building.kind === "park" ? weight + Math.max(building.width, building.height) - 3 : weight;
        scatter(building.x + building.width / 2, building.y + building.height / 2, w, radius);
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
    if (!this.hasMayor()) {
      return; // no planner, no zoning
    }
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
      this.logPathEvent(tr("Fields crowding the homes were cleared, to be re-sown further out. 🌱", "집들을 비좁게 하던 밭을 치웠다, 더 바깥에 다시 일굴 것이다. 🌱"));
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
      this.log(tr(`The ${kind} was too close to the homes — it will be rebuilt on the outskirts. 🏗️`, `${kind}이(가) 집들과 너무 가까웠다 — 변두리에 다시 지을 것이다. 🏗️`));
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

  /** Is a town planner (mayor) on duty? Planning only happens when one is. */
  hasMayor(): boolean {
    return this.agents.some((a) => a.job === "mayor");
  }

  hasPoliceStation(): boolean {
    return this.buildings.some((b) => b.kind === "police" && b.stage === "built");
  }

  /** Police are wanted on duty while there is meaningful friction. */
  get unrestIsHigh(): boolean {
    return this.unrest >= POLICE_ON_THRESHOLD;
  }

  /**
   * Residents a police station can't reach: each station keeps the peace for the
   * residents nearest it (within POLICE_RADIUS) up to POLICE_CAPACITY; everyone
   * beyond that goes unpoliced. So a spreading town needs stations distributed
   * through it, not just one at the centre.
   */
  uncoveredResidents(): number {
    const stations = this.buildings.filter((b) => b.kind === "police" && b.stage === "built");
    const total = this.agents.length;
    if (stations.length === 0) {
      return total;
    }
    const load = new Map<string, number>();
    const homes = this.buildings.filter((b) => b.kind === "house" && b.stage === "built");
    type Pair = { home: string; occ: number; station: string; dist: number };
    const pairs: Pair[] = [];
    for (const home of homes) {
      const occ = this.occupantsOf(home.id);
      if (occ === 0) {
        continue;
      }
      const hx = home.x + home.width / 2;
      const hy = home.y + home.height / 2;
      for (const st of stations) {
        const d = Math.hypot(hx - (st.x + st.width / 2), hy - (st.y + st.height / 2));
        if (d <= POLICE_RADIUS) {
          pairs.push({ home: home.id, occ, station: st.id, dist: d });
        }
      }
    }
    // Assign each home to the nearest station that still has room.
    pairs.sort((a, b) => a.dist - b.dist);
    const assigned = new Set<string>();
    let covered = 0;
    for (const p of pairs) {
      if (assigned.has(p.home)) {
        continue;
      }
      const used = load.get(p.station) ?? 0;
      if (used < POLICE_CAPACITY) {
        covered += Math.min(p.occ, POLICE_CAPACITY - used);
        load.set(p.station, used + p.occ);
        assigned.add(p.home);
      }
    }
    return Math.max(0, total - covered);
  }

  /**
   * Where the next police station should go: the lived-in home that no station
   * reaches and lies farthest from existing ones, so stations spread to cover the
   * town rather than piling up at the centre.
   */
  plannedPoliceSpot(): Vec2 | undefined {
    const stations = this.buildings.filter((b) => b.kind === "police" && b.stage === "built");
    let best: Vec2 | undefined;
    let bestScore = -1;
    for (const home of this.buildings) {
      if (home.kind !== "house" || home.stage !== "built" || this.occupantsOf(home.id) === 0) {
        continue;
      }
      const hx = home.x + home.width / 2;
      const hy = home.y + home.height / 2;
      let nearest = Number.POSITIVE_INFINITY;
      for (const st of stations) {
        nearest = Math.min(
          nearest,
          Math.hypot(hx - (st.x + st.width / 2), hy - (st.y + st.height / 2)),
        );
      }
      if (nearest <= POLICE_RADIUS) {
        continue; // already covered
      }
      if (nearest > bestScore) {
        bestScore = nearest;
        best = { x: hx, y: hy };
      }
    }
    return best;
  }

  needsPoliceStation(): boolean {
    if (this.agents.length < POLICE_MIN_POP) {
      return false;
    }
    if (this.buildings.some((b) => b.kind === "police" && b.stage !== "built")) {
      return false; // one at a time
    }
    // A sane ceiling so coverage gaps never trigger runaway building.
    const stations = this.buildings.filter((b) => b.kind === "police").length;
    if (stations >= Math.ceil(this.agents.length / POLICE_CAPACITY) + 1) {
      return false;
    }
    return this.uncoveredResidents() >= POLICE_CAPACITY / 2;
  }

  /**
   * Unrest eases toward a target set by friction (crowding + discontent) scaled
   * by how much of the town is unpoliced, minus the order on-duty officers keep.
   * High unrest occasionally erupts into a quarrel; officers break it up.
   */
  private updateUnrest() {
    // Policing is retired for now (stations built as 1-tile boxes). With no
    // officers to settle disputes, keep the meter at rest so quarrels don't
    // erupt unanswered. Order will return later as a proper amenity.
    this.unrest = 0;
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
      this.logPathEvent(tr(`An officer broke up a quarrel between ${a.name} and ${b.name}. 👮`, `경관이 ${a.name}와(과) ${b.name}의 다툼을 말렸다. 👮`));
    } else {
      a.needs.comfort = Math.max(0, a.needs.comfort - QUARREL_COMFORT_HIT);
      b.needs.comfort = Math.max(0, b.needs.comfort - QUARREL_COMFORT_HIT);
      this.log(tr(`${a.name} and ${b.name} quarreled — the village needs some order. 😠`, `${a.name}와(과) ${b.name}이(가) 다퉜다 — 마을에 질서가 필요하다. 😠`));
    }
  }

  // --- Damage & repair: demolished structures mend themselves over time -------

  /**
   * The structural tiles of a built building that are currently missing — a wall
   * or floor or door that's been torn out (e.g. by the dev demolish tool, or a
   * collapse). Interior ground (Plaza/Grass) and furniture are not counted: only
   * genuine structure (wall/floor/door/fence/gate) is something to rebuild.
   */
  private missingStructureTiles(building: Building): BuildPlanTile[] {
    const missing: BuildPlanTile[] = [];
    for (const tile of this.buildingLayout(building)) {
      if (!REPAIRABLE_TILES.has(tile.t)) {
        continue; // open yard ground / plaza — not "broken" when scuffed
      }
      const current = this.world.getTile(tile)?.type;
      // A floor tile carrying furniture (a bed, stove, table) is intact, not a hole.
      const intact =
        current === tile.t ||
        (tile.t === "Floor" && Simulation.FURNITURE_TILES.has(current as TileType));
      if (!intact) {
        missing.push({ x: tile.x, y: tile.y, t: tile.t, done: false });
      }
    }
    return missing;
  }

  /**
   * Scan built structures for demolition damage. A building noticed broken is
   * stamped with the time; if it's still broken after a grace period of neglect,
   * the town raises a repair job — its `plan` is loaded with just the missing
   * tiles and a resident re-lays each by hand (fetching wood like any build),
   * all while the building stays "built" so its function never lapses.
   */
  private detectDamage() {
    for (const building of this.buildings) {
      if (building.stage !== "built" || building.repairing) {
        continue; // sites/foundations build normally; a mend in progress is left
      }
      const missing = this.missingStructureTiles(building);
      if (missing.length === 0) {
        building.damagedAt = undefined;
        continue;
      }
      if (building.damagedAt === undefined) {
        building.damagedAt = this.elapsedSeconds;
        continue; // just noticed — give it the grace period before acting
      }
      if (this.elapsedSeconds - building.damagedAt >= REPAIR_GRACE_SECONDS) {
        building.repairing = true;
        building.plan = missing;
        this.log(
          tr(
            `A structure is damaged — someone will repair it. 🛠️`,
            `건물이 파손되었다 — 주민이 수리할 것이다. 🛠️`,
          ),
        );
        this.notifyChanged();
      }
    }
  }

  /**
   * Wrap up a repair (called when the mend plan is fully laid): drop the repair
   * state, restore the door approach (any road the demolition took out), and let
   * the building carry on as before. The missing tiles were already stamped one
   * by one as they were re-laid, so nothing needs repainting here.
   */
  finalizeRepair(building: Building) {
    building.repairing = false;
    building.plan = undefined;
    building.damagedAt = undefined;
    if (building.kind !== "bedroom" && this.gameMode === "auto") {
      this.reserveEntrance(building);
      this.paveApproach(building);
    }
    this.refreshDoors();
    this.notifyChanged();
  }

  // --- Developer tools: free-form tile edits (place road, demolish) -----------

  /** Dev tool: pave a single ground tile into Road. */
  devPaveRoad(position: Vec2): boolean {
    if (!ROADABLE.has(this.world.getTile(position)?.type as TileType)) {
      return false; // only ground can be paved — never over a wall/tree/water
    }
    this.world.setTile(position, "Road");
    this.notifyChanged();
    return true;
  }

  /**
   * Dev tool: demolish a single tile, returning it to bare ground. Works on any
   * part of any structure — a wall, floor, door, fence or stretch of road. If the
   * tile belonged to a building, the neglect-repair system will rebuild it later.
   */
  devDemolishTile(position: Vec2): boolean {
    const type = this.world.getTile(position)?.type;
    if (type === undefined) {
      return false;
    }
    this.world.setTile(position, "Grass");
    this.refreshDoors();
    this.notifyChanged();
    return true;
  }

  /** Dev tool: tear down the whole building under a tile (no repair follows). */
  devDemolishBuildingAt(position: Vec2): boolean {
    const building = this.buildingAt(position);
    if (!building) {
      return false;
    }
    this.removeBuilding(building);
    return true;
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

  /** The trade train is retired (an early-version feature); never any to draw. */
  getTrainPositions(): Vec2[] {
    return [];
  }

  private runFactories() {
    for (const building of this.buildings) {
      if (building.kind === "factory" && building.stage === "built" && this.isPowered(building)) {
        // A cannery turns out preserved grain rations.
        this.addFood("wheat", FACTORY_FOOD_PER_TICK);
        this.store("steel", FACTORY_STEEL_PER_TICK);
      }
    }
  }

  hasAnySmelter(): boolean {
    return this.buildings.some((building) => building.kind === "smelter");
  }

  getSmelter(): Building | undefined {
    return this.buildings.find(
      (building) => building.kind === "smelter" && building.stage === "built",
    );
  }

  /** A built smelter forges stored iron ore into steel, a little each tick. */
  private runSmelters() {
    for (const building of this.buildings) {
      if (building.kind !== "smelter" || building.stage !== "built") {
        continue;
      }
      if (this.stockOf("ironOre") >= SMELT_ORE_PER_BATCH && this.storeSpaceFor("steel") > 0) {
        const ore = this.withdraw("ironOre", SMELT_ORE_PER_BATCH);
        if (ore > 0) {
          this.store("steel", ore);
        }
      }
    }
  }

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

  /**
   * Parks and plazas have been retired. Heal any a past version had laid down:
   * remove park buildings (their footprint reverts to grass) and turn plaza
   * tiles — and the fountain/statue/lamps that framed them — back into ground.
   * Run once on load.
   */
  removeParksAndPlazas() {
    for (const park of this.buildings.filter((b) => b.kind === "park")) {
      this.removeBuilding(park);
    }
    for (const tile of this.world.tiles) {
      if (tile.type === "Plaza") {
        this.world.setTile(tile, "Road");
      } else if (tile.type === "Fountain" || tile.type === "Statue" || tile.type === "Lamp") {
        this.world.setTile(tile, "Grass");
      }
    }
  }

  /** The trade train and railway are retired — remove stations and tear up track. */
  removeRailways() {
    for (const station of this.buildings.filter((b) => b.kind === "station")) {
      this.removeBuilding(station);
    }
    for (const tile of this.world.tiles) {
      if (tile.type === "Rail") {
        this.world.setTile(tile, "Grass");
      }
    }
  }

  // --- The larder: typed, perishable food --------------------------------------

  /** Stock food of a kind; it starts fresh and ages toward spoiling (capped). */
  addFood(kind: FoodKind, amount: number) {
    const add = Math.min(amount, FOOD_CAP - this.foodStock);
    if (add <= 0) {
      return;
    }
    // Merge into a recent fresh lot of the same kind so the larder doesn't
    // fragment into countless tiny batches.
    const recent = this.foods.find(
      (b) => b.kind === kind && !b.spoiled && b.ageSeconds < FOOD_BATCH_MERGE_SECONDS,
    );
    if (recent) {
      recent.amount += add;
    } else {
      this.foods.push({ kind, amount: add, ageSeconds: 0, spoiled: false });
    }
    this.foodStock += add;
  }

  /**
   * Eat `amount` of stored food, oldest lots first — so the food nearest to
   * spoiling gets used (or makes someone sick) instead of sitting forever behind
   * fresher stock. Returns how much was eaten and how much of it was spoiled.
   */
  consumeFood(amount: number): { eaten: number; spoiled: number } {
    const order = [...this.foods].sort((a, b) => b.ageSeconds - a.ageSeconds);
    let need = amount;
    let spoiled = 0;
    for (const batch of order) {
      if (need <= 0) {
        break;
      }
      const take = Math.min(batch.amount, need);
      batch.amount -= take;
      need -= take;
      if (batch.spoiled) {
        spoiled += take;
      }
    }
    for (let i = this.foods.length - 1; i >= 0; i -= 1) {
      if (this.foods[i].amount <= 0) {
        this.foods.splice(i, 1);
      }
    }
    const eaten = amount - need;
    this.foodStock = Math.max(0, this.foodStock - eaten);
    return { eaten, spoiled };
  }

  /** Age every stored batch; one that passes its keeping time spoils. */
  private ageFood(deltaSeconds: number) {
    let changed = false;
    for (const batch of this.foods) {
      batch.ageSeconds += deltaSeconds;
      if (!batch.spoiled && batch.ageSeconds >= FOOD_SPOIL_SECONDS) {
        batch.spoiled = true;
        changed = true;
      }
    }
    if (changed) {
      this.notifyChanged();
    }
  }

  /** Larder broken down by kind with a fresh/spoiled split — for the inspector. */
  foodSummary(): { kind: FoodKind; fresh: number; spoiled: number }[] {
    const byKind = new Map<FoodKind, { fresh: number; spoiled: number }>();
    for (const b of this.foods) {
      const entry = byKind.get(b.kind) ?? { fresh: 0, spoiled: 0 };
      if (b.spoiled) {
        entry.spoiled += b.amount;
      } else {
        entry.fresh += b.amount;
      }
      byKind.set(b.kind, entry);
    }
    return [...byKind.entries()].map(([kind, v]) => ({ kind, ...v }));
  }

  /** Total spoiled food sitting in the larder. */
  spoiledFood(): number {
    return this.foods.reduce((sum, b) => sum + (b.spoiled ? b.amount : 0), 0);
  }

  /** Add cooked meals; if cooked from spoiled food they're tainted (made ill). */
  addMeals(count: number, tainted: boolean) {
    this.meals += count;
    if (tainted) {
      this.taintedMeals = Math.min(this.meals, this.taintedMeals + count);
    }
  }

  /** Take one meal to eat. Tainted meals are served first; returns true if so. */
  takeMeal(): boolean {
    if (this.meals <= 0) {
      return false;
    }
    this.meals -= 1;
    if (this.taintedMeals > 0) {
      this.taintedMeals -= 1;
      return true;
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

  getGranary(): Building | undefined {
    return this.buildings.find(
      (building) => building.kind === "granary" && building.stage === "built",
    );
  }

  hasAnyGranary(): boolean {
    return this.buildings.some((building) => building.kind === "granary");
  }

  /**
   * Where food is fetched and eaten: the granary once one is built, otherwise
   * the general warehouse (the larder lives there until a granary exists).
   */
  foodPantry(): Building | undefined {
    return this.getGranary() ?? this.getWarehouse();
  }

  /**
   * Where to stand to fetch food from a pantry: an interior floor tile (so the
   * resident steps inside to the shelves rather than loitering in the doorway),
   * picking the one nearest the approach so several fetchers spread out. Falls
   * back to the door if the interior can't be stood on.
   */
  pantryStand(pantry: Building, from: Vec2): Vec2 {
    const interior = this.interiorTiles(pantry).filter(
      (tile) => this.world.getTile(tile)?.type === "Floor",
    );
    if (interior.length === 0) {
      return pantry.door;
    }
    interior.sort(
      (a, b) =>
        (a.x - from.x) ** 2 + (a.y - from.y) ** 2 - ((b.x - from.x) ** 2 + (b.y - from.y) ** 2),
    );
    return interior[0];
  }

  /** Which shelf a food belongs on: grain (crops/berries) vs meat (game/fish). */
  static foodGroup(kind: FoodKind): "grain" | "meat" {
    return kind === "berry" || kind === "wheat" || kind === "rice" ? "grain" : "meat";
  }

  /** Total grain (crops + berries) in the larder. */
  get grainStock(): number {
    return this.foods.reduce(
      (sum, b) => sum + (Simulation.foodGroup(b.kind) === "grain" ? b.amount : 0),
      0,
    );
  }

  /** Total meat (game, herd, fish) in the larder. */
  get meatStock(): number {
    return this.foods.reduce(
      (sum, b) => sum + (Simulation.foodGroup(b.kind) === "meat" ? b.amount : 0),
      0,
    );
  }

  // --- Physical goods: loose ground piles and warehouse stock ---------------

  /** Drop a material on the ground at a tile, merging into a like pile there. */
  dropItem(position: Vec2, resource: ResourceKind, amount = 1) {
    let tile = { x: Math.round(position.x), y: Math.round(position.y) };
    // Never leave a load in a doorway — it blocks the threshold and looks wrong.
    // Settle it on the nearest walkable, non-door tile instead.
    if (!this.isDroppableTile(tile)) {
      tile = this.nearestDroppableTile(tile) ?? tile;
    }
    const existing = this.items.find(
      (stack) =>
        stack.resource === resource && stack.position.x === tile.x && stack.position.y === tile.y,
    );
    if (existing) {
      existing.amount += amount;
    } else {
      this.items.push({
        id: `item-${this.nextItemId++}`,
        resource,
        amount,
        position: { ...tile },
      });
    }
    this.notifyChanged();
  }

  /** A loose pile may sit here: it's walkable ground and not a doorway. */
  private isDroppableTile(tile: Vec2): boolean {
    const t = this.world.getTile(tile)?.type;
    return t !== undefined && t !== "Door" && this.world.isWalkable(tile);
  }

  /** Nearest tile a loose pile may rest on, searched in widening rings. */
  private nearestDroppableTile(from: Vec2): Vec2 | undefined {
    for (let r = 1; r <= 4; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) {
            continue; // only the new ring's perimeter
          }
          const p = { x: from.x + dx, y: from.y + dy };
          if (this.isDroppableTile(p)) {
            return p;
          }
        }
      }
    }
    return undefined;
  }

  /** Move any pile an older save left sitting in a doorway off the threshold. */
  relocateDoorwayPiles() {
    for (const stack of this.items) {
      if (this.world.getTile(stack.position)?.type === "Door") {
        const spot = this.nearestDroppableTile(stack.position);
        if (spot) {
          stack.position = { ...spot };
        }
      }
    }
  }

  /** Drop wood (shorthand used by felling). */
  dropWood(position: Vec2, amount = 1) {
    this.dropItem(position, "wood", amount);
  }

  getItem(id: string): ItemStack | undefined {
    return this.items.find((stack) => stack.id === id);
  }

  /**
   * Nearest loose pile no one else has claimed (or that we claimed). Pass a
   * resource to restrict to that material; omit it to haul whatever is nearest.
   */
  nearestHaulable(from: Vec2, agentId: string, resource?: ResourceKind): ItemStack | undefined {
    let best: ItemStack | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const stack of this.items) {
      if (stack.amount <= 0 || (resource && stack.resource !== resource)) {
        continue;
      }
      if (stack.reservedBy && stack.reservedBy !== agentId) {
        continue;
      }
      const dx = stack.position.x - from.x;
      const dy = stack.position.y - from.y;
      const d = dx * dx + dy * dy;
      if (d < bestDistance) {
        bestDistance = d;
        best = stack;
      }
    }
    return best;
  }

  hasHaulable(resource?: ResourceKind): boolean {
    return this.items.some(
      (stack) =>
        stack.amount > 0 && !stack.reservedBy && (!resource || stack.resource === resource),
    );
  }

  reserveItem(id: string, agentId: string) {
    const stack = this.getItem(id);
    if (stack) {
      stack.reservedBy = agentId;
    }
  }

  releaseItem(id: string) {
    const stack = this.getItem(id);
    if (stack) {
      stack.reservedBy = undefined;
    }
  }

  /** Release every pile a (departed or distracted) agent had claimed. */
  releaseItemsHeldBy(agentId: string) {
    for (const stack of this.items) {
      if (stack.reservedBy === agentId) {
        stack.reservedBy = undefined;
      }
    }
  }

  removeItem(id: string) {
    const index = this.items.findIndex((stack) => stack.id === id);
    if (index >= 0) {
      this.items.splice(index, 1);
      this.notifyChanged();
    }
  }

  // --- Stockpile zone: stored goods are physical piles on the warehouse floor --

  /** The interior floor tiles of every built warehouse — the stockpile zone. */
  stockpileTiles(): Vec2[] {
    const tiles: Vec2[] = [];
    for (const building of this.buildings) {
      if (building.kind === "warehouse" && building.stage === "built") {
        for (const position of this.interiorTiles(building)) {
          tiles.push(position);
        }
      }
    }
    return tiles;
  }

  isInStockpile(position: Vec2): boolean {
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    return this.stockpileTiles().some((t) => t.x === x && t.y === y);
  }

  /** The pile sitting on a tile (optionally only of a given resource). */
  private itemAt(tile: Vec2, resource?: ResourceKind): ItemStack | undefined {
    return this.items.find(
      (stack) =>
        stack.position.x === tile.x &&
        stack.position.y === tile.y &&
        stack.amount > 0 &&
        (!resource || stack.resource === resource),
    );
  }

  /** How much of a material is stored in the stockpile zone right now. */
  stockOf(resource: ResourceKind): number {
    let total = 0;
    for (const tile of this.stockpileTiles()) {
      const pile = this.itemAt(tile, resource);
      if (pile) {
        total += pile.amount;
      }
    }
    return total;
  }

  /** Spare room in the zone for a material: partial like-piles plus empty tiles. */
  storeSpaceFor(resource: ResourceKind): number {
    let space = 0;
    for (const tile of this.stockpileTiles()) {
      const pile = this.itemAt(tile);
      if (!pile) {
        space += TILE_STACK_CAP;
      } else if (pile.resource === resource) {
        space += Math.max(0, TILE_STACK_CAP - pile.amount);
      }
    }
    return space;
  }

  /** Deposit a material into the zone as physical piles; returns how much fit. */
  store(resource: ResourceKind, amount: number): number {
    let remaining = amount;
    const zone = this.stockpileTiles();
    // Top up existing like-piles first, then settle the rest onto empty tiles.
    for (const tile of zone) {
      if (remaining <= 0) break;
      const pile = this.itemAt(tile, resource);
      if (pile) {
        const add = Math.min(TILE_STACK_CAP - pile.amount, remaining);
        pile.amount += add;
        remaining -= add;
      }
    }
    for (const tile of zone) {
      if (remaining <= 0) break;
      if (this.itemAt(tile)) continue;
      const add = Math.min(TILE_STACK_CAP, remaining);
      this.items.push({
        id: `item-${this.nextItemId++}`,
        resource,
        amount: add,
        position: { ...tile },
      });
      remaining -= add;
    }
    const accepted = amount - remaining;
    if (accepted > 0) {
      this.notifyChanged();
    }
    return accepted;
  }

  /** Draw a material out of the zone's piles; returns how much was taken. */
  withdraw(resource: ResourceKind, amount: number): number {
    let remaining = amount;
    for (const tile of this.stockpileTiles()) {
      if (remaining <= 0) break;
      const pile = this.itemAt(tile, resource);
      if (pile) {
        const take = Math.min(pile.amount, remaining);
        pile.amount -= take;
        remaining -= take;
        if (pile.amount <= 0) {
          this.removeItem(pile.id);
        }
      }
    }
    const drawn = amount - remaining;
    if (drawn > 0) {
      this.notifyChanged();
    }
    return drawn;
  }

  private wantTarget(resource: ResourceKind): number {
    return resource === "wood" ? WOOD_WANT_TARGET : resource === "stone" ? STONE_WANT_TARGET : ORE_WANT_TARGET;
  }

  /** Loose piles of a material sitting outside the stockpile (awaiting hauling). */
  groundTotal(resource: ResourceKind): number {
    let total = 0;
    for (const stack of this.items) {
      if (stack.resource === resource && stack.amount > 0 && !this.isInStockpile(stack.position)) {
        total += stack.amount;
      }
    }
    return total;
  }

  /** Should producers keep gathering this material? Only while supply < target. */
  wantsMore(resource: ResourceKind): boolean {
    return (
      this.stockOf(resource) + this.groundTotal(resource) < this.wantTarget(resource) &&
      this.storeSpaceFor(resource) > 0
    );
  }

  // Wood-named shorthands kept for the existing felling/building paths.
  woodStoreSpace(): number {
    return this.storeSpaceFor("wood");
  }
  storeWood(amount: number): number {
    return this.store("wood", amount);
  }
  withdrawWood(amount: number): number {
    return this.withdraw("wood", amount);
  }
  wantsMoreWood(): boolean {
    return this.wantsMore("wood");
  }

  // --- Mining: rock yields stone, ore veins yield iron ----------------------

  /** Is this a solid, mineable rock or ore tile? */
  isRockTile(type: TileType): boolean {
    return (
      type === "RockSandstone" ||
      type === "RockLimestone" ||
      type === "RockGranite" ||
      type === "OreIron"
    );
  }

  /**
   * Can the colony mine this rock yet? Soft rock (sandstone, limestone) is
   * workable by hand; hard rock (granite) and ore need tools the colony hasn't
   * fashioned yet — the gate that ties material access to tech/tools.
   */
  canMineRock(type: TileType): boolean {
    if (type === "RockSandstone" || type === "RockLimestone") {
      return true;
    }
    if (type === "RockGranite" || type === "OreIron") {
      return this.hasMiningTools;
    }
    return false;
  }

  /** What a mined rock/ore tile yields. */
  mineYield(type: TileType): { resource: ResourceKind; amount: number } {
    if (type === "OreIron") {
      return { resource: "ironOre", amount: 2 };
    }
    // Harder rock gives a little more usable stone.
    return { resource: "stone", amount: type === "RockGranite" ? 3 : 2 };
  }

  /** Is there hard rock or ore around that a pickaxe would unlock? */
  hasToolGatedRock(): boolean {
    return this.world.tiles.some(
      (tile) => tile.type === "RockGranite" || tile.type === "OreIron",
    );
  }

  /** Note (once) that the colony wants to mine something it lacks tools for. */
  noteNeedsMiningTools() {
    if (this.notedNeedTools) {
      return;
    }
    this.notedNeedTools = true;
    this.log(
      tr(
        "The hard rock and ore here need better tools to mine.",
        "여기 단단한 암석과 광석을 캐려면 더 나은 도구가 필요하다.",
      ),
    );
  }

  getKitchen(): Building | undefined {
    return this.buildings.find(
      (building) => building.kind === "kitchen" && building.stage === "built",
    );
  }

  hasAnyKitchen(): boolean {
    return this.buildings.some((building) => building.kind === "kitchen");
  }

  /** The stove tile a cook works at (inside a built kitchen), if any. */
  getStove(): Vec2 | undefined {
    const tile = this.world.tiles.find((t) => t.type === "Stove");
    return tile ? { x: tile.x, y: tile.y } : undefined;
  }

  /** Every stove in the village. */
  getStoves(): Vec2[] {
    return this.world.tiles
      .filter((t) => t.type === "Stove")
      .map((t) => ({ x: t.x, y: t.y }));
  }

  // --- Stove reservation: only one cook may work a stove at a time -------------

  /** A stove free for `agentId` to claim (not in use by another cook), if any. */
  freeStoveFor(agentId: string): Vec2 | undefined {
    return this.getStoves().find((s) => {
      const cook = this.stoveCooks.get(`${s.x},${s.y}`);
      return !cook || cook === agentId;
    });
  }

  /** Reserve a stove for a cook (releasing any other they held first). */
  claimStove(position: Vec2, agentId: string) {
    this.releaseStove(agentId);
    this.stoveCooks.set(`${position.x},${position.y}`, agentId);
  }

  /** Release whatever stove a cook held (when they finish or down tools). */
  releaseStove(agentId: string) {
    for (const [key, cook] of this.stoveCooks) {
      if (cook === agentId) {
        this.stoveCooks.delete(key);
      }
    }
  }

  /** Put unused ingredients back in the larder (e.g. a cook abandons the job). */
  returnFood(amount: number, spoiled: boolean) {
    if (amount <= 0) {
      return;
    }
    this.foods.push({ kind: "wheat", amount, ageSeconds: spoiled ? FOOD_SPOIL_SECONDS : 0, spoiled });
    this.foodStock = Math.min(FOOD_CAP, this.foodStock + amount);
  }

  // --- Dining: a kitchen table ringed with chairs ------------------------------

  /** Does the kitchen already have a dining table? */
  hasDiningTable(): boolean {
    const kitchen = this.getKitchen();
    return (
      !!kitchen &&
      this.interiorTiles(kitchen).some((t) => this.world.getTile(t)?.type === "Table")
    );
  }

  /** A table tile in the kitchen, to set served meals down on. */
  diningTableTile(): Vec2 | undefined {
    const kitchen = this.getKitchen();
    if (!kitchen) {
      return undefined;
    }
    return this.interiorTiles(kitchen).find((t) => this.world.getTile(t)?.type === "Table");
  }

  /** Chairs inside the kitchen, by tile. */
  private diningChairs(): Vec2[] {
    const kitchen = this.getKitchen();
    if (!kitchen) {
      return [];
    }
    return this.interiorTiles(kitchen).filter(
      (t) => this.world.getTile(t)?.type === "Chair",
    );
  }

  /** A kitchen chair free for `agentId` to sit in (not taken by another diner). */
  freeDiningChair(agentId: string): Vec2 | undefined {
    return this.diningChairs().find((c) => {
      const sitter = this.chairSitters.get(`${c.x},${c.y}`);
      return !sitter || sitter === agentId;
    });
  }

  hasFreeDiningChair(agentId: string): boolean {
    return this.freeDiningChair(agentId) !== undefined;
  }

  claimChair(position: Vec2, agentId: string) {
    this.releaseChair(agentId);
    this.chairSitters.set(`${position.x},${position.y}`, agentId);
  }

  releaseChair(agentId: string) {
    for (const [key, sitter] of this.chairSitters) {
      if (sitter === agentId) {
        this.chairSitters.delete(key);
      }
    }
  }

  /**
   * Where to lay a dining set in the kitchen: a table tile with chairs on its
   * open floor sides, such that the room stays connected — the door stays
   * reachable, the stove keeps a tile to cook from, every free-floor tile is
   * still reachable, and each chair can be reached (and so sat on) from the tile
   * just beyond it. Returns the table tile and its chairs, or undefined if it
   * won't fit (the kitchen needs enlarging first).
   */
  diningSetSpot(kitchen: Building): { table: Vec2; chairs: Vec2[] } | undefined {
    const DIRS = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    const key = (p: Vec2) => `${p.x},${p.y}`;
    const isFloor = (p: Vec2): boolean => this.world.getTile(p)?.type === "Floor";
    const interior = this.interiorTiles(kitchen);
    const interiorKeys = new Set(interior.map(key));
    const doors = this.buildingDoors(kitchen);
    const inRoom = new Set([...interiorKeys, ...doors.map(key)]);
    const stove = interior.find((t) => this.world.getTile(t)?.type === "Stove");

    // Flood from the doorways across floor, treating `blocked` tiles as walls.
    const reachable = (blocked: Set<string>): Set<string> => {
      const seen = new Set<string>();
      const stack: Vec2[] = [];
      for (const d of doors) {
        if (!blocked.has(key(d))) {
          seen.add(key(d));
          stack.push(d);
        }
      }
      while (stack.length) {
        const p = stack.pop()!;
        for (const s of DIRS) {
          const np = { x: p.x + s.x, y: p.y + s.y };
          const k = key(np);
          if (seen.has(k) || !inRoom.has(k) || blocked.has(k)) {
            continue;
          }
          // Only walk across what's still passable (floor/door), not furniture.
          const t = this.world.getTile(np)?.type;
          if (t !== "Floor" && t !== "Door") {
            continue;
          }
          seen.add(k);
          stack.push(np);
        }
      }
      return seen;
    };

    // The placement is valid only if the room stays whole: with `blocked` tiles
    // treated as solid, no free-floor tile is cut off and the stove keeps a tile
    // beside it to cook from.
    const roomWhole = (blocked: Set<string>): boolean => {
      const seen = reachable(blocked);
      const strands = interior.some(
        (t) => isFloor(t) && !blocked.has(key(t)) && !seen.has(key(t)),
      );
      if (strands) {
        return false;
      }
      if (stove && !DIRS.some((s) => seen.has(key({ x: stove.x + s.x, y: stove.y + s.y })))) {
        return false;
      }
      return true;
    };

    for (const table of interior) {
      if (!isFloor(table)) {
        continue;
      }
      const blocked = new Set<string>([key(table)]);
      // A solid table on its own mustn't cut the room in two.
      if (!roomWhole(blocked)) {
        continue;
      }
      // Add chairs on the table's open floor sides one at a time, keeping the room
      // whole and each chair reachable (a diner mounts it from an adjacent tile).
      const chairs: Vec2[] = [];
      for (const d of DIRS) {
        const c = { x: table.x + d.x, y: table.y + d.y };
        if (!interiorKeys.has(key(c)) || !isFloor(c)) {
          continue;
        }
        const tentative = new Set(blocked);
        tentative.add(key(c));
        if (!roomWhole(tentative)) {
          continue;
        }
        const seen = reachable(tentative);
        const approachable = DIRS.some((s) => {
          const n = { x: c.x + s.x, y: c.y + s.y };
          return !(n.x === table.x && n.y === table.y) && seen.has(key(n));
        });
        if (!approachable) {
          continue;
        }
        chairs.push(c);
        blocked.add(key(c));
      }
      if (chairs.length > 0) {
        return { table, chairs };
      }
    }
    return undefined;
  }

  /** How many chairs (seats) the dining table currently has. */
  diningSeatCount(): number {
    return this.diningChairs().length;
  }

  /** Seats the village would like at the table: one per resident, within reason. */
  private seatTarget(): number {
    return Math.min(this.agents.length, DINING_SEAT_CAP);
  }

  /** The dining table is short of seats for the village. */
  wantsMoreSeats(): boolean {
    return this.hasDiningTable() && this.diningSeatCount() < this.seatTarget();
  }

  /**
   * The next single piece to grow an existing dining set: a chair on an open
   * floor side of the table (preferred), or a table tile extending the board
   * when there's no room left for another chair — always keeping the room whole.
   * Returns undefined if nothing more fits (the kitchen needs enlarging).
   */
  diningGrowthTile(kitchen: Building): { pos: Vec2; kind: "Table" | "Chair" } | undefined {
    const DIRS = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    const key = (p: Vec2) => `${p.x},${p.y}`;
    const isFloor = (p: Vec2): boolean => this.world.getTile(p)?.type === "Floor";
    const isTable = (p: Vec2): boolean => this.world.getTile(p)?.type === "Table";
    const interior = this.interiorTiles(kitchen);
    const interiorKeys = new Set(interior.map(key));
    const doors = this.buildingDoors(kitchen);
    const inRoom = new Set([...interiorKeys, ...doors.map(key)]);
    const stove = interior.find((t) => this.world.getTile(t)?.type === "Stove");
    const tables = interior.filter(isTable);
    if (tables.length === 0) {
      return undefined;
    }
    // Flood the room's floor/door space with `block` treated as solid (existing
    // furniture is already non-floor, so it blocks naturally).
    const reachable = (block: Vec2): Set<string> => {
      const blocked = key(block);
      const seen = new Set<string>();
      const stack: Vec2[] = [];
      for (const d of doors) {
        if (key(d) !== blocked) {
          seen.add(key(d));
          stack.push(d);
        }
      }
      while (stack.length) {
        const p = stack.pop()!;
        for (const s of DIRS) {
          const np = { x: p.x + s.x, y: p.y + s.y };
          const k = key(np);
          if (seen.has(k) || !inRoom.has(k) || k === blocked) {
            continue;
          }
          const t = this.world.getTile(np)?.type;
          if (t !== "Floor" && t !== "Door") {
            continue;
          }
          seen.add(k);
          stack.push(np);
        }
      }
      return seen;
    };
    const roomWhole = (block: Vec2): boolean => {
      const seen = reachable(block);
      const strands = interior.some(
        (t) => isFloor(t) && key(t) !== key(block) && !seen.has(key(t)),
      );
      if (strands) {
        return false;
      }
      return !stove || DIRS.some((s) => seen.has(key({ x: stove.x + s.x, y: stove.y + s.y })));
    };
    // Distinct floor tiles orthogonally adjacent to a table.
    const beside = new Map<string, Vec2>();
    for (const t of tables) {
      for (const d of DIRS) {
        const p = { x: t.x + d.x, y: t.y + d.y };
        if (interiorKeys.has(key(p)) && isFloor(p)) {
          beside.set(key(p), p);
        }
      }
    }
    // Prefer adding a chair (keeps the room whole and is reachable to sit on).
    for (const c of beside.values()) {
      if (!roomWhole(c)) {
        continue;
      }
      const seen = reachable(c);
      const approachable = DIRS.some((s) => {
        const n = { x: c.x + s.x, y: c.y + s.y };
        return !isTable(n) && seen.has(key(n));
      });
      if (approachable) {
        return { pos: c, kind: "Chair" };
      }
    }
    // Otherwise extend the board into a tile that still leaves an open side for a
    // future chair, so the longer table can be seated.
    for (const t of beside.values()) {
      if (!roomWhole(t)) {
        continue;
      }
      const hasOpenSide = DIRS.some((s) => {
        const n = { x: t.x + s.x, y: t.y + s.y };
        return interiorKeys.has(key(n)) && isFloor(n) && key(n) !== key(t);
      });
      if (hasOpenSide) {
        return { pos: t, kind: "Table" };
      }
    }
    return undefined;
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
    this.log(tr("The villagers gathered for morning worship. 🙏", "주민들이 아침 예배를 위해 모였다. 🙏"));
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
      // A mayor plans the town — without one, no planned roads/plaza/parks happen.
      ["mayor", this.era >= 2 ? 1 : 0],
      ["woodcutter", Math.min(2, Math.max(1, Math.floor(population / 5)))],
      // Haulers only make sense once there's a warehouse to stock; they ferry
      // felled wood in from the forest so woodcutters never stop to deliver.
      ["hauler", this.hasAnyWarehouse() ? Math.min(2, Math.max(1, Math.floor(population / 6))) : 0],
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
        this.log(tr(`${agent.name} became a ${job}.`, `${agent.name}이(가) ${job}이(가) 되었다.`), [agent]);
      }
    }
  }

  /**
   * Bring a newcomer into the heart of town, looking for a home. This is the
   * manual entry point behind the Add-immigrant control — no timer or cap, the
   * player decides when the population grows.
   */
  addImmigrant() {
    const center = this.villageCenter();
    const spawn = this.findSpawnPosition({ x: Math.round(center.x), y: Math.round(center.y) });
    const agent = createRandomAgent(spawn, this.takenNames());
    this.agents.push(agent);
    this.log(tr(`${agent.name} arrived in town, looking for a home. 🧳`, `${agent.name}이(가) 살 곳을 찾아 마을에 도착했다. 🧳`), [agent]);
    this.notifyChanged();
  }

  /** Observation mode: adult newcomers arrive over time and settle in. */
  private immigrate() {
    if (this.agents.length >= EXPERIMENT_POP_CAP) {
      return;
    }
    if (this.elapsedSeconds - this.lastImmigrationAt < IMMIGRATION_INTERVAL_SECONDS) {
      return;
    }
    this.lastImmigrationAt = this.elapsedSeconds;
    this.addImmigrant();
  }

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
    this.log(tr(`${parentA.name} and ${parentB.name} had a baby: ${baby.name}! 👶`, `${parentA.name}와(과) ${parentB.name} 사이에 아기 ${baby.name}이(가) 태어났다! 👶`), [
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
        this.log(tr(`${agent.name} came of age. 🎓`, `${agent.name}이(가) 성년이 되었다. 🎓`), [agent]);
      } else if (agent.age === ELDER_AGE) {
        agent.job = "none";
        this.log(tr(`${agent.name} retired as an elder. 🦳`, `${agent.name}이(가) 은퇴하여 어르신이 되었다. 🦳`), [agent]);
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
    this.log(tr(`${agent.name} passed away peacefully at ${agent.age}. 🕯️`, `${agent.name}이(가) ${agent.age}세에 평온히 세상을 떠났다. 🕯️`));

    // Release whatever the agent was holding onto.
    if (agent.target) {
      this.releaseClaim(agent.target);
    }
    this.releaseItemsHeldBy(agent.id);
    this.releaseStove(agent.id);
    this.releaseChair(agent.id);
    // Ingredients a cook was carrying go back to the pantry.
    if (agent.carryFood) {
      this.returnFood(agent.carryFood.amount, agent.carryFood.spoiled);
      agent.carryFood = undefined;
    }
    // A finished meal in hand still gets set out for the others.
    if (agent.carryMeal) {
      this.addMeals(agent.carryMeal.count, agent.carryMeal.tainted);
      agent.carryMeal = undefined;
    }
    // Goods they were carrying spill onto the ground where they fell.
    if (agent.inventory.wood > 0 && this.hasAnyWarehouse()) {
      this.dropWood(agent.position, agent.inventory.wood);
      agent.inventory.wood = 0;
    }
    if (agent.carry && agent.carry.amount > 0) {
      this.dropItem(agent.position, agent.carry.resource, agent.carry.amount);
      agent.carry = undefined;
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
      this.addFood(meatKind(animal.kind), ANIMAL_FOOD[animal.kind]);
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
    // The herder leads it in through the gate; settle it on the grass inside the
    // fence (animals can't open the gate themselves, so place it within).
    const spot = this.pastureGrazeSpot(pasture);
    if (spot) {
      animal.position = { ...spot };
    }
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
        this.addFood("beef", 1);
        this.notifyChanged();
      }
    }
  }

  /** Where an animal may walk: any walkable tile that isn't a fence or its gate —
   * a fence pens the herd in, and animals can't work the gate latch. */
  private animalCanEnter(p: Vec2): boolean {
    const t = this.world.getTile(p)?.type;
    return this.world.isWalkable(p) && t !== "Fence" && t !== "FenceGate";
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
    if (this.animalCanEnter(next)) {
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
    if (this.animalCanEnter(next)) {
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

  houseCapacity(_building: Building): number {
    return HOUSE_CAPACITY;
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
    // Paced by the era (and by wellbeing, in tryBirth) rather than by current
    // housing: the population grows to the era's ceiling and housing must spread
    // or build taller to shelter them. Overcrowding is the pressure that drives
    // new homes — so growth never deadlocks waiting on a material it can't get.
    return ERA_POP_CEILING[this.era] ?? ERA_POP_CEILING[ERA_POP_CEILING.length - 1];
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

  /** 0 = roomy, 1 = full. Surfaced in the inspector as housing pressure. */
  housingPressure(): number {
    const capacity = this.housingCapacity();
    return capacity === 0 ? 0 : Math.min(1, this.housedCount() / capacity);
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

  /** The building whose footprint covers a tile, if any. */
  private buildingAt(position: Vec2): Building | undefined {
    return this.buildings.find(
      (b) =>
        position.x >= b.x &&
        position.x < b.x + b.width &&
        position.y >= b.y &&
        position.y < b.y + b.height,
    );
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
    this.log(tr("An abandoned house crumbled back into the land. 🍂", "버려진 집이 허물어져 땅으로 돌아갔다. 🍂"));
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

function loadNewGameMode(): GameMode | undefined {
  try {
    const raw = localStorage.getItem(NEW_GAME_MODE_KEY);
    return raw === "auto" || raw === "architect" ? raw : undefined;
  } catch {
    return undefined;
  }
}

function clearNewGameMode() {
  try {
    localStorage.removeItem(NEW_GAME_MODE_KEY);
  } catch {
    // Storage may be unavailable; the game falls back to auto mode.
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
