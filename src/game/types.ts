export type Vec2 = {
  x: number;
  y: number;
};

export type TileType = "Grass" | "Tree" | "Water" | "Dirt" | "Road" | "HouseSite";

export type AgentState =
  | "Idle"
  | "FindTree"
  | "MoveToTree"
  | "ChopTree"
  | "FindHouseSite"
  | "MoveToHouseSite"
  | "PlanHouse"
  | "Rest";

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
  actionTimer: number;
};

export type GameLogEntry = {
  id: string;
  time: number;
  message: string;
};

export type SimulationSnapshot = {
  agents: Agent[];
  logs: GameLogEntry[];
};
