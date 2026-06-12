import { PixiRenderer } from "./render/PixiRenderer";
import { Simulation } from "./Simulation";
import type { SimulationSnapshot, Vec2 } from "./types";

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
    );
  }
}
