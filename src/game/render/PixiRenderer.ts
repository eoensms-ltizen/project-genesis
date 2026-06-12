import { Application, Container, Graphics } from "pixi.js";
import type { Agent, Building, TileType, Vec2 } from "../types";
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
  // Graphics are created once and reused: recreating them every frame leaks
  // GPU geometry (removeChildren does not destroy) and crashes mobile browsers.
  private readonly worldGraphics = new Graphics();
  private readonly overlayGraphics = new Graphics();
  private readonly agentGraphics = new Graphics();
  private readonly nightLayer = new Container();
  private readonly nightGraphics = new Graphics();
  private lastWorldVersion = -1;
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
    this.app.stage.addChild(this.nightLayer);
    this.worldLayer.addChild(this.worldGraphics);
    this.worldLayer.addChild(this.overlayGraphics);
    this.agentLayer.addChild(this.agentGraphics);
    this.nightLayer.addChild(this.nightGraphics);
    this.nightLayer.eventMode = "none";
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

  render(
    world: WorldMap,
    agents: Agent[],
    placementMode: boolean,
    darkness = 0,
    buildings: Building[] = [],
  ) {
    if (!this.initialized) {
      return;
    }

    this.layoutWorld(world);

    if (world.version !== this.lastWorldVersion) {
      this.lastWorldVersion = world.version;
      this.worldGraphics.clear();
      for (const tile of world.tiles) {
        drawTile(this.worldGraphics, tile.x, tile.y, tile.type);
      }
      for (const building of buildings) {
        drawBuilding(this.worldGraphics, building);
      }
    }

    this.agentGraphics.clear();
    for (const agent of agents) {
      drawAgent(this.agentGraphics, agent);
      if (agent.target) {
        drawTarget(this.agentGraphics, agent.target);
      }
    }

    this.overlayGraphics.clear();
    if (placementMode) {
      this.overlayGraphics.rect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);
      this.overlayGraphics.stroke({ color: 0xd7b65f, width: 3, alpha: 0.9 });
    }

    this.nightGraphics.clear();
    if (darkness > 0.02) {
      this.nightGraphics.rect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);
      this.nightGraphics.fill({ color: 0x0a1024, alpha: darkness * 0.55 });

      // Warm window light spills out of finished houses at night.
      for (const building of buildings) {
        if (building.stage !== "built") {
          continue;
        }
        const cx = (building.x + building.width / 2) * TILE_SIZE;
        const cy = (building.y + building.height / 2) * TILE_SIZE;
        this.nightGraphics.circle(cx, cy, 24);
        this.nightGraphics.fill({ color: 0xffc97a, alpha: darkness * 0.16 });
        this.nightGraphics.circle(cx, cy, 10);
        this.nightGraphics.fill({ color: 0xffe1a6, alpha: darkness * 0.32 });
      }
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
    this.nightLayer.scale.set(scale);
    this.worldLayer.position.set(left, top);
    this.agentLayer.position.set(left, top);
    this.nightLayer.position.set(left, top);
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

  if (type === "FieldEmpty" || type === "FieldGrowing" || type === "FieldRipe") {
    for (const row of [4, 8, 12]) {
      graphics.rect(px + 2, py + row, TILE_SIZE - 4, 1.5);
      graphics.fill(0x3c2e1d);
    }
    if (type === "FieldGrowing") {
      for (const [sx, sy] of [
        [4, 3],
        [9, 7],
        [6, 11],
        [12, 11],
      ]) {
        graphics.circle(px + sx, py + sy, 1.3);
        graphics.fill(0x6fae4e);
      }
    }
    if (type === "FieldRipe") {
      for (const [sx, sy] of [
        [4, 3],
        [9, 3],
        [6, 7],
        [12, 7],
        [4, 11],
        [10, 11],
      ]) {
        graphics.circle(px + sx, py + sy, 1.5);
        graphics.fill(0xe3b94e);
      }
    }
  }

  if (type === "Berry") {
    graphics.circle(px + 5, py + 6, 1.6);
    graphics.fill(0xc0394b);
    graphics.circle(px + 10, py + 10, 1.6);
    graphics.fill(0xc0394b);
    graphics.circle(px + 11, py + 5, 1.3);
    graphics.fill(0xa12d3e);
  }

}

function drawBuilding(graphics: Graphics, building: Building) {
  const px = building.x * TILE_SIZE;
  const py = building.y * TILE_SIZE;
  const w = building.width * TILE_SIZE;
  const h = building.height * TILE_SIZE;

  if (building.stage === "site") {
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.stroke({ color: 0xe8d16f, width: 2, alpha: 0.9 });
    for (const [sx, sy] of [
      [px + 2, py + 2],
      [px + w - 6, py + 2],
      [px + 2, py + h - 6],
      [px + w - 6, py + h - 6],
    ]) {
      graphics.rect(sx, sy, 4, 4);
      graphics.fill(0xe8d16f);
    }
    return;
  }

  if (building.stage === "foundation") {
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.fill(0x6b5337);
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.stroke({ color: 0xb08d57, width: 2 });
    for (const [sx, sy] of [
      [px + 4, py + 4],
      [px + w - 9, py + 4],
      [px + 4, py + h - 9],
      [px + w - 9, py + h - 9],
    ]) {
      graphics.rect(sx, sy, 5, 5);
      graphics.fill(0x8a6a44);
    }
    return;
  }

  if (building.kind === "warehouse") {
    // Flat-roofed storehouse with crates by the door.
    graphics.rect(px + 2, py + 6, w - 4, h - 8);
    graphics.fill(0x7d6a4f);
    graphics.rect(px + 1, py + 2, w - 2, 7);
    graphics.fill(0x5d4f3a);
    const doorX = building.door.x * TILE_SIZE + TILE_SIZE / 2;
    graphics.rect(doorX - 4, py + h - 12, 8, 10);
    graphics.fill(0x3a2c1c);
    graphics.rect(px + 4, py + h - 9, 6, 6);
    graphics.fill(0x9a7b4f);
    graphics.rect(px + w - 11, py + h - 9, 6, 6);
    graphics.fill(0x9a7b4f);
    return;
  }

  // Built house: walls, roof, door on the door tile, and a window.
  graphics.rect(px + 3, py + 10, w - 6, h - 13);
  graphics.fill(0x8a6a44);
  graphics.poly([px + 1, py + 13, px + w / 2, py + 1, px + w - 1, py + 13]);
  graphics.fill(0x9c4a38);

  const doorCenterX = building.door.x * TILE_SIZE + TILE_SIZE / 2;
  graphics.rect(doorCenterX - 3, py + h - 12, 6, 9);
  graphics.fill(0x3a2c1c);

  graphics.rect(px + w - 12, py + h - 13, 6, 6);
  graphics.fill(0x2c3a44);
}

function drawAgent(graphics: Graphics, agent: Agent) {
  const px = agent.position.x * TILE_SIZE + TILE_SIZE / 2;
  const py = agent.position.y * TILE_SIZE + TILE_SIZE / 2;

  graphics.circle(px, py, 4.6);
  graphics.fill(0xf2e6bd);
  graphics.circle(px + 1.5, py - 1.5, 1.4);
  graphics.fill(0x20231d);

  if (agent.state === "Chat") {
    drawSpeechBubble(graphics, px, py);
  } else if (agent.state === "Sleep") {
    graphics.circle(px + 5, py - 7, 1.2);
    graphics.fill(0xbfd2e8);
    graphics.circle(px + 8, py - 10, 1.7);
    graphics.fill(0xbfd2e8);
  }
}

function drawSpeechBubble(graphics: Graphics, px: number, py: number) {
  graphics.roundRect(px + 2, py - 15, 14, 9, 3);
  graphics.fill({ color: 0xf7f3e8, alpha: 0.95 });
  graphics.poly([px + 5, py - 6, px + 9, py - 6, px + 4, py - 2]);
  graphics.fill({ color: 0xf7f3e8, alpha: 0.95 });
  for (const dot of [0, 1, 2]) {
    graphics.circle(px + 6 + dot * 3.4, py - 10.5, 1);
    graphics.fill(0x4a4a42);
  }
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
    case "HouseFoundation":
      return 0x4a4034;
    case "House":
      return 0x55452f;
    case "Berry":
      return 0x2c4a28;
    case "FieldEmpty":
      return 0x4d3c26;
    case "FieldGrowing":
      return 0x4d3c26;
    case "FieldRipe":
      return 0x554427;
  }
}
