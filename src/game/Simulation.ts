import { AgentBrain } from "./agents/AgentBrain";
import { createRandomAgent } from "./agents/Agent";
import type { Agent, GameLogEntry, SimulationSnapshot, Vec2 } from "./types";
import { WorldMap } from "./world/WorldMap";

type SimulationOptions = {
  onChange: (snapshot: SimulationSnapshot) => void;
};

export class Simulation {
  readonly world: WorldMap;
  readonly agents: Agent[] = [];

  private readonly brain = new AgentBrain();
  private readonly onChange: SimulationOptions["onChange"];
  private readonly logs: GameLogEntry[] = [];
  private elapsedSeconds = 0;
  private nextLogId = 1;
  private dirty = true;

  constructor(options: SimulationOptions) {
    this.world = WorldMap.createRandom();
    this.onChange = options.onChange;
    this.log("A new valley is ready.");
  }

  addRandomAgent(position: Vec2) {
    const spawn = this.findSpawnPosition(position);
    const agent = createRandomAgent(spawn);
    this.agents.push(agent);
    this.log(`${agent.name} spawned.`);
    this.notifyChanged();
  }

  update(deltaSeconds: number) {
    this.elapsedSeconds += deltaSeconds;
    for (const agent of this.agents) {
      this.brain.update(agent, this, deltaSeconds);
    }

    if (this.dirty) {
      this.emitChange();
    }
  }

  log(message: string) {
    this.logs.push({
      id: `log-${this.nextLogId++}`,
      time: this.elapsedSeconds,
      message,
    });

    while (this.logs.length > 80) {
      this.logs.shift();
    }

    this.notifyChanged();
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
        personality: { ...agent.personality },
        health: { ...agent.health },
        inventory: { ...agent.inventory },
      })),
      logs: [...this.logs],
    };
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
