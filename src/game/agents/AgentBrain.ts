import type { Agent, AgentState, TileType, Vec2 } from "../types";
import type { Simulation } from "../Simulation";
import { ADULT_AGE } from "../Simulation";
import { findPath, roundVec } from "../world/Pathfinder";

const MOVE_SPEED_TILES_PER_SECOND = 4.5;
const CHOP_DURATION_SECONDS = 1.8;
const PLAN_DURATION_SECONDS = 1.4;
const BUILD_DURATION_SECONDS = 6;
const EAT_DURATION_SECONDS = 1.5;
const IDLE_THINK_SECONDS = 0.4;
const SEARCH_FAIL_BACKOFF_SECONDS = 3;
const TARGET_CANDIDATE_LIMIT = 12;

const HOUSE_WOOD_COST = 8;
const WAREHOUSE_WOOD_COST = 10;
const KITCHEN_WOOD_COST = 8;
const WOOD_STOCKPILE_CAP = 10;
const WOODCUTTER_STOCKPILE_CAP = 14;
const COOK_DURATION_SECONDS = 3;
const COOK_RAW_COST = 2;
const COOK_MEAL_YIELD = 2;
const FARM_WORK_DURATION_SECONDS = 2;
const PAVE_DURATION_SECONDS = 1.5;
const MAX_FIELD_TILES = 12;
const FOOD_STOCK_TARGET = 50;
const HUNGER_SEEK_THRESHOLD = 65;
const HUNGER_SNACK_THRESHOLD = 40;
const STAMINA_EXHAUSTED = 25;
const STAMINA_TIRED = 70;

const CHAT_DURATION_SECONDS = 2.5;
const CHAT_COOLDOWN_SECONDS = 40;
const CHAT_RANGE_TILES = 1.6;
const MARRIAGE_CHANCE = 0.4;
const WANDER_RADIUS_TILES = 5;
// States where a resident is free enough to stop for a quick chat.
const CHATTABLE_STATES: ReadonlySet<AgentState> = new Set([
  "Idle",
  "MoveToTree",
  "MoveToHouseSite",
  "MoveToFood",
  "MoveToFarm",
  "MoveToPave",
  "MoveToKitchen",
  "MoveHome",
  "Wander",
]);

export class AgentBrain {
  update(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const hungerRate = agent.state === "Sleep" ? 0.12 : 0.35;
    agent.health.hunger = Math.min(100, agent.health.hunger + deltaSeconds * hungerRate);
    agent.health.stamina = Math.max(0, agent.health.stamina - deltaSeconds * 0.06);

    if (agent.health.stamina < 12 && agent.state !== "Rest" && agent.state !== "Sleep") {
      this.abandonTask(agent, simulation);
      this.setState(agent, simulation, "Rest");
    }

    agent.socialCooldown = Math.max(0, (agent.socialCooldown ?? 15) - deltaSeconds);
    if (agent.socialCooldown === 0 && CHATTABLE_STATES.has(agent.state)) {
      this.tryStartChat(agent, simulation);
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
        const building = agent.projectBuildingId
          ? simulation.getBuilding(agent.projectBuildingId)
          : undefined;
        const cost = building ? buildCost(building.kind) : HOUSE_WOOD_COST;
        const targetTile = agent.target
          ? simulation.world.getTile(roundVec(agent.target))
          : undefined;
        const arrival: AgentState =
          (targetTile?.type === "HouseSite" || targetTile?.type === "HouseFoundation") &&
          agent.inventory.wood >= cost
            ? "BuildHouse"
            : "PlanHouse";
        this.moveAlongPath(agent, simulation, deltaSeconds, arrival);
        break;
      }
      case "MoveToFarm":
        this.moveAlongPath(agent, simulation, deltaSeconds, "FarmWork");
        break;
      case "FarmWork":
        this.farmWork(agent, simulation, deltaSeconds);
        break;
      case "MoveToPave":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Pave");
        break;
      case "Pave":
        this.pave(agent, simulation, deltaSeconds);
        break;
      case "MoveToKitchen":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Cook");
        break;
      case "Cook":
        this.cook(agent, simulation, deltaSeconds);
        break;
      case "Wander":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Idle");
        break;
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
        this.moveAlongPath(agent, simulation, deltaSeconds, simulation.isNight() ? "Sleep" : "Rest");
        break;
      case "Sleep":
        this.sleep(agent, simulation, deltaSeconds);
        break;
      case "Chat":
        this.chat(agent, simulation, deltaSeconds);
        break;
      case "Rest":
        this.rest(agent, simulation, deltaSeconds);
        break;
    }
  }

  private decideNextAction(agent: Agent, simulation: Simulation) {
    if (simulation.isNight()) {
      this.goSleep(agent, simulation);
      return;
    }

    if (agent.health.hunger >= HUNGER_SEEK_THRESHOLD) {
      this.setState(agent, simulation, "FindFood");
      return;
    }

    if (agent.health.stamina < STAMINA_EXHAUSTED) {
      this.goRest(agent, simulation);
      return;
    }

    // Children play near home instead of working.
    if (agent.age < ADULT_AGE) {
      this.wanderNearHome(agent, simulation);
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

    // Resume an unfinished construction project (e.g., after loading a save).
    if (agent.projectBuildingId) {
      const building = simulation.getBuilding(agent.projectBuildingId);
      if (building && building.stage !== "built") {
        if (agent.inventory.wood >= buildCost(building.kind)) {
          this.headToProject(agent, simulation, building.door);
        } else {
          this.setState(agent, simulation, "FindTree");
        }
        return;
      }
      agent.projectBuildingId = undefined;
    }

    if (simulation.era >= 1) {
      // Communal buildings outrank field work: gather wood for them first.
      const communal = this.communalProject(agent, simulation);
      if (communal === "started") {
        return;
      }
      if (communal === "gather") {
        this.setState(agent, simulation, "FindTree");
        return;
      }

      if (this.doJobWork(agent, simulation)) {
        return;
      }
    }

    const woodCap = agent.job === "woodcutter" ? WOODCUTTER_STOCKPILE_CAP : WOOD_STOCKPILE_CAP;
    if (agent.inventory.wood < woodCap) {
      this.setState(agent, simulation, "FindTree");
      return;
    }

    if (simulation.era >= 2 && this.findPaveWork(agent, simulation)) {
      return;
    }

    // Nothing to do: head home and loiter there, like a villager would.
    if (!samePos(roundVec(agent.position), agent.home)) {
      this.goRest(agent, simulation);
    }
  }

  /**
   * Returns "started" when the agent took on a communal building project,
   * "gather" when it should collect wood for one, "none" otherwise.
   */
  private communalProject(
    agent: Agent,
    simulation: Simulation,
  ): "started" | "gather" | "none" {
    let kind: "warehouse" | "kitchen" | undefined;
    if (!simulation.hasAnyWarehouse()) {
      kind = "warehouse";
    } else if (
      !simulation.hasAnyKitchen() &&
      simulation.getWarehouse() &&
      simulation.foodStock >= 10
    ) {
      kind = "kitchen";
    }
    if (!kind) {
      return "none";
    }

    const cost = buildCost(kind);
    if (agent.inventory.wood < cost) {
      return "gather";
    }
    return this.startCommunalBuilding(agent, simulation, kind) ? "started" : "none";
  }

  private doJobWork(agent: Agent, simulation: Simulation): boolean {
    switch (agent.job) {
      case "cook":
        return this.tryCook(agent, simulation) || this.findFarmWork(agent, simulation);
      case "farmer":
        return this.findFarmWork(agent, simulation);
      case "builder":
        return (
          (simulation.era >= 2 && this.findPaveWork(agent, simulation)) ||
          this.findFarmWork(agent, simulation)
        );
      case "woodcutter":
        return false; // Falls through to the wood-gathering branch below.
      default:
        return this.findFarmWork(agent, simulation);
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
    const site = simulation.world.findBuildingSite(agent.position, 2, 2, (position) =>
      simulation.isTileClaimed(position),
    );
    const door = site ? { x: site.x, y: site.y + 1 } : undefined;
    const path = door
      ? findPath(simulation.world, { start: agent.position, goal: door })
      : undefined;
    if (!site || !door || !path) {
      simulation.log(`${agent.name} could not find a house site.`);
      this.backOff(agent, simulation);
      return;
    }

    const building = simulation.registerBuilding({
      kind: "house",
      x: site.x,
      y: site.y,
      width: 2,
      height: 2,
      door,
      ownerId: agent.id,
    });
    simulation.claimBuildingFootprint(building);
    agent.homeBuildingId = building.id;
    agent.projectBuildingId = building.id;
    agent.homeSite = { ...door };
    agent.target = { ...door };
    agent.path = path;
    simulation.log(`${agent.name} chose a house site.`);
    this.setState(agent, simulation, "MoveToHouseSite");
  }

  private startCommunalBuilding(
    agent: Agent,
    simulation: Simulation,
    kind: "warehouse" | "kitchen",
  ): boolean {
    const width = kind === "warehouse" ? 3 : 2;
    const height = 2;
    const site = simulation.world.findBuildingSite(agent.position, width, height, (position) =>
      simulation.isTileClaimed(position),
    );
    if (!site) {
      return false;
    }
    const door = { x: site.x + Math.floor(width / 2), y: site.y + height - 1 };
    const path = findPath(simulation.world, { start: agent.position, goal: door });
    if (!path) {
      return false;
    }

    const building = simulation.registerBuilding({
      kind,
      x: site.x,
      y: site.y,
      width,
      height,
      door,
    });
    simulation.claimBuildingFootprint(building);
    agent.projectBuildingId = building.id;
    agent.target = { ...door };
    agent.path = path;
    simulation.log(
      kind === "warehouse"
        ? `${agent.name} is planning a village warehouse.`
        : `${agent.name} is planning a village kitchen.`,
    );
    this.setState(agent, simulation, "MoveToHouseSite");
    return true;
  }

  private tryCook(agent: Agent, simulation: Simulation): boolean {
    const kitchen = simulation.getKitchen();
    if (!kitchen) {
      return false;
    }
    if (
      simulation.foodStock < COOK_RAW_COST ||
      simulation.meals >= simulation.agents.length * 2
    ) {
      return false;
    }

    const path = findPath(simulation.world, { start: agent.position, goal: kitchen.door });
    if (!path) {
      return false;
    }

    agent.target = { ...kitchen.door };
    agent.path = path;
    this.setState(agent, simulation, "MoveToKitchen");
    return true;
  }

  private cook(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < COOK_DURATION_SECONDS) {
      return;
    }

    if (simulation.foodStock >= COOK_RAW_COST) {
      simulation.foodStock -= COOK_RAW_COST;
      simulation.meals += COOK_MEAL_YIELD;
      if (Math.random() < 0.4) {
        simulation.log(`${agent.name} cooked warm meals at the kitchen.`);
      }
      simulation.notifyChanged();
    }
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private headToProject(agent: Agent, simulation: Simulation, door: Vec2) {
    const path = findPath(simulation.world, { start: agent.position, goal: door });
    if (!path) {
      simulation.log(`${agent.name} cannot reach the construction site.`);
      this.backOff(agent, simulation);
      return;
    }
    agent.target = { ...door };
    agent.path = path;
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

    const building = agent.projectBuildingId
      ? simulation.getBuilding(agent.projectBuildingId)
      : undefined;
    if (building) {
      simulation.setBuildingStage(building, "site");
      simulation.log(
        building.kind === "house"
          ? `${agent.name} marked a future home.`
          : `${agent.name} staked out the ${building.kind}.`,
      );
    }
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private buildHouse(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const building = agent.projectBuildingId
      ? simulation.getBuilding(agent.projectBuildingId)
      : undefined;
    if (!building) {
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
      return;
    }

    if (agent.actionTimer === 0 && building.stage !== "foundation") {
      simulation.setBuildingStage(building, "foundation");
      simulation.log(
        building.kind === "house"
          ? `${agent.name} started building a house.`
          : `${agent.name} started building the ${building.kind}.`,
      );
    }

    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < BUILD_DURATION_SECONDS) {
      return;
    }

    simulation.setBuildingStage(building, "built");
    simulation.releaseBuildingFootprint(building);
    agent.inventory.wood = Math.max(0, agent.inventory.wood - buildCost(building.kind));
    if (building.kind === "house") {
      agent.home = { ...building.door };
      agent.homeSite = undefined;
      simulation.log(`${agent.name} finished their house.`);
    } else {
      simulation.log(`${agent.name} built the village ${building.kind}!`);
    }
    agent.projectBuildingId = undefined;
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private findFood(agent: Agent, simulation: Simulation) {
    const kitchen = simulation.getKitchen();
    if (kitchen && simulation.meals > 0) {
      const path = findPath(simulation.world, { start: agent.position, goal: kitchen.door });
      if (path) {
        agent.eatPlan = "meal";
        agent.target = { ...kitchen.door };
        agent.path = path;
        this.setState(agent, simulation, "MoveToFood");
        return;
      }
    }

    const warehouse = simulation.getWarehouse();
    if (warehouse && simulation.foodStock > 0) {
      const path = findPath(simulation.world, { start: agent.position, goal: warehouse.door });
      if (path) {
        agent.eatPlan = "warehouse";
        agent.target = { ...warehouse.door };
        agent.path = path;
        this.setState(agent, simulation, "MoveToFood");
        return;
      }
    }

    const route = this.routeToNearest(agent, simulation, "Berry", false);
    if (!route) {
      simulation.log(`${agent.name} is hungry but found no food.`);
      this.backOff(agent, simulation);
      return;
    }

    simulation.claimTile(route.target);
    agent.eatPlan = "berry";
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

    if (agent.eatPlan === "meal") {
      if (simulation.meals > 0) {
        simulation.meals -= 1;
        agent.health.hunger = Math.max(0, agent.health.hunger - 80);
        simulation.log(`${agent.name} enjoyed a warm meal.`);
      }
    } else if (agent.eatPlan === "warehouse") {
      if (simulation.foodStock > 0) {
        simulation.foodStock -= 1;
        agent.health.hunger = Math.max(0, agent.health.hunger - 60);
        simulation.log(`${agent.name} ate from the warehouse.`);
      }
    } else {
      if (agent.target) {
        simulation.world.setTile(agent.target, "Grass");
        simulation.releaseClaim(agent.target);
      }
      agent.health.hunger = Math.max(0, agent.health.hunger - 55);
      simulation.log(`${agent.name} ate berries.`);
    }
    agent.eatPlan = undefined;
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private findFarmWork(agent: Agent, simulation: Simulation): boolean {
    if (simulation.foodStock >= FOOD_STOCK_TARGET) {
      return false;
    }
    const world = simulation.world;
    const route =
      this.routeToNearest(agent, simulation, "FieldRipe", false) ??
      this.routeToNearest(agent, simulation, "FieldEmpty", false);
    if (route) {
      simulation.claimTile(route.target);
      agent.target = route.target;
      agent.path = route.path;
      this.setState(agent, simulation, "MoveToFarm");
      return true;
    }

    const fieldCount =
      world.countType("FieldEmpty") + world.countType("FieldGrowing") + world.countType("FieldRipe");
    if (fieldCount >= Math.min(MAX_FIELD_TILES, simulation.agents.length * 2)) {
      return false;
    }

    const site = world.findBuildingSite(agent.position, 3, 3, (position) =>
      simulation.isTileClaimed(position),
    );
    if (!site) {
      return false;
    }
    const center = { x: site.x + 1, y: site.y + 1 };
    const path = findPath(world, { start: agent.position, goal: center });
    if (!path) {
      return false;
    }

    simulation.claimTile(center);
    agent.target = center;
    agent.path = path;
    this.setState(agent, simulation, "MoveToFarm");
    return true;
  }

  private farmWork(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < FARM_WORK_DURATION_SECONDS) {
      return;
    }

    if (agent.target) {
      simulation.releaseClaim(agent.target);
      const center = roundVec(agent.target);
      const tile = simulation.world.getTile(center);
      if (tile?.type === "FieldRipe") {
        simulation.world.setTile(center, "FieldEmpty");
        simulation.foodStock += 2;
        simulation.log(`${agent.name} harvested crops. +2 food`);
      } else if (tile?.type === "FieldEmpty") {
        simulation.world.setTile(center, "FieldGrowing");
        if (Math.random() < 0.35) {
          simulation.log(`${agent.name} sowed seeds.`);
        }
      } else if (tile?.type === "Grass") {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const position = { x: center.x + dx, y: center.y + dy };
            const patch = simulation.world.getTile(position);
            if (patch?.type === "Grass" && !simulation.isTileClaimed(position)) {
              simulation.world.setTile(position, "FieldEmpty");
            }
          }
        }
        simulation.log(`${agent.name} tilled a new field.`);
      }
    }
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private findPaveWork(agent: Agent, simulation: Simulation): boolean {
    const world = simulation.world;
    let best: Vec2 | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const tile of world.tiles) {
      if (tile.type !== "Dirt" || simulation.isTileClaimed(tile)) {
        continue;
      }
      if (!hasAdjacentRoad(world, tile)) {
        continue;
      }
      const d = squaredDistance(agent.position, tile);
      if (d < bestDistance) {
        bestDistance = d;
        best = { x: tile.x, y: tile.y };
      }
    }
    if (!best) {
      return false;
    }

    const path = findPath(world, { start: agent.position, goal: best });
    if (!path) {
      return false;
    }

    simulation.claimTile(best);
    agent.target = best;
    agent.path = path;
    this.setState(agent, simulation, "MoveToPave");
    return true;
  }

  private pave(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < PAVE_DURATION_SECONDS) {
      return;
    }

    if (agent.target) {
      simulation.releaseClaim(agent.target);
      const tile = simulation.world.getTile(roundVec(agent.target));
      if (tile?.type === "Dirt") {
        simulation.world.setTile(agent.target, "Road");
        if (Math.random() < 0.3) {
          simulation.log(`${agent.name} paved a stretch of road.`);
        }
      }
    }
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private tryStartChat(agent: Agent, simulation: Simulation) {
    const partner = simulation.agents.find(
      (other) =>
        other !== agent &&
        (other.socialCooldown ?? 1) === 0 &&
        CHATTABLE_STATES.has(other.state) &&
        distance(agent.position, other.position) <= CHAT_RANGE_TILES,
    );
    if (!partner) {
      return;
    }

    this.startChat(agent, simulation);
    this.startChat(partner, simulation);

    if (this.canMarry(agent, partner) && Math.random() < MARRIAGE_CHANCE) {
      this.marry(agent, partner, simulation);
    } else {
      simulation.log(`${agent.name} and ${partner.name} stopped for a chat.`);
    }
  }

  private canMarry(a: Agent, b: Agent): boolean {
    return (
      !a.spouseId &&
      !b.spouseId &&
      a.age >= ADULT_AGE &&
      b.age >= ADULT_AGE &&
      a.gender !== b.gender &&
      Boolean(a.home || b.home)
    );
  }

  private marry(a: Agent, b: Agent, simulation: Simulation) {
    const homeOwner = a.home ? a : b;
    const mover = homeOwner === a ? b : a;

    // The mover gives up any house of their own and any pending house plan.
    if (mover.projectBuildingId) {
      const pending = simulation.getBuilding(mover.projectBuildingId);
      if (pending && pending.stage !== "built" && pending.kind === "house") {
        simulation.cancelBuilding(pending);
      }
      mover.projectBuildingId = undefined;
    }
    mover.homeSite = undefined;
    mover.home = homeOwner.home ? { ...homeOwner.home } : undefined;
    mover.homeBuildingId = homeOwner.homeBuildingId;

    a.spouseId = b.id;
    b.spouseId = a.id;
    simulation.log(`${a.name} and ${b.name} got married! 💍`);
  }

  private wanderNearHome(agent: Agent, simulation: Simulation) {
    const anchor = agent.home ?? roundVec(agent.position);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = {
        x: anchor.x + Math.floor(Math.random() * (WANDER_RADIUS_TILES * 2 + 1)) - WANDER_RADIUS_TILES,
        y: anchor.y + Math.floor(Math.random() * (WANDER_RADIUS_TILES * 2 + 1)) - WANDER_RADIUS_TILES,
      };
      if (!simulation.world.isWalkable(candidate)) {
        continue;
      }
      const path = findPath(simulation.world, { start: agent.position, goal: candidate });
      if (path) {
        agent.target = candidate;
        agent.path = path;
        this.setState(agent, simulation, "Wander");
        return;
      }
    }
    this.backOff(agent, simulation);
  }

  private startChat(agent: Agent, simulation: Simulation) {
    agent.resumeState = agent.state === "Idle" ? undefined : agent.state;
    agent.socialCooldown = CHAT_COOLDOWN_SECONDS;
    this.setState(agent, simulation, "Chat");
  }

  private chat(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < CHAT_DURATION_SECONDS) {
      return;
    }

    const resume = agent.resumeState;
    agent.resumeState = undefined;
    this.setState(agent, simulation, resume ?? "Idle");
  }

  private goSleep(agent: Agent, simulation: Simulation) {
    if (agent.home && !samePos(roundVec(agent.position), agent.home)) {
      const path = findPath(simulation.world, { start: agent.position, goal: agent.home });
      if (path) {
        agent.target = { ...agent.home };
        agent.path = path;
        this.setState(agent, simulation, "MoveHome");
        return;
      }
    }
    this.setState(agent, simulation, "Sleep");
  }

  private sleep(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const atHome = Boolean(agent.home && samePos(roundVec(agent.position), agent.home));
    const regenRate = atHome ? 12 : 6;
    agent.health.stamina = Math.min(100, agent.health.stamina + deltaSeconds * regenRate);

    if (!simulation.isNight()) {
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
    }
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

function buildCost(kind: "house" | "warehouse" | "kitchen"): number {
  if (kind === "warehouse") {
    return WAREHOUSE_WOOD_COST;
  }
  if (kind === "kitchen") {
    return KITCHEN_WOOD_COST;
  }
  return HOUSE_WOOD_COST;
}

function hasAdjacentRoad(world: Simulation["world"], position: Vec2): boolean {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    if (world.getTile({ x: position.x + dx, y: position.y + dy })?.type === "Road") {
      return true;
    }
  }
  return false;
}
