import { Application, Container, Graphics } from "pixi.js";
import type { Agent, Animal, Building, TileType, Vec2 } from "../types";
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
  // Cached lamp tile centres, refreshed only when the world changes.
  private lampCenters: { x: number; y: number }[] = [];

  // User-controlled camera on top of the fit-to-screen base transform.
  private userZoom = 1;
  private panX = 0;
  private panY = 0;
  private baseScale = 1;
  private baseLeft = 0;
  private baseTop = 0;
  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private dragMoved = false;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;

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

    this.attachCameraControls();

    this.initialized = true;
  }

  /** Pointer drag pans, wheel/pinch zooms, and a clean tap inspects a tile. */
  private attachCameraControls() {
    const canvas = this.app.canvas;
    canvas.style.touchAction = "none";

    const TAP_SLOP = 6;

    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture?.(event.pointerId);
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.activePointers.size === 1) {
        this.dragStart = { x: event.clientX, y: event.clientY, panX: this.panX, panY: this.panY };
        this.dragMoved = false;
      } else if (this.activePointers.size === 2) {
        const [a, b] = [...this.activePointers.values()];
        this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.pinchStartZoom = this.userZoom;
        this.dragStart = null;
      }
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!this.activePointers.has(event.pointerId)) {
        return;
      }
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this.activePointers.size === 2 && this.pinchStartDist > 0) {
        const [a, b] = [...this.activePointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.setZoomAround((this.pinchStartZoom * dist) / this.pinchStartDist, mid);
        return;
      }

      if (this.dragStart) {
        const dx = event.clientX - this.dragStart.x;
        const dy = event.clientY - this.dragStart.y;
        if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) {
          this.dragMoved = true;
        }
        this.panX = this.dragStart.panX + dx;
        this.panY = this.dragStart.panY + dy;
        this.clampPan();
      }
    });

    const endPointer = (event: PointerEvent) => {
      const wasSingle = this.activePointers.size === 1;
      this.activePointers.delete(event.pointerId);
      if (wasSingle && this.dragStart && !this.dragMoved) {
        const rect = canvas.getBoundingClientRect();
        const local = this.worldLayer.toLocal({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
        this.options.onTileClick({
          x: Math.floor(local.x / TILE_SIZE),
          y: Math.floor(local.y / TILE_SIZE),
        });
      }
      if (this.activePointers.size < 2) {
        this.pinchStartDist = 0;
      }
      if (this.activePointers.size === 0) {
        this.dragStart = null;
      }
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
        this.setZoomAround(this.userZoom * factor, {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      },
      { passive: false },
    );
  }

  /** Zoom toward a screen point so the world under it stays put. */
  private setZoomAround(nextZoom: number, screenPoint: { x: number; y: number }) {
    const clamped = Math.max(1, Math.min(6, nextZoom));
    const prevScale = this.baseScale * this.userZoom;
    const nextScale = this.baseScale * clamped;
    if (nextScale === prevScale) {
      return;
    }
    // worldX = (screen - (baseLeft + pan)) / scale must be invariant.
    const originX = this.baseLeft + this.panX;
    const originY = this.baseTop + this.panY;
    const worldX = (screenPoint.x - originX) / prevScale;
    const worldY = (screenPoint.y - originY) / prevScale;
    this.userZoom = clamped;
    this.panX = screenPoint.x - this.baseLeft - worldX * nextScale;
    this.panY = screenPoint.y - this.baseTop - worldY * nextScale;
    this.clampPan();
  }

  private clampPan() {
    const scale = this.baseScale * this.userZoom;
    const worldW = 64 * TILE_SIZE * scale;
    const worldH = 64 * TILE_SIZE * scale;
    const viewW = this.app.screen.width;
    const viewH = this.app.screen.height;
    // Keep at least part of the world on screen.
    const minX = Math.min(0, viewW - this.baseLeft - worldW);
    const maxX = Math.max(0, -this.baseLeft);
    const minY = Math.min(0, viewH - this.baseTop - worldH);
    const maxY = Math.max(0, -this.baseTop);
    this.panX = Math.max(minX, Math.min(maxX, this.panX));
    this.panY = Math.max(minY, Math.min(maxY, this.panY));
  }

  resetCamera() {
    this.userZoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  render(
    world: WorldMap,
    agents: Agent[],
    placementMode: boolean,
    darkness = 0,
    buildings: Building[] = [],
    animals: Animal[] = [],
    trains: Vec2[] = [],
    poweredBuildingIds: string[] = [],
    litter: Vec2[] = [],
  ) {
    if (!this.initialized) {
      return;
    }

    this.layoutWorld(world);

    if (world.version !== this.lastWorldVersion) {
      this.lastWorldVersion = world.version;
      this.worldGraphics.clear();
      this.lampCenters = [];
      for (const tile of world.tiles) {
        drawTile(this.worldGraphics, tile.x, tile.y, tile.type);
        if (tile.type === "Lamp") {
          this.lampCenters.push({
            x: tile.x * TILE_SIZE + TILE_SIZE / 2,
            y: tile.y * TILE_SIZE + TILE_SIZE / 2,
          });
        }
      }
      // Draw north-to-south so a building's raised body overlaps the one behind
      // it (a simple 2.5D depth order).
      for (const building of [...buildings].sort((a, b) => a.y - b.y)) {
        drawBuilding(this.worldGraphics, building);
      }
    }

    this.agentGraphics.clear();
    for (const animal of animals) {
      drawAnimal(this.agentGraphics, animal);
    }
    for (const train of trains) {
      drawTrain(this.agentGraphics, train);
    }
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
    for (const spot of litter) {
      const lx = spot.x * TILE_SIZE;
      const ly = spot.y * TILE_SIZE;
      this.overlayGraphics.circle(lx + 4, ly + 8, 1.4);
      this.overlayGraphics.fill({ color: 0x6b5a3a, alpha: 0.9 });
      this.overlayGraphics.circle(lx + 9, ly + 5, 1.2);
      this.overlayGraphics.fill({ color: 0x7c6a48, alpha: 0.85 });
      this.overlayGraphics.rect(lx + 6, ly + 10, 2.4, 1.4);
      this.overlayGraphics.fill({ color: 0x554631, alpha: 0.85 });
    }

    this.nightGraphics.clear();
    if (darkness > 0.02) {
      this.nightGraphics.rect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);
      this.nightGraphics.fill({ color: 0x0a1024, alpha: darkness * 0.55 });

      // Window light at night: warm for unpowered, bright electric when powered.
      const powered = new Set(poweredBuildingIds);
      for (const building of buildings) {
        if (building.stage !== "built") {
          continue;
        }
        const cx = (building.x + building.width / 2) * TILE_SIZE;
        const cy = (building.y + building.height / 2) * TILE_SIZE;
        const isPowered = powered.has(building.id);
        const outer = isPowered ? 34 : 24;
        const haloColor = isPowered ? 0xbfe3ff : 0xffc97a;
        const coreColor = isPowered ? 0xeaf6ff : 0xffe1a6;
        const haloAlpha = isPowered ? 0.26 : 0.16;
        const coreAlpha = isPowered ? 0.5 : 0.32;
        this.nightGraphics.circle(cx, cy, outer);
        this.nightGraphics.fill({ color: haloColor, alpha: darkness * haloAlpha });
        this.nightGraphics.circle(cx, cy, isPowered ? 14 : 10);
        this.nightGraphics.fill({ color: coreColor, alpha: darkness * coreAlpha });
      }

      // Street lamps light the plaza after dark.
      for (const tile of world.tiles) {
        if (tile.type !== "Lamp") {
          continue;
        }
        const lx = tile.x * TILE_SIZE + TILE_SIZE / 2;
        const ly = tile.y * TILE_SIZE + TILE_SIZE / 2;
        this.nightGraphics.circle(lx, ly, 20);
        this.nightGraphics.fill({ color: 0xffe6a0, alpha: darkness * 0.2 });
        this.nightGraphics.circle(lx, ly, 8);
        this.nightGraphics.fill({ color: 0xfff0c0, alpha: darkness * 0.34 });
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
    this.baseScale = Math.max(
      0.6,
      Math.min(this.app.screen.width / worldPixelWidth, this.app.screen.height / worldPixelHeight),
    );
    this.baseLeft = Math.max(0, (this.app.screen.width - worldPixelWidth * this.baseScale) / 2);
    this.baseTop = Math.max(0, (this.app.screen.height - worldPixelHeight * this.baseScale) / 2);

    const scale = this.baseScale * this.userZoom;
    const left = this.baseLeft + this.panX;
    const top = this.baseTop + this.panY;

    for (const layer of [this.worldLayer, this.agentLayer, this.nightLayer]) {
      layer.scale.set(scale);
      layer.position.set(left, top);
    }
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

  if (type === "Stump") {
    graphics.circle(px + 8, py + 8, 3.4);
    graphics.fill(0x6d4b2d);
    graphics.circle(px + 8, py + 8, 1.6);
    graphics.fill(0x8f6a40);
  }

  if (type === "Plaza") {
    // Paved flagstones.
    graphics.rect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    graphics.stroke({ color: 0x756d5f, width: 1, alpha: 0.6 });
  }

  if (type === "Fountain") {
    graphics.circle(px + 8, py + 8, 6.5);
    graphics.fill(0x6d6557);
    graphics.circle(px + 8, py + 8, 5);
    graphics.fill(0x3f8aa3);
    graphics.circle(px + 8, py + 8, 1.8);
    graphics.fill(0xbfe6f0);
  }

  if (type === "Statue") {
    graphics.rect(px + 4, py + 11, 8, 3);
    graphics.fill(0x6d6557);
    graphics.rect(px + 6.5, py + 4, 3, 8);
    graphics.fill(0xb9b4a6);
    graphics.circle(px + 8, py + 4, 2.2);
    graphics.fill(0xc7c2b4);
  }

  if (type === "Lamp") {
    graphics.rect(px + 7, py + 5, 2, 9);
    graphics.fill(0x4a4438);
    graphics.circle(px + 8, py + 4, 2.4);
    graphics.fill(0xffe6a0);
  }

  if (type === "Rail") {
    graphics.rect(px, py + 4, TILE_SIZE, 1.5);
    graphics.fill(0x6b6a64);
    graphics.rect(px, py + 10, TILE_SIZE, 1.5);
    graphics.fill(0x6b6a64);
    for (const tx of [2, 7, 12]) {
      graphics.rect(px + tx, py + 3, 1.5, 9);
      graphics.fill(0x4a3a26);
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

  if (building.kind === "pasture") {
    // Fenced grazing yard with posts.
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.fill(0x39521f);
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.stroke({ color: 0x8a6a44, width: 2 });
    for (let i = 0; i <= building.width; i += 1) {
      graphics.rect(px + i * TILE_SIZE - 1, py + 1, 2, 4);
      graphics.fill(0x8a6a44);
    }
    return;
  }

  if (building.kind === "park") {
    // Green square with crossing paths, leafy trees, a pond and flower beds.
    graphics.rect(px + 1, py + 1, w - 2, h - 2);
    graphics.fill(0x3f6b32);
    graphics.rect(px + Math.floor(w / 2) - 1, py + 1, 2, h - 2);
    graphics.fill({ color: 0xb6a06a, alpha: 0.6 });
    graphics.rect(px + 1, py + Math.floor(h / 2) - 1, w - 2, 2);
    graphics.fill({ color: 0xb6a06a, alpha: 0.6 });
    // A small pond.
    graphics.circle(px + w - 9, py + 9, 4);
    graphics.fill(0x3f6f8a);
    // Leafy trees scattered across the lawn.
    for (const [tx, ty] of [
      [6, 6],
      [w - 8, h - 9],
      [9, h - 8],
      [w - 12, 7],
    ]) {
      graphics.circle(px + tx, py + ty, 4);
      graphics.fill(0x2f5a26);
      graphics.rect(px + tx - 0.8, py + ty, 1.6, 4);
      graphics.fill(0x5a4326);
    }
    // Flower bed dots.
    graphics.circle(px + 7, py + h - 5, 1.4);
    graphics.fill(0xd98ab0);
    graphics.circle(px + 10, py + h - 6, 1.3);
    graphics.fill(0xe8d16f);
    return;
  }

  if (building.kind === "cemetery") {
    // Quiet walled graveyard with rows of headstones.
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.fill(0x44503a);
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.stroke({ color: 0x6f6552, width: 2 });
    for (let gy = py + 7; gy < py + h - 4; gy += 9) {
      for (let gx = px + 6; gx < px + w - 5; gx += 9) {
        graphics.rect(gx - 1, gy, 2, 5);
        graphics.fill(0xb9bcc2);
        graphics.rect(gx - 2.5, gy + 1, 5, 1.5);
        graphics.fill(0xb9bcc2);
      }
    }
    return;
  }

  // --- Everything else is drawn as a 2.5D block rising above its footprint. ---
  const level =
    building.level ??
    ((building.capacity ?? 1) >= 24
      ? 4
      : (building.capacity ?? 1) >= 12
        ? 3
        : (building.capacity ?? 1) >= 6
          ? 2
          : 1);
  const lift = buildingLift(building.kind, level);
  const palette = buildingPalette(building.kind, level);
  const top = py - lift;
  const doorX = building.door.x * TILE_SIZE + TILE_SIZE / 2;

  // Ground shadow cast to the lower-right.
  graphics.rect(px + 2, py + 3, w - 1, h - 3);
  graphics.fill({ color: 0x0c0f0b, alpha: 0.16 });
  // Front facade from the roof's base down to the footprint's south edge.
  graphics.rect(px, top + h, w, lift);
  graphics.fill(palette.wall);
  graphics.rect(px + w - 3, top + h, 3, lift);
  graphics.fill({ color: 0x000000, alpha: 0.16 });
  // Roof / top face.
  graphics.rect(px, top, w, h);
  graphics.fill(palette.roof);
  graphics.rect(px, top, w, 2);
  graphics.fill({ color: 0xffffff, alpha: 0.12 });
  // Lit windows on the facade (denser for apartments and towers).
  const dense = building.kind === "house" && level >= 3;
  const stepX = dense ? 6 : 8;
  const stepY = dense ? 6 : 7;
  for (let wy = top + h + 3; wy < py + h - 9; wy += stepY) {
    for (let wx = px + 3; wx < px + w - 5; wx += stepX) {
      graphics.rect(wx, wy, 3, 3);
      graphics.fill(0x9fb8cc);
    }
  }
  // Door on the bottom (south) face, on the door column.
  graphics.rect(doorX - 3, py + h - 9, 6, 9);
  graphics.fill(0x2c2118);
  drawRoofAccent(graphics, building.kind, px, w, top, doorX);
}

function buildingLift(kind: Building["kind"], level: number): number {
  switch (kind) {
    case "house":
      return level >= 4 ? 42 : level >= 3 ? 28 : level >= 2 ? 18 : 11;
    case "powerplant":
      return 34;
    case "church":
      return 30;
    case "factory":
      return 28;
    case "police":
      return 18;
    case "kitchen":
      return 17;
    case "warehouse":
      return 16;
    case "station":
      return 16;
    default:
      return 14;
  }
}

function buildingPalette(kind: Building["kind"], level: number): { roof: number; wall: number } {
  switch (kind) {
    case "house":
      return level >= 3 ? { roof: 0x4f5058, wall: 0x6f6552 } : { roof: 0x9c4a38, wall: 0x8a6a44 };
    case "warehouse":
      return { roof: 0x5d4f3a, wall: 0x7d6a4f };
    case "kitchen":
      return { roof: 0x6f7a3e, wall: 0x8a6a44 };
    case "church":
      return { roof: 0x7d8aa0, wall: 0xb8b0a0 };
    case "powerplant":
      return { roof: 0x70747a, wall: 0x5a5e62 };
    case "factory":
      return { roof: 0x4a4038, wall: 0x6e4a3a };
    case "station":
      return { roof: 0x9c4a38, wall: 0x7a5a3a };
    case "police":
      return { roof: 0x3a5a8a, wall: 0x8a8f99 };
    default:
      return { roof: 0x9c4a38, wall: 0x8a6a44 };
  }
}

function drawRoofAccent(
  graphics: Graphics,
  kind: Building["kind"],
  px: number,
  w: number,
  top: number,
  doorX: number,
) {
  if (kind === "church") {
    graphics.rect(doorX - 1.5, top - 9, 3, 11);
    graphics.fill(0xe9e2d0);
    graphics.rect(doorX - 0.75, top - 13, 1.5, 6);
    graphics.fill(0xe9e2d0);
    graphics.rect(doorX - 3, top - 12, 6, 1.6);
    graphics.fill(0xe9e2d0);
  } else if (kind === "factory") {
    graphics.rect(px + 4, top - 10, 3, 11);
    graphics.fill(0x4a4038);
    graphics.rect(px + w - 8, top - 8, 3, 9);
    graphics.fill(0x4a4038);
    graphics.circle(px + 5.5, top - 11, 2.4);
    graphics.fill({ color: 0x9a9488, alpha: 0.55 });
  } else if (kind === "powerplant") {
    graphics.poly([px + 5, top, px + 9, top - 10, px + w - 9, top - 10, px + w - 5, top]);
    graphics.fill(0x70747a);
    graphics.circle(px + w / 2, top - 12, 3.2);
    graphics.fill({ color: 0xd8dce0, alpha: 0.55 });
  } else if (kind === "kitchen") {
    graphics.rect(px + w - 8, top - 7, 3, 9);
    graphics.fill(0x5a5148);
    graphics.circle(px + w - 6.5, top - 8, 2);
    graphics.fill({ color: 0xb0a89a, alpha: 0.5 });
  } else if (kind === "station") {
    graphics.rect(px - 1, top - 2, w + 2, 3);
    graphics.fill(0x9c4a38);
  } else if (kind === "police") {
    graphics.circle(doorX, top - 3, 1.8);
    graphics.fill(0x8fd0ff);
  }
}

const JOB_COLORS: Partial<Record<Agent["job"], number>> = {
  farmer: 0x6fae4e,
  woodcutter: 0x8a6a44,
  cook: 0xe39a4e,
  builder: 0x9aa7b5,
  cleaner: 0x4ec9c9,
  police: 0x4a6ed0,
  mayor: 0xd7b65f,
};

function drawAgent(graphics: Graphics, agent: Agent) {
  const px = agent.position.x * TILE_SIZE + TILE_SIZE / 2;
  const py = agent.position.y * TILE_SIZE + TILE_SIZE / 2;
  const isChild = agent.age < 12;
  const radius = isChild ? 3 : 4.6;

  const jobColor = JOB_COLORS[agent.job];
  if (jobColor !== undefined) {
    graphics.circle(px, py, radius + 1.4);
    graphics.fill({ color: jobColor, alpha: 0.85 });
  }

  graphics.circle(px, py, radius);
  graphics.fill(isChild ? 0xf7ecd0 : 0xf2e6bd);
  graphics.circle(px + radius * 0.33, py - radius * 0.33, isChild ? 1 : 1.4);
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

const ANIMAL_COLORS = {
  deer: 0xb07a48,
  boar: 0x6b5240,
  rabbit: 0xcabfb0,
};

function drawAnimal(graphics: Graphics, animal: Animal) {
  const px = animal.position.x * TILE_SIZE + TILE_SIZE / 2;
  const py = animal.position.y * TILE_SIZE + TILE_SIZE / 2;
  const r = animal.kind === "rabbit" ? 2.6 : animal.kind === "boar" ? 4 : 3.4;

  if (animal.state === "tamed") {
    graphics.circle(px, py, r + 1.5);
    graphics.fill({ color: 0x9ad17a, alpha: 0.6 });
  }
  // Body + head nub so animals read differently from round residents.
  graphics.ellipse(px, py, r + 1.4, r);
  graphics.fill(ANIMAL_COLORS[animal.kind]);
  graphics.circle(px + r, py - r * 0.5, r * 0.5);
  graphics.fill(ANIMAL_COLORS[animal.kind]);
  if (animal.kind === "deer") {
    graphics.rect(px + r - 0.5, py - r * 1.6, 1, 2.4);
    graphics.fill(0x6d4b2d);
  }
}

function drawTrain(graphics: Graphics, train: Vec2) {
  const px = train.x * TILE_SIZE;
  const py = train.y * TILE_SIZE + 2;
  // Locomotive plus two cars trailing behind.
  graphics.rect(px, py, 14, 11);
  graphics.fill(0x2c3138);
  graphics.rect(px + 3, py + 2, 5, 4);
  graphics.fill(0x8fb6d6);
  graphics.rect(px - 16, py + 1, 13, 10);
  graphics.fill(0x4a3f37);
  graphics.rect(px - 31, py + 1, 13, 10);
  graphics.fill(0x4a3f37);
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
    case "Stump":
      return 0x243c24;
    case "Plaza":
      return 0x8d8475;
    case "Fountain":
      return 0x8d8475;
    case "Statue":
      return 0x8d8475;
    case "Lamp":
      return 0x8d8475;
    case "Rail":
      return 0x3a3b38;
  }
}
