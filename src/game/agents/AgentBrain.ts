import type { Agent, AgentState, Building, BuildingKind, TileType, Vec2 } from "../types";
import type { Simulation } from "../Simulation";
import { ADULT_AGE, ELDER_AGE } from "../Simulation";
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
const CHURCH_WOOD_COST = 14;
const PASTURE_WOOD_COST = 12;
const POWERPLANT_WOOD_COST = 16;
const FACTORY_WOOD_COST = 16;
const STATION_WOOD_COST = 14;
const CEMETERY_WOOD_COST = 10;
const PARK_WOOD_COST = 8;
const POLICE_WOOD_COST = 12;
const WORSHIP_RADIUS_TILES = 4;
const TRANSPLANT_DISTANCE_TILES = 6;
const HUNT_DURATION_SECONDS = 1.2;
const TAME_DURATION_SECONDS = 2.5;
const PASTURE_HERD_CAP = 6;
const WOOD_STOCKPILE_CAP = 10;
const WOODCUTTER_STOCKPILE_CAP = 14;
const COOK_DURATION_SECONDS = 3;
const COOK_RAW_COST = 2;
const COOK_MEAL_YIELD = 2;
const FARM_WORK_DURATION_SECONDS = 2;
const CLEAN_DURATION_SECONDS = 1.5;
const PAVE_DURATION_SECONDS = 1.5;
const MAX_FIELD_TILES = 12;
// New fields are never tilled within this many tiles of a home, so farmland
// keeps its distance from where people live.
const FIELD_HOME_BUFFER = 4;
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
  "MoveToWorship",
  "MoveToStump",
  "MoveToPlant",
  "MoveHome",
  "Wander",
]);

// --- Needs (0..100 satisfaction) ----------------------------------------
// Each soft need drains every second and refills while the resident performs
// the matching activity. Personality scales both how fast a need drains and how
// loudly it calls, so two residents in the same situation choose differently.
const NEED_DECAY = { social: 0.09, purpose: 0.05, faith: 0.045, leisure: 0.06, comfort: 0.04 };
const NEED_FILL = { social: 22, purpose: 3, faith: 6, leisure: 8, comfort: 12 };
const PRAY_DURATION_SECONDS = 8;
const RELAX_DURATION_SECONDS = 6;
// Crowding: homes packed within this radius drain comfort faster (the first
// couple of neighbours are fine; beyond that it starts to feel cramped).
const COMFORT_CROWD_RADIUS = 6;
const COMFORT_CROWD_TOLERANCE = 2;
const COMFORT_CROWD_DECAY = 0.02;
// How strongly the surrounding ambiance pushes comfort up (amenities) or down
// (nuisances) per second, and how much it sways where things get built.
const AMBIANCE_COMFORT_RATE = 0.005;
const AMBIANCE_SITING_WEIGHT = 1.5;
// A soft need must reach this urgency to pull an adult away from work.
const NEED_ACT_THRESHOLD = 55;
// Work is the baseline drive, so it always carries at least this much pull.
const WORK_BASELINE_URGENCY = 18;

// While in one of these states the resident is contributing, which feeds the
// sense-of-purpose need; everything else lets it drain.
const WORKING_STATES: ReadonlySet<AgentState> = new Set([
  "FindTree",
  "MoveToTree",
  "ChopTree",
  "FindHouseSite",
  "MoveToHouseSite",
  "PlanHouse",
  "BuildHouse",
  "MoveToFarm",
  "FarmWork",
  "MoveToPave",
  "Pave",
  "MoveToKitchen",
  "Cook",
  "MoveToStump",
  "Transplant",
  "MoveToPlant",
  "Plant",
  "MoveToHunt",
  "Hunt",
  "MoveToTame",
  "Tame",
  "MoveToRedevelop",
  "Redevelop",
  "MoveToClean",
  "Clean",
  "Patrol",
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

    this.updateNeeds(agent, simulation, deltaSeconds);

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
      case "MoveToWorship":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Worship");
        break;
      case "Worship":
        this.worship(agent, simulation, deltaSeconds);
        break;
      case "MoveToStump":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Transplant");
        break;
      case "Transplant":
        this.transplantDig(agent, simulation);
        break;
      case "MoveToPlant":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Plant");
        break;
      case "Plant":
        this.plantTree(agent, simulation);
        break;
      case "MoveToHunt":
        this.approachQuarry(agent, simulation, deltaSeconds, "Hunt");
        break;
      case "Hunt":
        this.hunt(agent, simulation, deltaSeconds);
        break;
      case "MoveToTame":
        this.approachQuarry(agent, simulation, deltaSeconds, "Tame");
        break;
      case "Tame":
        this.tame(agent, simulation, deltaSeconds);
        break;
      case "MoveToRedevelop":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Redevelop");
        break;
      case "Redevelop":
        this.redevelop(agent, simulation, deltaSeconds);
        break;
      case "MoveToPark":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Relax");
        break;
      case "Relax":
        this.relax(agent, simulation, deltaSeconds);
        break;
      case "MoveToClean":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Clean");
        break;
      case "Clean":
        this.clean(agent, simulation, deltaSeconds);
        break;
      case "Patrol":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Idle");
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
    // Night and acute survival are structural: they override every soft need,
    // including the drive to build a first home.
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

    // Children and elders are outside working life; they live by company and
    // leisure, whichever pulls harder.
    if (agent.age < ADULT_AGE || agent.age >= ELDER_AGE) {
      this.liveByLeisure(agent, simulation);
      return;
    }

    // A homeless adult must establish a home before joining the village's
    // need-driven daily life.
    if (!agent.home) {
      if (this.tryClaimEmptyHouse(agent, simulation)) {
        return;
      }
      if (this.tryHousing(agent, simulation)) {
        return;
      }
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

    // The dominant need chooses the next action.
    this.actOnDominantNeed(agent, simulation);
  }

  /**
   * Utility arbitration: score every drive by how urgent it is right now,
   * weighted by personality, then act on the strongest. Survival drives are
   * scored on a steeper curve so they win whenever they matter; work is the
   * baseline, so a resident only breaks from it when a soft need outgrows it.
   */
  private actOnDominantNeed(agent: Agent, simulation: Simulation) {
    const p = agent.personality;
    const n = agent.needs;
    const churchOpen = Boolean(simulation.getChurch());

    type DriveKind = "eat" | "rest" | "social" | "faith" | "leisure" | "comfort" | "work";
    type Drive = { kind: DriveKind; urgency: number };
    const drives: Drive[] = [];

    // Mild hunger/tiredness compete as ordinary drives (the acute cases were
    // already handled structurally above).
    if (agent.health.hunger >= HUNGER_SNACK_THRESHOLD) {
      drives.push({ kind: "eat", urgency: agent.health.hunger });
    }
    if (agent.health.stamina < STAMINA_TIRED) {
      drives.push({ kind: "rest", urgency: 100 - agent.health.stamina });
    }

    const social = (100 - n.social) * (0.6 + p.sociability);
    if (social >= NEED_ACT_THRESHOLD) {
      drives.push({ kind: "social", urgency: social });
    }
    const leisure = (100 - n.leisure) * (0.5 + p.curiosity);
    if (leisure >= NEED_ACT_THRESHOLD) {
      drives.push({ kind: "leisure", urgency: leisure });
    }
    // Feeling cramped pulls a resident toward a park for some breathing room.
    const comfort = (100 - n.comfort) * 0.9;
    if (comfort >= NEED_ACT_THRESHOLD) {
      drives.push({ kind: "comfort", urgency: comfort });
    }
    if (churchOpen) {
      const faith = (100 - n.faith) * 0.9;
      // The morning service is a standing call regardless of how topped-up faith is.
      if (faith >= NEED_ACT_THRESHOLD || simulation.isWorshipMorning()) {
        drives.push({ kind: "faith", urgency: Math.max(faith, simulation.isWorshipMorning() ? 80 : 0) });
      }
    }

    // Work is always on the table as the fallback drive.
    const work = Math.max((100 - n.purpose) * (0.5 + p.diligence), WORK_BASELINE_URGENCY);
    drives.push({ kind: "work", urgency: work });

    drives.sort((a, b) => b.urgency - a.urgency);

    for (const drive of drives) {
      if (this.pursue(agent, simulation, drive.kind)) {
        return;
      }
    }

    // Nothing actionable: head home and loiter, like a villager would.
    if (!samePos(roundVec(agent.position), agent.home ?? roundVec(agent.position))) {
      this.goRest(agent, simulation);
    }
  }

  /** Executes a chosen drive; returns false if it could not be acted on. */
  private pursue(
    agent: Agent,
    simulation: Simulation,
    kind: "eat" | "rest" | "social" | "faith" | "leisure" | "comfort" | "work",
  ): boolean {
    switch (kind) {
      case "eat":
        this.setState(agent, simulation, "FindFood");
        return true;
      case "rest":
        this.goRest(agent, simulation);
        return true;
      case "faith":
        return this.goWorship(agent, simulation);
      case "social":
        if (this.seekCompany(agent, simulation)) {
          this.maybeLog(simulation, `${agent.name} went looking for company.`);
          return true;
        }
        return false;
      case "leisure":
        this.wanderNearHome(agent, simulation);
        this.maybeLog(simulation, `${agent.name} wandered off to take in the village.`);
        return true;
      case "comfort":
        // Only actionable if a park exists; otherwise the unmet need shows up as
        // low wellbeing and prompts builders to lay one out (see communalProject).
        if (this.goRelax(agent, simulation)) {
          this.maybeLog(simulation, `${agent.name} went to the park for some air.`);
          return true;
        }
        return false;
      case "work":
        return this.doProductiveWork(agent, simulation);
    }
  }

  /** Route to the nearest park and relax there to recover comfort. */
  private goRelax(agent: Agent, simulation: Simulation): boolean {
    const park = simulation.nearestPark(agent.position);
    if (!park) {
      return false;
    }
    const cx = Math.round(park.x + park.width / 2);
    const cy = Math.round(park.y + park.height / 2);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = {
        x: cx + Math.floor(Math.random() * 5) - 2,
        y: cy + Math.floor(Math.random() * 5) - 2,
      };
      if (!simulation.world.isWalkable(candidate)) {
        continue;
      }
      const path = findPath(simulation.world, { start: agent.position, goal: candidate });
      if (path) {
        agent.target = candidate;
        agent.path = path;
        this.setState(agent, simulation, "MoveToPark");
        return true;
      }
    }
    return false;
  }

  private relax(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer >= RELAX_DURATION_SECONDS) {
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
    }
  }

  private doProductiveWork(agent: Agent, simulation: Simulation): boolean {
    if (simulation.era >= 1) {
      // Shelter before extras: when the town is full, growing housing upward
      // takes priority over new communal amenities — otherwise housing capacity
      // (and so the population) never grows past whatever it started at. Only one
      // house redevelops at a time, so other workers fall through to the rest.
      if (this.tryRedevelop(agent, simulation)) {
        return true;
      }
      // Communal buildings outrank field work: gather wood for them first.
      const communal = this.communalProject(agent, simulation);
      if (communal === "started") {
        return true;
      }
      if (communal === "gather") {
        this.setState(agent, simulation, "FindTree");
        return true;
      }
      if (this.doJobWork(agent, simulation)) {
        return true;
      }
    }

    const woodCap = agent.job === "woodcutter" ? WOODCUTTER_STOCKPILE_CAP : WOOD_STOCKPILE_CAP;
    if (agent.inventory.wood < woodCap) {
      this.setState(agent, simulation, "FindTree");
      return true;
    }

    if (simulation.era >= 2 && this.findPaveWork(agent, simulation)) {
      return true;
    }

    return false;
  }

  /**
   * Land pressure made actionable: when housing is nearly full and there is no
   * room to sprawl, a worker rebuilds a central house one tier taller. Gathers
   * wood first if short, like a communal project.
   */
  private tryRedevelop(agent: Agent, simulation: Simulation): boolean {
    if (!simulation.shouldRedevelopHousing()) {
      return false;
    }
    const house = simulation.findRedevelopableHouse();
    if (!house) {
      return false;
    }
    if (agent.inventory.wood < simulation.redevelopCost(house)) {
      this.setState(agent, simulation, "FindTree");
      return true;
    }
    const path = findPath(simulation.world, { start: agent.position, goal: house.door });
    if (!path) {
      return false;
    }
    agent.projectBuildingId = house.id;
    agent.target = { ...house.door };
    agent.path = path;
    this.setState(agent, simulation, "MoveToRedevelop");
    return true;
  }

  private redevelop(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const house = agent.projectBuildingId
      ? simulation.getBuilding(agent.projectBuildingId)
      : undefined;
    // The target may have been claimed, levelled, or removed while en route.
    if (
      !house ||
      house.kind !== "house" ||
      house.stage !== "built" ||
      simulation.houseLevel(house) >= 4
    ) {
      agent.projectBuildingId = undefined;
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
      return;
    }

    if (agent.actionTimer === 0) {
      simulation.log(`${agent.name} began redeveloping a house.`, [agent]);
    }
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < BUILD_DURATION_SECONDS) {
      return;
    }

    agent.inventory.wood = Math.max(0, agent.inventory.wood - simulation.redevelopCost(house));
    simulation.levelUpHouse(house);
    agent.projectBuildingId = undefined;
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  /** Lifestage idle for children and elders: company if lonely, else a stroll. */
  private liveByLeisure(agent: Agent, simulation: Simulation) {
    const social = (100 - agent.needs.social) * (0.6 + agent.personality.sociability);
    if (social >= NEED_ACT_THRESHOLD && this.seekCompany(agent, simulation)) {
      return;
    }
    this.wanderNearHome(agent, simulation);
  }

  /**
   * Walk toward a communal building (or the village centre) so the resident
   * runs into others; the opportunistic chat in update() does the rest.
   */
  private seekCompany(agent: Agent, simulation: Simulation): boolean {
    const hub =
      simulation.getWarehouse() ??
      simulation.getKitchen() ??
      simulation.getChurch();
    const center = hub
      ? { x: Math.round(hub.x + hub.width / 2), y: Math.round(hub.y + hub.height / 2) }
      : roundVec(agent.position);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = {
        x: center.x + Math.floor(Math.random() * (WANDER_RADIUS_TILES * 2 + 1)) - WANDER_RADIUS_TILES,
        y: center.y + Math.floor(Math.random() * (WANDER_RADIUS_TILES * 2 + 1)) - WANDER_RADIUS_TILES,
      };
      if (!simulation.world.isWalkable(candidate)) {
        continue;
      }
      const path = findPath(simulation.world, { start: agent.position, goal: candidate });
      if (path) {
        agent.target = candidate;
        agent.path = path;
        this.setState(agent, simulation, "Wander");
        return true;
      }
    }
    return false;
  }

  /** Occasional flavour log so the village feels alive without spamming. */
  private maybeLog(simulation: Simulation, message: string) {
    if (Math.random() < 0.18) {
      simulation.log(message);
    }
  }

  private updateNeeds(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const p = agent.personality;
    const n = agent.needs;

    n.social = clampNeed(n.social - deltaSeconds * NEED_DECAY.social * (0.6 + p.sociability));
    n.leisure = clampNeed(n.leisure - deltaSeconds * NEED_DECAY.leisure * (0.5 + p.curiosity));
    n.purpose = clampNeed(n.purpose - deltaSeconds * NEED_DECAY.purpose * (0.5 + p.diligence));
    // Faith only matters once there is a church to give it meaning.
    if (simulation.getChurch()) {
      n.faith = clampNeed(n.faith - deltaSeconds * NEED_DECAY.faith);
    }
    // Comfort drains faster the more crowded the resident's home is, and shifts
    // with the surroundings: pleasant amenities soothe, nearby nuisances grate.
    const anchor = agent.home ?? roundVec(agent.position);
    const crowd = Math.max(
      0,
      simulation.localHouseDensity(anchor, COMFORT_CROWD_RADIUS) - COMFORT_CROWD_TOLERANCE,
    );
    const ambiance = simulation.ambianceAt(anchor);
    n.comfort = clampNeed(
      n.comfort -
        deltaSeconds * (NEED_DECAY.comfort + crowd * COMFORT_CROWD_DECAY) +
        deltaSeconds * ambiance * AMBIANCE_COMFORT_RATE,
    );

    // Refill while engaged in the matching activity.
    if (agent.state === "Chat") {
      n.social = clampNeed(n.social + deltaSeconds * NEED_FILL.social);
    }
    if (agent.state === "Wander") {
      n.leisure = clampNeed(n.leisure + deltaSeconds * NEED_FILL.leisure);
    }
    if (agent.state === "Worship") {
      n.faith = clampNeed(n.faith + deltaSeconds * NEED_FILL.faith);
    }
    if (WORKING_STATES.has(agent.state)) {
      n.purpose = clampNeed(n.purpose + deltaSeconds * NEED_FILL.purpose);
    }
    if (agent.state === "Relax") {
      n.comfort = clampNeed(n.comfort + deltaSeconds * NEED_FILL.comfort);
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
    let kind:
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
      | undefined;
    if (!simulation.hasAnyWarehouse()) {
      kind = "warehouse";
    } else if (simulation.needsCemetery()) {
      // The dead must be laid to rest — built far from where people live.
      kind = "cemetery";
    } else if (simulation.needsPark()) {
      // A cramped town lays out green space near where people live.
      kind = "park";
    } else if (simulation.needsPoliceStation()) {
      // A restless town builds a police station to keep the peace.
      kind = "police";
    } else if (
      !simulation.hasAnyKitchen() &&
      simulation.getWarehouse() &&
      simulation.foodStock >= 10
    ) {
      kind = "kitchen";
    } else if (
      simulation.era >= 2 &&
      !simulation.hasAnyChurch() &&
      simulation.getKitchen()
    ) {
      kind = "church";
    } else if (
      simulation.era >= 2 &&
      !simulation.hasAnyPasture() &&
      simulation.getChurch()
    ) {
      kind = "pasture";
    } else if (simulation.era >= 4 && !simulation.hasAnyPowerPlant()) {
      kind = "powerplant";
    } else if (
      simulation.era >= 4 &&
      !simulation.hasAnyFactory() &&
      simulation.getPowerPlant()
    ) {
      kind = "factory";
    } else if (
      simulation.era >= 4 &&
      !simulation.hasAnyStation() &&
      simulation.getPowerPlant()
    ) {
      kind = "station";
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
        // Reforest by relocating an in-the-way stump, otherwise gather wood below.
        return this.findTransplantWork(agent, simulation);
      case "hunter":
        return this.findHuntWork(agent, simulation);
      case "cleaner":
        return this.findCleanWork(agent, simulation) || this.findFarmWork(agent, simulation);
      case "police":
        return this.patrol(agent, simulation);
      default:
        return this.findFarmWork(agent, simulation);
    }
  }

  /** Officers walk a beat around where people gather; their presence calms unrest. */
  private patrol(agent: Agent, simulation: Simulation): boolean {
    const hub =
      simulation.getWarehouse() ?? simulation.getChurch() ?? simulation.getKitchen();
    const center = hub
      ? { x: Math.round(hub.x + hub.width / 2), y: Math.round(hub.y + hub.height / 2) }
      : roundVec(simulation.villageCenter());
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = {
        x: center.x + Math.floor(Math.random() * (WANDER_RADIUS_TILES * 2 + 1)) - WANDER_RADIUS_TILES,
        y: center.y + Math.floor(Math.random() * (WANDER_RADIUS_TILES * 2 + 1)) - WANDER_RADIUS_TILES,
      };
      if (!simulation.world.isWalkable(candidate)) {
        continue;
      }
      const path = findPath(simulation.world, { start: agent.position, goal: candidate });
      if (path) {
        agent.target = candidate;
        agent.path = path;
        this.setState(agent, simulation, "Patrol");
        return true;
      }
    }
    return false;
  }

  private findCleanWork(agent: Agent, simulation: Simulation): boolean {
    const spot = simulation.nearestLitter(agent.position);
    if (!spot) {
      return false;
    }
    const path = findPath(simulation.world, { start: agent.position, goal: spot });
    if (!path) {
      return false;
    }
    agent.target = { ...spot };
    agent.path = path;
    this.setState(agent, simulation, "MoveToClean");
    return true;
  }

  private clean(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < CLEAN_DURATION_SECONDS) {
      return;
    }
    if (agent.target) {
      simulation.clearLitterAt(roundVec(agent.target));
    }
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
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
      simulation.world.setTile(agent.target, "Stump");
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
    // Before staking a fresh plot, join a household with room — including one
    // still being planned or built. Reached only when the resident has no plot
    // of their own yet, so this never cancels someone's in-progress home; it
    // just keeps a group of founders to a few shared homes instead of one each.
    const spare = simulation.findJoinableHousehold();
    if (spare && spare.id !== agent.homeBuildingId) {
      this.moveInto(agent, simulation, spare, "moved into shared housing");
      this.setState(agent, simulation, "Idle");
      return;
    }

    // Homes seek pleasant surroundings: drawn to parks/church, away from
    // cemeteries, power plants, fields and stumps. The town zones itself.
    const site = simulation.world.findBuildingSite(
      agent.position,
      2,
      2,
      (position) => simulation.isTileClaimed(position),
      { extraScore: (cx, cy) => simulation.ambianceAt({ x: cx, y: cy }) * AMBIANCE_SITING_WEIGHT },
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
    kind: Exclude<BuildingKind, "house">,
  ): boolean {
    const threeWide = new Set([
      "warehouse",
      "church",
      "pasture",
      "powerplant",
      "factory",
      "station",
      "cemetery",
    ]);
    const threeTall = new Set(["church", "pasture", "powerplant", "factory", "cemetery"]);
    const width = threeWide.has(kind) ? 3 : 2;
    const height = threeTall.has(kind) ? 3 : 2;
    // The cemetery is sited remotely (away from the village centre and housing);
    // everything else slots in near the builder, close to the village.
    const isClaimed = (position: Vec2) => simulation.isTileClaimed(position);
    const avoidsHomes = kind === "powerplant" || kind === "factory";
    const site =
      kind === "cemetery"
        ? simulation.world.findBuildingSite(
            roundVec(simulation.villageCenter()),
            width,
            height,
            isClaimed,
            { far: true, minDistance: 16 },
          )
        : simulation.world.findBuildingSite(agent.position, width, height, isClaimed, {
            // Power plants and factories are nuisances — steer them away from homes.
            extraScore: avoidsHomes
              ? (cx, cy) => -simulation.ambianceAt({ x: cx, y: cy }) * AMBIANCE_SITING_WEIGHT
              : undefined,
          });
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
    simulation.log(`${agent.name} is planning a village ${kind}.`);
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
      simulation.log(`${agent.name} finished their house.`, [agent]);
    } else {
      simulation.log(`${agent.name} built the village ${building.kind}!`, [agent]);
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

    // Fields prefer low-ambiance ground — they cluster together near existing
    // fields and steer clear of pleasant, residential areas.
    const site = world.findBuildingSite(
      agent.position,
      3,
      3,
      (position) =>
        simulation.isTileClaimed(position) ||
        simulation.hasHouseNear(position, FIELD_HOME_BUFFER),
      { extraScore: (cx, cy) => -simulation.ambianceAt({ x: cx, y: cy }) * AMBIANCE_SITING_WEIGHT },
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

  private findHuntWork(agent: Agent, simulation: Simulation): boolean {
    // Prefer taming peaceful animals when a pasture has room; otherwise hunt.
    const wantTame =
      Boolean(simulation.getPasture()) && simulation.tamedHerdSize() < PASTURE_HERD_CAP;

    let best: { id: string; pos: Vec2 } | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const animal of simulation.animals) {
      if (animal.state === "tamed") {
        continue;
      }
      const d = squaredDistance(agent.position, animal.position);
      if (d < bestDistance) {
        bestDistance = d;
        best = { id: animal.id, pos: { ...animal.position } };
      }
    }
    if (!best) {
      return false;
    }

    const path = findPath(simulation.world, {
      start: agent.position,
      goal: best.pos,
      stopAdjacent: true,
    });
    if (!path) {
      return false;
    }

    const animal = simulation.getAnimal(best.id);
    const willTame = wantTame && animal !== undefined && simulation.isTameable(animal.kind);
    agent.huntTargetId = best.id;
    agent.target = best.pos;
    agent.path = path;
    this.setState(agent, simulation, willTame ? "MoveToTame" : "MoveToHunt");
    return true;
  }

  /** Re-paths toward a moving animal; transitions to the action when adjacent. */
  private approachQuarry(
    agent: Agent,
    simulation: Simulation,
    deltaSeconds: number,
    action: AgentState,
  ) {
    const animal = agent.huntTargetId ? simulation.getAnimal(agent.huntTargetId) : undefined;
    if (!animal) {
      agent.huntTargetId = undefined;
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
      return;
    }

    if (distance(agent.position, animal.position) <= 1.5) {
      agent.path = undefined;
      this.setState(agent, simulation, action);
      return;
    }

    // Keep chasing: refresh the path toward the animal's current tile.
    if (!agent.path || agent.path.length === 0) {
      const path = findPath(simulation.world, {
        start: agent.position,
        goal: animal.position,
        stopAdjacent: true,
      });
      if (!path) {
        agent.huntTargetId = undefined;
        this.backOff(agent, simulation);
        return;
      }
      agent.target = { ...animal.position };
      agent.path = path;
    }
    this.moveAlongPath(agent, simulation, deltaSeconds, action);
  }

  private hunt(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const animal = agent.huntTargetId ? simulation.getAnimal(agent.huntTargetId) : undefined;
    if (!animal) {
      agent.huntTargetId = undefined;
      this.setState(agent, simulation, "Idle");
      return;
    }
    if (distance(agent.position, animal.position) > 1.6) {
      this.setState(agent, simulation, "MoveToHunt");
      return;
    }

    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < HUNT_DURATION_SECONDS) {
      return;
    }
    agent.actionTimer = 0;

    const kind = animal.kind;
    const felled = simulation.strikeAnimal(animal);
    if (felled) {
      simulation.log(`${agent.name} hunted a ${kind}. +${simulation.animalFoodValue(kind)} food 🏹`, [
        agent,
      ]);
      agent.huntTargetId = undefined;
      agent.target = undefined;
      this.setState(agent, simulation, "Idle");
    }
  }

  private tame(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const animal = agent.huntTargetId ? simulation.getAnimal(agent.huntTargetId) : undefined;
    if (!animal) {
      agent.huntTargetId = undefined;
      this.setState(agent, simulation, "Idle");
      return;
    }
    if (distance(agent.position, animal.position) > 1.6) {
      this.setState(agent, simulation, "MoveToTame");
      return;
    }

    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < TAME_DURATION_SECONDS) {
      return;
    }

    if (simulation.tameAnimal(animal)) {
      simulation.log(`${agent.name} tamed a ${animal.kind} for the pasture. 🐾`, [agent]);
    }
    agent.huntTargetId = undefined;
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private goWorship(agent: Agent, simulation: Simulation): boolean {
    const church = simulation.getChurch();
    if (!church) {
      return false;
    }
    const cx = church.x + church.width / 2;
    const cy = church.y + church.height / 2;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = {
        x: Math.round(cx) + Math.floor(Math.random() * (WORSHIP_RADIUS_TILES * 2 + 1)) -
          WORSHIP_RADIUS_TILES,
        y: Math.round(cy) + Math.floor(Math.random() * (WORSHIP_RADIUS_TILES * 2 + 1)) -
          WORSHIP_RADIUS_TILES,
      };
      if (!simulation.world.isWalkable(candidate)) {
        continue;
      }
      const path = findPath(simulation.world, { start: agent.position, goal: candidate });
      if (path) {
        agent.target = candidate;
        agent.path = path;
        this.setState(agent, simulation, "MoveToWorship");
        return true;
      }
    }
    return false;
  }

  private worship(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    if (agent.actionTimer === 0) {
      simulation.noteWorshipGathering();
    }
    agent.actionTimer += deltaSeconds;
    // During the morning service, stay for the full gathering; a personal visit
    // outside the service is a shorter private prayer. Either way faith refills
    // while in this state (see updateNeeds).
    const done = simulation.isWorshipMorning()
      ? agent.actionTimer > 40
      : agent.actionTimer >= PRAY_DURATION_SECONDS;
    if (done) {
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
    }
  }

  private findTransplantWork(agent: Agent, simulation: Simulation): boolean {
    const world = simulation.world;
    let best: Vec2 | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const tile of world.tiles) {
      if (tile.type !== "Stump" || simulation.isTileClaimed(tile)) {
        continue;
      }
      // Only relocate stumps that sit in developed areas (near paths/buildings).
      if (!this.stumpInTheWay(world, tile)) {
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

    const path = findPath(world, { start: agent.position, goal: best, stopAdjacent: true });
    if (!path) {
      return false;
    }

    simulation.claimTile(best);
    agent.target = best;
    agent.path = path;
    this.setState(agent, simulation, "MoveToStump");
    return true;
  }

  private transplantDig(agent: Agent, simulation: Simulation) {
    if (!agent.target) {
      this.setState(agent, simulation, "Idle");
      return;
    }
    const stump = roundVec(agent.target);
    simulation.releaseClaim(stump);
    if (simulation.world.getTile(stump)?.type === "Stump") {
      simulation.world.setTile(stump, "Grass");
    }

    // Find a clear spot a little away to replant the sapling.
    const plant = this.findPlantSpot(simulation, stump);
    if (!plant) {
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
      return;
    }

    const path = findPath(simulation.world, { start: agent.position, goal: plant, stopAdjacent: true });
    if (!path) {
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
      return;
    }
    simulation.claimTile(plant);
    agent.target = plant;
    agent.path = path;
    this.setState(agent, simulation, "MoveToPlant");
  }

  private plantTree(agent: Agent, simulation: Simulation) {
    if (agent.target) {
      const spot = roundVec(agent.target);
      simulation.releaseClaim(spot);
      if (simulation.world.getTile(spot)?.type === "Grass") {
        simulation.world.setTile(spot, "Tree");
        simulation.log(`${agent.name} transplanted a sapling to greener ground. 🌱`);
      }
    }
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  private findPlantSpot(simulation: Simulation, from: Vec2): Vec2 | undefined {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = TRANSPLANT_DISTANCE_TILES + Math.floor(Math.random() * 5);
      const candidate = {
        x: Math.round(from.x + Math.cos(angle) * radius),
        y: Math.round(from.y + Math.sin(angle) * radius),
      };
      const tile = simulation.world.getTile(candidate);
      if (
        tile?.type === "Grass" &&
        !simulation.isTileClaimed(candidate) &&
        !this.stumpInTheWay(simulation.world, candidate)
      ) {
        return candidate;
      }
    }
    return undefined;
  }

  private stumpInTheWay(world: Simulation["world"], position: Vec2): boolean {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const type = world.getTile({ x: position.x + dx, y: position.y + dy })?.type;
      if (
        type === "Road" ||
        type === "Dirt" ||
        type === "Plaza" ||
        type === "House" ||
        type === "FieldEmpty" ||
        type === "FieldGrowing" ||
        type === "FieldRipe"
      ) {
        return true;
      }
    }
    return false;
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
    if (mover.homeBuildingId && mover.homeBuildingId !== homeOwner.homeBuildingId) {
      const oldHouse = simulation.getBuilding(mover.homeBuildingId);
      if (oldHouse && oldHouse.ownerId === mover.id) {
        oldHouse.ownerId = undefined;
      }
    }
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
    simulation.log(`${a.name} and ${b.name} got married! 💍`, [a, b]);
  }

  /**
   * Under land pressure, homeless adults move into shared housing instead of
   * sprawling: fill a free slot in an existing villa/apartment, or densify a
   * central house (house -> villa -> apartment) and move in.
   */
  private tryHousing(agent: Agent, simulation: Simulation): boolean {
    const spare = simulation.findHouseWithSpareCapacity();
    if (spare) {
      this.moveInto(agent, simulation, spare, "moved into shared housing");
      return true;
    }

    if (!simulation.isLandTight()) {
      return false; // open land nearby — build a fresh house (sprawl).
    }

    const house = simulation.findDensifiableHouse();
    if (!house) {
      return false; // nothing left to densify — allow distant sprawl.
    }
    const cost = simulation.redevelopCost(house);
    if (agent.inventory.wood < cost) {
      this.setState(agent, simulation, "FindTree");
      return true;
    }
    agent.inventory.wood -= cost;
    simulation.levelUpHouse(house);
    this.moveInto(agent, simulation, house, "joined a denser household");
    return true;
  }

  private moveInto(agent: Agent, simulation: Simulation, house: Building, reason: string) {
    if (agent.projectBuildingId) {
      const pending = simulation.getBuilding(agent.projectBuildingId);
      if (pending && pending.stage !== "built" && pending.kind === "house") {
        simulation.cancelBuilding(pending);
      }
      agent.projectBuildingId = undefined;
    }
    if (!house.ownerId) {
      house.ownerId = agent.id;
    }
    agent.home = { ...house.door };
    agent.homeBuildingId = house.id;
    agent.homeSite = undefined;
    simulation.log(`${agent.name} ${reason}. 🏠`, [agent]);
  }

  /** Homeless adults move into a built house whose owner has passed away. */
  private tryClaimEmptyHouse(agent: Agent, simulation: Simulation): boolean {
    const empty = simulation.buildings.find(
      (building) =>
        building.kind === "house" &&
        building.stage === "built" &&
        (!building.ownerId ||
          !simulation.agents.some((other) => other.id === building.ownerId)),
    );
    if (!empty) {
      return false;
    }

    empty.ownerId = agent.id;
    agent.home = { ...empty.door };
    agent.homeBuildingId = empty.id;
    simulation.log(`${agent.name} moved into an empty house.`, [agent]);
    return true;
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

function clampNeed(value: number): number {
  return value < 0 ? 0 : value > 100 ? 100 : value;
}

function buildCost(kind: BuildingKind): number {
  if (kind === "warehouse") {
    return WAREHOUSE_WOOD_COST;
  }
  if (kind === "kitchen") {
    return KITCHEN_WOOD_COST;
  }
  if (kind === "church") {
    return CHURCH_WOOD_COST;
  }
  if (kind === "pasture") {
    return PASTURE_WOOD_COST;
  }
  if (kind === "powerplant") {
    return POWERPLANT_WOOD_COST;
  }
  if (kind === "factory") {
    return FACTORY_WOOD_COST;
  }
  if (kind === "station") {
    return STATION_WOOD_COST;
  }
  if (kind === "cemetery") {
    return CEMETERY_WOOD_COST;
  }
  if (kind === "park") {
    return PARK_WOOD_COST;
  }
  if (kind === "police") {
    return POLICE_WOOD_COST;
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
