import type { Agent, Vec2 } from "../types";
import type { Simulation } from "../Simulation";

const MOVE_SPEED_TILES_PER_SECOND = 4.5;
const CHOP_DURATION_SECONDS = 1.8;
const PLAN_DURATION_SECONDS = 1.4;

export class AgentBrain {
  update(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.health.hunger = Math.min(100, agent.health.hunger + deltaSeconds * 0.18);
    agent.health.stamina = Math.max(0, agent.health.stamina - deltaSeconds * 0.06);

    if (agent.health.stamina < 12 && agent.state !== "Rest") {
      this.setState(agent, simulation, "Rest");
    }

    switch (agent.state) {
      case "Idle":
        this.decideNextAction(agent, simulation);
        break;
      case "FindTree":
        this.findTree(agent, simulation);
        break;
      case "MoveToTree":
        this.moveTowardTarget(agent, simulation, deltaSeconds, "ChopTree");
        break;
      case "ChopTree":
        this.chopTree(agent, simulation, deltaSeconds);
        break;
      case "FindHouseSite":
        this.findHouseSite(agent, simulation);
        break;
      case "MoveToHouseSite":
        this.moveTowardTarget(agent, simulation, deltaSeconds, "PlanHouse");
        break;
      case "PlanHouse":
        this.planHouse(agent, simulation, deltaSeconds);
        break;
      case "Rest":
        this.rest(agent, simulation, deltaSeconds);
        break;
    }
  }

  private decideNextAction(agent: Agent, simulation: Simulation) {
    if (agent.inventory.wood < 1) {
      this.setState(agent, simulation, "FindTree");
      return;
    }

    const hasHouseSite = simulation.world.tiles.some((tile) => tile.type === "HouseSite");
    if (!hasHouseSite) {
      this.setState(agent, simulation, "FindHouseSite");
      return;
    }

    if (agent.health.stamina < 80) {
      this.setState(agent, simulation, "Rest");
      return;
    }
  }

  private findTree(agent: Agent, simulation: Simulation) {
    const tree = simulation.world.findNearestType(agent.position, "Tree");
    if (!tree) {
      simulation.log(`${agent.name} could not find a tree.`);
      this.setState(agent, simulation, "Idle");
      return;
    }

    agent.target = tree;
    simulation.log(`${agent.name} found a tree.`);
    this.setState(agent, simulation, "MoveToTree");
  }

  private chopTree(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < CHOP_DURATION_SECONDS) {
      return;
    }

    if (agent.target) {
      simulation.world.setTile(agent.target, "Grass");
    }
    agent.inventory.wood += 1;
    agent.health.stamina = Math.max(0, agent.health.stamina - 8);
    simulation.log(`${agent.name} chopped wood. +1 wood`);
    agent.target = undefined;
    this.setState(agent, simulation, "FindHouseSite");
  }

  private findHouseSite(agent: Agent, simulation: Simulation) {
    const site = simulation.world.findHouseSiteCandidate(agent.position);
    if (!site) {
      simulation.log(`${agent.name} could not find a house site.`);
      this.setState(agent, simulation, "Idle");
      return;
    }

    agent.target = site;
    simulation.log(`${agent.name} selected a house site.`);
    this.setState(agent, simulation, "MoveToHouseSite");
  }

  private planHouse(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < PLAN_DURATION_SECONDS) {
      return;
    }

    if (agent.target) {
      simulation.world.setTile(agent.target, "HouseSite");
      simulation.log(`${agent.name} marked a future home.`);
    }
    agent.target = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private rest(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.health.stamina = Math.min(100, agent.health.stamina + deltaSeconds * 9);
    if (agent.health.stamina >= 75) {
      simulation.log(`${agent.name} finished resting.`);
      this.setState(agent, simulation, "Idle");
    }
  }

  private moveTowardTarget(
    agent: Agent,
    simulation: Simulation,
    deltaSeconds: number,
    nextState: Agent["state"],
  ) {
    if (!agent.target) {
      this.setState(agent, simulation, "Idle");
      return;
    }

    const next = stepToward(agent.position, agent.target, MOVE_SPEED_TILES_PER_SECOND * deltaSeconds);
    agent.position = next;

    if (distance(agent.position, agent.target) <= 0.04) {
      agent.position = { ...agent.target };
      this.setState(agent, simulation, nextState);
    }
  }

  private setState(agent: Agent, simulation: Simulation, state: Agent["state"]) {
    if (agent.state === state) {
      return;
    }
    agent.state = state;
    agent.actionTimer = 0;
    simulation.notifyChanged();
  }
}

function stepToward(current: Vec2, target: Vec2, step: number): Vec2 {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const length = Math.hypot(dx, dy);
  if (length <= step || length === 0) {
    return { ...target };
  }

  return {
    x: current.x + (dx / length) * step,
    y: current.y + (dy / length) * step,
  };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
