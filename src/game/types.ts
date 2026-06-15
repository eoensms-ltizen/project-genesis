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
  // Room construction: walls enclose a space, a door breaks the wall, and the
  // interior is walkable floor. A house is a walled room rather than a solid block.
  | "Wall"
  | "Floor"
  | "Door"
  // Rocky terrain: solid stone (impassable until mined) of various kinds, iron
  // ore veins embedded in it, and the rough floor left behind once mined.
  | "RockSandstone"
  | "RockLimestone"
  | "RockGranite"
  | "OreIron"
  | "RockFloor"
  // Furniture inside rooms: a stove to cook at, a bed to sleep in, a table to dine at.
  | "Stove"
  | "Bed"
  | "Table"
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
  // Physical hauling: carry produced goods to the warehouse and draw them back
  // out for construction (RimWorld-style stockpiling).
  | "MoveToHaul" // walking to a loose ground stack to pick it up
  | "LoadWood" // picking the stack up into one's arms
  | "MoveToStore" // carrying the load to the warehouse
  | "StoreWood" // depositing the load into the warehouse stock
  | "MoveToWithdraw" // walking to the warehouse to fetch build materials
  | "WithdrawWood" // drawing materials out of the warehouse stock
  | "MoveToMine" // walking to a rock/ore tile to mine it
  | "Mine" // breaking rock for stone or ore
  | "MoveToCraft" // walking to the workshop/warehouse to make tools
  | "CraftTool" // fashioning a tool (e.g. a pickaxe) from materials
  | "MoveToFurnish" // walking home to install furniture (a bed)
  | "Furnish" // building a piece of furniture
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
  | "mayor"
  // Moves produced goods from where they're made to the warehouse, freeing
  // producers to keep producing — a delivery role that emerges once there's a
  // warehouse to stock.
  | "hauler";

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
  | "police"
  // Forges mined iron ore into steel.
  | "smelter";

export type BuildingStage = "site" | "foundation" | "built";

// Buildings that are enclosed walled rooms (perimeter walls, a door, a floor
// interior) rather than open yards. Parks, pastures and cemeteries are outdoor
// spaces and keep their own look.
export const ROOM_BUILDING_KINDS: ReadonlySet<BuildingKind> = new Set([
  "house",
  "warehouse",
  "kitchen",
  "church",
  "powerplant",
  "factory",
  "station",
  "police",
  "smelter",
]);

export type Building = {
  id: string;
  kind: BuildingKind;
  x: number;
  y: number;
  width: number;
  height: number;
  door: Vec2; // primary entrance (used by pathing/home)
  doors?: Vec2[]; // all entrances incl. the primary; face the nearest streets
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

// Goods that can be physically carried and stockpiled. Wood is felled; stone and
// iron ore are mined from rock. Food/meals follow the same model in a later pass.
export type ResourceKind = "wood" | "stone" | "ironOre" | "steel";

// A loose pile of goods sitting on the ground, dropped where it was produced
// until a hauler carries it to the warehouse.
export type ItemStack = {
  id: string;
  resource: ResourceKind;
  amount: number;
  position: Vec2;
  // Id of the agent currently hauling this pile, so two don't fight over it.
  reservedBy?: string;
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
  | { kind: "item"; itemId: string }
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
  // Overall happiness (0..100), a smoothed aggregate of needs and circumstances.
  // Drives despondent breaks when low; matters more as the colony develops.
  mood?: number;
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
  // How much wood to draw out of the warehouse on the current fetch trip.
  fetchAmount?: number;
  // The ground stack this agent has reserved and is hauling.
  haulItemId?: string;
  // A load being physically carried to the warehouse (any resource). Kept apart
  // from inventory.wood, which is the wood a builder consumes on site.
  carry?: { resource: ResourceKind; amount: number };
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
  // Materials physically stored in the warehouse, available to withdraw.
  woodStock: number;
  stoneStock: number;
  oreStock: number;
  // The soft cap on residents the village can currently support (housing ∩ era).
  supportedPopulation: number;
  // Pieces of uncollected litter — the hygiene pressure that calls for cleaners.
  litter: number;
  // Public-order pressure (0..100) — rising friction that calls for police.
  unrest: number;
  // Steel (rebar) stock from factories; gates apartment/tower construction.
  steel: number;
};
