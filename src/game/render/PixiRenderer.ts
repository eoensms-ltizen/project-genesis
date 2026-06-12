import { Application, Container, Graphics } from "pixi.js";
import type { Agent, TileType, Vec2 } from "../types";
import type { WorldMap } from "../world/WorldMap";

const TILE_SIZE = 16;

type RendererOptions = {
  onTileClick: (position: Vec2) => void;
};

export class PixiRenderer {
  private readonly host: HTMLElement;
  private readonly options: RendererOptions;
  private readonly app = new Application();
  private readonly worldLayer = new Container();
  private readonly agentLayer = new Container();
  private initialized = false;

  constructor(host: HTMLElement, options: RendererOptions) {
    this.host = host;
    this.options = options;
  }

  async init() {
    await this.app.init({
      antialias: false,
      background: "#101310",
      resizeTo: this.host,
    });

    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.worldLayer);
    this.app.stage.addChild(this.agentLayer);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (event) => {
      const local = this.worldLayer.toLocal(event.global);
      this.options.onTileClick({
        x: Math.floor(local.x / TILE_SIZE),
        y: Math.floor(local.y / TILE_SIZE),
      });
    });

    this.initialized = true;
  }

  render(world: WorldMap, agents: Agent[], placementMode: boolean) {
    if (!this.initialized) {
      return;
    }

    this.worldLayer.removeChildren();
    this.agentLayer.removeChildren();
    this.layoutWorld(world);

    const graphics = new Graphics();
    for (const tile of world.tiles) {
      drawTile(graphics, tile.x, tile.y, tile.type);
    }
    this.worldLayer.addChild(graphics);

    const agentGraphics = new Graphics();
    for (const agent of agents) {
      drawAgent(agentGraphics, agent);
      if (agent.target) {
        drawTarget(agentGraphics, agent.target);
      }
    }
    this.agentLayer.addChild(agentGraphics);

    if (placementMode) {
      const overlay = new Graphics();
      overlay.rect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);
      overlay.stroke({ color: 0xd7b65f, width: 3, alpha: 0.9 });
      this.worldLayer.addChild(overlay);
    }
  }

  destroy() {
    if (!this.initialized) {
      return;
    }

    this.app.destroy({ removeView: true }, { children: true });
    this.initialized = false;
  }

  private layoutWorld(world: WorldMap) {
    const worldPixelWidth = world.width * TILE_SIZE;
    const worldPixelHeight = world.height * TILE_SIZE;
    const scale = Math.max(
      0.6,
      Math.min(this.app.screen.width / worldPixelWidth, this.app.screen.height / worldPixelHeight),
    );
    const left = Math.max(0, (this.app.screen.width - worldPixelWidth * scale) / 2);
    const top = Math.max(0, (this.app.screen.height - worldPixelHeight * scale) / 2);

    this.worldLayer.scale.set(scale);
    this.agentLayer.scale.set(scale);
    this.worldLayer.position.set(left, top);
    this.agentLayer.position.set(left, top);
  }
}

function drawTile(graphics: Graphics, x: number, y: number, type: TileType) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const color = tileColor(type);

  graphics.rect(px, py, TILE_SIZE, TILE_SIZE);
  graphics.fill(color);

  if (type === "Tree") {
    graphics.rect(px + 6, py + 8, 4, 7);
    graphics.fill(0x6d4b2d);
    graphics.circle(px + 8, py + 6, 6);
    graphics.fill(0x153f1f);
  }

  if (type === "HouseSite") {
    graphics.rect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    graphics.stroke({ color: 0xe8d16f, width: 2 });
  }
}

function drawAgent(graphics: Graphics, agent: Agent) {
  const px = agent.position.x * TILE_SIZE + TILE_SIZE / 2;
  const py = agent.position.y * TILE_SIZE + TILE_SIZE / 2;

  graphics.circle(px, py, 4.6);
  graphics.fill(0xf2e6bd);
  graphics.circle(px + 1.5, py - 1.5, 1.4);
  graphics.fill(0x20231d);
}

function drawTarget(graphics: Graphics, target: Vec2) {
  const px = target.x * TILE_SIZE;
  const py = target.y * TILE_SIZE;

  graphics.rect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);
  graphics.stroke({ color: 0xffffff, width: 1, alpha: 0.65 });
}

function tileColor(type: TileType): number {
  switch (type) {
    case "Grass":
      return 0x243c24;
    case "Tree":
      return 0x1f351d;
    case "Water":
      return 0x17434a;
    case "Dirt":
      return 0x5d4a34;
    case "Road":
      return 0x706a5f;
    case "HouseSite":
      return 0x39402a;
  }
}
