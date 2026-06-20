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

  /** Instantly raise a finished building near the village centre. Returns false
   *  if no clear site was found. */
  devBuild(kind: BuildingKind): boolean {
    const sizes: Partial<Record<BuildingKind, [number, number]>> = {
      house: [5, 5],
      warehouse: [4, 4],
      granary: [4, 4],
      kitchen: [4, 4],
      funfair: [8, 6],
      pasture: [6, 6],
      cemetery: [3, 3],
      park: [3, 3],
    };
    const [w, h] = sizes[kind] ?? [4, 4];
    const c = this.simulation.villageCenter();
    const origin = { x: Math.round(c.x), y: Math.round(c.y) };
    const site = this.simulation.world.findBuildingSite(origin, w, h, (p) =>
      this.simulation.isTileClaimed(p),
    );
    if (!site) {
      return false;
    }
    const building = this.simulation.registerBuilding({
      kind,
      x: site.x,
      y: site.y,
      width: w,
      height: h,
      door: { x: site.x + Math.floor(w / 2), y: site.y + h - 1 },
    });
    this.simulation.claimBuildingFootprint(building);
    this.simulation.setBuildingStage(building, "built");
    this.simulation.notifyChanged();
    this.render();
    return true;
  }

  destroy() {
    this.renderer.destroy();
  }

  private render() {
    if (!this.started) {
      return;
    }
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
      this.simulation.hasAnyFunfair() ? this.simulation.coasterTrackTiles() : [],
      this.simulation.hasAnyFunfair() ? this.simulation.coasterCarTiles() : [],
    );
  }
}
