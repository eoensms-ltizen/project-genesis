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
  | "Berry";

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
  | "Rest";

export type BuildingKind = "house";

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
};

export type Agent = {
  id: string;
  name: string;
  age: number;
  gender: "male" | "female";
  job: "none" | "builder" | "farmer" | "fisher" | "woodcutter";
  personality: {
    diligence: number;
    sociability: number;
    curiosity: number;
  };
  health: {
    stamina: number;
    hunger: number;
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
  actionTimer: number;
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
};
