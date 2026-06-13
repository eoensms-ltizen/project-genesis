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
  "Jiho",
  "Seo-yeon",
  "Minjun",
  "Haeun",
  "Siwoo",
  "Ari",
  "Geon",
  "Dahee",
  "Rowoon",
  "Bom",
  "Iseo",
  "Kyu",
  "Nari",
  "Onyu",
  "Pureum",
  "Saebyeok",
];

let nextAgentId = 1;

// Keeps ids unique after loading a save that already contains agents.
export function bumpAgentIdCounter(minimum: number) {
  if (nextAgentId < minimum) {
    nextAgentId = minimum;
  }
}

export function createRandomAgent(position: Vec2, takenNames?: Set<string>): Agent {
  const gender = Math.random() > 0.5 ? "male" : "female";
  const name = pickName(takenNames);

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
    // Newcomers arrive content, so they settle in and work before any need pulls
    // them toward socialising or leisure.
    needs: {
      social: 70,
      purpose: 70,
      faith: 70,
      leisure: 70,
      comfort: 70,
    },
    lifespan: 65 + Math.floor(Math.random() * 26),
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

function pickName(takenNames?: Set<string>): string {
  const available = takenNames
    ? FIRST_NAMES.filter((name) => !takenNames.has(name))
    : FIRST_NAMES;
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }

  // Every base name is in use; suffix a generation number.
  const base = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  for (let generation = 2; ; generation += 1) {
    const candidate = `${base} ${generation}`;
    if (!takenNames?.has(candidate)) {
      return candidate;
    }
  }
}
