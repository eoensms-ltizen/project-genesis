import { Application, Container, Graphics } from "pixi.js";
import type { Agent, Animal, Building, ItemStack, ResourceKind, TileType, Vec2 } from "../types";
import { ROOM_BUILDING_KINDS } from "../types";
import type { WorldMap } from "../world/WorldMap";

const TILE_SIZE = 16;
// Terrain is drawn in square blocks of this many tiles, each a separate Graphics,
// so changing one tile only rebuilds its block (8×8 = 64 tiles) instead of all.
const CHUNK = 8;
// Zoom the camera snaps to when you start following a resident, so they're framed.
const FOLLOW_ZOOM = 2.6;

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
  // The terrain is split into CHUNK×CHUNK-tile blocks, each its own Graphics, so a
  // single tile change (e.g. a wall laid mid-build) only rebuilds its chunk and
  // its neighbours — not all 4096 tiles. Building bodies sit in their own layer,
  // rebuilt only when the building set changes.
  private readonly terrainLayer = new Container();
  private chunkGraphics: Graphics[] = [];
  private chunkCols = 0;
  private chunkRows = 0;
  private readonly buildingGraphics = new Graphics();
  private readonly overlayGraphics = new Graphics();
  private readonly agentGraphics = new Graphics();
  private readonly nightLayer = new Container();
  private readonly nightGraphics = new Graphics();
  private lastBuildingsKey = "";
  private flatBuildings = false;
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
  // When set, the camera keeps this resident centred each frame (follow mode).
  private followAgentId: string | null = null;
  private followTarget: { x: number; y: number } | null = null;
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
    // z-order within the world: terrain chunks, then building bodies above them
    // (so a raised 2.5D body overlaps the terrain behind it), then loose overlays.
    this.worldLayer.addChild(this.terrainLayer);
    this.worldLayer.addChild(this.buildingGraphics);
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
          this.followAgentId = null; // a manual pan breaks out of follow mode
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
    this.followAgentId = null;
  }

  /** Lock the camera onto a resident (or pass null to stop following). */
  setFollowAgent(agentId: string | null) {
    this.followAgentId = agentId;
    // At base zoom the whole valley already fits the screen, so there's no room
    // to recentre. Zoom in when following begins so the resident is actually
    // framed and the camera can track them around the map.
    if (agentId && this.userZoom < FOLLOW_ZOOM) {
      this.userZoom = FOLLOW_ZOOM;
    }
  }

  isFollowing(agentId: string): boolean {
    return this.followAgentId === agentId;
  }

  /** Toggle the 2.5D building "lids" on/off; forces the building layer to redraw. */
  setFlatBuildings(flat: boolean) {
    if (this.flatBuildings === flat) {
      return;
    }
    this.flatBuildings = flat;
    this.lastBuildingsKey = ""; // force the building layer to redraw next frame
  }

  /** Create one Graphics per CHUNK×CHUNK block of tiles, once we know the size. */
  private ensureChunks(world: WorldMap) {
    const cols = Math.ceil(world.width / CHUNK);
    const rows = Math.ceil(world.height / CHUNK);
    if (this.chunkCols === cols && this.chunkRows === rows && this.chunkGraphics.length > 0) {
      return;
    }
    for (const g of this.chunkGraphics) {
      g.destroy();
    }
    this.terrainLayer.removeChildren();
    this.chunkCols = cols;
    this.chunkRows = rows;
    this.chunkGraphics = [];
    for (let i = 0; i < cols * rows; i += 1) {
      const g = new Graphics();
      this.chunkGraphics.push(g);
      this.terrainLayer.addChild(g);
    }
  }

  /** Chunk index containing tile (tx,ty), or -1 if out of bounds. */
  private chunkAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.chunkCols * CHUNK || ty >= this.chunkRows * CHUNK) {
      return -1;
    }
    return Math.floor(ty / CHUNK) * this.chunkCols + Math.floor(tx / CHUNK);
  }

  /** Redraw every tile of one chunk into its own Graphics. */
  private drawChunk(world: WorldMap, ci: number) {
    const g = this.chunkGraphics[ci];
    if (!g) {
      return;
    }
    g.clear();
    const cx = (ci % this.chunkCols) * CHUNK;
    const cy = Math.floor(ci / this.chunkCols) * CHUNK;
    for (let ty = cy; ty < cy + CHUNK && ty < world.height; ty += 1) {
      for (let tx = cx; tx < cx + CHUNK && tx < world.width; tx += 1) {
        const tile = world.getTile({ x: tx, y: ty });
        if (!tile) {
          continue;
        }
        if (tile.type === "Wall") {
          drawWall(g, world, tx, ty);
        } else if (tile.type === "Door") {
          drawDoor(g, tx, ty, wallMask(world, tx, ty));
        } else if (isRockSolid(tile.type)) {
          drawRock(g, tx, ty, tile.type, rockMask(world, tx, ty));
        } else if (tile.type === "Bed" || tile.type === "BedFoot") {
          // A two-tile bed is drawn as one piece: the frame wraps both tiles and
          // the mattress runs unbroken across the seam (needs the neighbour, so
          // it can't live in the per-tile drawTile).
          drawBed(g, world, tx, ty, tile.type === "Bed");
        } else if (tile.type === "BedSite") {
          // The reserved plot likewise reads as one ghost bed, not two squares.
          drawBedSite(g, world, tx, ty);
        } else if (tile.type === "Fence" || tile.type === "FenceGate") {
          // The rail line follows its neighbours (straight runs, corners, the
          // gate), so it needs the surrounding tiles — can't be a per-tile draw.
          drawFence(g, world, tx, ty, tile.type === "FenceGate");
        } else if (tile.type === "Chair") {
          // A chair faces its table, so it needs to know which side the table is on.
          drawChair(g, world, tx, ty);
        } else {
          drawTile(g, tx, ty, tile.type);
        }
      }
    }
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
    items: ItemStack[] = [],
    grainStock = 0,
    meatStock = 0,
    time = 0,
  ) {
    if (!this.initialized) {
      return;
    }

    // Resolve the follow target (if any) before laying out the camera. If the
    // followed resident is gone, drop follow mode.
    if (this.followAgentId) {
      const followed = agents.find((a) => a.id === this.followAgentId);
      this.followTarget = followed ? followed.position : null;
      if (!followed) {
        this.followAgentId = null;
      }
    } else {
      this.followTarget = null;
    }

    this.layoutWorld(world);
    this.ensureChunks(world);

    // Terrain: redraw only the chunks whose tiles changed since last frame (plus
    // neighbours, so wall/rock autotiling seams across chunk borders stay right).
    const dirty = world.consumeDirty();
    if (dirty.all) {
      this.lampCenters = [];
      for (const tile of world.tiles) {
        if (tile.type === "Lamp") {
          this.lampCenters.push({
            x: tile.x * TILE_SIZE + TILE_SIZE / 2,
            y: tile.y * TILE_SIZE + TILE_SIZE / 2,
          });
        }
      }
      for (let ci = 0; ci < this.chunkGraphics.length; ci += 1) {
        this.drawChunk(world, ci);
      }
    } else if (dirty.tiles.length > 0) {
      const chunks = new Set<number>();
      for (const index of dirty.tiles) {
        const tx = index % world.width;
        const ty = Math.floor(index / world.width);
        // The tile's own chunk, plus any neighbour chunk (autotile reads the 8
        // surrounding tiles, so a border change can alter a neighbour's seams).
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const ci = this.chunkAt(tx + dx, ty + dy);
            if (ci >= 0) {
              chunks.add(ci);
            }
          }
        }
      }
      for (const ci of chunks) {
        this.drawChunk(world, ci);
      }
    }

    // Building bodies live in their own layer, rebuilt only when the building set
    // or stages change — construction tile changes never touch this.
    const buildingsKey =
      (this.flatBuildings ? "f" : "r") +
      buildings.map((b) => `${b.id}:${b.stage}:${b.level ?? 0}`).join("|");
    if (dirty.all || buildingsKey !== this.lastBuildingsKey) {
      this.lastBuildingsKey = buildingsKey;
      this.buildingGraphics.clear();
      // Draw north-to-south so a building's raised body overlaps the one behind
      // it (a simple 2.5D depth order). A finished room is drawn from its wall/
      // floor/door tiles (in the terrain layer), so it only gets an emblem here;
      // a room under construction shows its rising tiles and gets no block.
      for (const building of [...buildings].sort((a, b) => a.y - b.y)) {
        if (ROOM_BUILDING_KINDS.has(building.kind) && building.stage === "built") {
          drawRoomMarker(this.buildingGraphics, building);
          continue;
        }
        if (ROOM_BUILDING_KINDS.has(building.kind) && building.stage === "foundation") {
          continue;
        }
        // A finished pasture is drawn from its fence/gate/grass tiles in the
        // terrain layer, like a walled room — no solid body here.
        if (building.kind === "pasture" && building.stage === "built") {
          continue;
        }
        // A finished fairground: plaza/fence come from the terrain layer; the
        // roller-coaster track, supports, station and car are drawn on top here.
        if (building.kind === "funfair" && building.stage === "built") {
          drawFunfair(this.buildingGraphics, building);
          continue;
        }
        drawBuilding(this.buildingGraphics, building, this.flatBuildings);
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
    // Loose material piles waiting to be hauled: a small stack, taller the more
    // has accumulated, coloured by material (wood logs, grey stone, rusty ore).
    for (const stack of items) {
      const sx = stack.position.x * TILE_SIZE;
      const sy = stack.position.y * TILE_SIZE;
      const layers = Math.min(4, Math.max(1, Math.ceil(stack.amount / 3)));
      const [a, b] = resourcePileColors(stack.resource);
      for (let i = 0; i < layers; i += 1) {
        const ly = sy + 11 - i * 2.4;
        this.overlayGraphics.rect(sx + 3, ly, 10, 2);
        this.overlayGraphics.fill({ color: i % 2 === 0 ? a : b, alpha: 0.95 });
        // thin, dark outline so the pile reads crisply against the ground
        this.overlayGraphics.rect(sx + 3, ly, 10, 2);
        this.overlayGraphics.stroke({ width: 0.6, color: 0x1c130a, alpha: 0.9 });
      }
    }

    // The granary's larder, shown as stores on its floor: grain sacks (tan) and
    // meat (red haunches), more of each the fuller the shelf.
    for (const building of buildings) {
      if (building.kind !== "granary" || building.stage !== "built") {
        continue;
      }
      drawGranaryFood(this.overlayGraphics, world, building, grainStock, meatStock);
    }

    // The map-wide roller coaster rides above everything on its pillars — drawn
    // here (over buildings and residents) once a fairground station exists.
    if (buildings.some((b) => b.kind === "funfair" && b.stage === "built")) {
      const track = coasterTrack(world);
      drawCoaster(this.overlayGraphics, track);
      drawCoasterTrain(this.overlayGraphics, track, time);
    }

    // Doors swing open while a resident is passing through them.
    const occupied = new Set(
      agents.map((a) => `${Math.round(a.position.x)},${Math.round(a.position.y)}`),
    );
    for (const building of buildings) {
      if (building.stage !== "built") {
        continue;
      }
      for (const door of building.doors ?? [building.door]) {
        if (occupied.has(`${door.x},${door.y}`)) {
          drawOpenDoor(this.overlayGraphics, door.x, door.y, wallMask(world, door.x, door.y));
        }
      }
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
        // A small warm glow near the building, not a room-filling blob: capped to
        // the building's footprint so it reads as light through the windows.
        const span = Math.min(building.width, building.height) * TILE_SIZE;
        const outer = Math.min(isPowered ? 16 : 13, span * 0.45);
        const haloColor = isPowered ? 0xbfe3ff : 0xffc97a;
        const coreColor = isPowered ? 0xeaf6ff : 0xffe1a6;
        const haloAlpha = isPowered ? 0.22 : 0.14;
        const coreAlpha = isPowered ? 0.42 : 0.26;
        this.nightGraphics.circle(cx, cy, outer);
        this.nightGraphics.fill({ color: haloColor, alpha: darkness * haloAlpha });
        this.nightGraphics.circle(cx, cy, outer * 0.5);
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
    // Follow mode: recompute the pan so the tracked resident sits at screen centre.
    if (this.followTarget) {
      const cx = (this.followTarget.x + 0.5) * TILE_SIZE * scale;
      const cy = (this.followTarget.y + 0.5) * TILE_SIZE * scale;
      this.panX = this.app.screen.width / 2 - this.baseLeft - cx;
      this.panY = this.app.screen.height / 2 - this.baseTop - cy;
      this.clampPan();
    }
    const left = this.baseLeft + this.panX;
    const top = this.baseTop + this.panY;

    for (const layer of [this.worldLayer, this.agentLayer, this.nightLayer]) {
      layer.scale.set(scale);
      layer.position.set(left, top);
    }
  }
}

/**
 * Draw one tile of a bed so the two tiles read as a single piece of furniture: a
 * wooden frame wraps the whole bed, the mattress runs unbroken across the seam
 * (the shared edge has no frame), the pillow sits at the head end, and a turned-
 * down blanket covers the foot. Falls back to a tidy one-tile bed if it has no
 * partner (a tiny room).
 */
function drawBed(graphics: Graphics, world: WorldMap, x: number, y: number, isHead: boolean) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const FRAME = 0x5c3f24;
  const MATTRESS = 0x8a5a86;
  const PILLOW = 0xf3eede;
  const BLANKET = 0x6a4a80;
  const want: TileType = isHead ? "BedFoot" : "Bed";
  // Direction to the partner tile (the rest of this bed), if any.
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const pd = dirs.find((d) => world.getTile({ x: x + d.x, y: y + d.y })?.type === want);

  // Floor underneath, then the frame fills the tile.
  graphics.rect(px, py, TILE_SIZE, TILE_SIZE);
  graphics.fill(tileColor("Floor"));
  graphics.rect(px, py, TILE_SIZE, TILE_SIZE);
  graphics.fill(FRAME);

  // Mattress inset by the frame width on every side EXCEPT the shared seam, so it
  // meets the partner's mattress with no frame line between them.
  const F = 2;
  const left = pd && pd.x === -1 ? 0 : F;
  const right = pd && pd.x === 1 ? 0 : F;
  const top = pd && pd.y === -1 ? 0 : F;
  const bottom = pd && pd.y === 1 ? 0 : F;
  const mx = px + left;
  const my = py + top;
  const mw = TILE_SIZE - left - right;
  const mh = TILE_SIZE - top - bottom;
  graphics.rect(mx, my, mw, mh);
  graphics.fill(MATTRESS);

  if (isHead) {
    // Pillow at the end away from the partner (the head of the bed).
    let r: [number, number, number, number];
    if (pd && pd.x === 1) r = [mx + 1, my + 1, 4, mh - 2];
    else if (pd && pd.x === -1) r = [mx + mw - 5, my + 1, 4, mh - 2];
    else if (pd && pd.y === -1) r = [mx + 1, my + mh - 5, mw - 2, 4];
    else r = [mx + 1, my + 1, mw - 2, 4]; // partner below, or lone bed → pillow on top
    graphics.roundRect(r[0], r[1], r[2], r[3], 1.5);
    graphics.fill(PILLOW);
  } else {
    // Turned-down blanket over the foot, with a lighter fold edge at the seam.
    graphics.rect(mx, my, mw, mh);
    graphics.fill(BLANKET);
    if (pd && pd.x !== 0) {
      const fold = pd.x === -1 ? mx + mw - 2 : mx + 1;
      graphics.rect(fold, my, 1.5, mh);
    } else {
      const fold = pd && pd.y === -1 ? my + mh - 2 : my + 1;
      graphics.rect(mx, fold, mw, 1.5);
    }
    graphics.fill({ color: 0xb6a6c8, alpha: 0.7 });
  }
}

/**
 * A reserved bed plot drawn as one ghost bed: a translucent outline spanning both
 * site tiles (no line down the middle), marking "a bed goes here" before it's
 * built. Mirrors drawBed's seam handling so it reads as a single piece.
 */
function drawBedSite(graphics: Graphics, world: WorldMap, x: number, y: number) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const pd = dirs.find((d) => world.getTile({ x: x + d.x, y: y + d.y })?.type === "BedSite");
  graphics.rect(px, py, TILE_SIZE, TILE_SIZE);
  graphics.fill(tileColor("Floor"));
  // Translucent fill, flush on the seam so the two halves merge into one shape.
  const F = 1.5;
  const left = pd && pd.x === -1 ? 0 : F;
  const right = pd && pd.x === 1 ? 0 : F;
  const top = pd && pd.y === -1 ? 0 : F;
  const bottom = pd && pd.y === 1 ? 0 : F;
  graphics.rect(px + left, py + top, TILE_SIZE - left - right, TILE_SIZE - top - bottom);
  graphics.fill({ color: 0x8a5a86, alpha: 0.18 });
  // Outline only the non-shared edges so the box wraps the whole plot.
  const edge = (x1: number, y1: number, x2: number, y2: number) => {
    graphics.moveTo(px + x1, py + y1);
    graphics.lineTo(px + x2, py + y2);
  };
  const T = TILE_SIZE;
  if (!(pd && pd.y === -1)) edge(left, top, T - right, top);
  if (!(pd && pd.y === 1)) edge(left, T - bottom, T - right, T - bottom);
  if (!(pd && pd.x === -1)) edge(left, top, left, T - bottom);
  if (!(pd && pd.x === 1)) edge(T - right, top, T - right, T - bottom);
  graphics.stroke({ color: 0xb98ab2, width: 1, alpha: 0.85 });
  graphics.circle(px + T / 2, py + T / 2, 1.4);
  graphics.fill({ color: 0xb98ab2, alpha: 0.7 });
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
    // soft, low-contrast outline so the canopy reads against grass without
    // the harsh dark line the walls and material piles use
    graphics.circle(px + 8, py + 6, 6);
    graphics.stroke({ width: 1, color: 0x0c2a12, alpha: 0.45 });
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

  if (type === "Floor") {
    // Interior floorboards.
    for (const row of [4, 8, 12]) {
      graphics.rect(px + 1, py + row, TILE_SIZE - 2, 0.8);
      graphics.fill({ color: 0x33291c, alpha: 0.7 });
    }
  }

  if (type === "RockFloor") {
    // Rough hewn-rock floor left after mining: scattered rubble flecks.
    for (const [sx, sy] of [
      [4, 5],
      [11, 7],
      [7, 12],
    ]) {
      graphics.circle(px + sx, py + sy, 1);
      graphics.fill({ color: 0x33302b, alpha: 0.6 });
    }
  }

  if (type === "Stove") {
    // A dark iron stove with a glowing firebox.
    graphics.rect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    graphics.fill(0x3c352e);
    graphics.rect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    graphics.stroke({ color: 0x20201c, width: 1 });
    graphics.rect(px + 5, py + 8, TILE_SIZE - 10, 4);
    graphics.fill(0xe7873c);
    graphics.circle(px + 8, py + 5, 1.3);
    graphics.fill({ color: 0x8a8f99, alpha: 0.8 });
  }


  if (type === "Counter") {
    // The prep surface beside the stove: a butcher-block top with a cutting board
    // and a knife, so the stove + counter read as one cooking station.
    graphics.rect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    graphics.fill(0x6e5235);
    graphics.rect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    graphics.stroke({ color: 0x3a2c19, width: 1, alpha: 0.85 });
    // lit top edge
    graphics.rect(px + 3, py + 3, TILE_SIZE - 6, 1.4);
    graphics.fill({ color: 0x9a7a52, alpha: 0.85 });
    // a pale cutting board
    graphics.rect(px + 5, py + 7, 6, 4.5);
    graphics.fill(0xcbb487);
    // the knife
    graphics.rect(px + 10.5, py + 6, 0.9, 5);
    graphics.fill({ color: 0xc2c7cc, alpha: 0.9 });
  }

  if (type === "Table") {
    // A solid wooden dining table, nearly filling its tile so a run of tables
    // reads as one long board, with a lit top edge and a set place.
    graphics.rect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    graphics.fill(0x8a6a44);
    graphics.rect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    graphics.stroke({ color: 0x3a2c19, width: 1, alpha: 0.85 });
    graphics.rect(px + 2, py + 2, TILE_SIZE - 4, 1.5);
    graphics.fill({ color: 0xa6855a, alpha: 0.85 });
    graphics.circle(px + 8, py + 9, 2.1);
    graphics.fill(0xe6ddc8);
    graphics.circle(px + 8, py + 9, 2.1);
    graphics.stroke({ color: 0xbdb39a, width: 0.6 });
  }

}

/**
 * A dining chair: a wooden seat with its backrest on the side away from the
 * table it serves, so the diner faces the table. Solid furniture, climbed onto
 * only to sit (see the dining logic).
 */
function drawChair(graphics: Graphics, world: WorldMap, x: number, y: number) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  graphics.rect(px, py, TILE_SIZE, TILE_SIZE);
  graphics.fill(tileColor("Chair"));

  const SEAT = 0x9a6f43;
  const SEAT_HI = 0xba8f5d;
  const FRAME = 0x5c3f24;
  const OUTLINE = 0x2c1d10;

  // The diner faces the adjacent table; the backrest sits on the opposite side.
  const table = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
  ].find((d) => world.getTile({ x: x + d.dx, y: y + d.dy })?.type === "Table");
  const back = table ? { dx: -table.dx, dy: -table.dy } : { dx: 0, dy: -1 };

  // Backrest bar along the back edge.
  if (back.dy < 0) graphics.rect(px + 3, py + 2.4, TILE_SIZE - 6, 2.2);
  else if (back.dy > 0) graphics.rect(px + 3, py + TILE_SIZE - 4.6, TILE_SIZE - 6, 2.2);
  else if (back.dx < 0) graphics.rect(px + 2.4, py + 3, 2.2, TILE_SIZE - 6);
  else graphics.rect(px + TILE_SIZE - 4.6, py + 3, 2.2, TILE_SIZE - 6);
  graphics.fill(FRAME);

  // Seat.
  graphics.roundRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8, 2);
  graphics.fill(SEAT);
  graphics.roundRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8, 2);
  graphics.stroke({ color: OUTLINE, width: 1, alpha: 0.8 });
  graphics.rect(px + 5, py + 5, TILE_SIZE - 10, 1.5);
  graphics.fill({ color: SEAT_HI, alpha: 0.85 });
}

/**
 * A post-and-rail fence whose rails follow the run: a beam reaches from the tile
 * centre toward each neighbouring fence/gate tile, so straight runs and corners
 * join cleanly (no stray horizontal bars on a vertical stretch). A capped post
 * sits at the centre over the joint, with a soft ground shadow for depth. A gate
 * is lighter, hangs slightly ajar, and leaves the middle open.
 */
function drawFence(graphics: Graphics, world: WorldMap, x: number, y: number, isGate: boolean) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const cx = px + TILE_SIZE / 2;
  const cy = py + TILE_SIZE / 2;
  const half = TILE_SIZE / 2;

  // Grass underneath the rails.
  graphics.rect(px, py, TILE_SIZE, TILE_SIZE);
  graphics.fill(tileColor("Fence"));

  const linked = (dx: number, dy: number): boolean => {
    const t = world.getTile({ x: x + dx, y: y + dy })?.type;
    return t === "Fence" || t === "FenceGate";
  };
  const dirs: Array<{ on: boolean; dx: number; dy: number }> = [
    { on: linked(0, -1), dx: 0, dy: -1 },
    { on: linked(0, 1), dx: 0, dy: 1 },
    { on: linked(1, 0), dx: 1, dy: 0 },
    { on: linked(-1, 0), dx: -1, dy: 0 },
  ];
  const anyLink = dirs.some((d) => d.on);
  const runHoriz = dirs[2].on || dirs[3].on;

  const RAIL = isGate ? 0xb89358 : 0x9a7548;
  const RAIL_HI = isGate ? 0xd6b67e : 0xbb945e;
  const POST = 0x6a4a2c;
  const POST_HI = 0x8c6a40;
  const OUTLINE = 0x2c1d10;
  const RW = 3.2; // rail thickness

  // A beam from the centre toward each linked edge (half a tile each).
  const beam = (dx: number, dy: number, w: number): [number, number, number, number] =>
    dx !== 0
      ? [dx < 0 ? px : cx, cy - w / 2, half, w]
      : [cx - w / 2, dy < 0 ? py : cy, w, half];

  // Soft ground shadow, offset down-right, under each beam.
  for (const d of dirs) {
    if (!d.on) continue;
    const [bx, by, bw, bh] = beam(d.dx, d.dy, RW);
    graphics.rect(bx + 1.3, by + 1.4, bw, bh);
  }
  if (!anyLink) {
    graphics.rect(px + 3.3, cy - RW / 2 + 1.4, TILE_SIZE - 6, RW);
  }
  graphics.fill({ color: 0x14250f, alpha: 0.32 });

  // The rails themselves.
  for (const d of dirs) {
    if (!d.on) continue;
    const [bx, by, bw, bh] = beam(d.dx, d.dy, RW);
    graphics.rect(bx, by, bw, bh);
  }
  if (!anyLink) {
    graphics.rect(px + 3, cy - RW / 2, TILE_SIZE - 6, RW); // a lone stub of rail
  }
  graphics.fill(RAIL);

  // A lit top edge along each rail for a rounded, sunny look.
  for (const d of dirs) {
    if (!d.on) continue;
    const [bx, by, bw] = beam(d.dx, d.dy, RW);
    graphics.rect(bx, by, d.dx !== 0 ? bw : 1, d.dx !== 0 ? 1 : half);
  }
  graphics.fill({ color: RAIL_HI, alpha: 0.85 });

  if (isGate) {
    // Posts flank the opening (across the run); a lighter leaf hangs ajar, swung
    // a little into the yard, and the middle is left clear so folk can pass.
    const P = 4.2;
    const posts = runHoriz
      ? [
          { x: px + 1.6, y: cy },
          { x: px + TILE_SIZE - 1.6, y: cy },
        ]
      : [
          { x: cx, y: py + 1.6 },
          { x: cx, y: py + TILE_SIZE - 1.6 },
        ];
    for (const p of posts) {
      graphics.rect(p.x - P / 2, p.y - P / 2, P, P);
      graphics.fill(POST);
      graphics.rect(p.x - P / 2, p.y - P / 2, P, P);
      graphics.stroke({ color: OUTLINE, width: 1, alpha: 0.8 });
    }
    // The ajar leaf: a short lighter plank angled off one post into the yard.
    if (runHoriz) {
      graphics.rect(px + 2.2, cy - 1, 6.5, 2);
      graphics.fill({ color: RAIL_HI, alpha: 0.95 });
      graphics.rect(px + 7.5, cy - 4.2, 2, 4.2);
      graphics.fill({ color: RAIL, alpha: 0.95 });
    } else {
      graphics.rect(cx - 1, py + 2.2, 2, 6.5);
      graphics.fill({ color: RAIL_HI, alpha: 0.95 });
      graphics.rect(cx, py + 7.5, 4.2, 2);
      graphics.fill({ color: RAIL, alpha: 0.95 });
    }
    return;
  }

  // A capped post at the centre, sitting over the rail joint.
  const P = 5;
  graphics.rect(cx - P / 2, cy - P / 2, P, P);
  graphics.fill(POST);
  graphics.rect(cx - P / 2, cy - P / 2, P, P);
  graphics.stroke({ color: OUTLINE, width: 1, alpha: 0.85 });
  // A lit cap (top-left) so the post reads as raised.
  graphics.rect(cx - P / 2 + 0.9, cy - P / 2 + 0.9, P - 2.6, 1.6);
  graphics.fill({ color: POST_HI, alpha: 0.95 });
}

/** Draw the granary's stores: grain sacks and meat laid out on its floor. */
function drawGranaryFood(
  graphics: Graphics,
  world: WorldMap,
  building: Building,
  grain: number,
  meat: number,
) {
  const interior: Vec2[] = [];
  for (let fy = 1; fy < building.height - 1; fy += 1) {
    for (let fx = 1; fx < building.width - 1; fx += 1) {
      const x = building.x + fx;
      const y = building.y + fy;
      if (world.getTile({ x, y })?.type === "Floor") {
        interior.push({ x, y });
      }
    }
  }
  if (interior.length === 0) {
    return;
  }
  interior.sort((a, b) => a.y - b.y || a.x - b.x);
  const PER_TILE = 12; // one full sack/haunch ≈ this many units
  let grainTiles = grain > 0 ? Math.max(1, Math.ceil(grain / PER_TILE)) : 0;
  let meatTiles = meat > 0 ? Math.max(1, Math.ceil(meat / PER_TILE)) : 0;
  if (grainTiles + meatTiles > interior.length) {
    const total = grainTiles + meatTiles;
    grainTiles = Math.round((interior.length * grainTiles) / total);
    meatTiles = interior.length - grainTiles;
  }
  let idx = 0;
  for (let i = 0; i < grainTiles && idx < interior.length; i += 1, idx += 1) {
    drawGrainSack(graphics, interior[idx]);
  }
  for (let i = 0; i < meatTiles && idx < interior.length; i += 1, idx += 1) {
    drawMeatStore(graphics, interior[idx]);
  }
}

function drawGrainSack(graphics: Graphics, tile: Vec2) {
  const px = tile.x * TILE_SIZE;
  const py = tile.y * TILE_SIZE;
  graphics.roundRect(px + 3.5, py + 5, 9, 8.5, 2);
  graphics.fill({ color: 0xcaa15c });
  graphics.roundRect(px + 3.5, py + 5, 9, 8.5, 2);
  graphics.stroke({ width: 0.6, color: 0x6b4f23, alpha: 0.9 });
  // cinched neck + tie
  graphics.rect(px + 6, py + 3.6, 4, 2.4);
  graphics.fill({ color: 0xb08a4c });
  // a lit seam down the front
  graphics.rect(px + 5, py + 8, 6, 1);
  graphics.fill({ color: 0xe6c884, alpha: 0.7 });
}

function drawMeatStore(graphics: Graphics, tile: Vec2) {
  const px = tile.x * TILE_SIZE;
  const py = tile.y * TILE_SIZE;
  graphics.ellipse(px + 8, py + 9, 5, 4);
  graphics.fill({ color: 0xb05242 });
  graphics.ellipse(px + 8, py + 9, 5, 4);
  graphics.stroke({ width: 0.6, color: 0x5e231c, alpha: 0.9 });
  // protruding bone
  graphics.roundRect(px + 10.5, py + 8, 3.6, 1.8, 0.9);
  graphics.fill({ color: 0xe8ddc8 });
  // a streak of fat catching the light
  graphics.ellipse(px + 6.6, py + 8, 1.7, 1);
  graphics.fill({ color: 0xd98b78, alpha: 0.85 });
}

function resourcePileColors(resource: ResourceKind): [number, number] {
  switch (resource) {
    case "stone":
      return [0x9a948a, 0x787169];
    case "ironOre":
      return [0x8a7a66, 0xb5763e];
    case "steel":
      return [0x9fb0bd, 0x6c7c88];
    default:
      return [0x8a6a44, 0x6f5436]; // wood
  }
}

function rockBaseColor(type: TileType): number {
  switch (type) {
    case "RockSandstone":
      return 0x9c8a63;
    case "RockLimestone":
      return 0x8f8e84;
    case "RockGranite":
      return 0x6f6a70;
    case "OreIron":
      return 0x6b6660;
    default:
      return 0x6f6a70;
  }
}

function isRockSolid(type: TileType | undefined): boolean {
  return (
    type === "RockSandstone" ||
    type === "RockLimestone" ||
    type === "RockGranite" ||
    type === "OreIron"
  );
}

function rockMask(world: WorldMap, x: number, y: number): number {
  let mask = 0;
  if (isRockSolid(world.getTile({ x, y: y - 1 })?.type)) mask |= N;
  if (isRockSolid(world.getTile({ x: x + 1, y })?.type)) mask |= E;
  if (isRockSolid(world.getTile({ x, y: y + 1 })?.type)) mask |= S;
  if (isRockSolid(world.getTile({ x: x - 1, y })?.type)) mask |= W;
  return mask;
}

/**
 * Solid rock cell. Like walls, edge light/shadow is drawn only on faces with no
 * adjacent rock, so an outcrop reads as one connected mass with a cliff edge.
 * Iron ore glints with rusty flecks.
 */
function drawRock(graphics: Graphics, x: number, y: number, type: TileType, mask: number) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const S_ = TILE_SIZE;
  graphics.rect(px, py, S_, S_);
  graphics.fill(rockBaseColor(type));
  // Mineral speckle.
  for (const [sx, sy] of [
    [4, 5],
    [11, 4],
    [7, 11],
    [13, 12],
  ]) {
    graphics.circle(px + sx, py + sy, 1);
    graphics.fill({ color: 0x000000, alpha: 0.12 });
  }
  if (type === "OreIron") {
    for (const [sx, sy] of [
      [5, 6],
      [10, 9],
      [8, 3],
    ]) {
      graphics.circle(px + sx, py + sy, 1.5);
      graphics.fill(0xb5763e);
    }
    for (const [sx, sy] of [
      [12, 6],
      [6, 12],
    ]) {
      graphics.circle(px + sx, py + sy, 1);
      graphics.fill(0x8a5a30);
    }
  }
  // Cliff edge shading on exposed faces.
  if (!(mask & N)) {
    graphics.rect(px, py, S_, 2.5);
    graphics.fill({ color: 0xffffff, alpha: 0.12 });
  }
  if (!(mask & S)) {
    graphics.rect(px, py + S_ - 3, S_, 3);
    graphics.fill({ color: 0x000000, alpha: 0.3 });
  }
  if (!(mask & W)) {
    graphics.rect(px, py, 2.5, S_);
    graphics.fill({ color: 0x000000, alpha: 0.12 });
  }
  if (!(mask & E)) {
    graphics.rect(px + S_ - 2.5, py, 2.5, S_);
    graphics.fill({ color: 0x000000, alpha: 0.18 });
  }
}

// Wall/door neighbour bits, so walls render as one connected mass (RimWorld-style
// auto-linking) and doors orient along the wall they break.
const N = 1;
const E = 2;
const S = 4;
const W = 8;

function isStructural(world: WorldMap, x: number, y: number): boolean {
  const t = world.getTile({ x, y })?.type;
  return t === "Wall" || t === "Door";
}

function wallMask(world: WorldMap, x: number, y: number): number {
  let mask = 0;
  if (isStructural(world, x, y - 1)) mask |= N;
  if (isStructural(world, x + 1, y)) mask |= E;
  if (isStructural(world, x, y + 1)) mask |= S;
  if (isStructural(world, x - 1, y)) mask |= W;
  return mask;
}

/**
 * A timbered wall cell, full-tile so a run reads as one solid connected mass
 * (no gaps). It's embossed/raised: a lit top face and soft shadow at the base,
 * with the bevel drawn ONLY on sides that have no wall/door neighbour — so the
 * interior of a wall run stays flat and corners knit into a clean raised outline
 * (no internal seams or black edges).
 */
function drawWall(graphics: Graphics, world: WorldMap, x: number, y: number) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const S_ = TILE_SIZE;
  const body = 0x8a6638; // warm tan timber
  const lite = 0xb18a4e; // lit top edge
  const shade = 0x6f5230; // gentle inner shade toward the base
  const outline = 0x32230f; // dark outline around the wall mass
  // Only another wall joins us flush (no outline there). Every other side — the
  // outdoors, the room, OR a doorway — is an edge of the wall mass and gets the
  // dark outline. Outlining the door-facing edge caps the wall at the opening, so
  // the jamb is closed (the door tile itself draws no building outline).
  const joins = (dx: number, dy: number): boolean => {
    return world.getTile({ x: x + dx, y: y + dy })?.type === "Wall";
  };
  const edgeN = !joins(0, -1), edgeS = !joins(0, 1), edgeW = !joins(-1, 0), edgeE = !joins(1, 0);

  graphics.rect(px, py, S_, S_);
  graphics.fill(body);

  // Slight raised shading: a lit band under an open top edge, a soft shade above
  // an open bottom edge — gives the timber a little depth before the outline.
  const OL = 2;
  if (edgeN) {
    graphics.rect(px, py + OL, S_, 2);
    graphics.fill({ color: lite, alpha: 0.8 });
  }
  if (edgeS) {
    graphics.rect(px, py + S_ - OL - 2.5, S_, 2.5);
    graphics.fill({ color: shade, alpha: 0.85 });
  }

  // Dark outline on every open edge (none between joined wall cells), so the run
  // reads as one timbered mass with a crisp border and clean corners.
  if (edgeN) {
    graphics.rect(px, py, S_, OL);
    graphics.fill(outline);
  }
  if (edgeS) {
    graphics.rect(px, py + S_ - OL, S_, OL);
    graphics.fill(outline);
  }
  if (edgeW) {
    graphics.rect(px, py, OL, S_);
    graphics.fill(outline);
  }
  if (edgeE) {
    graphics.rect(px + S_ - OL, py, OL, S_);
    graphics.fill(outline);
  }
}

/** A door drawn open (leaf swung against the jamb) while someone passes through. */
function drawOpenDoor(graphics: Graphics, x: number, y: number, mask: number) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const S_ = TILE_SIZE;
  // Cover the closed slab with a clear threshold, then a thin open leaf to one side.
  graphics.rect(px, py, S_, S_);
  graphics.fill(0x4a3b2a);
  const alongHorizontal = Boolean(mask & E) || Boolean(mask & W);
  if (alongHorizontal) {
    graphics.rect(px + 1, py + S_ / 2 - 3.5, 2.5, 7);
  } else {
    graphics.rect(px + S_ / 2 - 3.5, py + 1, 7, 2.5);
  }
  graphics.fill(0x7a5a36);
}

const DOOR_OUTLINE = 0x32230f; // matches the wall outline
const DOOR_LEAF = 0x7c5c34;

/** A door slab set into the wall it breaks, oriented along the wall's run. The
 * door itself carries no building outline — the flanking walls cap the opening. */
function drawDoor(graphics: Graphics, x: number, y: number, mask: number) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const S_ = TILE_SIZE;
  graphics.rect(px, py, S_, S_);
  graphics.fill(0x4a3b2a);
  const alongHorizontal = Boolean(mask & E) || Boolean(mask & W);
  if (alongHorizontal) {
    graphics.rect(px + 1, py + S_ / 2 - 4, S_ - 2, 8);
    graphics.fill(DOOR_LEAF);
    graphics.rect(px + 1, py + S_ / 2 - 4, S_ - 2, 8);
    graphics.stroke({ color: DOOR_OUTLINE, width: 1, alpha: 0.9 });
  } else {
    graphics.rect(px + S_ / 2 - 4, py + 1, 8, S_ - 2);
    graphics.fill(DOOR_LEAF);
    graphics.rect(px + S_ / 2 - 4, py + 1, 8, S_ - 2);
    graphics.stroke({ color: DOOR_OUTLINE, width: 1, alpha: 0.9 });
  }
}

/**
 * A small emblem on a walled room's floor so you can tell what it's for at a
 * glance. The house (resident sleeps inside) and warehouse (piles show inside)
 * need no emblem.
 */
function drawRoomMarker(graphics: Graphics, building: Building) {
  // House (sleeper), warehouse (piles) and kitchen (stove) identify themselves
  // by what's inside — no emblem needed.
  if (
    building.kind === "house" ||
    building.kind === "bedroom" || // a bedroom shows its bed inside, like a house
    building.kind === "warehouse" ||
    building.kind === "granary" || // shows its grain/meat stores inside
    building.kind === "kitchen"
  ) {
    return;
  }
  const cx = (building.x + building.width / 2) * TILE_SIZE;
  const cy = (building.y + building.height / 2) * TILE_SIZE;
  const palette = buildingPalette(building.kind, 1);
  graphics.circle(cx, cy, 5);
  graphics.fill({ color: palette.roof, alpha: 0.95 });
  graphics.circle(cx, cy, 5);
  graphics.stroke({ color: 0x000000, width: 1, alpha: 0.25 });
  // A tiny hint glyph for a few rooms.
  if (building.kind === "church") {
    graphics.rect(cx - 0.7, cy - 3, 1.4, 6);
    graphics.fill(0xf0ead8);
    graphics.rect(cx - 2.5, cy - 1.2, 5, 1.4);
    graphics.fill(0xf0ead8);
  } else if (building.kind === "smelter") {
    graphics.circle(cx, cy, 1.8);
    graphics.fill(0xe7873c);
  }
}

// A long, organic roller coaster that sprawls across the WHOLE map and rides up
// on pillars over the rooftops (RollerCoaster-Tycoon style), not a small loop
// boxed in a footprint. Fixed normalised waypoints (smoothly curved), scaled to
// the map; each point carries `e` = height 0..1, which drives the 2.5D look:
// higher track is lifted up-screen, drawn thicker (perspective), and over any
// track it crosses.
const COASTER_WAYPOINTS: { x: number; y: number; e: number }[] = [
  { x: 0.5, y: 0.86, e: 0.0 }, // station (low, front)
  { x: 0.74, y: 0.84, e: 0.18 },
  { x: 0.88, y: 0.7, e: 0.5 },
  { x: 0.91, y: 0.48, e: 0.95 }, // big lift hill (right)
  { x: 0.76, y: 0.4, e: 0.6 },
  { x: 0.62, y: 0.5, e: 0.28 },
  { x: 0.67, y: 0.64, e: 0.12 }, // inner curl
  { x: 0.55, y: 0.71, e: 0.2 },
  { x: 0.45, y: 0.62, e: 0.42 },
  { x: 0.47, y: 0.46, e: 0.66 },
  { x: 0.58, y: 0.32, e: 0.4 },
  { x: 0.74, y: 0.22, e: 0.7 },
  { x: 0.6, y: 0.12, e: 0.9 }, // far hill (top)
  { x: 0.4, y: 0.14, e: 0.55 },
  { x: 0.22, y: 0.24, e: 0.8 }, // left hill
  { x: 0.12, y: 0.46, e: 0.46 },
  { x: 0.16, y: 0.68, e: 0.24 },
  { x: 0.3, y: 0.82, e: 0.08 },
];

let coasterCache: { key: string; pts: CoasterPoint[] } | null = null;

/** The map-wide coaster centreline (ground px + height), Catmull-Rom-smoothed. */
function coasterTrack(world: WorldMap): CoasterPoint[] {
  const key = `${world.width}x${world.height}`;
  if (coasterCache && coasterCache.key === key) {
    return coasterCache.pts;
  }
  const W = world.width * TILE_SIZE;
  const H = world.height * TILE_SIZE;
  const wp = COASTER_WAYPOINTS.map((p) => ({ x: p.x * W, y: p.y * H, e: p.e }));
  const n = wp.length;
  const PER = 10;
  const pts: CoasterPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const p0 = wp[(i - 1 + n) % n];
    const p1 = wp[i];
    const p2 = wp[(i + 1) % n];
    const p3 = wp[(i + 2) % n];
    for (let j = 0; j < PER; j += 1) {
      const t = j / PER;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push({
        x: cr(p0.x, p1.x, p2.x, p3.x),
        y: cr(p0.y, p1.y, p2.y, p3.y),
        elev: Math.max(0, Math.min(1, cr(p0.e, p1.e, p2.e, p3.e))),
      });
    }
  }
  // Signature features, spliced in highest-index-first so earlier indices stay
  // valid: a helix (spiral tower) and several big vertical loops.
  insertHelix(pts, Math.floor(pts.length * 0.8), 3, 24, 1.5);
  insertVerticalLoop(pts, Math.floor(pts.length * 0.62), 24);
  insertVerticalLoop(pts, Math.floor(pts.length * 0.42), 22);
  insertVerticalLoop(pts, Math.floor(pts.length * 0.22), 24);
  insertVerticalLoop(pts, Math.floor(pts.length * 0.08), 22);
  coasterCache = { key, pts };
  return pts;
}

type CoasterPoint = { x: number; y: number; elev: number; noPillar?: boolean };

/**
 * Splice a vertical loop-the-loop into the track at `atIndex`. Drawn as a circle
 * in the screen-x / height plane (camera-facing), so it's always cleanly round
 * (radius R) regardless of which way the track runs there, and returns to the
 * entry point so the track flows on.
 */
function insertVerticalLoop(pts: CoasterPoint[], atIndex: number, R: number) {
  const a = pts[atIndex];
  const loop: CoasterPoint[] = [];
  const STEPS = 30;
  for (let k = 1; k < STEPS; k += 1) {
    const th = (k / STEPS) * Math.PI * 2;
    loop.push({
      x: a.x + R * Math.sin(th),
      y: a.y,
      elev: a.elev + (R * (1 - Math.cos(th))) / COASTER_LIFT_PX, // peak 2R at the top
      noPillar: true,
    });
  }
  pts.splice(atIndex + 1, 0, ...loop);
}

/**
 * Splice a helix (spiral tower) into the track at `atIndex`: the track winds
 * `turns` times around a centre (radius R) while it climbs to a peak and back,
 * so the stacked loops read as a corkscrew tower in the 2.5D view. Returns to the
 * entry point and entry height, so the loop stays closed.
 */
function insertHelix(pts: CoasterPoint[], atIndex: number, turns: number, R: number, peak: number) {
  const a = pts[atIndex];
  const cx = a.x - R; // so theta=0 starts at the entry point
  const cy = a.y;
  const helix: CoasterPoint[] = [];
  const PER_TURN = 20;
  const total = turns * PER_TURN;
  for (let k = 1; k < total; k += 1) {
    const th = (k / PER_TURN) * Math.PI * 2;
    const frac = k / total;
    helix.push({
      x: cx + R * Math.cos(th),
      y: cy + R * Math.sin(th),
      elev: a.elev + peak * Math.sin(frac * Math.PI), // up to the peak, then back down
      noPillar: true,
    });
  }
  pts.splice(atIndex + 1, 0, ...helix);
}

const COASTER_LIFT_PX = 34; // screen-px an elev-1 stretch rises above its footprint

/**
 * Draw the elevated coaster: purple pillars up from the ground footprint, a yellow
 * track riding on top — lifted up-screen and drawn thicker the higher it climbs
 * (perspective), with higher track drawn over the track it crosses.
 */
function drawCoaster(graphics: Graphics, pts: CoasterPoint[]) {
  const N = pts.length;
  const up = (p: { y: number; elev: number }) => p.y - p.elev * COASTER_LIFT_PX;
  // Pillars from the ground up to the lifted track (skip loop points — a pillar
  // through a loop would look wrong).
  for (let i = 0; i < N; i += 3) {
    const p = pts[i];
    if (p.noPillar) {
      continue;
    }
    graphics.ellipse(p.x, p.y, 1.6, 0.9);
    graphics.fill({ color: 0x2c1f49, alpha: 0.45 }); // foot shadow
    graphics.moveTo(p.x, p.y);
    graphics.lineTo(p.x, up(p));
    graphics.stroke({ color: 0x7a57b0, width: 1.1 + p.elev * 1.9, alpha: 0.9 });
  }
  // Track segments, low elevation first so higher track overdraws crossings.
  const order = Array.from({ length: N }, (_, i) => i).sort(
    (a, b) => pts[a].elev + pts[(a + 1) % N].elev - (pts[b].elev + pts[(b + 1) % N].elev),
  );
  for (const i of order) {
    const a = pts[i];
    const b = pts[(i + 1) % N];
    const ax = a.x;
    const ay = up(a);
    const bx = b.x;
    const by = up(b);
    const e = (a.elev + b.elev) / 2;
    const w = 3 + e * 5.5; // thicker the higher it climbs
    graphics.moveTo(ax, ay);
    graphics.lineTo(bx, by);
    graphics.stroke({ color: 0x6e4a0c, width: w + 2.6, alpha: 1 }); // dark underside
    graphics.moveTo(ax, ay);
    graphics.lineTo(bx, by);
    graphics.stroke({ color: 0xf2c83a, width: w, alpha: 1 }); // yellow track
    graphics.moveTo(ax, ay);
    graphics.lineTo(bx, by);
    graphics.stroke({ color: 0xfff0a6, width: Math.max(0.6, w * 0.32), alpha: 0.7 }); // highlight
  }
}

const COASTER_CAR_COLORS = [0xff4d4d, 0x4f8de0, 0xf2c33a, 0x57c46a, 0xb066d8, 0xff944d];
const COASTER_LOOP_SECONDS = 16; // time for the train to make one full circuit

/**
 * Draw the moving train: a string of cars riding the elevated track, advancing
 * by `time` so they sweep the whole circuit — through the loops and the helix.
 */
function drawCoasterTrain(graphics: Graphics, pts: CoasterPoint[], time: number) {
  const N = pts.length;
  if (N < 2) {
    return;
  }
  const up = (p: CoasterPoint) => p.y - p.elev * COASTER_LIFT_PX;
  const at = (f: number) => {
    const i0 = ((Math.floor(f) % N) + N) % N;
    const i1 = (i0 + 1) % N;
    const tt = f - Math.floor(f);
    const a = pts[i0];
    const b = pts[i1];
    return { x: a.x + (b.x - a.x) * tt, y: up(a) + (up(b) - up(a)) * tt, elev: a.elev + (b.elev - a.elev) * tt };
  };
  const head = ((time / COASTER_LOOP_SECONDS) * N) % N;
  const CARS = 6;
  const GAP = 2.4;
  for (let c = CARS - 1; c >= 0; c -= 1) {
    const p = at(((head - c * GAP) % N + N) % N);
    const w = 4.4 + p.elev * 1.6; // a touch bigger up high, matching the track
    graphics.roundRect(p.x - w / 2, p.y - w / 2, w, w, 1.6);
    graphics.fill(COASTER_CAR_COLORS[c % COASTER_CAR_COLORS.length]);
    graphics.roundRect(p.x - w / 2, p.y - w / 2, w, w, 1.6);
    graphics.stroke({ color: 0x241509, width: 0.8, alpha: 0.95 });
    graphics.circle(p.x, p.y - 1, 1); // a rider's head
    graphics.fill({ color: 0xf0e0c0, alpha: 0.9 });
  }
}

/** Draw a finished fairground's compact station (the coaster track is map-wide). */
function drawFunfair(graphics: Graphics, building: Building) {
  const cx = (building.x + building.width / 2) * TILE_SIZE;
  const by = (building.y + building.height - 1) * TILE_SIZE;
  graphics.roundRect(cx - 12, by - 9, 24, 9, 2);
  graphics.fill({ color: 0x8a6a44, alpha: 0.95 });
  graphics.roundRect(cx - 12, by - 9, 24, 9, 2);
  graphics.stroke({ color: 0x4a3722, width: 1, alpha: 0.9 });
  graphics.rect(cx - 1, by - 12, 2, 4);
  graphics.fill(0xe8d27a);
}

function drawBuilding(graphics: Graphics, building: Building, flat: boolean) {
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

  const level =
    building.level ??
    ((building.capacity ?? 1) >= 24
      ? 4
      : (building.capacity ?? 1) >= 12
        ? 3
        : (building.capacity ?? 1) >= 6
          ? 2
          : 1);
  const palette = buildingPalette(building.kind, level);

  // Flat (top-down) mode: just the footprint, so the layout is easy to read
  // while the town is being built. No raised "lid" obscuring what's underneath.
  if (flat) {
    graphics.rect(px, py, w, h);
    graphics.fill(palette.roof);
    graphics.rect(px + 0.5, py + 0.5, w - 1, h - 1);
    graphics.stroke({ color: palette.wall, width: 1 });
    for (const door of building.doors ?? [building.door]) {
      graphics.rect(door.x * TILE_SIZE + 3, door.y * TILE_SIZE + 4, TILE_SIZE - 6, TILE_SIZE - 5);
      graphics.fill(0x2c2118);
    }
    return;
  }

  // --- Everything else is drawn as a 2.5D block rising above its footprint. ---
  const lift = buildingLift(building.kind, level);
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
  // An opening at each entrance, on whichever side it faces the street.
  const doors = building.doors ?? [building.door];
  for (const door of doors) {
    const sx = door.x * TILE_SIZE;
    const sy = door.y * TILE_SIZE;
    graphics.rect(sx + 3, sy + 4, TILE_SIZE - 6, TILE_SIZE - 5);
    graphics.fill(0x2c2118);
  }
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
    case "smelter":
      return 20;
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
    case "granary":
      // A warm barn: straw-gold roof over timber walls.
      return { roof: 0xb98a3e, wall: 0x8a6a44 };
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
    case "smelter":
      return { roof: 0x52483f, wall: 0x6e5a48 };
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
  hauler: 0xc27b3e,
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

  // A resident carrying a load (hauled material, or wood for building) shows a
  // small bundle slung on their back, coloured by what it is.
  const carried: ResourceKind | undefined =
    agent.carry?.resource ?? (agent.inventory.wood > 0 ? "wood" : undefined);
  if (carried) {
    const [color] = resourcePileColors(carried);
    graphics.rect(px - 3.4, py - radius - 3.4, 6.8, 2.6);
    graphics.fill({ color, alpha: 0.95 });
    graphics.stroke({ color: 0x4f3c25, width: 0.6, alpha: 0.9 });
  }

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
    case "Wall":
      return 0x6b6258;
    case "Floor":
      return 0x4a3b2a;
    case "Door":
      return 0x4a3b2a;
    case "RockSandstone":
      return 0x9c8a63;
    case "RockLimestone":
      return 0x8f8e84;
    case "RockGranite":
      return 0x6f6a70;
    case "OreIron":
      return 0x6b6660;
    case "RockFloor":
      return 0x4f4a44;
    case "Stove":
      return 0x4a3b2a;
    case "Counter":
      return 0x4a3b2a;
    case "Bed":
      return 0x4a3b2a;
    case "BedFoot":
      return 0x4a3b2a;
    case "BedSite":
      return 0x4a3b2a; // floor tone; the ghost outline is drawn on top
    case "Table":
      return 0x4a3b2a;
    case "Chair":
      return 0x4a3b2a;
    case "Fence":
      return 0x3f5a26; // pasture grass under the rails
    case "FenceGate":
      return 0x3f5a26;
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
