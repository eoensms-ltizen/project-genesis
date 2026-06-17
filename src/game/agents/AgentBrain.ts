import type { Agent, AgentState, Building, BuildingKind, BuildPlanTile, ResourceKind, TileType, Vec2 } from "../types";
import { ROOM_BUILDING_KINDS } from "../types";
import type { Simulation } from "../Simulation";
import { ADULT_AGE, ELDER_AGE } from "../Simulation";
import { findPath, roundVec } from "../world/Pathfinder";
import { tr } from "../../i18n";

const MOVE_SPEED_TILES_PER_SECOND = 4.5;
const CHOP_DURATION_SECONDS = 1.8;
const PLAN_DURATION_SECONDS = 1.4;
const BUILD_DURATION_SECONDS = 6;
// Time to lay a single wall/floor/door tile by hand. A whole room is now raised
// one tile at a time, so this is short — the build "duration" emerges from the
// tile count and the walking between tiles.
const PER_TILE_BUILD_SECONDS = 0.45;
// Materials are paid as the work is done, not in one lump: the groundwork/floor
// when the foundation is laid, then each wall/door as it goes up. A builder
// carries a load of wood to site (up to what they can hold) and spends it tile
// by tile — only trekking back for more once their arms are empty.
const FOUNDATION_WOOD = 3;
const WALL_TILE_WOOD = 1;
const DOOR_TILE_WOOD = 2;
// Felling one tree yields this much wood — a tree is a meaningful haul, so fewer
// trees fall to raise a building (and the slow ~5-year regrowth bites less).
const WOOD_PER_TREE = 4;
const BUILD_CARRY_WOOD = 12; // a generic load a builder hauls to site at once
// A builder gathering for a known project fetches enough to finish it in one go,
// up to this cap — so they fell/haul a whole load at once and then lay many
// tiles, instead of a tree-per-wall. A 5×5 house needs ~21 wood.
const BUILD_LOAD_MAX = 30;

/** Wood a single plan tile costs to lay (floors are covered by the foundation). */
function tileWood(t: BuildPlanTile["t"]): number {
  return t === "Wall" ? WALL_TILE_WOOD : t === "Door" ? DOOR_TILE_WOOD : 0;
}
const EAT_DURATION_SECONDS = 1.5;
const IDLE_THINK_SECONDS = 0.4;
const SEARCH_FAIL_BACKOFF_SECONDS = 3;
const TARGET_CANDIDATE_LIMIT = 12;

const HOUSE_WOOD_COST = 11;
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
const SMELTER_WOOD_COST = 14;
// Each building budgets this much extra wood for its doorway(s).
const DOOR_WOOD_COST = 2;
const WORSHIP_RADIUS_TILES = 4;
const TRANSPLANT_DISTANCE_TILES = 6;
const HUNT_DURATION_SECONDS = 1.2;
const TAME_DURATION_SECONDS = 2.5;
const PASTURE_HERD_CAP = 6;
const WOOD_STOCKPILE_CAP = 10;
const WOODCUTTER_STOCKPILE_CAP = 14;
// A hamlet this size has no division of labour: everyone pitches in to gather
// wood (there's no crowd to over-fell), so a lone settler can provision
// themselves. Larger towns leave felling to woodcutters.
const SMALL_SETTLEMENT = 4;
// How much wood a hauler can carry in one trip from a forest pile to the warehouse.
const HAUL_CAPACITY = 12;
const LOAD_DURATION_SECONDS = 0.6;
const STORE_DURATION_SECONDS = 0.6;
const WITHDRAW_DURATION_SECONDS = 0.6;
// Breaking rock is slower than felling a tree.
const MINE_DURATION_SECONDS = 3;
// Keep at least this much wood on hand before turning idle effort to mining, so
// construction never starves but stone still gets gathered before wood is maxed.
const WOOD_RESERVE_FLOOR = 24;
// A pickaxe: crafted from stored wood + stone, it unlocks hard rock and ore.
const PICKAXE_WOOD_COST = 6;
const PICKAXE_STONE_COST = 10;
const CRAFT_DURATION_SECONDS = 3;
// A bed: built from wood inside one's home. Sleeping in a bed rests best.
const BED_WOOD_COST = 4;
const TABLE_WOOD_COST = 4;
// Once the warehouse holds at least this much wood, a resident sharing a communal
// house may spend the surplus annexing a private bedroom (privacy without
// starving the village of building material). Tuned above a house's full cost so
// expansion only happens from genuine surplus, never the last of the stores.
const PRIVATE_ROOM_WOOD_SURPLUS = 40;
const FURNISH_DURATION_SECONDS = 3;
const COOK_DURATION_SECONDS = 3;
const COOK_RAW_COST = 2;
const COOK_MEAL_YIELD = 2;
// Anyone can cook, but a non-cook works at this efficiency: slower and wasting
// some of the food (fewer meals from the same raw ingredients).
const NON_EXPERT_COOK_EFFICIENCY = 0.55;
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
// Night is no longer forced sleep: the well-rested may work or wander through
// the dark. But night toil drains stamina hard (NIGHT_STAMINA_FACTOR× the day
// rate for both passive activity and discrete labour), so once a resident dips
// below NIGHT_REST_STAMINA the dark pulls them to bed for the rest of the night.
const NIGHT_STAMINA_FACTOR = 3;
const NIGHT_REST_STAMINA = 55;
// Passive stamina cost per second while up and about (steeper at night).
const STAMINA_DRAIN_DAY = 0.06;
const STAMINA_DRAIN_NIGHT = 0.6;

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
  "MoveToHaul",
  "MoveToStore",
  "MoveToWithdraw",
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
// Living among a few close neighbours is cosy (a hamlet); being hemmed in by a
// crush of them is not. A small cluster lifts comfort, a large one drains it.
const HOUSE_CLUSTER_RADIUS = 2.6;
const CLUSTER_COSY_CAP = 3; // neighbours up to here feel neighbourly
const CLUSTER_CROWDED = 5; // neighbours past here start to grate
const COMFORT_CLUSTER_RATE = 0.02;
// How strongly the surrounding ambiance pushes comfort up (amenities) or down
// (nuisances) per second, and how much it sways where things get built.
const AMBIANCE_COMFORT_RATE = 0.005;
// A home wants at least this many interior tiles per resident to feel roomy; a
// 3x3 (9-tile) interior comfortably houses one. Falling short drains comfort.
const ROOMY_AREA_PER_RESIDENT = 6;
const CRAMP_COMFORT_RATE = 0.012;
const AMBIANCE_SITING_WEIGHT = 1.5;
// A soft need must reach this urgency to pull an adult away from work.
const NEED_ACT_THRESHOLD = 55;

// Mood (0..100): a smoothed aggregate of needs and circumstances. It eases
// toward a target each tick; when it sinks low a resident grows despondent and
// downs tools for a moment. Mood's grip tightens as the colony develops — early
// on survival crowds it out, later quality of life starts to bite.
const MOOD_EASE_PER_SECOND = 0.2;
const MOOD_BREAK_THRESHOLD = 30;
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
  "MoveToClean",
  "Clean",
  "Patrol",
  "MoveToHaul",
  "LoadWood",
  "MoveToStore",
  "StoreWood",
  "MoveToWithdraw",
  "WithdrawWood",
  "MoveToMine",
  "Mine",
  "MoveToCraft",
  "CraftTool",
  "MoveToFurnish",
  "Furnish",
]);

export class AgentBrain {
  update(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const hungerRate = agent.state === "Sleep" ? 0.12 : 0.35;
    agent.health.hunger = Math.min(100, agent.health.hunger + deltaSeconds * hungerRate);
    // Being up and about costs stamina — far more so at night (see the night
    // rules above). Sleeping and resting recover it, so they don't pay this.
    const recovering = agent.state === "Sleep" || agent.state === "Rest";
    const drainRate = !recovering && simulation.isNight() ? STAMINA_DRAIN_NIGHT : STAMINA_DRAIN_DAY;
    agent.health.stamina = Math.max(0, agent.health.stamina - deltaSeconds * drainRate);

    if (agent.health.stamina < 12 && agent.state !== "Rest" && agent.state !== "Sleep") {
      this.abandonTask(agent, simulation);
      // Running on empty after dark: turn in for the night rather than catnap.
      if (simulation.isNight()) {
        this.goSleep(agent, simulation);
      } else {
        this.setState(agent, simulation, "Rest");
      }
    }

    agent.socialCooldown = Math.max(0, (agent.socialCooldown ?? 15) - deltaSeconds);
    if (agent.socialCooldown === 0 && CHATTABLE_STATES.has(agent.state)) {
      this.tryStartChat(agent, simulation);
    }

    this.updateNeeds(agent, simulation, deltaSeconds);
    this.updateMood(agent, simulation, deltaSeconds);

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
        // A walled room only needs the groundwork material to break ground (the
        // rest is paid wall by wall); an open space still pays its lump cost.
        const needed =
          building && ROOM_BUILDING_KINDS.has(building.kind)
            ? FOUNDATION_WOOD
            : building
              ? buildCost(building.kind)
              : FOUNDATION_WOOD;
        const targetTile = agent.target
          ? simulation.world.getTile(roundVec(agent.target))
          : undefined;
        // A build already under way (foundation laid) → join in placing tiles.
        // Otherwise stake the plot first, unless we've arrived on a staked site
        // with enough wood in hand to break ground right away.
        const arrival: AgentState =
          building?.stage === "foundation"
            ? "BuildHouse"
            : (targetTile?.type === "HouseSite" || targetTile?.type === "HouseFoundation") &&
                agent.inventory.wood >= needed
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
      case "MoveToHaul":
        this.moveAlongPath(agent, simulation, deltaSeconds, "LoadWood");
        break;
      case "LoadWood":
        this.loadWood(agent, simulation, deltaSeconds);
        break;
      case "MoveToStore":
        this.moveAlongPath(agent, simulation, deltaSeconds, "StoreWood");
        break;
      case "StoreWood":
        this.storeWood(agent, simulation, deltaSeconds);
        break;
      case "MoveToWithdraw":
        this.moveAlongPath(agent, simulation, deltaSeconds, "WithdrawWood");
        break;
      case "WithdrawWood":
        this.withdrawWood(agent, simulation, deltaSeconds);
        break;
      case "MoveToMine":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Mine");
        break;
      case "Mine":
        this.mine(agent, simulation, deltaSeconds);
        break;
      case "MoveToCraft":
        this.moveAlongPath(agent, simulation, deltaSeconds, "CraftTool");
        break;
      case "CraftTool":
        this.craftPickaxe(agent, simulation, deltaSeconds);
        break;
      case "MoveToFurnish":
        this.moveAlongPath(agent, simulation, deltaSeconds, "Furnish");
        break;
      case "Furnish":
        this.furnish(agent, simulation, deltaSeconds);
        break;
      case "MoveToBuildTile":
        this.moveAlongPath(agent, simulation, deltaSeconds, "BuildTile");
        break;
      case "BuildTile":
        this.buildTile(agent, simulation, deltaSeconds);
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
    // Acute survival is structural. Night no longer forces sleep outright: a
    // resident with stamina to spare may keep working or wander the dark (it just
    // drains them fast). Once they tire past NIGHT_REST_STAMINA, the night sends
    // them to bed — and sleep runs until dawn.
    if (simulation.isNight() && agent.health.stamina < NIGHT_REST_STAMINA) {
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
      // A slot was claimed earlier and the shelter is now finished — move in.
      if (agent.homeBuildingId) {
        const claimed = simulation.getBuilding(agent.homeBuildingId);
        if (claimed && claimed.kind === "house" && claimed.stage === "built") {
          agent.home = simulation.houseInterior(claimed);
          agent.homeSite = undefined;
          return;
        }
        if (!claimed) {
          agent.homeBuildingId = undefined;
        }
      }
      // Already breaking ground on a home (their own site or a shared shelter):
      // keep laying tiles rather than re-deciding where to live each time a meal
      // or nightfall interrupts the build.
      if (agent.projectBuildingId) {
        const proj = simulation.getBuilding(agent.projectBuildingId);
        if (proj && proj.stage !== "built") {
          if (proj.stage === "foundation") {
            this.setState(agent, simulation, "BuildHouse");
            return;
          }
          if (this.fetchWood(agent, simulation, BUILD_CARRY_WOOD)) {
            return;
          }
          this.headToProject(agent, simulation, proj.door);
          return;
        }
        agent.projectBuildingId = undefined;
      }
      if (this.tryClaimEmptyHouse(agent, simulation)) {
        return;
      }
      if (this.tryHousing(agent, simulation)) {
        return;
      }
      // Don't sprawl into a private hut: if a shelter is already going up with
      // room to spare, claim a bunk there and help raise it (communal living
      // first; private rooms come later when materials allow).
      if (this.tryJoinSharedShelter(agent, simulation)) {
        return;
      }
      if (!agent.homeSite) {
        this.setState(agent, simulation, "FindHouseSite");
        return;
      }
      // Carry a load of wood to site, then start laying the groundwork.
      if (this.fetchWood(agent, simulation, BUILD_CARRY_WOOD)) {
        return;
      }
      this.headToHomeSite(agent, simulation);
      return;
    }

    // A grown, unmarried adult leaves an overcrowded family home to start a
    // place of their own nearby — this is how the town spreads into a cluster
    // of homes instead of cramming everyone into a few.
    if (this.shouldMoveOut(agent, simulation)) {
      agent.home = undefined;
      agent.homeBuildingId = undefined;
      agent.homeSite = undefined;
      simulation.log(tr(`${agent.name} moved out to find a place of their own. 🧳`, `${agent.name}이(가) 자기만의 보금자리를 찾아 독립했다. 🧳`), [agent]);
      return;
    }

    // Resume an unfinished construction project (e.g., a civic build, or after
    // loading a save). A foundation already laid → carry on placing its tiles.
    if (agent.projectBuildingId) {
      const building = simulation.getBuilding(agent.projectBuildingId);
      if (building && building.stage !== "built") {
        if (building.stage === "foundation") {
          this.setState(agent, simulation, "BuildHouse");
          return;
        }
        if (this.fetchWood(agent, simulation, BUILD_CARRY_WOOD)) {
          return;
        }
        this.headToProject(agent, simulation, building.door);
        return;
      }
      agent.projectBuildingId = undefined;
    }

    // A despondent resident may down tools and wander before any work begins
    // (but only once fed, rested and housed — survival came first above).
    if (this.maybeMoodBreak(agent, simulation)) {
      return;
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
    // Socialising is only actionable when there's actually someone else to meet.
    // A lone settler can't satisfy it, so it must not crowd out the work and
    // provisioning that keep them alive — otherwise they wander forever seeking
    // company that doesn't exist.
    if (social >= NEED_ACT_THRESHOLD && this.hasCompany(agent, simulation)) {
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
          this.maybeLog(simulation, tr(`${agent.name} went looking for company.`, `${agent.name}이(가) 어울릴 사람을 찾아 나섰다.`));
          return true;
        }
        return false;
      case "leisure":
        this.wanderNearHome(agent, simulation);
        this.maybeLog(simulation, tr(`${agent.name} wandered off to take in the village.`, `${agent.name}이(가) 마을을 둘러보러 거닐었다.`));
        return true;
      case "comfort":
        // Only actionable if a park exists; otherwise the unmet need shows up as
        // low wellbeing and prompts builders to lay one out (see communalProject).
        if (this.goRelax(agent, simulation)) {
          this.maybeLog(simulation, tr(`${agent.name} went to the park for some air.`, `${agent.name}이(가) 바람을 쐬러 공원에 갔다.`));
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
    // Provisioning is need-driven from the very first resident, not gated on
    // reaching a later era: raise a warehouse to stockpile goods, then farm to
    // keep the larder full so hunger is met from stores rather than foraging.
    // communalProject builds the warehouse (and a kitchen once there's food);
    // its advanced civic buildings remain gated by their own era checks inside.
    const communal = this.communalProject(agent, simulation);
    if (communal === "started") {
      return true;
    }
    // Set up one's own bed early: it's a quick, one-time comfort (each resident
    // builds a single bed), so it comes before endless farming and before pitching
    // in on neighbours' builds — otherwise it never gets a turn and folk sleep on
    // the floor forever.
    if (this.tryBuildBed(agent, simulation)) {
      return true;
    }
    // Farm whenever the food stores sit below target — a standing guard against
    // hunger that a lone settler tends to before idling.
    if (this.findFarmWork(agent, simulation)) {
      return true;
    }
    // Cook raw food into meals once there's a stove — anyone may, though a
    // non-cook does it slowly and wastefully (see cookEfficiency).
    if (this.tryCook(agent, simulation)) {
      return true;
    }
    // A dining table once the bed's in and food is handled — a further comfort.
    if (this.tryBuildTable(agent, simulation)) {
      return true;
    }
    // Sharing a communal house grates once there's wood to spare: annex a private
    // bedroom onto it (sharing a wall), then move your bed in — privacy emerges
    // from crowding + surplus, no player drawing required.
    if (this.tryBuildPrivateRoom(agent, simulation)) {
      return true;
    }
    // Spare hands pitch in on a neighbour's half-built room — a barn-raising — but
    // only after one's own provisioning and bed are seen to, so helping never
    // starves the basics (this used to run first and nothing else got done).
    if (this.tryHelpBuild(agent, simulation)) {
      return true;
    }
    // Specialists ply their trade once the town is organised enough to assign jobs.
    if (simulation.era >= 1 && this.doJobWork(agent, simulation)) {
      return true;
    }

    // Keep the wood economy flowing. Once there's a warehouse, anyone with idle
    // hands hauls loose piles into it; felling fresh timber is left to woodcutters
    // in a busy town (so a crowd doesn't bury the forest in logs), but in a small
    // hamlet everyone fells to stockpile materials. Builders still fell on demand
    // via fetchWood when the warehouse runs dry, so construction never stalls.
    if (simulation.hasAnyWarehouse()) {
      if (this.findHaulWork(agent, simulation)) {
        return true;
      }
      const mayGather =
        agent.job === "woodcutter" || simulation.agents.length <= SMALL_SETTLEMENT;
      if (mayGather) {
        const woodSupply = simulation.stockOf("wood") + simulation.groundTotal("wood");
        // Urgent wood first; once a working reserve exists, mine soft rock for a
        // stone reserve, then keep topping wood toward its target.
        if (woodSupply < WOOD_RESERVE_FLOOR && simulation.wantsMoreWood()) {
          this.setState(agent, simulation, "FindTree");
          return true;
        }
        // Make a pickaxe once there's a stone reserve and hard rock to use it on.
        if (this.tryCraftPickaxe(agent, simulation)) {
          return true;
        }
        if (this.findMineWork(agent, simulation)) {
          return true;
        }
        if (simulation.wantsMoreWood()) {
          this.setState(agent, simulation, "FindTree");
          return true;
        }
      }
    } else {
      const woodCap = agent.job === "woodcutter" ? WOODCUTTER_STOCKPILE_CAP : WOOD_STOCKPILE_CAP;
      if (agent.inventory.wood < woodCap) {
        this.setState(agent, simulation, "FindTree");
        return true;
      }
    }

    if (simulation.era >= 2 && this.findPaveWork(agent, simulation)) {
      return true;
    }

    return false;
  }

  /**
   * A single grown-up strikes out on their own when their home is overcrowded —
   * houses no longer grow taller, so the settlement spreads into a new home (a
   * hamlet of houses) rather than packing more in.
   */
  private shouldMoveOut(agent: Agent, simulation: Simulation): boolean {
    if (agent.spouseId || !agent.homeBuildingId) {
      return false;
    }
    // Don't abandon a home mid-annex: finish the private bedroom first.
    if (agent.projectBuildingId) {
      const proj = simulation.getBuilding(agent.projectBuildingId);
      if (proj?.kind === "bedroom" && proj.stage !== "built") {
        return false;
      }
    }
    const home = simulation.getBuilding(agent.homeBuildingId);
    if (!home || home.kind !== "house" || home.ownerId === agent.id) {
      return false;
    }
    // Move out only once the home is genuinely overcrowded.
    return simulation.occupantsOf(home.id) > simulation.houseCapacity(home);
  }

  /** Lifestage idle for children and elders: company if lonely, else a stroll. */
  private liveByLeisure(agent: Agent, simulation: Simulation) {
    const social = (100 - agent.needs.social) * (0.6 + agent.personality.sociability);
    if (
      social >= NEED_ACT_THRESHOLD &&
      this.hasCompany(agent, simulation) &&
      this.seekCompany(agent, simulation)
    ) {
      return;
    }
    this.wanderNearHome(agent, simulation);
  }

  /** Is there anyone else around to socialise with? A hermit gives up on company. */
  private hasCompany(agent: Agent, simulation: Simulation): boolean {
    return simulation.agents.some((other) => other.id !== agent.id);
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
    // Comfort shifts with the home's surroundings and how it clusters with
    // neighbours: pleasant amenities soothe, nuisances grate; a small cluster of
    // homes is cosy, an overpacked one is oppressive.
    const anchor = agent.home ?? roundVec(agent.position);
    const neighbours = simulation.localHouseDensity(anchor, HOUSE_CLUSTER_RADIUS);
    const cluster =
      Math.min(neighbours, CLUSTER_COSY_CAP) - Math.max(0, neighbours - CLUSTER_CROWDED);
    const ambiance = simulation.ambianceAt(anchor);
    // An overcrowded home (more residents than it can comfortably hold) grates too.
    const home = agent.homeBuildingId ? simulation.getBuilding(agent.homeBuildingId) : undefined;
    const overcrowd =
      home && home.kind === "house"
        ? Math.max(0, simulation.occupantsOf(home.id) - simulation.houseCapacity(home))
        : 0;
    // A furnished home (bed, dining table) is cosier — room quality lifts comfort.
    const furniture =
      home && home.kind === "house" ? simulation.homeFurnitureComfort(home) : 0;
    // A cramped home grates: too little interior space per resident feels stuffy,
    // which nudges the colony toward roomier homes.
    let cramp = 0;
    if (home && home.kind === "house") {
      const area = simulation.interiorTiles(home).length;
      const occupants = Math.max(1, simulation.occupantsOf(home.id));
      cramp = Math.max(0, ROOMY_AREA_PER_RESIDENT - area / occupants);
    }
    n.comfort = clampNeed(
      n.comfort -
        deltaSeconds * (NEED_DECAY.comfort + overcrowd * 0.03 + cramp * CRAMP_COMFORT_RATE) +
        deltaSeconds * ambiance * AMBIANCE_COMFORT_RATE +
        deltaSeconds * cluster * COMFORT_CLUSTER_RATE +
        deltaSeconds * furniture,
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

  /** Ease mood toward a target blended from the resident's needs and survival. */
  private updateMood(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const n = agent.needs;
    let target = 50;
    target += (n.comfort - 50) * 0.35;
    target += (n.social - 50) * 0.2;
    target += (n.leisure - 50) * 0.15;
    target += (n.purpose - 50) * 0.1;
    if (simulation.getChurch()) {
      target += (n.faith - 50) * 0.1;
    }
    // Acute survival pressure weighs heavily on the heart.
    if (agent.health.hunger >= HUNGER_SEEK_THRESHOLD) {
      target -= 18;
    }
    if (agent.health.stamina < STAMINA_EXHAUSTED) {
      target -= 14;
    }
    target = clampNeed(target);
    const current = agent.mood ?? 60;
    agent.mood = current + (target - current) * Math.min(1, deltaSeconds * MOOD_EASE_PER_SECOND);
  }

  /** How strongly mood bites: negligible in a struggling young settlement, full in a developed one. */
  private moodImpact(simulation: Simulation): number {
    return Math.min(1, 0.15 + simulation.era * 0.22);
  }

  /**
   * When mood sinks, a resident grows despondent and downs tools for a moment —
   * a stroll to clear their head. More likely the unhappier they are and the more
   * developed the colony (where comfort is expected).
   */
  private maybeMoodBreak(agent: Agent, simulation: Simulation): boolean {
    const mood = agent.mood ?? 60;
    if (mood >= MOOD_BREAK_THRESHOLD) {
      return false;
    }
    const severity = (MOOD_BREAK_THRESHOLD - mood) / MOOD_BREAK_THRESHOLD; // 0..1
    // Kept modest so even a miserable resident still works between breaks.
    if (Math.random() >= severity * this.moodImpact(simulation) * 0.22) {
      return false;
    }
    this.wanderNearHome(agent, simulation);
    this.maybeLog(simulation, tr(`${agent.name} is downhearted and stepped away from work.`, `${agent.name}이(가) 낙담해 잠시 일손을 놓았다.`));
    return true;
  }

  /**
   * Returns "started" when the agent took on a communal building project (or
   * went to fetch the wood for one), "none" otherwise.
   */
  private communalProject(
    agent: Agent,
    simulation: Simulation,
  ): "started" | "none" {
    let kind:
      | "warehouse"
      | "kitchen"
      | "church"
      | "pasture"
      | "powerplant"
      | "factory"
      | "station"
      | "cemetery"
      | "police"
      | "smelter"
      | undefined;
    if (!simulation.hasAnyWarehouse()) {
      kind = "warehouse";
    } else if (simulation.needsCemetery()) {
      // The dead must be laid to rest — built far from where people live.
      kind = "cemetery";
    } else if (simulation.needsPoliceStation()) {
      // A restless town builds a police station to keep the peace.
      kind = "police";
    } else if (
      // Iron ore on hand and no smelter yet — build one to forge it into steel.
      // Material-driven, not era-gated: mastering iron is its own milestone.
      !simulation.hasAnySmelter() &&
      simulation.hasMiningTools &&
      simulation.stockOf("ironOre") > 0
    ) {
      kind = "smelter";
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
      this.fetchWood(agent, simulation, cost);
      return "started";
    }
    return this.startCommunalBuilding(agent, simulation, kind) ? "started" : "none";
  }

  /**
   * Pitch in on a nearby half-built room that still needs hands — a barn-raising.
   * Several residents converging on one site (each grabbing a different tile via
   * the plan's reservation) raise it far faster than one builder alone. Capped per
   * building by how much is left, so a tiny room isn't swarmed. The helper keeps
   * their own home; only true residents move in when it's done.
   */
  private tryHelpBuild(agent: Agent, simulation: Simulation): boolean {
    if (agent.projectBuildingId) {
      return false; // already committed to a build
    }
    let best: Building | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const b of simulation.buildings) {
      // Help once the groundwork is down (a plan exists); skip un-staked sites.
      if (b.stage !== "foundation" || !ROOM_BUILDING_KINDS.has(b.kind) || !b.plan) {
        continue;
      }
      const undone = b.plan.filter((t) => !t.done);
      // Every remaining tile already spoken for — no use crowding in.
      if (undone.length === 0 || undone.every((t) => t.claimedBy)) {
        continue;
      }
      const builders = simulation.agents.filter((a) => a.projectBuildingId === b.id).length;
      // One extra pair of hands per ~3 tiles left, up to four on a big build.
      const cap = Math.max(1, Math.min(4, Math.ceil(undone.length / 3)));
      if (builders >= cap) {
        continue;
      }
      const d = Math.abs(b.x - agent.position.x) + Math.abs(b.y - agent.position.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = b;
      }
    }
    if (!best) {
      return false;
    }
    agent.projectBuildingId = best.id;
    simulation.log(tr(`${agent.name} pitched in on the build. 🔨`, `${agent.name}이(가) 건축을 거들기 시작했다. 🔨`));
    const load = this.buildLoadTarget(best, simulation);
    if (this.fetchWood(agent, simulation, load)) {
      return true;
    }
    // The build is at foundation stage, so BuildHouse drives the per-tile walk
    // from wherever the helper stands — no need to route to a door first.
    this.setState(agent, simulation, "BuildHouse");
    return true;
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
      case "hauler":
        // Ferry felled wood from the forest into the warehouse.
        return this.findHaulWork(agent, simulation);
      case "hunter":
        return this.findHuntWork(agent, simulation);
      case "cleaner":
        return this.findCleanWork(agent, simulation) || this.findFarmWork(agent, simulation);
      case "police":
        return this.patrol(agent, simulation);
      case "mayor":
        // The mayor surveys the town on foot; their oversight is what lets the
        // planned roads, plaza and parks happen (see the gated planners).
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
      simulation.log(tr(`${agent.name} could not reach a tree.`, `${agent.name}이(가) 나무에 닿지 못했다.`));
      this.backOff(agent, simulation);
      return;
    }

    simulation.claimTile(route.target);
    agent.target = route.target;
    agent.path = route.path;
    simulation.log(tr(`${agent.name} found a tree.`, `${agent.name}이(가) 나무를 찾았다.`));
    this.setState(agent, simulation, "MoveToTree");
  }

  private chopTree(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < CHOP_DURATION_SECONDS) {
      return;
    }

    const stump = agent.target ? roundVec(agent.target) : undefined;
    if (agent.target) {
      simulation.world.setTile(agent.target, "Stump");
      simulation.releaseClaim(agent.target);
    }
    agent.health.stamina = Math.max(0, agent.health.stamina - 8 * this.nightFactor(simulation));
    // A builder felling to supply their own project (gatherWood set) keeps the
    // log in hand and fells again until they're holding a whole load — so they
    // arrive with enough wood to lay many tiles, not a tree-per-wall.
    if (agent.gatherWood !== undefined) {
      agent.inventory.wood += WOOD_PER_TREE;
      simulation.log(tr(`${agent.name} chopped wood. +${WOOD_PER_TREE} wood`, `${agent.name}이(가) 나무를 베었다. +나무 ${WOOD_PER_TREE}`));
      agent.target = undefined;
      agent.path = undefined;
      if (agent.inventory.wood < agent.gatherWood) {
        // Still short of the load — go fell the next tree right away.
        this.setState(agent, simulation, "FindTree");
      } else {
        agent.gatherWood = undefined; // load gathered — back to building
        this.setState(agent, simulation, "Idle");
      }
      return;
    }
    // Before there's a warehouse, the feller carries the log themselves (it goes
    // straight into the first homes). Once a warehouse exists, the log is left as
    // a pile on the ground for a hauler to carry in — the producer keeps felling.
    if (stump && simulation.hasAnyWarehouse()) {
      simulation.dropWood(stump, WOOD_PER_TREE);
      simulation.log(tr(`${agent.name} felled a tree, leaving the logs to be hauled. 🪵`, `${agent.name}이(가) 나무를 베어 통나무를 운반용으로 남겼다. 🪵`));
    } else {
      agent.inventory.wood += WOOD_PER_TREE;
      simulation.log(tr(`${agent.name} chopped wood. +${WOOD_PER_TREE} wood`, `${agent.name}이(가) 나무를 베었다. +나무 ${WOOD_PER_TREE}`));
    }
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  // --- Physical wood hauling ------------------------------------------------

  /**
   * Ensures the agent will end up holding at least `cost` wood before building.
   * Returns true if it put the agent on a sub-task (fetching) — the caller should
   * stop; the build resumes from Idle once the wood is in hand. Returns false
   * when the agent already carries enough (proceed to build).
   *
   * Before a warehouse exists this is simply "go chop". Once one does, the wood
   * economy runs through the warehouse: withdraw if it's stocked, otherwise top
   * it up by hauling a loose pile or felling a fresh tree.
   */
  private fetchWood(agent: Agent, simulation: Simulation, cost: number): boolean {
    if (agent.inventory.wood >= cost) {
      return false;
    }
    if (!simulation.hasAnyWarehouse()) {
      agent.gatherWood = cost;
      this.setState(agent, simulation, "FindTree");
      return true;
    }
    const need = cost - agent.inventory.wood;
    const warehouse = simulation.getWarehouse();
    if (warehouse && simulation.stockOf("wood") >= need) {
      const path = findPath(simulation.world, { start: agent.position, goal: warehouse.door });
      if (path) {
        agent.fetchAmount = need;
        agent.target = { ...warehouse.door };
        agent.path = path;
        this.setState(agent, simulation, "MoveToWithdraw");
        return true;
      }
    }
    // The warehouse can't cover it: top it up. Haul a loose wood pile if there is
    // one, otherwise fell fresh trees. We're felling specifically to supply this
    // errand, so carry the logs and keep chopping until we hold `cost` (a whole
    // load) — not a tree, a wall, a tree, a wall.
    if (simulation.hasHaulable("wood") && this.findHaulWork(agent, simulation, "wood")) {
      return true;
    }
    agent.gatherWood = cost;
    this.setState(agent, simulation, "FindTree");
    return true;
  }

  /**
   * Claim the nearest loose pile that the warehouse still has room for and set
   * off to carry it in. Pass a resource to haul only that material (e.g. a
   * builder topping up wood); omit it to haul whatever is nearest.
   */
  private findHaulWork(agent: Agent, simulation: Simulation, resource?: ResourceKind): boolean {
    const warehouse = simulation.getWarehouse();
    if (!warehouse) {
      return false;
    }
    let best: { id: string; position: Vec2 } | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const stack of simulation.items) {
      if (stack.amount <= 0 || (resource && stack.resource !== resource)) {
        continue;
      }
      if (stack.reservedBy && stack.reservedBy !== agent.id) {
        continue;
      }
      // Goods already in the stockpile are stored — don't re-haul them.
      if (simulation.isInStockpile(stack.position)) {
        continue;
      }
      if (simulation.storeSpaceFor(stack.resource) <= 0) {
        continue;
      }
      const d = squaredDistance(agent.position, stack.position);
      if (d < bestDistance) {
        bestDistance = d;
        best = { id: stack.id, position: stack.position };
      }
    }
    if (!best) {
      return false;
    }
    const path = findPath(simulation.world, {
      start: agent.position,
      goal: best.position,
      stopAdjacent: true,
    });
    if (!path) {
      return false;
    }
    simulation.reserveItem(best.id, agent.id);
    agent.haulItemId = best.id;
    agent.target = { ...best.position };
    agent.path = path;
    this.setState(agent, simulation, "MoveToHaul");
    return true;
  }

  /** Arrived at the pile: scoop a load into one's arms, then head off to store it. */
  private loadWood(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < LOAD_DURATION_SECONDS) {
      return;
    }
    const stack = agent.haulItemId ? simulation.getItem(agent.haulItemId) : undefined;
    if (!stack || stack.amount <= 0) {
      // The pile vanished (someone else hauled it); give up and rethink.
      if (agent.haulItemId) {
        simulation.releaseItem(agent.haulItemId);
      }
      agent.haulItemId = undefined;
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
      return;
    }
    const taken = Math.min(stack.amount, HAUL_CAPACITY);
    agent.carry = { resource: stack.resource, amount: taken };
    stack.amount -= taken;
    if (stack.amount <= 0) {
      simulation.removeItem(stack.id);
    } else {
      simulation.releaseItem(stack.id);
    }
    agent.haulItemId = undefined;

    const warehouse = simulation.getWarehouse();
    if (!warehouse) {
      this.dropCarry(agent, simulation);
      this.backOff(agent, simulation);
      return;
    }
    const path = findPath(simulation.world, { start: agent.position, goal: warehouse.door });
    if (!path) {
      this.backOff(agent, simulation);
      return;
    }
    agent.target = { ...warehouse.door };
    agent.path = path;
    this.setState(agent, simulation, "MoveToStore");
  }

  /** Arrived at the warehouse with a load: deposit it into the stock. */
  private storeWood(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < STORE_DURATION_SECONDS) {
      return;
    }
    if (agent.carry && agent.carry.amount > 0) {
      const { resource } = agent.carry;
      const stored = simulation.store(resource, agent.carry.amount);
      agent.carry.amount -= stored;
      // Anything that didn't fit is set back down at the warehouse door.
      this.dropCarry(agent, simulation);
      if (stored > 0 && Math.random() < 0.4) {
        simulation.log(
          tr(
            `${agent.name} stocked ${stored} ${resource} in the warehouse.`,
            `${agent.name}이(가) 창고에 ${resourceNameKo(resource)} ${stored}을(를) 채워 넣었다.`,
          ),
        );
      }
    }
    agent.carry = undefined;
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  /** Set a carried load back down on the ground (e.g. nowhere to store it). */
  private dropCarry(agent: Agent, simulation: Simulation) {
    if (agent.carry && agent.carry.amount > 0) {
      simulation.dropItem(agent.position, agent.carry.resource, agent.carry.amount);
    }
    agent.carry = undefined;
  }

  /**
   * Head out to mine rock for stone (or ore, once tools exist). Picks the
   * nearest workable rock; if the only rock nearby is too hard to mine without
   * tools, it notes that the colony needs better tools and gives up for now.
   */
  private findMineWork(agent: Agent, simulation: Simulation): boolean {
    const wantStone = simulation.wantsMore("stone");
    const wantOre = simulation.hasMiningTools && simulation.wantsMore("ironOre");
    if (!wantStone && !wantOre) {
      return false;
    }
    let best: Vec2 | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    let blockedByTools = false;
    for (const tile of simulation.world.tiles) {
      if (!simulation.isRockTile(tile.type) || simulation.isTileClaimed(tile)) {
        continue;
      }
      const yielded = simulation.mineYield(tile.type);
      if (yielded.resource === "stone" && !wantStone) {
        continue;
      }
      if (yielded.resource === "ironOre" && !wantOre) {
        continue;
      }
      if (!simulation.canMineRock(tile.type)) {
        blockedByTools = true;
        continue;
      }
      const d = squaredDistance(agent.position, tile);
      if (d < bestDistance) {
        bestDistance = d;
        best = { x: tile.x, y: tile.y };
      }
    }
    if (!best) {
      if (blockedByTools) {
        simulation.noteNeedsMiningTools();
      }
      return false;
    }
    const path = findPath(simulation.world, {
      start: agent.position,
      goal: best,
      stopAdjacent: true,
    });
    if (!path) {
      return false;
    }
    simulation.claimTile(best);
    agent.target = best;
    agent.path = path;
    this.setState(agent, simulation, "MoveToMine");
    return true;
  }

  private mine(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < MINE_DURATION_SECONDS) {
      return;
    }
    if (agent.target) {
      const pos = roundVec(agent.target);
      simulation.releaseClaim(pos);
      const tile = simulation.world.getTile(pos);
      if (tile && simulation.isRockTile(tile.type)) {
        const yielded = simulation.mineYield(tile.type);
        simulation.world.setTile(pos, "RockFloor");
        simulation.dropItem(pos, yielded.resource, yielded.amount);
        simulation.log(
          tr(
            `${agent.name} mined ${yielded.amount} ${yielded.resource}. ⛏️`,
            `${agent.name}이(가) ${resourceNameKo(yielded.resource)} ${yielded.amount}을(를) 캤다. ⛏️`,
          ),
        );
      }
    }
    agent.health.stamina = Math.max(0, agent.health.stamina - 8 * this.nightFactor(simulation));
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  /** Arrived at the warehouse to fetch materials: draw them into one's arms. */
  private withdrawWood(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < WITHDRAW_DURATION_SECONDS) {
      return;
    }
    const want = agent.fetchAmount ?? 0;
    if (want > 0) {
      agent.inventory.wood += simulation.withdrawWood(want);
    }
    agent.fetchAmount = undefined;
    agent.target = undefined;
    agent.path = undefined;
    // Back to Idle: decideNextAction resumes the build now the wood is in hand.
    this.setState(agent, simulation, "Idle");
  }

  /**
   * Once the colony has worked enough soft stone and there's hard rock or ore
   * around to justify it, a resident fashions a pickaxe from stored wood + stone
   * at the warehouse — unlocking granite and iron-ore mining. Tools beget access
   * to tougher materials: the engine of material progress.
   */
  private tryCraftPickaxe(agent: Agent, simulation: Simulation): boolean {
    if (simulation.hasMiningTools || simulation.pickaxeInProgress) {
      return false;
    }
    const warehouse = simulation.getWarehouse();
    if (!warehouse || !simulation.hasToolGatedRock()) {
      return false;
    }
    if (
      simulation.stockOf("stone") < PICKAXE_STONE_COST ||
      simulation.stockOf("wood") < PICKAXE_WOOD_COST
    ) {
      return false;
    }
    const path = findPath(simulation.world, { start: agent.position, goal: warehouse.door });
    if (!path) {
      return false;
    }
    simulation.pickaxeInProgress = true;
    agent.target = { ...warehouse.door };
    agent.path = path;
    this.setState(agent, simulation, "MoveToCraft");
    return true;
  }

  private craftPickaxe(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < CRAFT_DURATION_SECONDS) {
      return;
    }
    simulation.pickaxeInProgress = false;
    // Re-check the tools weren't already made and the materials are still here.
    if (
      !simulation.hasMiningTools &&
      simulation.stockOf("stone") >= PICKAXE_STONE_COST &&
      simulation.stockOf("wood") >= PICKAXE_WOOD_COST
    ) {
      simulation.withdraw("wood", PICKAXE_WOOD_COST);
      simulation.withdraw("stone", PICKAXE_STONE_COST);
      simulation.hasMiningTools = true;
      simulation.log(
        tr(
          `${agent.name} forged a pickaxe — hard rock and iron ore can now be mined. ⛏️`,
          `${agent.name}이(가) 곡괭이를 만들었다 — 이제 단단한 암석과 철광석을 캘 수 있다. ⛏️`,
        ),
        [agent],
      );
    }
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  /**
   * A resident furnishes their home with a bed (from wood) once they have one —
   * a comfort improvement so they rest properly instead of on the bare floor.
   */
  /** True when this resident already has their own (built) bed. */
  private hasOwnBed(agent: Agent, simulation: Simulation): boolean {
    return (
      agent.bedPos !== undefined &&
      simulation.world.getTile(agent.bedPos)?.type === "Bed"
    );
  }

  /** True when this resident has reserved a bed plot (the site is staked, maybe
   * not yet built) — used so they don't reserve a second one. */
  private hasBedPlot(agent: Agent, simulation: Simulation): boolean {
    const t = agent.bedPos ? simulation.world.getTile(agent.bedPos)?.type : undefined;
    return t === "Bed" || t === "BedSite";
  }

  /** Number of built beds (head tiles) inside a home. */
  private bedCountIn(simulation: Simulation, home: Building): number {
    return simulation
      .interiorTiles(home)
      .filter((t) => simulation.world.getTile(t)?.type === "Bed").length;
  }

  /**
   * Adopt an existing bed in this home that no living resident owns (a dead
   * occupant's bed, or one forgotten across a reload). Returns true if claimed.
   * This is what keeps beds from multiplying: a bedless resident reuses a spare
   * bed instead of building yet another.
   */
  private claimUnownedBed(agent: Agent, simulation: Simulation, home: Building): boolean {
    const ownedKeys = new Set(
      simulation.agents
        .filter((a) => a !== agent && a.bedPos)
        .map((a) => `${a.bedPos!.x},${a.bedPos!.y}`),
    );
    for (const tile of simulation.interiorTiles(home)) {
      if (
        simulation.world.getTile(tile)?.type === "Bed" &&
        !ownedKeys.has(`${tile.x},${tile.y}`)
      ) {
        agent.bedPos = { ...tile };
        // Pick up the adjoining foot tile, if this is a two-tile bed.
        agent.bedFoot = [
          { x: tile.x + 1, y: tile.y },
          { x: tile.x - 1, y: tile.y },
          { x: tile.x, y: tile.y + 1 },
          { x: tile.x, y: tile.y - 1 },
        ].find((p) => simulation.world.getTile(p)?.type === "BedFoot");
        return true;
      }
    }
    return false;
  }

  private tryBuildBed(agent: Agent, simulation: Simulation): boolean {
    if (!agent.home || !agent.homeBuildingId) {
      return false;
    }
    const home = simulation.getBuilding(agent.homeBuildingId);
    // Each resident builds their OWN bed (no sharing); skip only if they already
    // have one or the home isn't built yet.
    if (!home || home.kind !== "house" || home.stage !== "built" || this.hasOwnBed(agent, simulation)) {
      return false;
    }
    if (!this.hasBedPlot(agent, simulation)) {
      // Before building a fresh bed, adopt an existing one with no living owner —
      // a bed left by someone who died, or one this resident forgot (bedPos isn't
      // persisted across reloads). This stops beds piling up to fill the room.
      if (this.claimUnownedBed(agent, simulation, home)) {
        return false; // they have a bed now; nothing to build
      }
      // Never crowd a home with more beds than it can house.
      if (this.bedCountIn(simulation, home) >= simulation.houseCapacity(home)) {
        return false;
      }
      // Reserve the bed plot up front so it's visible (and inspectable as a "bed
      // site") while the resident goes off to fetch wood — you can see it coming.
      const plot = simulation.reserveBedPlot(home);
      if (!plot) {
        return false;
      }
      agent.bedPos = { ...plot.head };
      agent.bedFoot = plot.foot ? { ...plot.foot } : undefined;
      simulation.world.setTile(plot.head, "BedSite");
      if (plot.foot) {
        simulation.world.setTile(plot.foot, "BedSite");
      }
    }
    if (agent.inventory.wood < BED_WOOD_COST) {
      return this.fetchWood(agent, simulation, BED_WOOD_COST);
    }
    // Walk to a tile beside the plot (not onto it) and raise the bed from there,
    // the way a wall is laid from an adjacent tile.
    const stand = this.bedBuildSpot(agent, simulation);
    if (!stand) {
      return false;
    }
    const path = findPath(simulation.world, { start: agent.position, goal: stand });
    if (!path) {
      return false;
    }
    agent.target = { ...stand };
    agent.path = path;
    this.setState(agent, simulation, "MoveToFurnish");
    return true;
  }

  /** A walkable tile beside the resident's reserved bed plot to build it from. */
  private bedBuildSpot(agent: Agent, simulation: Simulation): Vec2 | undefined {
    if (!agent.bedPos) {
      return undefined;
    }
    const plotTiles = [agent.bedPos, agent.bedFoot].filter(Boolean) as Vec2[];
    const isPlot = (p: Vec2) => plotTiles.some((t) => t.x === p.x && t.y === p.y);
    for (const t of plotTiles) {
      for (const d of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        const s = { x: t.x + d.x, y: t.y + d.y };
        if (!isPlot(s) && simulation.world.isWalkable(s)) {
          return s;
        }
      }
    }
    return undefined;
  }

  /** Furnish the home with a table once it has a bed — a step toward a real room. */
  private tryBuildTable(agent: Agent, simulation: Simulation): boolean {
    if (!agent.home || !agent.homeBuildingId) {
      return false;
    }
    const home = simulation.getBuilding(agent.homeBuildingId);
    if (
      !home ||
      home.kind !== "house" ||
      home.stage !== "built" ||
      !simulation.hasBed(home) || // a bed comes first
      simulation.hasTable(home)
    ) {
      return false;
    }
    if (agent.inventory.wood < TABLE_WOOD_COST) {
      return this.fetchWood(agent, simulation, TABLE_WOOD_COST);
    }
    const spot = simulation.bedSpot(home); // nearest free interior floor tile
    if (!spot) {
      return false;
    }
    const path = findPath(simulation.world, { start: agent.position, goal: spot });
    if (!path) {
      return false;
    }
    agent.target = { ...spot };
    agent.path = path;
    this.setState(agent, simulation, "MoveToFurnish");
    return true;
  }

  private furnish(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < FURNISH_DURATION_SECONDS) {
      return;
    }
    const home = agent.homeBuildingId ? simulation.getBuilding(agent.homeBuildingId) : undefined;
    // A reserved bed plot (the resident walked to a tile beside it) → raise the
    // bed on its staked tiles from where they stand. Otherwise it's a dining table.
    const onBedSite =
      agent.bedPos !== undefined && simulation.world.getTile(agent.bedPos)?.type === "BedSite";
    if (home && onBedSite && agent.inventory.wood >= BED_WOOD_COST) {
      simulation.world.setTile(agent.bedPos!, "Bed");
      if (agent.bedFoot) {
        simulation.world.setTile(agent.bedFoot, "BedFoot");
      }
      agent.inventory.wood -= BED_WOOD_COST;
      simulation.log(tr(`${agent.name} built a bed at home. 🛏️`, `${agent.name}이(가) 집에 자기 침대를 놓았다. 🛏️`), [agent]);
    } else if (
      home &&
      agent.target &&
      simulation.world.getTile(roundVec(agent.target))?.type === "Floor" &&
      !simulation.hasTable(home) &&
      agent.inventory.wood >= TABLE_WOOD_COST
    ) {
      simulation.world.setTile(roundVec(agent.target), "Table");
      agent.inventory.wood -= TABLE_WOOD_COST;
      simulation.log(tr(`${agent.name} set up a dining table. 🍽️`, `${agent.name}이(가) 식탁을 놓았다. 🍽️`), [agent]);
    }
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  /**
   * Move a resident's bed into a finished room: lift their old bed (back to bare
   * floor) and lay one on the new room's interior, retargeting their bedPos. If
   * they had no bed yet, this simply gives them one in the new room.
   */
  private relocateBedInto(agent: Agent, simulation: Simulation, room: Building) {
    // Lift the old bed (head + foot) back to bare floor.
    for (const old of [agent.bedPos, agent.bedFoot]) {
      if (old) {
        const t = simulation.world.getTile(old)?.type;
        if (t === "Bed" || t === "BedFoot" || t === "BedSite") {
          simulation.world.setTile(old, "Floor");
        }
      }
    }
    // Lay a fresh bed in the new room (two tiles if it fits, else one).
    const plot = simulation.reserveBedPlot(room);
    const head = plot ? plot.head : simulation.houseInterior(room);
    simulation.world.setTile(head, "Bed");
    agent.bedPos = { ...head };
    if (plot?.foot) {
      simulation.world.setTile(plot.foot, "BedFoot");
      agent.bedFoot = { ...plot.foot };
    } else {
      agent.bedFoot = undefined;
    }
  }

  /** True once this resident already owns a private bedroom annex. */
  private hasPrivateRoom(agent: Agent, simulation: Simulation): boolean {
    return simulation.buildings.some(
      (b) => b.kind === "bedroom" && b.ownerId === agent.id,
    );
  }

  /**
   * A resident sharing a communal house annexes their own bedroom onto it once
   * the village has wood to spare. The new room shares one of the house's walls
   * (no double wall) and opens onto it through an internal door. Their bed moves
   * in when it's done. Returns true if the resident took up (or is fetching wood
   * for) the project.
   */
  private tryBuildPrivateRoom(agent: Agent, simulation: Simulation): boolean {
    // Don't start a second project, and don't expand if you already have privacy.
    if (agent.projectBuildingId || !agent.home || !agent.homeBuildingId) {
      return false;
    }
    if (this.hasPrivateRoom(agent, simulation)) {
      return false;
    }
    const home = simulation.getBuilding(agent.homeBuildingId);
    if (!home || home.kind !== "house" || home.stage !== "built") {
      return false;
    }
    // Privacy only matters when the house is actually shared — a lone occupant
    // already has the place to themselves.
    if (simulation.occupantsOf(home.id) < 2) {
      return false;
    }
    // Only from genuine surplus, so annexing never starves construction/heating.
    if (simulation.stockOf("wood") < PRIVATE_ROOM_WOOD_SURPLUS) {
      return false;
    }
    // Need the groundwork load in hand before breaking ground; go top up first.
    if (agent.inventory.wood < FOUNDATION_WOOD) {
      return this.fetchWood(agent, simulation, BUILD_CARRY_WOOD);
    }
    const site = simulation.findAnnexSite(home);
    if (!site) {
      return false;
    }
    const bedroom = simulation.registerBuilding({
      kind: "bedroom",
      x: site.x,
      y: site.y,
      width: site.width,
      height: site.height,
      door: site.door,
      doors: [site.door],
      ownerId: agent.id,
      annexOf: home.id,
    });
    simulation.claimBuildingFootprint(bedroom);
    // Break ground immediately so the build is never left dangling at "site"
    // (whose resume path routes to a road-facing door an annex doesn't have).
    agent.inventory.wood = Math.max(0, agent.inventory.wood - FOUNDATION_WOOD);
    simulation.setBuildingStage(bedroom, "foundation");
    agent.projectBuildingId = bedroom.id;
    agent.buildTarget = undefined;
    agent.target = undefined;
    agent.path = undefined;
    simulation.log(tr(`${agent.name} started a private bedroom. 🚪`, `${agent.name}이(가) 개인 침실을 증축하기 시작했다. 🚪`), [agent]);
    this.setState(agent, simulation, "BuildHouse");
    return true;
  }

  private findHouseSite(agent: Agent, simulation: Simulation) {
    // Last check before raising a new hut: if a shelter has just gone up for
    // staking (e.g. another newcomer started one this tick), join it instead —
    // this stops a crowd of homeless settlers from each building their own.
    if (this.tryJoinSharedShelter(agent, simulation)) {
      return;
    }
    const isClaimed = (position: Vec2) => simulation.isTileClaimed(position);
    // Prefer terraced housing: a spot that shares a whole wall with an existing
    // building, so the wall is built once (saving material and space) instead of
    // raising two walls back to back. Fall back to a free-standing plot when no
    // neighbour can be cleanly abutted.
    const site =
      simulation.findAdjoiningSite(5, 5, roundVec(agent.position), isClaimed) ??
      simulation.world.findBuildingSite(agent.position, 5, 5, isClaimed, {
        extraScore: (cx, cy) => simulation.ambianceAt({ x: cx, y: cy }) * AMBIANCE_SITING_WEIGHT,
      });
    if (!site) {
      simulation.log(tr(`${agent.name} could not find a house site.`, `${agent.name}이(가) 집 지을 자리를 찾지 못했다.`));
      this.backOff(agent, simulation);
      return;
    }

    // A home: 5x5 footprint with a roomy 3x3 interior — space for a bed, a dining
    // table and breathing room, so it doesn't feel cramped.
    const building = simulation.registerBuilding({
      kind: "house",
      x: site.x,
      y: site.y,
      width: 5,
      height: 5,
      door: { x: site.x + 2, y: site.y + 4 },
      ownerId: agent.id,
    });
    // registerBuilding picks road-facing doors; head for the primary one.
    const door = building.door;
    const path = findPath(simulation.world, { start: agent.position, goal: door });
    if (!path) {
      simulation.cancelBuilding(building);
      this.backOff(agent, simulation);
      return;
    }
    simulation.claimBuildingFootprint(building);
    // Reserve the doorways as road immediately, before any clustered neighbour
    // staked the same tick can drop its footprint onto one.
    simulation.reserveEntrance(building);
    agent.homeBuildingId = building.id;
    agent.projectBuildingId = building.id;
    agent.homeSite = { ...door };
    agent.target = { ...door };
    agent.path = path;
    simulation.log(tr(`${agent.name} chose a house site.`, `${agent.name}이(가) 집 지을 자리를 골랐다.`));
    this.setState(agent, simulation, "MoveToHouseSite");
  }

  private startCommunalBuilding(
    agent: Agent,
    simulation: Simulation,
    kind: Exclude<BuildingKind, "house">,
  ): boolean {
    // Walled-room buildings need at least a 3x3 footprint so they have a floor
    // interior; the warehouse is larger to hold a decent stockpile. Open spaces
    // (park, pasture, cemetery) keep their 3x3 yard.
    const SIZES: Partial<Record<BuildingKind, [number, number]>> = {
      warehouse: [4, 4],
      // A 4×4 kitchen has a 2×2 interior: the stove sits on one tile and the cook
      // stands on the floor beside it (a 3×3 left no room — the stove WAS the
      // whole interior, so cooks ended up standing on it).
      kitchen: [4, 4],
      church: [3, 3],
      powerplant: [3, 3],
      factory: [3, 3],
      station: [3, 3],
      police: [3, 3],
      smelter: [3, 3],
      // A roomy paddock: a 6×6 fence with a 4×4 grass interior for the herd.
      pasture: [6, 6],
      cemetery: [3, 3],
      park: [3, 3],
    };
    const [width, height] = SIZES[kind] ?? [3, 3];
    // The cemetery is sited remotely (away from the village centre and housing);
    // everything else slots in near the builder, close to the village.
    const isClaimed = (position: Vec2) => simulation.isTileClaimed(position);
    const avoidsHomes = kind === "powerplant" || kind === "factory" || kind === "smelter";
    // A factory must sit near the power plant to be electrified (and so forge
    // steel), so it builds next to it; other industry just shuns housing.
    const powerplant = simulation.getPowerPlant();
    const policeSpot = kind === "police" ? simulation.plannedPoliceSpot() : undefined;
    const origin =
      kind === "factory" && powerplant
        ? { x: Math.round(powerplant.x + powerplant.width / 2), y: Math.round(powerplant.y + powerplant.height / 2) }
        : policeSpot
          ? { x: Math.round(policeSpot.x), y: Math.round(policeSpot.y) }
          : agent.position;
    // Village-centre walled buildings (warehouse, kitchen, church, station,
    // police) join the cluster by sharing a wall with a neighbour — one wall, not
    // two back to back. Nuisances (power plant/factory/smelter) and the remote
    // cemetery, and the open yards (park/pasture), keep their own placement.
    const adjoins =
      ROOM_BUILDING_KINDS.has(kind) && !avoidsHomes && kind !== "cemetery";
    const site =
      kind === "cemetery"
        ? simulation.world.findBuildingSite(
            roundVec(simulation.villageCenter()),
            width,
            height,
            isClaimed,
            { far: true, minDistance: 16 },
          )
        : (adjoins
            ? simulation.findAdjoiningSite(width, height, roundVec(origin), isClaimed)
            : undefined) ??
          simulation.world.findBuildingSite(origin, width, height, isClaimed, {
            // Power plants and factories are nuisances — steer them away from homes.
            extraScore: avoidsHomes
              ? (cx, cy) => -simulation.ambianceAt({ x: cx, y: cy }) * AMBIANCE_SITING_WEIGHT
              : undefined,
          });
    if (!site) {
      return false;
    }
    const building = simulation.registerBuilding({
      kind,
      x: site.x,
      y: site.y,
      width,
      height,
      door: { x: site.x + Math.floor(width / 2), y: site.y + height - 1 },
    });
    const door = building.door;
    const path = findPath(simulation.world, { start: agent.position, goal: door });
    if (!path) {
      simulation.cancelBuilding(building);
      return false;
    }
    simulation.claimBuildingFootprint(building);
    simulation.reserveEntrance(building);
    agent.projectBuildingId = building.id;
    agent.target = { ...door };
    agent.path = path;
    simulation.log(tr(`${agent.name} is planning a village ${kind}.`, `${agent.name}이(가) 마을 ${buildingNameKo(kind)}을(를) 계획하고 있다.`));
    this.setState(agent, simulation, "MoveToHouseSite");
    return true;
  }

  private tryCook(agent: Agent, simulation: Simulation): boolean {
    // Cooking needs a stove (inside a kitchen), raw food, and a larder that
    // isn't already full of meals. Anyone may do it — see cookEfficiency.
    const stove = simulation.getStove();
    if (!stove) {
      return false;
    }
    if (
      simulation.foodStock < COOK_RAW_COST ||
      simulation.meals >= simulation.agents.length * 2
    ) {
      return false;
    }

    // Stand beside the (solid) stove to cook, not on it.
    const path = findPath(simulation.world, { start: agent.position, goal: stove, stopAdjacent: true });
    if (!path) {
      return false;
    }

    agent.target = { ...stove };
    agent.path = path;
    this.setState(agent, simulation, "MoveToKitchen");
    return true;
  }

  /** A cook works at full speed and yield; anyone else cooks slower and wastefully. */
  private cookEfficiency(agent: Agent): number {
    return agent.job === "cook" ? 1 : NON_EXPERT_COOK_EFFICIENCY;
  }

  private cook(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const efficiency = this.cookEfficiency(agent);
    agent.actionTimer += deltaSeconds;
    // A clumsy cook takes longer over the stove.
    if (agent.actionTimer < COOK_DURATION_SECONDS / efficiency) {
      return;
    }

    if (simulation.foodStock >= COOK_RAW_COST) {
      simulation.foodStock -= COOK_RAW_COST;
      // A non-cook gets fewer meals out of the same ingredients (some is spoiled).
      const yieldMeals = Math.max(1, Math.round(COOK_MEAL_YIELD * efficiency));
      simulation.meals += yieldMeals;
      if (Math.random() < 0.4) {
        simulation.log(
          efficiency >= 1
            ? tr(`${agent.name} cooked warm meals at the stove.`, `${agent.name}이(가) 화덕에서 따뜻한 식사를 지었다.`)
            : tr(`${agent.name} cooked at the stove, a little clumsily.`, `${agent.name}이(가) 화덕에서 서툴게 식사를 지었다.`),
        );
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
      simulation.log(tr(`${agent.name} cannot reach the construction site.`, `${agent.name}이(가) 공사장에 닿지 못한다.`));
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
      simulation.log(tr(`${agent.name} cannot reach their house site.`, `${agent.name}이(가) 자기 집터에 닿지 못한다.`));
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
          ? tr(`${agent.name} marked a future home.`, `${agent.name}이(가) 미래의 보금자리 자리를 표시했다.`)
          : tr(`${agent.name} staked out the ${building.kind}.`, `${agent.name}이(가) ${buildingNameKo(building.kind)} 자리를 잡았다.`),
      );
    }
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  /**
   * Wood to haul on one supply run for a build: enough to finish what's left
   * (foundation if unlaid + each remaining wall/door tile), capped at
   * BUILD_LOAD_MAX so a builder fells/withdraws a whole load and then lays many
   * tiles. Floors are free (covered by the foundation). With several builders
   * sharing a room each fetches the full remainder — a little slack, but it keeps
   * them all working rather than starved.
   */
  private buildLoadTarget(building: Building, simulation: Simulation): number {
    let left = building.stage === "foundation" ? 0 : FOUNDATION_WOOD;
    for (const tile of building.plan ?? []) {
      if (!tile.done) {
        left += tileWood(tile.t);
      }
    }
    // Split the remaining need across everyone working this build, so three
    // builders don't each fell a whole house's worth of timber. Solo builders
    // still fetch the lot (capped) and finish in one or two runs.
    const builders = Math.max(
      1,
      simulation.agents.filter((a) => a.projectBuildingId === building.id).length,
    );
    const share = Math.ceil(left / builders);
    return Math.max(FOUNDATION_WOOD, Math.min(BUILD_LOAD_MAX, share));
  }

  /**
   * Drive a walled-room build tile by tile. Each visit picks the nearest tile
   * still to be laid, walks the builder to it, and lays it — so the room rises
   * one wall/floor/door at a time (and several residents can raise one shelter
   * together). Open spaces (park/pasture/cemetery) keep the old timed build.
   */
  private buildHouse(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const building = agent.projectBuildingId
      ? simulation.getBuilding(agent.projectBuildingId)
      : undefined;
    if (!building || building.stage === "built") {
      agent.buildTarget = undefined;
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
      return;
    }

    if (!ROOM_BUILDING_KINDS.has(building.kind)) {
      this.buildOpenSpace(agent, simulation, building, deltaSeconds);
      return;
    }

    // How much wood to haul per supply run: enough to finish this building in one
    // trip (capped), so a builder fells/withdraws a whole load and then lays many
    // tiles, rather than fetching a tree's worth per wall.
    const load = this.buildLoadTarget(building, simulation);

    // Lay the foundation (and draw up the plan) the first time someone arrives:
    // pay the groundwork/floor material now. If short, fetch a fresh load first.
    if (building.stage !== "foundation") {
      if (agent.inventory.wood < FOUNDATION_WOOD) {
        if (!this.fetchWood(agent, simulation, load)) {
          this.backOff(agent, simulation);
        }
        return;
      }
      agent.inventory.wood = Math.max(0, agent.inventory.wood - FOUNDATION_WOOD);
      simulation.setBuildingStage(building, "foundation");
      simulation.log(
        building.kind === "house"
          ? tr(`${agent.name} started building a house.`, `${agent.name}이(가) 집을 짓기 시작했다.`)
          : tr(`${agent.name} started building the ${building.kind}.`, `${agent.name}이(가) ${buildingNameKo(building.kind)}을(를) 짓기 시작했다.`),
      );
    }

    simulation.ensureBuildPlan(building);
    const next = simulation.nextBuildTile(building, agent.position, agent.id);
    if (!next) {
      this.finishBuilding(agent, simulation, building);
      return;
    }

    // Out of materials for the next piece? Trek back for a full load, then carry
    // on laying tiles — no warehouse round-trip per single tile.
    if (agent.inventory.wood < tileWood(next.t)) {
      simulation.releaseBuildClaims(building, agent.id); // free our tile while away
      if (!this.fetchWood(agent, simulation, load)) {
        this.backOff(agent, simulation);
      }
      return;
    }

    agent.buildTarget = { x: next.x, y: next.y };
    agent.actionTimer = 0;
    const path = findPath(simulation.world, {
      start: agent.position,
      goal: agent.buildTarget,
      stopAdjacent: true,
    });
    if (!path) {
      // Can't reach it (e.g. momentarily boxed in) — lay it in place rather than
      // deadlock, then carry on with the next tile.
      simulation.placeBuildTile(building, next);
      return;
    }
    agent.target = { ...agent.buildTarget };
    agent.path = path;
    this.setState(agent, simulation, "MoveToBuildTile");
  }

  /** Arrived beside a planned tile: lay it, then move on to the next. */
  private buildTile(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    const building = agent.projectBuildingId
      ? simulation.getBuilding(agent.projectBuildingId)
      : undefined;
    if (!building || !agent.buildTarget || building.stage === "built") {
      agent.buildTarget = undefined;
      this.setState(agent, simulation, building ? "BuildHouse" : "Idle");
      return;
    }

    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < PER_TILE_BUILD_SECONDS) {
      return;
    }
    agent.actionTimer = 0;

    const tile = building.plan?.find(
      (p) => p.x === agent.buildTarget!.x && p.y === agent.buildTarget!.y && !p.done,
    );
    if (tile) {
      const need = tileWood(tile.t);
      if (agent.inventory.wood >= need) {
        agent.inventory.wood -= need;
        simulation.placeBuildTile(building, tile);
      }
      // Short on wood (a load ran out between picking and laying): leave it for
      // the next pass — buildHouse will send this builder to restock.
    }
    agent.buildTarget = undefined;
    agent.target = undefined;
    agent.path = undefined;

    // Carry straight on with the next tile, unless night falls or survival calls
    // — then hand back to the planner so basic needs come first.
    if (
      simulation.isNight() ||
      agent.health.hunger >= HUNGER_SEEK_THRESHOLD ||
      agent.health.stamina < STAMINA_EXHAUSTED
    ) {
      this.setState(agent, simulation, "Idle");
    } else {
      this.setState(agent, simulation, "BuildHouse");
    }
  }

  /** Finish a walled room: stamp it built, move in (houses) or open it (civic). */
  private finishBuilding(agent: Agent, simulation: Simulation, building: Building) {
    simulation.setBuildingStage(building, "built");
    simulation.releaseBuildingFootprint(building);
    if (building.kind === "bedroom") {
      // A private annex: keep living in the communal house, but move the bed into
      // the new room so the resident sleeps in privacy from now on.
      building.ownerId = agent.id;
      this.relocateBedInto(agent, simulation, building);
      simulation.log(tr(`${agent.name} finished a private bedroom. 🛏️`, `${agent.name}이(가) 개인 침실을 완성했다. 🛏️`), [agent]);
    } else if (building.kind === "house") {
      // Whoever lays the last tile finishes it — but only the house's own
      // residents move in. A neighbour who just pitched in keeps their own home.
      if (!agent.home || agent.homeBuildingId === building.id) {
        agent.home = simulation.houseInterior(building);
        agent.homeSite = undefined;
        simulation.log(tr(`${agent.name} finished their house.`, `${agent.name}이(가) 집을 완성했다.`), [agent]);
      } else {
        simulation.log(tr(`${agent.name} helped finish a house. 🔨`, `${agent.name}이(가) 이웃의 집을 같이 완성했다. 🔨`), [agent]);
      }
    } else {
      simulation.log(tr(`${agent.name} built the village ${building.kind}!`, `${agent.name}이(가) 마을 ${buildingNameKo(building.kind)}을(를) 지었다!`), [agent]);
    }
    agent.projectBuildingId = undefined;
    agent.buildTarget = undefined;
    agent.target = undefined;
    agent.path = undefined;
    this.setState(agent, simulation, "Idle");
  }

  /** The old single-timer build, kept for open spaces (park/pasture/cemetery). */
  private buildOpenSpace(
    agent: Agent,
    simulation: Simulation,
    building: Building,
    deltaSeconds: number,
  ) {
    if (agent.actionTimer === 0 && building.stage !== "foundation") {
      simulation.setBuildingStage(building, "foundation");
      simulation.log(
        tr(`${agent.name} started building the ${building.kind}.`, `${agent.name}이(가) ${buildingNameKo(building.kind)}을(를) 짓기 시작했다.`),
      );
    }

    agent.actionTimer += deltaSeconds;
    if (agent.actionTimer < BUILD_DURATION_SECONDS) {
      return;
    }

    simulation.setBuildingStage(building, "built");
    simulation.releaseBuildingFootprint(building);
    agent.inventory.wood = Math.max(0, agent.inventory.wood - buildCost(building.kind));
    simulation.log(tr(`${agent.name} built the village ${building.kind}!`, `${agent.name}이(가) 마을 ${buildingNameKo(building.kind)}을(를) 지었다!`), [agent]);
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
      simulation.log(tr(`${agent.name} is hungry but found no food.`, `${agent.name}이(가) 배고프지만 먹을 것을 찾지 못했다.`));
      this.backOff(agent, simulation);
      return;
    }

    simulation.claimTile(route.target);
    agent.eatPlan = "berry";
    agent.target = route.target;
    agent.path = route.path;
    simulation.log(tr(`${agent.name} went looking for berries.`, `${agent.name}이(가) 산딸기를 찾아 나섰다.`));
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
        simulation.log(tr(`${agent.name} enjoyed a warm meal.`, `${agent.name}이(가) 따뜻한 식사를 즐겼다.`));
      }
    } else if (agent.eatPlan === "warehouse") {
      if (simulation.foodStock > 0) {
        simulation.foodStock -= 1;
        agent.health.hunger = Math.max(0, agent.health.hunger - 60);
        simulation.log(tr(`${agent.name} ate from the warehouse.`, `${agent.name}이(가) 창고에서 끼니를 해결했다.`));
      }
    } else {
      if (agent.target) {
        simulation.world.setTile(agent.target, "Grass");
        simulation.releaseClaim(agent.target);
      }
      agent.health.hunger = Math.max(0, agent.health.hunger - 55);
      simulation.log(tr(`${agent.name} ate berries.`, `${agent.name}이(가) 산딸기를 먹었다.`));
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
        simulation.log(tr(`${agent.name} harvested crops. +2 food`, `${agent.name}이(가) 작물을 거뒀다. +식량 2`));
      } else if (tile?.type === "FieldEmpty") {
        simulation.world.setTile(center, "FieldGrowing");
        if (Math.random() < 0.35) {
          simulation.log(tr(`${agent.name} sowed seeds.`, `${agent.name}이(가) 씨를 뿌렸다.`));
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
        simulation.log(tr(`${agent.name} tilled a new field.`, `${agent.name}이(가) 새 밭을 일궜다.`));
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
          simulation.log(tr(`${agent.name} paved a stretch of road.`, `${agent.name}이(가) 길 한 구간을 포장했다.`));
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
      simulation.log(tr(`${agent.name} hunted a ${kind}. +${simulation.animalFoodValue(kind)} food 🏹`, `${agent.name}이(가) ${animalNameKo(kind)}을(를) 사냥했다. +식량 ${simulation.animalFoodValue(kind)} 🏹`), [
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
      simulation.log(tr(`${agent.name} tamed a ${animal.kind} for the pasture. 🐾`, `${agent.name}이(가) 목장에 둘 ${animalNameKo(animal.kind)}을(를) 길들였다. 🐾`), [agent]);
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
        simulation.log(tr(`${agent.name} transplanted a sapling to greener ground. 🌱`, `${agent.name}이(가) 묘목을 더 푸른 땅으로 옮겨 심었다. 🌱`));
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
      simulation.log(tr(`${agent.name} and ${partner.name} stopped for a chat.`, `${agent.name}와(과) ${partner.name}이(가) 멈춰 서서 담소를 나눴다.`));
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
    simulation.log(tr(`${a.name} and ${b.name} got married! 💍`, `${a.name}와(과) ${b.name}이(가) 결혼했다! 💍`), [a, b]);
  }

  /**
   * Under land pressure, homeless adults move into shared housing instead of
   * sprawling: fill a free slot in an existing villa/apartment, or densify a
   * central house (house -> villa -> apartment) and move in.
   */
  private tryHousing(agent: Agent, simulation: Simulation): boolean {
    // Move into a house with a spare slot if there is one; otherwise spread out
    // and raise a new home (houses no longer densify into taller tiers).
    const spare = simulation.findHouseWithSpareCapacity();
    if (spare) {
      this.moveInto(agent, simulation, spare, tr("moved into shared housing", "공동 주택에 들어갔다"));
      return true;
    }
    return false;
  }

  /**
   * Communal-first housing: rather than each newcomer raising their own hut, a
   * homeless resident claims a bunk in a shelter that's already going up (with
   * room to spare) and pitches in to finish it. They move in once it's built.
   */
  private tryJoinSharedShelter(agent: Agent, simulation: Simulation): boolean {
    let shelter =
      agent.homeBuildingId ? simulation.getBuilding(agent.homeBuildingId) : undefined;
    if (!shelter || shelter.kind !== "house" || shelter.stage === "built") {
      shelter = simulation.buildings.find(
        (b) =>
          b.kind === "house" &&
          b.stage !== "built" &&
          simulation.occupantsOf(b.id) < simulation.houseCapacity(b),
      );
    }
    if (!shelter || shelter.stage === "built") {
      return false;
    }
    agent.homeBuildingId = shelter.id; // a claimed bunk counts toward capacity
    if (!shelter.ownerId) {
      shelter.ownerId = agent.id;
    }
    agent.homeSite = undefined;
    // Actually join the build crew: own the project so the build state machine
    // (and tile reservation) puts this resident to work laying tiles too —
    // several hands raise the shelter together.
    agent.projectBuildingId = shelter.id;
    // Pitch in to raise it, like any communal project.
    const load = this.buildLoadTarget(shelter, simulation);
    if (agent.inventory.wood >= load) {
      this.headToProject(agent, simulation, shelter.door);
    } else {
      this.fetchWood(agent, simulation, load);
    }
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
    agent.home = simulation.houseInterior(house);
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
    agent.home = simulation.houseInterior(empty);
    agent.homeBuildingId = empty.id;
    simulation.log(tr(`${agent.name} moved into an empty house.`, `${agent.name}이(가) 빈 집으로 이사했다.`), [agent]);
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
    const rp = roundVec(agent.position);
    // Claim a free bed at bedtime if we don't already own one — beds aren't saved
    // across reloads, so a resident with a bed standing empty in their home would
    // otherwise sleep on the floor at the centre. Adopt it and sleep there.
    if (!this.hasOwnBed(agent, simulation) && agent.homeBuildingId) {
      const home = simulation.getBuilding(agent.homeBuildingId);
      if (home && home.kind === "house" && home.stage === "built") {
        this.claimUnownedBed(agent, simulation, home);
      }
    }
    // A bed is solid: you climb onto it from an adjacent tile. Walk up beside the
    // bed, and the Sleep state mounts it. If already on/beside it, sleep now.
    if (this.hasOwnBed(agent, simulation) && agent.bedPos) {
      const bed = agent.bedPos;
      if (samePos(rp, bed) || isAdjacent(rp, bed)) {
        this.setState(agent, simulation, "Sleep");
        return;
      }
      const path = findPath(simulation.world, {
        start: agent.position,
        goal: bed,
        stopAdjacent: true, // stop beside the (solid) bed, then mount in Sleep
      });
      if (path) {
        agent.target = { ...bed };
        agent.path = path;
        this.setState(agent, simulation, "MoveHome");
        return;
      }
      // Bed unreachable (boxed in) — fall through to sleeping on the home floor.
    }
    const spot = agent.home;
    if (spot && !samePos(rp, spot)) {
      const path = findPath(simulation.world, { start: agent.position, goal: spot });
      if (path) {
        agent.target = { ...spot };
        agent.path = path;
        this.setState(agent, simulation, "MoveHome");
        return;
      }
    }
    this.setState(agent, simulation, "Sleep");
  }

  private sleep(agent: Agent, simulation: Simulation, deltaSeconds: number) {
    // Climb onto one's own bed when standing right beside it (the bed is solid, so
    // we step onto it here instead of letting the pathfinder route onto it).
    if (
      this.hasOwnBed(agent, simulation) &&
      agent.bedPos &&
      isAdjacent(roundVec(agent.position), agent.bedPos)
    ) {
      agent.position = { ...agent.bedPos };
      agent.path = undefined;
      agent.target = undefined;
    }
    // A bed rests best, one's own home next, rough sleeping outside the least.
    const onBed = simulation.world.getTile(roundVec(agent.position))?.type === "Bed";
    const atHome = Boolean(agent.home && samePos(roundVec(agent.position), agent.home));
    const regenRate = onBed ? 18 : atHome ? 12 : 6;
    agent.health.stamina = Math.min(100, agent.health.stamina + deltaSeconds * regenRate);

    if (!simulation.isNight()) {
      agent.target = undefined;
      agent.path = undefined;
      this.setState(agent, simulation, "Idle");
    }
  }

  private goRest(agent: Agent, simulation: Simulation) {
    const rp = roundVec(agent.position);
    // Rest on one's own bed, not on the house-centre floor. Claim a free bed at
    // home if we don't have one (beds aren't saved across reloads), then head to
    // it — exactly like turning in at night, but a daytime power-nap.
    if (!this.hasOwnBed(agent, simulation) && agent.homeBuildingId) {
      const home = simulation.getBuilding(agent.homeBuildingId);
      if (home && home.kind === "house" && home.stage === "built") {
        this.claimUnownedBed(agent, simulation, home);
      }
    }
    if (this.hasOwnBed(agent, simulation) && agent.bedPos) {
      const bed = agent.bedPos;
      if (samePos(rp, bed) || isAdjacent(rp, bed)) {
        this.setState(agent, simulation, "Rest");
        return;
      }
      const path = findPath(simulation.world, {
        start: agent.position,
        goal: bed,
        stopAdjacent: true, // stop beside the solid bed, then climb on in Rest
      });
      if (path) {
        agent.target = { ...bed };
        agent.path = path;
        this.setState(agent, simulation, "MoveHome");
        return;
      }
    }
    if (agent.home && !samePos(rp, agent.home)) {
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
    // Climb onto one's own bed when standing right beside it (the bed is solid),
    // so a daytime rest happens in bed rather than on the floor next to it.
    if (
      this.hasOwnBed(agent, simulation) &&
      agent.bedPos &&
      isAdjacent(roundVec(agent.position), agent.bedPos)
    ) {
      agent.position = { ...agent.bedPos };
      agent.path = undefined;
      agent.target = undefined;
    }
    agent.actionTimer += deltaSeconds;
    const onBed = simulation.world.getTile(roundVec(agent.position))?.type === "Bed";
    const atHome =
      onBed || Boolean(agent.home && samePos(roundVec(agent.position), agent.home));
    const regenRate = atHome ? 16 : 9;
    agent.health.stamina = Math.min(100, agent.health.stamina + deltaSeconds * regenRate);

    const restedAt = atHome ? 92 : 75;
    if (agent.health.stamina >= restedAt) {
      // Instant rests (loitering at home while already rested) stay out of the log.
      if (agent.actionTimer >= 1) {
        simulation.log(
          atHome
            ? tr(`${agent.name} rested at home.`, `${agent.name}이(가) 집에서 쉬었다.`)
            : tr(`${agent.name} finished resting.`, `${agent.name}이(가) 휴식을 마쳤다.`),
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
        // Stop next to the goal whenever the goal tile itself can't be stood on
        // (a tree, rock, or the solid stove) — otherwise path right onto it.
        stopAdjacent:
          nextState === "ChopTree" ||
          nextState === "Mine" ||
          !simulation.world.isWalkable(agent.target),
      });
      if (!replanned) {
        simulation.log(tr(`${agent.name} is blocked and gave up.`, `${agent.name}이(가) 길이 막혀 포기했다.`));
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
        // Only working-age adults wear roads in; children's wandering doesn't
        // carve the street network (and there can be a lot of children).
        if (agent.age >= ADULT_AGE) {
          simulation.recordTraffic(waypoint);
        }
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
    if (agent.haulItemId) {
      simulation.releaseItem(agent.haulItemId);
      agent.haulItemId = undefined;
    }
    // A carried load is set down where they stand so it isn't lost.
    this.dropCarry(agent, simulation);
    // If they were mid-craft, let the colony try again.
    if (agent.state === "MoveToCraft" || agent.state === "CraftTool") {
      simulation.pickaxeInProgress = false;
    }
    // Free any build tile they'd claimed so another builder can take it.
    if (agent.projectBuildingId) {
      simulation.releaseBuildClaims(simulation.getBuilding(agent.projectBuildingId), agent.id);
    }
    agent.buildTarget = undefined;
    agent.gatherWood = undefined;
    agent.fetchAmount = undefined;
    agent.target = undefined;
    agent.path = undefined;
  }

  /** Multiplier on labour stamina cost: night work is far more tiring. */
  private nightFactor(simulation: Simulation): number {
    return simulation.isNight() ? NIGHT_STAMINA_FACTOR : 1;
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

/** Orthogonally adjacent (sharing an edge) — used to mount a bed from beside it. */
function isAdjacent(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function clampNeed(value: number): number {
  return value < 0 ? 0 : value > 100 ? 100 : value;
}

function buildingNameKo(kind: BuildingKind): string {
  const names: Record<BuildingKind, string> = {
    house: "집",
    bedroom: "침실",
    warehouse: "창고",
    kitchen: "부엌",
    church: "교회",
    pasture: "목초지",
    powerplant: "발전소",
    factory: "공장",
    station: "역",
    cemetery: "묘지",
    park: "공원",
    police: "경찰서",
    smelter: "제련소",
  };
  return names[kind] ?? kind;
}

function animalNameKo(kind: string): string {
  return kind === "deer" ? "사슴" : kind === "boar" ? "멧돼지" : kind === "rabbit" ? "토끼" : kind;
}

function resourceNameKo(resource: ResourceKind): string {
  return resource === "wood"
    ? "나무"
    : resource === "stone"
      ? "돌"
      : resource === "ironOre"
        ? "철광석"
        : "강철";
}

const BUILDING_WOOD_COST: Record<BuildingKind, number> = {
  house: HOUSE_WOOD_COST,
  // Annexes are built piecemeal (per-tile), so this lump figure is only a
  // fallback; their real cost is the foundation plus each wall/door tile.
  bedroom: FOUNDATION_WOOD,
  warehouse: WAREHOUSE_WOOD_COST,
  kitchen: KITCHEN_WOOD_COST,
  church: CHURCH_WOOD_COST,
  pasture: PASTURE_WOOD_COST,
  powerplant: POWERPLANT_WOOD_COST,
  factory: FACTORY_WOOD_COST,
  station: STATION_WOOD_COST,
  cemetery: CEMETERY_WOOD_COST,
  park: PARK_WOOD_COST,
  police: POLICE_WOOD_COST,
  smelter: SMELTER_WOOD_COST,
};

// Wood to build, including an allowance for the building's doorway(s). Buildings
// can have more than one door (road-facing, by size) — that extra opening is
// paid for here.
function buildCost(kind: BuildingKind): number {
  return (BUILDING_WOOD_COST[kind] ?? HOUSE_WOOD_COST) + DOOR_WOOD_COST;
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
