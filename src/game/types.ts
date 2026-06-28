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
  // The prep surface beside a stove — together they form a 2-tile cooking
  // counter (조리대). Solid like the stove; cooking happens at the stove tile.
  | "Counter"
  // A bed spans two tiles: the head (pillow end, where the sleeper lies) and the
  // foot. "BedSite" is a reserved-but-unbuilt bed plot — marked ahead of time so
  // it reads as a planned bed, then replaced by Bed+BedFoot once built.
  | "Bed"
  | "BedFoot"
  | "BedSite"
  | "Table"
  // A chair set at a table's edge. Solid like all furniture, but its diner can
  // climb onto it to sit and eat (mounted from beside it, like a bed) — so it's
  // only ever stood on while in use.
  | "Chair"
  // A pasture is fenced like a walled room: solid fence rails pen the herd in,
  // with a gate people can walk through but animals cannot.
  | "Fence"
  | "FenceGate"
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

export type FurnitureKind = "bed" | "stove" | "counter" | "table" | "chair";

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
  | "MoveToPantry" // walking to the warehouse to pick up cooking ingredients
  | "CollectIngredients" // taking raw food into one's arms to carry to the stove
  | "MoveToKitchen"
  | "Cook"
  | "MoveToServe" // carrying a finished meal to the dining table to set it down
  | "Serve" // placing the meal on the table for others to eat
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
  | "MoveToBuildTile" // walking to a single planned wall/floor/door tile
  | "BuildTile" // laying one structure tile by hand
  | "MoveToBlueprint" // walking to a player-ordered blueprint (Architect resident-build)
  | "BuildBlueprint" // constructing one blueprint tile (wall/door/furniture)
  | "MoveToFunfair" // walking to the amusement park to ride
  | "Ride" // riding the roller coaster (leisure + a lift in spirits)
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
  // A private bedroom annexed onto a communal house, sharing one of its walls.
  // Not a home in its own right — its owner still lives in the parent house and
  // only sleeps here, so it never counts toward housing capacity/occupancy.
  | "bedroom"
  | "warehouse"
  // A granary: the food store. Keeps grain (crops/berries) and meat (the hunt,
  // the herd, the river) — the larder's visible home, separate from the
  // material warehouse.
  | "granary"
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
  | "smelter"
  // An amusement park: an open fairground with a roller coaster. A leisure venue
  // residents visit to ride, lifting their spirits.
  | "funfair";

export type BuildingStage = "site" | "foundation" | "built";

// Buildings that are enclosed walled rooms (perimeter walls, a door, a floor
// interior) rather than open yards. Parks, pastures and cemeteries are outdoor
// spaces and keep their own look.
export const ROOM_BUILDING_KINDS: ReadonlySet<BuildingKind> = new Set([
  "house",
  "bedroom",
  "warehouse",
  "granary",
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
  // Legacy redevelopment tier/capacity. Houses no longer level up (the town
  // spreads into more homes instead); these are ignored now, kept only so old
  // saves still parse. Capacity is a fixed value in the simulation.
  capacity?: number;
  level?: number;
  // Construction plan: the individual wall/floor/door tiles that make up this
  // room, each laid by hand one at a time. Present while the building is going
  // up (stage "foundation"); residents tick `done` true as they place each tile.
  plan?: BuildPlanTile[];
  // For a "bedroom" annex: the id of the communal house it's attached to (it
  // shares one wall with that house and opens onto it through an internal door).
  annexOf?: string;
  // True while a finished room is being enlarged in place (walls torn down,
  // floor laid, walls re-wrapped). Tells the build/finish path to preserve the
  // existing interior (stockpile, stove, beds) instead of repainting it blank.
  expanding?: boolean;
  // Elapsed-seconds stamp of when this built building was first noticed to be
  // damaged (a structural tile demolished). Cleared once it's whole again. After
  // a grace period of neglect the town raises a repair job (see `repairing`).
  damagedAt?: number;
  // True while a finished building is being mended: its `plan` holds only the
  // missing structural tiles (done:false), and a resident re-lays each — exactly
  // like a fresh build, but the stage stays "built" so its function never lapses.
  repairing?: boolean;
  // Architect-mode buildings can be painted as arbitrary floor zones. They keep
  // the same function/kind, while floors, walls and doors are authored separately.
  customLayout?: boolean;
  tiles?: Vec2[];
};

// One tile of a building's construction plan — a wall, floor, or doorway that a
// resident walks to and lays individually (RimWorld-style piecemeal building).
export type BuildPlanTile = {
  x: number;
  y: number;
  // The tile this spot becomes once laid — a room's Wall/Floor/Door, or a yard's
  // Fence/FenceGate/Grass/Plaza. Any building is now raised tile by tile.
  t: TileType;
  done?: boolean;
  // Id of the builder currently walking to lay this tile, so several builders can
  // raise one room at once without two of them converging on the same tile.
  claimedBy?: string;
};

// A player-ordered build job in Architect "resident-build" mode: a single tile
// (a wall, door, or piece of furniture) the player has designated, which a
// resident hauls material for and constructs by hand. Until built it shows as a
// translucent ghost. (Floors/fields/roads are applied instantly, not blueprinted.)
export type Blueprint = {
  id: string;
  x: number;
  y: number;
  // The tile this becomes once a resident finishes it.
  t: TileType;
  // Wood the builder must carry to raise it.
  cost: number;
  // Orientation 0..3 (right/down/left/up) for multi-tile furniture — a Bed uses it
  // to place its foot. Undefined for single-tile blueprints.
  dir?: number;
  // Id of the resident currently building it (so two don't both grab it).
  claimedBy?: string;
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

// Kinds of food the village stores. Crops come from fields, meat from the hunt
// and the herd, fish from the water; berries are foraged. Stored food keeps for
// a while, then spoils — and eating (or cooking with) spoiled food makes a
// resident sick.
export type FoodKind = "berry" | "wheat" | "rice" | "beef" | "rabbit" | "fish";

// One lot of stored food of a single kind, ageing toward spoilage as it sits.
export type FoodBatch = {
  kind: FoodKind;
  amount: number;
  ageSeconds: number;
  spoiled: boolean;
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
  // Seconds of food poisoning left to run after eating spoiled food: while sick a
  // resident is miserable and tires faster.
  sickSeconds?: number;
  // Raw ingredients a cook is carrying from the pantry to the stove (spoiled if
  // any of them had turned — the meal comes out tainted).
  carryFood?: { amount: number; spoiled: boolean };
  // Finished meals a cook is carrying from the stove to the dining table to serve
  // (tainted if cooked from spoiled ingredients).
  carryMeal?: { count: number; tainted: boolean };
  // The stove this cook has reserved for the current cooking trip (one cook per
  // stove — nobody else may use it until they're done).
  cookStove?: Vec2;
  // The dining chair a resident has reserved to sit and eat at (one diner per
  // chair); they climb onto it from beside it, like a bed.
  sitChair?: Vec2;
  // Dining furniture a resident is on their way to lay: a new table and/or some
  // chairs (an initial set, or extra pieces when the table is enlarged).
  diningPlan?: { table?: Vec2; chairs: Vec2[] };
  // How much wood to draw out of the warehouse on the current fetch trip.
  fetchAmount?: number;
  // The ground stack this agent has reserved and is hauling.
  haulItemId?: string;
  // A load being physically carried to the warehouse (any resource). Kept apart
  // from inventory.wood, which is the wood a builder consumes on site.
  carry?: { resource: ResourceKind; amount: number };
  // This resident's own bed — head tile (where they sleep) and foot tile of the
  // 1×2/2×1 bed. While the plot is reserved both tiles are "BedSite"; once built
  // bedPos is "Bed" and bedFoot is "BedFoot". Transient; re-derived if missing.
  bedPos?: Vec2;
  bedFoot?: Vec2;
  // The single structure tile this builder is currently walking to / laying.
  buildTarget?: Vec2;
  // Id of the Architect blueprint this resident is currently building, if any.
  blueprintId?: string;
  // While set, this builder is on a felling errand for their project: they keep
  // chopping (carrying the logs) until holding this much wood, then go build —
  // so they fell a whole load at once instead of a tree-per-wall. Transient.
  gatherWood?: number;
  // Sim-time (seconds) this resident last rode the amusement park. Recent riders
  // shrug off low-mood breaks for a while (mental protection). Transient.
  funAt?: number;
  // Which coaster car this resident is riding (0 = lead). Set while in the Ride
  // state; their position tracks that car around the loop. Transient.
  rideSlot?: number;
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

export type WeatherKind = "clear" | "cloudy" | "rain" | "storm";

export type WeatherState = {
  kind: WeatherKind;
  intensity: number;
};

export type GameMode = "auto" | "architect";

export type SimulationSnapshot = {
  agents: Agent[];
  logs: GameLogEntry[];
  clock: GameClock;
  weather: WeatherState;
  gameMode: GameMode;
  era: number;
  foodStock: number;
  // The larder split by shelf: grain (crops/berries) and meat (game/herd/fish).
  grainStock: number;
  meatStock: number;
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
