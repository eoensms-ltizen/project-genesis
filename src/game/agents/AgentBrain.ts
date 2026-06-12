import type { Agent, AgentState, TileType, Vec2 } from "../types";
import type { Simulation } from "../Simulation";
import { findPath, roundVec } from "../world/Pathfinder";

const MOVE_SPEED_TILES_PER_SECOND = 4.5;
const CHOP_DURATION_SECONDS = 1.8;
const PLAN_DURATION_SECONDS = 1.4;
const BUILD_DURATION_SECONDS = 4;
const EAT_DURATION_SECONDS = 1.5;
const IDLE_THINK_SECONDS = 0.4;
const SEARCH_FAIL_BACKOFF_SECONDS = 3;
const TARGET_CANDIDATE_LIMIT = 12;

const HOUSE_WOOD_COST = 5;
const WOOD_STOCKPILE_CAP = 8;
const HUNGER_SEEK_THRESHOLD = 65;
const HUNGER_SNACK_THRESHOLD = 40;
const STAMINA_EXHAUSTED = 25;
const STAMINA_TIRED = 70;

export class AgentBrain {
  update(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.health.hunger = Math.min(100, agent.health.hunger + deltaSeconds * 0.35);
    agent.health.stamina = Math.max(0, agent.health.stamina - deltaSeconds * 0.06);

    if (agent.health.stamina < 12 && agent.state !== "Rest") {
      this.abandonTask(agent, simulation);
      this.setState(agent, simulation, "Rest");
    }

    switch (agent.state) {
      case "Idle":
        agent.actionTimer += deltaSeconds;
        if (agent.actionTimer >= IDLE_THINK_SECONDS) {
          this.decideNextAction(agent, simulation);
        }
        break;
      case "FindTree":
        this.findTree(agent, simulation);
        break;
      case "MoveToTree":
        this.moveAlongPath(agent, simulation, deltaSeconds, "ChopTree");
        break;
      case "ChopTree":
        this.chopTree(agent, simulation, deltaSeconds);
        break;
      case "FindHouseSite":
        this.findHouseSite(agent, simulation);
        break;
      case "MoveToHouseSite": {
        const targetTile = agent.target
          ? simulation.world.getTile(roundVec(agent.target))
          : undefined;
        const arrival: AgentState =
          (targetTile?.type === "HouseSite" || targetTile?.type === "HouseFoundation") &&
          agent.inventory.wood >= HOUSE_WOOD_COST
            ? "BuildHouse"
            : "PlanHouse";
        this.moveAlongPath(agent, simulation, deltaSeconds, arrival);
        break;
      }
      case "PlanHouse":
        this.planHouse(agent, simulation, deltaSeconds);
        break;
      case "BuildHouse":
        this.buildHouse(agent, simulation, deltaSeconds);
        break;
      case "FindFood":
        this.findFood(agent, simulation);
        break;
      case "MoveToFood":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Eat");
        break;
      case "Eat":
        this.eat(agent, simulation, deltaSeconds);
        break;
      case "MoveHome":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Rest");
        break;
      case "Rest":
        this.rest(agent, simulation, deltaSeconds);
        break;
    }
  }

  private decideNextAction(agent: Agent, simulation: Simulation) {
    if (agent.health.hunger >= HUNGER_SEEK_THRESHOLD) {
      this.setState(agent, simulation, "FindFood");
      return;
    }

    if (agent.health.stamina < STAMINA_EXHAUSTED) {
      this.goRest(agent, simulation);
      return;
    }

    if (!agent.home) {
      if (!agent.homeSite) {
        this.setState(agent, simulation, "FindHouseSite");
        return;
      }
      if (agent.inventory.wood < HOUSE_WOOD_COST) {
        this.setState(agent, simulation, "FindTree");
        return;
      }
      this.headToHomeSite(agent, simulation);
      return;
    }

    if (agent.health.stamina < STAMINA_TIRED) {
      this.goRest(agent, simulation);
      return;
    }

    if (agent.health.hunger >= HUNGER_SNACK_THRESHOLD) {
      this.setState(agent, simulation, "FindFood");
      return;
    }

    if (agent.inventory.wood < WOOD_STOCKPILE_CAP) {
      this.setState(agent, simulation, "FindTree");
      return;
    }

    // Nothing to do: head home and loiter there, like a villager would.
    if (!samePos(roundVec(agent.position), agent.home)) {
      this.goRest(agent, simulation);
    }
  }

  private findTree(agent: Agent, simulation: Simulation) {
    const route = this.routeToNearest(agent, simulation, "Tree", true);
    if (!route) {
      simulation.log(`${agent.name} could not reach a tree.`);
      this.backOff(agent, simulation);
      return;
    }

    simulation.claimTile(route.target);
    agent.target = route.target;
    agent.path = route.path;
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
      simulation.releaseClaim(agent.target);
    }
    agent.inventory.wood += 1;
    agent.health.stamina = Math.max(0, agent.health.stamina - 8);
    simulation.log(`${agent.name} chopped wood. +1 wood`);
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private findHouseSite(agent: Agent, simulation: Simulation) {
    const site = simulation.world.findHouseSiteCandidate(agent.position, (position) =>
      simulation.isTileClaimed(position),
    );
    const path =
      site && !simulation.isTileClaimed(site)
        ? findPath(simulation.world, { start: agent.position, goal: site })
        : undefined;
    if (!site || !path) {
      simulation.log(`${agent.name} could not find a house site.`);
      this.backOff(agent, simulation);
      return;
    }

    simulation.claimTile(site);
    agent.homeSite = { ...site };
    agent.target = { ...site };
    agent.path = path;
    simulation.log(`${agent.name} chose a house site.`);
    this.setState(agent, simulation, "MoveToHouseSite");
  }

  private headToHomeSite(agent: Agent, simulation: Simulation) {
    if (!agent.homeSite) {
      this.setState(agent, simulation, "Idle");
      return;
    }

    const path = findPath(simulation.world, { start: agent.position, goal: agent.homeSite });
    if (!path) {
      simulation.log(`${agent.name} cannot reach their house site.`);
      this.backOff(agent, simulation);
      return;
    }

    agent.target = { ...agent.homeSite };
    agent.path = path;
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
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private buildHouse(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    if (agent.actionTimer === 0 && agent.target) {
      const tile = simulation.world.getTile(roundVec(agent.target));
      if (tile && tile.type !== "HouseFoundation") {
        simulation.world.setTile(agent.target, "HouseFoundation");
        simulation.log(`${agent.name} started building a house.`);
      }
    }

    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < BUILD_DURATION_SECONDS) {
      return;
    }

    if (agent.target) {
      simulation.world.setTile(agent.target, "House");
      simulation.releaseClaim(agent.target);
      agent.home = { ...agent.target };
      agent.homeSite = undefined;
      agent.inventory.wood = Math.max(0, agent.inventory.wood - HOUSE_WOOD_COST);
      simulation.log(`${agent.name} finished their house.`);
    }
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private findFood(agent: Agent, simulation: Simulation) {
    const route = this.routeToNearest(agent, simulation, "Berry", false);
    if (!route) {
      simulation.log(`${agent.name} is hungry but found no food.`);
      this.backOff(agent, simulation);
      return;
    }

    simulation.claimTile(route.target);
    agent.target = route.target;
    agent.path = route.path;
    simulation.log(`${agent.name} went looking for berries.`);
    this.setState(agent, simulation, "MoveToFood");
  }

  private eat(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < EAT_DURATION_SECONDS) {
      return;
    }

    if (agent.target) {
      simulation.world.setTile(agent.target, "Grass");
      simulation.releaseClaim(agent.target);
    }
    agent.health.hunger = Math.max(0, agent.health.hunger - 55);
    simulation.log(`${agent.name} ate berries.`);
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private goRest(agent: Agent, simulation: Simulation) {
    if (agent.home && !samePos(roundVec(agent.position), agent.home)) {
      const path = findPath(simulation.world, { start: agent.position, goal: agent.home });
      if (path) {
        agent.target = { ...agent.home };
        agent.path = path;
        this.setState(agent, simulation, "MoveHome");
        return;
      }
    }
    this.setState(agent, simulation, "Rest");
  }

  private rest(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    const atHome = Boolean(agent.home && samePos(roundVec(agent.position), agent.home));
    const regenRate = atHome ? 16 : 9;
    agent.health.stamina = Math.min(100, agent.health.stamina + deltaSeconds * regenRate);

    const restedAt = atHome ? 92 : 75;
    if (agent.health.stamina >= restedAt) {
      // Instant rests (loitering at home while already rested) stay out of the log.
      if (agent.actionTimer >= 1) {
        simulation.log(
          atHome ? `${agent.name} rested at home.` : `${agent.name} finished resting.`,
        );
      }
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
    }
  }

  private moveAlongPath(
    agent: Agent,
    simulation: Simulation,
    deltaSeconds: number,
    nextState: AgentState,
  ) {
    if (!agent.target) {
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
      return;
    }

    if (!agent.path || agent.path.length === 0) {
      this.setState(agent, simulation, nextState);
      return;
    }

    if (!simulation.world.isWalkable(agent.path[0])) {
      // The world changed under our feet; replan to the same target.
      const replanned = findPath(simulation.world, {
        start: agent.position,
        goal: agent.target,
        stopAdjacent: nextState === "ChopTree",
      });
      if (!replanned) {
        simulation.log(`${agent.name} is blocked and gave up.`);
        this.abandonTask(agent, simulation);
        this.backOff(agent, simulation);
        return;
      }
      agent.path = replanned;
      return;
    }

    const tileCost = simulation.world.moveCost(roundVec(agent.position));
    const speed = MOVE_SPEED_TILES_PER_SECOND / (Number.isFinite(tileCost) ? tileCost : 1);
    let remaining = speed * deltaSeconds;

    while (remaining > 0 && agent.path.length > 0) {
      const waypoint = agent.path[0];
      const gap = distance(agent.position, waypoint);
      if (gap <= remaining) {
        agent.position = { x: waypoint.x, y: waypoint.y };
        remaining -= gap;
        agent.path.shift();
        simulation.recordTraffic(waypoint);
      } else {
        agent.position = stepToward(agent.position, waypoint, remaining);
        remaining = 0;
      }
    }

    if (agent.path.length === 0) {
      this.setState(agent, simulation, nextState);
    }
  }

  private routeToNearest(
    agent: Agent,
    simulation: Simulation,
    type: TileType,
    stopAdjacent: boolean,
  ): { target: Vec2; path: Vec2[] } | undefined {
    const origin = agent.position;
    const candidates = simulation.world.tiles
      .filter((tile) => tile.type === type && !simulation.isTileClaimed(tile))
      .sort((a, b) => squaredDistance(origin, a) - squaredDistance(origin, b))
      .slice(0, TARGET_CANDIDATE_LIMIT);

    for (const tile of candidates) {
      const target = { x: tile.x, y: tile.y };
      const path = findPath(simulation.world, { start: origin, goal: target, stopAdjacent });
      if (path) {
        return { target, path };
      }
    }

    return undefined;
  }

  private abandonTask(agent: Agent, simulation: Simulation) {
    if (agent.target && !(agent.homeSite && samePos(agent.target, agent.homeSite))) {
      simulation.releaseClaim(agent.target);
    }
    agent.target = undefined;
    agent.path = undefined;
  }

  private backOff(agent: Agent, simulation: Simulation) {
    this.setState(agent, simulation, "Idle");
    // Wait before searching again so failures do not spam every frame.
    agent.actionTimer = -SEARCH_FAIL_BACKOFF_SECONDS;
  }

  private setState(agent: Agent, simulation: Simulation, state: AgentState) {
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

function squaredDistance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function samePos(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}
