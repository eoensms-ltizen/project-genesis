import { SoundManager } from "./audio/SoundManager";
import { PixiRenderer } from "./render/PixiRenderer";
import { Simulation } from "./Simulation";
import type {
  BuildingKind,
  FoodKind,
  InspectionTarget,
  ResourceKind,
  SimulationSnapshot,
  Vec2,
} from "./types";

type GameAppOptions = {
  onChange: (snapshot: SimulationSnapshot) => void;
  onTileClick: (position: Vec2) => void;
};

export class GameApp {
  readonly simulation: Simulation;

  private readonly renderer: PixiRenderer;
  private readonly sound = new SoundManager();
  private placementMode = false;
  private started = false;

  constructor(host: HTMLElement, options: GameAppOptions) {
    this.simulation = new Simulation({
      onChange: options.onChange,
    });
    this.renderer = new PixiRenderer(host, {
      onTileClick: options.onTileClick,
    });
  }

  async start() {
    await this.renderer.init();
    this.started = true;
    this.render();
    this.simulation.notifyChanged();
  }

  tick(deltaSeconds: number) {
    this.simulation.update(deltaSeconds);
    this.render();
    this.sound.tick(this.simulation.agents, {
      clock: this.simulation.getClock(),
      weather: this.simulation.getWeather(),
      focusWeights: this.renderer.audioFocusWeights(this.simulation.agents),
    });
  }

  addRandomAgent(position: Vec2) {
    this.simulation.addRandomAgent(position);
    this.render();
  }

  addImmigrant() {
    this.simulation.addImmigrant();
    this.render();
  }

  setPlacementMode(enabled: boolean) {
    this.placementMode = enabled;
    this.render();
  }

  isPlacementMode(): boolean {
    return this.placementMode;
  }

  /** What lives at the clicked tile: a resident, a building, or the terrain. */
  inspectAt(position: Vec2): InspectionTarget {
    let nearest: { id: string } | undefined;
    let nearestDistance = 1.1;
    for (const agent of this.simulation.agents) {
      const d = Math.hypot(agent.position.x - position.x, agent.position.y - position.y);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = agent;
      }
    }
    if (nearest) {
      return { kind: "agent", agentId: nearest.id };
    }

    let nearestAnimal: { id: string } | undefined;
    let nearestAnimalDistance = 1.1;
    for (const animal of this.simulation.animals) {
      const d = Math.hypot(animal.position.x - position.x, animal.position.y - position.y);
      if (d < nearestAnimalDistance) {
        nearestAnimalDistance = d;
        nearestAnimal = animal;
      }
    }
    if (nearestAnimal) {
      return { kind: "animal", animalId: nearestAnimal.id };
    }

    // A material pile sitting on this tile (loose, or stored in the warehouse).
    const tx = Math.round(position.x);
    const ty = Math.round(position.y);
    const pile = this.simulation.items.find(
      (stack) => stack.amount > 0 && stack.position.x === tx && stack.position.y === ty,
    );
    if (pile) {
      return { kind: "item", itemId: pile.id };
    }

    // Walls, doors, floors and furniture are selectable structures in their own
    // right, even though they sit inside a building's footprint — clicking a bed
    // inspects the bed, not the whole building.
    const structureTile = this.simulation.world.getTile(position)?.type;
    // Clicking inside the granary shows its food store (grain/meat), not the bare
    // floor tile under the sacks.
    const granaryHere = this.simulation.buildings.find(
      (b) =>
        b.kind === "granary" &&
        position.x >= b.x &&
        position.x < b.x + b.width &&
        position.y >= b.y &&
        position.y < b.y + b.height,
    );
    if (granaryHere && structureTile === "Floor") {
      return { kind: "building", buildingId: granaryHere.id };
    }
    if (
      structureTile === "Wall" ||
      structureTile === "Door" ||
      structureTile === "Floor" ||
      structureTile === "Bed" ||
      structureTile === "BedFoot" ||
      structureTile === "BedSite" ||
      structureTile === "Table" ||
      structureTile === "Stove" ||
      structureTile === "Counter" ||
      structureTile === "Fence" ||
      structureTile === "FenceGate"
    ) {
      return { kind: "tile", position: { ...position } };
    }

    const building = this.simulation.buildings.find(
      (candidate) =>
        position.x >= candidate.x &&
        position.x < candidate.x + candidate.width &&
        position.y >= candidate.y &&
        position.y < candidate.y + candidate.height,
    );
    if (building) {
      return { kind: "building", buildingId: building.id };
    }

    return { kind: "tile", position: { ...position } };
  }

  resetCamera() {
    this.renderer.resetCamera();
  }

  /** Lock the camera onto a resident, or pass null to stop following. */
  followAgent(agentId: string | null) {
    this.renderer.setFollowAgent(agentId);
    this.render();
  }

  isFollowing(agentId: string): boolean {
    return this.renderer.isFollowing(agentId);
  }

  setFlatBuildings(flat: boolean) {
    this.renderer.setFlatBuildings(flat);
  }

  setSkinMode(enabled: boolean) {
    this.renderer.setSkinMode(enabled);
    this.render();
  }

  setSoundEnabled(enabled: boolean) {
    this.sound.setEnabled(enabled);
  }

  isSoundEnabled(): boolean {
    return this.sound.isEnabled();
  }

  unlockAudio() {
    void this.sound.unlock();
  }

  // --- Developer cheats (debug panel only — not part of normal play) ---------

  /** Add raw materials straight into the warehouse stock. */
  devGiveResource(resource: ResourceKind, amount: number) {
    this.simulation.store(resource, amount);
    this.simulation.notifyChanged();
    this.render();
  }

  /** Add food straight into the larder. */
  devGiveFood(kind: FoodKind, amount: number) {
    this.simulation.addFood(kind, amount);
    this.simulation.notifyChanged();
    this.render();
  }

  /** Jump the village to a chosen era. */
  devSetEra(era: number) {
    this.simulation.era = Math.max(0, Math.min(4, Math.round(era)));
    this.simulation.notifyChanged();
    this.render();
  }

  private static readonly DEV_BUILD_SIZES: Partial<Record<BuildingKind, [number, number]>> = {
    house: [5, 5],
    warehouse: [4, 4],
    granary: [4, 4],
    kitchen: [4, 4],
    funfair: [8, 6],
    pasture: [6, 6],
    cemetery: [3, 3],
    park: [3, 3],
  };

  private devRaise(kind: BuildingKind, x: number, y: number, instant: boolean): boolean {
    const [w, h] = GameApp.DEV_BUILD_SIZES[kind] ?? [4, 4];
    const building = this.simulation.registerBuilding({
      kind,
      x,
      y,
      width: w,
      height: h,
      door: { x: x + Math.floor(w / 2), y: y + h - 1 },
    });
    this.simulation.claimBuildingFootprint(building);
    if (instant) {
      // Drop it down already finished.
      this.simulation.setBuildingStage(building, "built");
    } else {
      // Just stake the plot: residents will adopt the site and raise it tile by
      // tile (they fetch the wood and lay each wall/fence themselves).
      this.simulation.setBuildingStage(building, "site");
      this.simulation.reserveEntrance(building);
    }
    this.simulation.notifyChanged();
    this.render();
    return true;
  }

  /** Place a building near the village centre — finished (instant) or as a site. */
  devBuild(kind: BuildingKind, instant = true): boolean {
    const [w, h] = GameApp.DEV_BUILD_SIZES[kind] ?? [4, 4];
    const c = this.simulation.villageCenter();
    const origin = { x: Math.round(c.x), y: Math.round(c.y) };
    const site = this.simulation.world.findBuildingSite(origin, w, h, (p) =>
      this.simulation.isTileClaimed(p),
    );
    if (!site) {
      return false;
    }
    return this.devRaise(kind, site.x, site.y, instant);
  }

  /** Place a building centred on a clicked tile — finished (instant) or as a site. */
  devBuildAt(kind: BuildingKind, position: Vec2, instant = true): boolean {
    const [w, h] = GameApp.DEV_BUILD_SIZES[kind] ?? [4, 4];
    const x = Math.round(position.x) - Math.floor(w / 2);
    const y = Math.round(position.y) - Math.floor(h / 2);
    return this.devRaise(kind, x, y, instant);
  }

  /**
   * Arm the placement ghost shown under the cursor. Pass a building kind to ghost
   * its footprint, `tileTool` true to ghost a single tile (road/demolish), or
   * neither to clear the preview.
   */
  setPlacementPreview(kind: BuildingKind | null, tileTool = false) {
    if (kind) {
      const [w, h] = GameApp.DEV_BUILD_SIZES[kind] ?? [4, 4];
      this.renderer.setPlacementPreview({ w, h, tile: false });
    } else if (tileTool) {
      this.renderer.setPlacementPreview({ w: 1, h: 1, tile: true });
    } else {
      this.renderer.setPlacementPreview(null);
    }
  }

  /** Dev tool: pave the clicked ground tile into a road. */
  devPaveRoadAt(position: Vec2): boolean {
    const ok = this.simulation.devPaveRoad({ x: Math.round(position.x), y: Math.round(position.y) });
    if (ok) this.render();
    return ok;
  }

  /** Dev tool: demolish the single clicked tile (wall/floor/door/fence/road). */
  devDemolishTileAt(position: Vec2): boolean {
    const ok = this.simulation.devDemolishTile({ x: Math.round(position.x), y: Math.round(position.y) });
    if (ok) this.render();
    return ok;
  }

  /** Dev tool: tear down the whole building under the clicked tile. */
  devDemolishBuildingAt(position: Vec2): boolean {
    const ok = this.simulation.devDemolishBuildingAt({ x: Math.round(position.x), y: Math.round(position.y) });
    if (ok) this.render();
    return ok;
  }

  /** Top up every material in the warehouse. */
  devFillMaterials() {
    this.simulation.store("wood", 300);
    this.simulation.store("stone", 300);
    this.simulation.store("ironOre", 200);
    this.simulation.store("steel", 200);
    this.simulation.notifyChanged();
    this.render();
  }

  /** Set every resident's hunger (0 = full, 100 = starving). */
  devSetAllHunger(hunger: number) {
    for (const a of this.simulation.agents) {
      a.health.hunger = Math.max(0, Math.min(100, hunger));
    }
    this.simulation.notifyChanged();
    this.render();
  }

  /** Fast-forward the simulation by `seconds` of sim time (run in small steps). */
  devAdvanceTime(seconds: number) {
    const step = 0.5;
    const n = Math.min(Math.ceil(seconds / step), 1500);
    for (let i = 0; i < n; i += 1) {
      this.simulation.update(step);
    }
    this.render();
  }

  /** Edit a single resident's needs / mood / vitals (dev sliders). */
  devSetAgent(
    agentId: string,
    patch: {
      mood?: number;
      hunger?: number;
      stamina?: number;
      needs?: Partial<{
        social: number;
        purpose: number;
        faith: number;
        leisure: number;
        comfort: number;
      }>;
    },
  ) {
    const a = this.simulation.agents.find((x) => x.id === agentId);
    if (!a) {
      return;
    }
    if (patch.mood !== undefined) a.mood = Math.max(0, Math.min(100, patch.mood));
    if (patch.hunger !== undefined) a.health.hunger = Math.max(0, Math.min(100, patch.hunger));
    if (patch.stamina !== undefined) a.health.stamina = Math.max(0, Math.min(100, patch.stamina));
    if (patch.needs) {
      for (const [k, v] of Object.entries(patch.needs)) {
        (a.needs as unknown as Record<string, number>)[k] = Math.max(0, Math.min(100, v as number));
      }
    }
    this.simulation.notifyChanged();
    this.render();
  }

  destroy() {
    this.sound.destroy();
    this.renderer.destroy();
  }

  private render() {
    if (!this.started) {
      return;
    }
    const track = this.simulation.coasterTrackTiles();
    this.renderer.render(
      this.simulation.world,
      this.simulation.agents,
      this.placementMode,
      this.simulation.getDarkness(),
      this.simulation.buildings,
      this.simulation.animals,
      this.simulation.getTrainPositions(),
      this.simulation.getPoweredBuildingIds(),
      this.simulation.litter,
      this.simulation.items,
      this.simulation.grainStock,
      this.simulation.meatStock,
      // Only a BUILT funfair has a coaster. A staked/under-construction funfair
      // returns an empty track, so guard the cars on the track being present —
      // otherwise coasterCarTiles() would index an empty ring and crash.
      track,
      track.length > 0 ? this.simulation.coasterCarTiles() : [],
    );
  }
}
