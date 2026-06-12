import type { Agent, Vec2 } from "../types";

const FIRST_NAMES = [
  "Chulsoo",
  "Mina",
  "Joon",
  "Hana",
  "Doyun",
  "Sora",
  "Taemin",
  "Yuna",
];

let nextAgentId = 1;

export function createRandomAgent(position: Vec2): Agent {
  const gender = Math.random() > 0.5 ? "male" : "female";
  const name = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];

  return {
    id: `agent-${nextAgentId++}`,
    name,
    age: 18 + Math.floor(Math.random() * 32),
    gender,
    job: "none",
    personality: {
      diligence: randomTrait(),
      sociability: randomTrait(),
      curiosity: randomTrait(),
    },
    health: {
      stamina: 100,
      hunger: 15,
    },
    position: { ...position },
    inventory: {
      wood: 0,
      food: 0,
    },
    state: "Idle",
    actionTimer: 0,
  };
}

function randomTrait(): number {
  return Math.round((0.25 + Math.random() * 0.75) * 100) / 100;
}
