import { PixiRenderer } from "./render/PixiRenderer";
import { Simulation } from "./Simulation";
import type { InspectionTarget, SimulationSnapshot, Vec2 } from "./types";

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

  setFlatBuildings(flat: boolean) {
    this.renderer.setFlatBuildings(flat);
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
    );
  }
}
