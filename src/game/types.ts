export type Vec2 = {
  x: number;
  y: number;
};

export type TileType =
  | "Grass"
  | "Tree"
  | "Water"
  | "Dirt"
  | "Road"
  | "HouseSite"
  | "HouseFoundation"
  | "House"
  | "Berry"
  | "FieldEmpty"
  | "FieldGrowing"
  | "FieldRipe"
  | "Stump"
  | "Plaza"
  | "Fountain"
  | "Statue"
  | "Lamp"
  | "Rail";

export type AgentState =
  | "Idle"
  | "FindTree"
  | "MoveToTree"
  | "ChopTree"
  | "FindHouseSite"
  | "MoveToHouseSite"
  | "PlanHouse"
  | "BuildHouse"
  | "FindFood"
  | "MoveToFood"
  | "Eat"
  | "MoveHome"
  | "Sleep"
  | "Chat"
  | "MoveToFarm"
  | "FarmWork"
  | "MoveToPave"
  | "Pave"
  | "MoveToKitchen"
  | "Cook"
  | "MoveToWorship"
  | "Worship"
  | "MoveToStump"
  | "Transplant"
  | "MoveToPlant"
  | "Plant"
  | "MoveToHunt"
  | "Hunt"
  | "MoveToTame"
  | "Tame"
  | "MoveToRedevelop"
  | "Redevelop"
  | "MoveToPark"
  | "Relax"
  | "MoveToClean"
  | "Clean"
  | "Patrol"
  | "Wander"
  | "Rest";

export type AgentJob =
  | "none"
  | "builder"
  | "farmer"
  | "fisher"
  | "woodcutter"
  | "cook"
  | "hunter"
  | "cleaner"
  | "police"
  | "mayor";

export type BuildingKind =
  | "house"
  | "warehouse"
  | "kitchen"
  | "church"
  | "pasture"
  | "powerplant"
  | "factory"
  | "station"
  | "cemetery"
  | "park"
  | "police";

export type BuildingStage = "site" | "foundation" | "built";

export type Building = {
  id: string;
  kind: BuildingKind;
  x: number;
  y: number;
  width: number;
  height: number;
  door: Vec2;
  stage: BuildingStage;
  ownerId?: string;
  builtAtDay?: number;
  durability?: number;
  // Household capacity for houses: 1 = house, 2 = villa, 4 = apartment, 8 = tower.
  // Derived from `level` — kept in sync so the renderer can key off it directly.
  capacity?: number;
  // Redevelopment tier (1+). Higher levels pack more output/capacity into the
  // same footprint; builders raise it in place when land pressure is high.
  level?: number;
};

export type AnimalKind = "deer" | "boar" | "rabbit";

export type AnimalState = "wild" | "fleeing" | "tamed";

export type Animal = {
  id: string;
  kind: AnimalKind;
  position: Vec2;
  state: AnimalState;
  health: number;
  path?: Vec2[];
  moveTimer: number;
  penId?: string;
};

export type InspectionTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "building"; buildingId: string }
  | { kind: "animal"; animalId: string }
  | { kind: "tile"; position: Vec2 };

export type Agent = {
  id: string;
  name: string;
  age: number;
  gender: "male" | "female";
  job: AgentJob;
  huntTargetId?: string;
  personality: {
    diligence: number;
    sociability: number;
    curiosity: number;
  };
  health: {
    stamina: number;
    hunger: number;
  };
  // Soft needs that drive behaviour. 0 = desperate, 100 = fully satisfied.
  // They drift down over time (personality sets the rate) and refill while the
  // resident is doing the matching activity. The most urgent need picks the
  // next action, which is what makes daily life emergent rather than scripted.
  needs: {
    social: number; // company, conversation
    purpose: number; // contributing through work
    faith: number; // worship at the church
    leisure: number; // strolling, taking in the village
    comfort: number; // breathing room; drains faster when homes are crowded
  };
  position: Vec2;
  inventory: {
    wood: number;
    food: number;
  };
  state: AgentState;
  target?: Vec2;
  path?: Vec2[];
  home?: Vec2;
  homeSite?: Vec2;
  homeBuildingId?: string;
  spouseId?: string;
  lifespan: number;
  lastChildAt?: number;
  actionTimer: number;
  projectBuildingId?: string;
  socialCooldown?: number;
  resumeState?: AgentState;
  eatPlan?: "berry" | "warehouse" | "meal";
};

export type GameLogEntry = {
  id: string;
  time: number;
  message: string;
};

export type GameClock = {
  year: number;
  day: number;
  hour: number;
  minute: number;
  isNight: boolean;
};

export type SimulationSnapshot = {
  agents: Agent[];
  logs: GameLogEntry[];
  clock: GameClock;
  era: number;
  foodStock: number;
  meals: number;
  buildings: Building[];
  animals: Animal[];
  trains: Vec2[];
  poweredBuildingIds: string[];
  // The soft cap on residents the village can currently support (housing ∩ era).
  supportedPopulation: number;
  // Pieces of uncollected litter — the hygiene pressure that calls for cleaners.
  litter: number;
  // Public-order pressure (0..100) — rising friction that calls for police.
  unrest: number;
  // Steel (rebar) stock from factories; gates apartment/tower construction.
  steel: number;
};
