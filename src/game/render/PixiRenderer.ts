import { Application, Assets, Container, Graphics, TilingSprite, type Texture } from "pixi.js";
import skinGroundTextureUrl from "../../assets/skin/colony-ground-texture.png";
import weatherNightOverlayUrl from "../../assets/skin/weather-night-overlay.png";
import type { Agent, AgentState, Animal, Building, BuildingKind, ItemStack, ResourceKind, TileType, Vec2, WeatherState } from "../types";
import { ROOM_BUILDING_KINDS } from "../types";
import type { WorldMap } from "../world/WorldMap";

const TILE_SIZE = 16;
// Terrain is drawn in square blocks of this many tiles, each a separate Graphics,
// so changing one tile only rebuilds its block (8×8 = 64 tiles) instead of all.
const CHUNK = 8;
// Zoom the camera snaps to when you start following a resident, so they're framed.
const FOLLOW_ZOOM = 2.6;
const CLEAR_WEATHER: WeatherState = { kind: "clear", intensity: 1 };

type RendererOptions = {
  onTileClick: (position: Vec2) => void;
  onTileDragStart?: (position: Vec2) => boolean;
  onTileDragMove?: (position: Vec2) => void;
  onTileDragEnd?: (position: Vec2) => void;
};

export type ArchitectDraftPreview =
  | { kind: "rect"; rect: { x: number; y: number; width: number; height: number } }
  | { kind: "tiles"; tiles: Vec2[]; mode: "floor" | "field" | "wall" | "door" | "road" | "erase"; building?: BuildingKind };

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
  private skinTextureLayer: TilingSprite | null = null;
  private weatherTextureLayer: TilingSprite | null = null;
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
  private skinMode = false;
  private forceTerrainRedraw = false;
  private effectTime = 0;
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
  private drawPointerId: number | null = null;
  private dragStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private dragMoved = false;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  // Latest tile the pointer is hovering (null when off-canvas), and the footprint
  // to ghost there for a dev placement (null when no dev tool is armed).
  private hoverTile: Vec2 | null = null;
  private placementPreview: { w: number; h: number; tile: boolean } | null = null;
  private architectDraftPreview: ArchitectDraftPreview | null = null;

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

    const [skinTexture, weatherTexture] = await Promise.all([
      Assets.load<Texture>(skinGroundTextureUrl),
      Assets.load<Texture>(weatherNightOverlayUrl),
    ]);
    const skinTextureLayer = new TilingSprite({
      texture: skinTexture,
      width: 1,
      height: 1,
      tileScale: { x: 0.82, y: 0.82 },
    });
    skinTextureLayer.alpha = 0;
    skinTextureLayer.visible = false;
    this.skinTextureLayer = skinTextureLayer;
    const weatherTextureLayer = new TilingSprite({
      texture: weatherTexture,
      width: 1,
      height: 1,
      tileScale: { x: 1, y: 1 },
    });
    weatherTextureLayer.alpha = 0;
    weatherTextureLayer.visible = false;
    this.weatherTextureLayer = weatherTextureLayer;

    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.worldLayer);
    this.app.stage.addChild(this.agentLayer);
    this.app.stage.addChild(this.nightLayer);
    // z-order within the world: terrain chunks, then building bodies above them
    // (so a raised 2.5D body overlaps the terrain behind it), then loose overlays.
    this.worldLayer.addChild(this.terrainLayer);
    this.worldLayer.addChild(skinTextureLayer);
    this.worldLayer.addChild(this.buildingGraphics);
    this.worldLayer.addChild(this.overlayGraphics);
    this.agentLayer.addChild(this.agentGraphics);
    this.nightLayer.addChild(this.nightGraphics);
    this.nightLayer.addChild(weatherTextureLayer);
    this.nightLayer.eventMode = "none";
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;

    this.attachCameraControls();

    this.initialized = true;
  }

  private screenToTile(event: PointerEvent): Vec2 {
    const rect = this.app.canvas.getBoundingClientRect();
    const local = this.worldLayer.toLocal({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    return {
      x: Math.floor(local.x / TILE_SIZE),
      y: Math.floor(local.y / TILE_SIZE),
    };
  }

  /** Pointer drag pans, wheel/pinch zooms, and a clean tap inspects a tile. */
  private attachCameraControls() {
    const canvas = this.app.canvas;
    canvas.style.touchAction = "none";
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    const TAP_SLOP = 6;

    canvas.addEventListener("pointerdown", (event) => {
      const tile = this.screenToTile(event);
      this.hoverTile = tile;
      if (event.button === 0 && this.options.onTileDragStart?.(tile)) {
        event.preventDefault();
        canvas.setPointerCapture?.(event.pointerId);
        this.drawPointerId = event.pointerId;
        this.dragStart = null;
        this.dragMoved = false;
        return;
      }
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

    // Track the hovered tile so a dev placement can be ghosted under the cursor.
    const updateHover = (event: PointerEvent) => {
      this.hoverTile = this.screenToTile(event);
    };
    canvas.addEventListener("pointermove", (event) => updateHover(event));
    canvas.addEventListener("pointerleave", () => {
      this.hoverTile = null;
    });

    canvas.addEventListener("pointermove", (event) => {
      if (this.drawPointerId === event.pointerId) {
        const tile = this.screenToTile(event);
        this.hoverTile = tile;
        this.options.onTileDragMove?.(tile);
        return;
      }
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
      if (this.drawPointerId === event.pointerId) {
        const tile = this.screenToTile(event);
        this.hoverTile = tile;
        this.options.onTileDragEnd?.(tile);
        this.drawPointerId = null;
        return;
      }
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

  audioFocusWeights(agents: Agent[]): Map<string, number> {
    const weights = new Map<string, number>();
    const scale = this.baseScale * this.userZoom;
    const left = this.baseLeft + this.panX;
    const top = this.baseTop + this.panY;
    const centerX = this.app.screen.width / 2;
    const centerY = this.app.screen.height / 2;
    const audibleRadius = Math.max(140, Math.min(this.app.screen.width, this.app.screen.height) * 0.55);
    const margin = 48;

    for (const agent of agents) {
      const sx = left + (agent.position.x * TILE_SIZE + TILE_SIZE / 2) * scale;
      const sy = top + (agent.position.y * TILE_SIZE + TILE_SIZE / 2) * scale;
      if (
        sx < -margin ||
        sy < -margin ||
        sx > this.app.screen.width + margin ||
        sy > this.app.screen.height + margin
      ) {
        weights.set(agent.id, 0);
        continue;
      }

      const distance = Math.hypot(sx - centerX, sy - centerY);
      const centered = Math.max(0, 1 - distance / audibleRadius);
      const visibleFloor = 0.14;
      const focus = visibleFloor + centered * centered * (1 - visibleFloor);
      weights.set(agent.id, agent.id === this.followAgentId ? Math.max(focus, 1.25) : focus);
    }

    return weights;
  }

  /** Toggle the 2.5D building "lids" on/off; forces the building layer to redraw. */
  setFlatBuildings(flat: boolean) {
    if (this.flatBuildings === flat) {
      return;
    }
    this.flatBuildings = flat;
    this.lastBuildingsKey = ""; // force the building layer to redraw next frame
  }

  setSkinMode(enabled: boolean) {
    if (this.skinMode === enabled) {
      return;
    }
    this.skinMode = enabled;
    this.forceTerrainRedraw = true;
    this.lastBuildingsKey = "";
    this.updateSkinTextureLayer();
  }

  /**
   * Arm (or clear) the placement ghost: while set, a translucent footprint of the
   * given size is drawn under the cursor so you can see exactly what — and where —
   * a dev placement will land before you click. `tile` true draws a single tile.
   */
  setPlacementPreview(spec: { w: number; h: number; tile: boolean } | null) {
    this.placementPreview = spec;
  }

  setArchitectDraftPreview(preview: ArchitectDraftPreview | null) {
    this.architectDraftPreview = preview;
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

  private updateSkinTextureLayer(world?: WorldMap) {
    const layer = this.skinTextureLayer;
    if (!layer) {
      return;
    }
    if (world) {
      layer.setSize(world.width * TILE_SIZE, world.height * TILE_SIZE);
    }
    layer.visible = this.skinMode;
    layer.alpha = this.skinMode ? 0.22 : 0;
  }

  private updateWeatherTextureLayer(world: WorldMap, darkness: number, weather: WeatherState) {
    const layer = this.weatherTextureLayer;
    if (!layer) {
      return;
    }
    layer.setSize(world.width * TILE_SIZE, world.height * TILE_SIZE);
    const wet = weather.kind === "storm" ? 1 : weather.kind === "rain" ? 0.7 : weather.kind === "cloudy" ? 0.24 : 0;
    const alpha = Math.min(0.11, darkness * 0.04 + wet * 0.032 + (weather.kind === "storm" ? weather.intensity * 0.02 : 0));
    layer.visible = alpha > 0.008;
    layer.alpha = alpha;
    layer.tilePosition.set(0, 0);
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
          drawWall(g, world, tx, ty, this.skinMode);
        } else if (tile.type === "Door") {
          drawDoor(g, tx, ty, wallMask(world, tx, ty), this.skinMode);
        } else if (isRockSolid(tile.type)) {
          drawRock(g, tx, ty, tile.type, rockMask(world, tx, ty), this.skinMode);
        } else if (tile.type === "Bed" || tile.type === "BedFoot") {
          // A two-tile bed is drawn as one piece: the frame wraps both tiles and
          // the mattress runs unbroken across the seam (needs the neighbour, so
          // it can't live in the per-tile drawTile).
          drawBed(g, world, tx, ty, tile.type === "Bed", this.skinMode);
        } else if (tile.type === "BedSite") {
          // The reserved plot likewise reads as one ghost bed, not two squares.
          drawBedSite(g, world, tx, ty, this.skinMode);
        } else if (tile.type === "Fence" || tile.type === "FenceGate") {
          // The rail line follows its neighbours (straight runs, corners, the
          // gate), so it needs the surrounding tiles — can't be a per-tile draw.
          drawFence(g, world, tx, ty, tile.type === "FenceGate", this.skinMode);
        } else if (tile.type === "Chair") {
          // A chair faces its table, so it needs to know which side the table is on.
          drawChair(g, world, tx, ty, this.skinMode);
        } else {
          drawTile(g, tx, ty, tile.type, this.skinMode);
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
    weather: WeatherState = CLEAR_WEATHER,
    coasterTrack: Vec2[] = [],
    coasterCars: Vec2[] = [],
  ) {
    if (!this.initialized) {
      return;
    }
    this.effectTime += this.app.ticker.deltaMS / 1000;

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
    this.updateSkinTextureLayer(world);
    this.updateWeatherTextureLayer(world, darkness, weather);

    // Terrain: redraw only the chunks whose tiles changed since last frame (plus
    // neighbours, so wall/rock autotiling seams across chunk borders stay right).
    const dirty = world.consumeDirty();
    if (dirty.all || this.forceTerrainRedraw) {
      this.forceTerrainRedraw = false;
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
      (this.skinMode ? "s" : "c") +
      buildings
        .map((b) =>
          `${b.id}:${b.stage}:${b.level ?? 0}:${
            b.customLayout ? (b.tiles ?? []).map((tile) => `${tile.x},${tile.y}`).join(";") : ""
          }`,
        )
        .join("|");
    if (dirty.all || buildingsKey !== this.lastBuildingsKey) {
      this.lastBuildingsKey = buildingsKey;
      this.buildingGraphics.clear();
      // Draw north-to-south so a building's raised body overlaps the one behind
      // it (a simple 2.5D depth order). A finished room is drawn from its wall/
      // floor/door tiles (in the terrain layer), so it only gets an emblem here;
      // a room under construction shows its rising tiles and gets no block.
      for (const building of [...buildings].sort((a, b) => a.y - b.y)) {
        // Under construction (foundation): every building shows its rising tiles
        // from the terrain layer — no block or work-site box on top.
        if (building.stage === "foundation") {
          continue;
        }
        if (building.stage === "built") {
          if (building.customLayout) {
            drawCustomFloorZone(this.buildingGraphics, building, this.skinMode);
            continue;
          }
          // Finished buildings are drawn from their own tiles in the terrain layer
          // (walls/floor for rooms, fence/grass/plaza for yards). Rooms get a
          // purpose emblem; the fairground gets its coaster station on top.
          if (ROOM_BUILDING_KINDS.has(building.kind)) {
            drawRoomMarker(this.buildingGraphics, building, this.skinMode);
            continue;
          }
          if (building.kind === "funfair") {
            drawFunfair(this.buildingGraphics, building, this.skinMode);
            continue;
          }
          if (building.kind === "pasture") {
            continue;
          }
          // cemetery / park keep their decorative body drawn over their tiles.
        }
        drawBuilding(this.buildingGraphics, building, this.flatBuildings, this.skinMode);
      }
    }

    this.agentGraphics.clear();
    // The flat coaster railway + its cars, drawn first (on the ground, under the
    // residents — riders sit on top) once a fairground station exists. Track and
    // car positions come from the simulation so riding residents line up exactly.
    if (coasterTrack.length > 0 && buildings.some((b) => b.kind === "funfair" && b.stage === "built")) {
      drawCoasterRails(this.agentGraphics, coasterTrack, this.skinMode);
      drawCoasterCars(this.agentGraphics, coasterCars, this.skinMode);
    }
    for (const animal of animals) {
      drawAnimal(this.agentGraphics, animal, this.skinMode);
    }
    for (const train of trains) {
      drawTrain(this.agentGraphics, train, this.skinMode);
    }
    for (const agent of agents) {
      drawWorkEffect(this.agentGraphics, agent, this.skinMode, this.effectTime);
      drawAgent(this.agentGraphics, agent, this.skinMode);
      if (agent.target) {
        drawTarget(this.agentGraphics, agent.target, this.skinMode);
      }
    }

    this.overlayGraphics.clear();
    if (placementMode) {
      this.overlayGraphics.rect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);
      this.overlayGraphics.stroke({ color: this.skinMode ? 0xc6a35f : 0xd7b65f, width: 3, alpha: 0.9 });
    }
    for (const spot of litter) {
      const lx = spot.x * TILE_SIZE;
      const ly = spot.y * TILE_SIZE;
      this.overlayGraphics.circle(lx + 4, ly + 8, 1.4);
      this.overlayGraphics.fill({ color: this.skinMode ? 0x57462d : 0x6b5a3a, alpha: 0.9 });
      this.overlayGraphics.circle(lx + 9, ly + 5, 1.2);
      this.overlayGraphics.fill({ color: this.skinMode ? 0x675234 : 0x7c6a48, alpha: 0.85 });
      this.overlayGraphics.rect(lx + 6, ly + 10, 2.4, 1.4);
      this.overlayGraphics.fill({ color: this.skinMode ? 0x463722 : 0x554631, alpha: 0.85 });
    }
    // Loose material piles waiting to be hauled: a small stack, taller the more
    // has accumulated, coloured by material (wood logs, grey stone, rusty ore).
    for (const stack of items) {
      const sx = stack.position.x * TILE_SIZE;
      const sy = stack.position.y * TILE_SIZE;
      const layers = Math.min(4, Math.max(1, Math.ceil(stack.amount / 3)));
      const [a, b] = resourcePileColors(stack.resource, this.skinMode);
      for (let i = 0; i < layers; i += 1) {
        const ly = sy + 11 - i * 2.4;
        this.overlayGraphics.rect(sx + 3, ly, 10, 2);
        this.overlayGraphics.fill({ color: i % 2 === 0 ? a : b, alpha: 0.95 });
        // thin, dark outline so the pile reads crisply against the ground
        this.overlayGraphics.rect(sx + 3, ly, 10, 2);
        this.overlayGraphics.stroke({ width: 0.6, color: this.skinMode ? 0x120c06 : 0x1c130a, alpha: 0.9 });
      }
    }

    // The granary's larder, shown as stores on its floor: grain sacks (tan) and
    // meat (red haunches), more of each the fuller the shelf.
    for (const building of buildings) {
      if (building.kind !== "granary" || building.stage !== "built") {
        continue;
      }
      drawGranaryFood(this.overlayGraphics, world, building, grainStock, meatStock, this.skinMode);
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
          drawOpenDoor(this.overlayGraphics, door.x, door.y, wallMask(world, door.x, door.y), this.skinMode);
        }
      }
    }

    // Placement ghost: a translucent outline of exactly what a dev tool will drop
    // under the cursor (a building footprint centred on the hover tile, or a single
    // highlighted tile for the road/demolish tools).
    if (this.placementPreview && this.hoverTile) {
      const { w, h, tile } = this.placementPreview;
      const ox = tile ? this.hoverTile.x : this.hoverTile.x - Math.floor(w / 2);
      const oy = tile ? this.hoverTile.y : this.hoverTile.y - Math.floor(h / 2);
      const px = ox * TILE_SIZE;
      const py = oy * TILE_SIZE;
      const color = this.skinMode ? (tile ? 0xd6bd78 : 0x8ebd68) : tile ? 0xffd24a : 0x5fd17a;
      this.overlayGraphics.rect(px, py, w * TILE_SIZE, h * TILE_SIZE);
      this.overlayGraphics.fill({ color, alpha: 0.18 });
      this.overlayGraphics.rect(px, py, w * TILE_SIZE, h * TILE_SIZE);
      this.overlayGraphics.stroke({ color, width: 1.5, alpha: 0.95 });
      // For a building, also mark the doorway tile so the orientation is obvious.
      if (!tile) {
        this.overlayGraphics.rect(
          (ox + Math.floor(w / 2)) * TILE_SIZE,
          (oy + h - 1) * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE,
        );
        this.overlayGraphics.fill({ color: this.skinMode ? 0x5d7fa0 : 0x3a7bd0, alpha: 0.5 });
      }
    }

    drawArchitectDraftPreview(this.overlayGraphics, this.architectDraftPreview, this.skinMode);

    drawWeatherOverlay(this.overlayGraphics, world, weather, this.effectTime, this.skinMode);

    this.nightGraphics.clear();
    if (darkness > 0.02) {
      this.nightGraphics.rect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);
      const stormTint = weather.kind === "storm" || weather.kind === "rain" ? 0.06 * weather.intensity : 0;
      this.nightGraphics.fill({
        color: this.skinMode ? 0x050914 : 0x07101e,
        alpha: darkness * (this.skinMode ? 0.72 : 0.66) + stormTint,
      });

      // Window light at night: warm for unpowered, bright electric when powered.
      const powered = new Set(poweredBuildingIds);
      for (const [index, building] of buildings.entries()) {
        if (building.stage !== "built") {
          continue;
        }
        drawNightBuildingLights(
          this.nightGraphics,
          building,
          powered.has(building.id),
          darkness,
          this.skinMode,
          index,
          this.effectTime,
          weather,
        );
      }

      // Street lamps light the plaza after dark.
      for (const tile of world.tiles) {
        if (tile.type !== "Lamp") {
          continue;
        }
        drawStreetLampGlow(this.nightGraphics, tile.x, tile.y, darkness, this.skinMode, weather);
      }

      drawNightVignette(this.nightGraphics, world, darkness);
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

function drawArchitectDraftPreview(
  graphics: Graphics,
  preview: ArchitectDraftPreview | null,
  skinMode: boolean,
) {
  if (!preview) {
    return;
  }
  if (preview.kind === "rect") {
    const { x, y, width, height } = preview.rect;
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;
    const color = skinMode ? 0xd6bd78 : 0xffd75f;
    graphics.rect(px, py, width * TILE_SIZE, height * TILE_SIZE);
    graphics.fill({ color, alpha: 0.22 });
    graphics.rect(px, py, width * TILE_SIZE, height * TILE_SIZE);
    graphics.stroke({ color, width: 2, alpha: 0.95 });
    graphics.rect((x + Math.floor(width / 2)) * TILE_SIZE, (y + height - 1) * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    graphics.fill({ color: skinMode ? 0x68a6c8 : 0x4aa3ff, alpha: 0.42 });
    return;
  }

  const color = architectPreviewColor(preview, skinMode);
  const alpha =
    preview.mode === "wall" || preview.mode === "door"
      ? 0.32
      : preview.mode === "erase"
        ? 0.2
        : 0.26;
  for (const tile of preview.tiles) {
    const px = tile.x * TILE_SIZE;
    const py = tile.y * TILE_SIZE;
    graphics.rect(px, py, TILE_SIZE, TILE_SIZE);
    graphics.fill({ color, alpha });
    graphics.rect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    graphics.stroke({ color, width: 1.2, alpha: 0.9 });
    if (preview.mode === "door") {
      graphics.rect(px + 4, py + 2, TILE_SIZE - 8, TILE_SIZE - 4);
      graphics.fill({ color: skinMode ? 0x2a1b0f : 0x302218, alpha: 0.5 });
    }
  }
}

function architectPreviewColor(preview: Extract<ArchitectDraftPreview, { kind: "tiles" }>, skinMode: boolean): number {
  if (preview.mode === "erase") {
    return skinMode ? 0xdf6b6b : 0xff5a5a;
  }
  if (preview.mode === "wall") {
    return skinMode ? 0x9a7a4a : 0x8b7a68;
  }
  if (preview.mode === "door") {
    return skinMode ? 0xc48a45 : 0xb87832;
  }
  if (preview.mode === "road") {
    return skinMode ? 0xd6bd78 : 0xffd75f;
  }
  if (preview.mode === "field") {
    return skinMode ? 0x8dae57 : 0x91c85e;
  }
  switch (preview.building) {
    case "warehouse":
      return skinMode ? 0x8fb4c8 : 0x8eb9d6;
    case "granary":
      return skinMode ? 0xbca85a : 0xd2bd5f;
    case "kitchen":
      return skinMode ? 0xcc8c62 : 0xe08f62;
    case "funfair":
      return skinMode ? 0xb26bb5 : 0xd07ad8;
    case "pasture":
      return skinMode ? 0x78a45f : 0x7fbe64;
    default:
      return skinMode ? 0x6fa7c0 : 0x76c9e8;
  }
}

function drawWeatherOverlay(
  graphics: Graphics,
  world: WorldMap,
  weather: WeatherState,
  time: number,
  skinMode: boolean,
) {
  if (weather.kind === "clear") {
    return;
  }

  const worldW = world.width * TILE_SIZE;
  const worldH = world.height * TILE_SIZE;
  const intensity = weather.kind === "cloudy" ? weather.intensity * 0.55 : weather.intensity;
  const tint = weather.kind === "storm" ? 0x6f84a8 : weather.kind === "rain" ? 0x476b82 : 0x465569;
  graphics.rect(0, 0, worldW, worldH);
  graphics.fill({ color: tint, alpha: weather.kind === "cloudy" ? 0.035 : 0.045 + intensity * 0.025 });

  if (weather.kind === "cloudy") {
    for (let i = 0; i < 18; i += 1) {
      const x = fract(i * 0.372 + time * 0.006) * worldW;
      const y = fract(i * 0.618 + Math.sin(time * 0.08) * 0.015) * worldH;
      graphics.ellipse(x, y, 42 + (i % 4) * 13, 16 + (i % 3) * 6);
      graphics.fill({ color: skinMode ? 0x273141 : 0x324051, alpha: 0.022 + intensity * 0.012 });
    }
    return;
  }

  const count = weather.kind === "storm" ? 135 : 90;
  const streak = weather.kind === "storm" ? 12 : 8;
  const speed = weather.kind === "storm" ? 0.74 : 0.48;
  const color = weather.kind === "storm" ? 0xb8d2e7 : 0x9cbac9;
  for (let i = 0; i < count; i += 1) {
    const x = fract(i * 0.754877 + time * 0.035) * worldW;
    const y = fract(i * 0.569841 + time * speed + Math.sin(i) * 0.02) * worldH;
    const dx = weather.kind === "storm" ? -3.8 : -2.4;
    drawStroke(graphics, x, y, x + dx, y + streak, color, weather.kind === "storm" ? 0.7 : 0.55, 0.11 + intensity * 0.06);
  }

  if (weather.kind === "storm") {
    const flash = Math.pow(Math.max(0, Math.sin(time * 0.73 + 1.2)), 28) * intensity;
    if (flash > 0.02) {
      graphics.rect(0, 0, worldW, worldH);
      graphics.fill({ color: 0xa8c8ff, alpha: flash * 0.12 });
    }
  }
}

function drawNightBuildingLights(
  graphics: Graphics,
  building: Building,
  powered: boolean,
  darkness: number,
  skinMode: boolean,
  index: number,
  time: number,
  weather: WeatherState,
) {
  const x = building.x * TILE_SIZE;
  const y = building.y * TILE_SIZE;
  const w = building.width * TILE_SIZE;
  const h = building.height * TILE_SIZE;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const wetBoost = weather.kind === "rain" || weather.kind === "storm" ? 1.28 : 1;
  const pulse = 0.9 + Math.sin(time * 2.2 + index * 1.7) * 0.1;
  const accent = powered
    ? [0x2fe7ef, 0xff3dbd, 0x8f5cff][index % 3]
    : building.kind === "kitchen"
      ? 0xff4eb8
      : building.kind === "church"
        ? 0xb48cff
        : skinMode
          ? [0x24d8e8, 0xff5bc8, 0xffa15c, 0x9e6dff][index % 4]
          : 0xffc16f;
  const core = powered ? (skinMode ? 0xaaf8ff : 0xb8fbff) : skinMode ? 0xffc28a : 0xffd09a;
  const outer = Math.max(12, Math.min(24, Math.min(w, h) * (powered ? 0.52 : 0.38)));

  graphics.circle(cx, cy, outer * 2.1);
  graphics.fill({ color: accent, alpha: darkness * (skinMode ? 0.09 : 0.055) * wetBoost * pulse });
  graphics.circle(cx, cy, outer * 0.86);
  graphics.fill({ color: core, alpha: darkness * (skinMode ? 0.12 : 0.16) * wetBoost });
  graphics.circle(cx, cy, outer * 0.34);
  graphics.fill({ color: core, alpha: darkness * (skinMode ? 0.25 : 0.3) });

  const stripAlpha = darkness * (skinMode ? (powered ? 0.92 : 0.76) : powered ? 0.74 : 0.38) * wetBoost;
  const stripW = Math.max(7, Math.min(16, w * 0.24));
  const stripH = 2.2;
  const inset = 3;
  graphics.rect(x + inset - 1, y + h - 5, stripW + 2, stripH + 2);
  graphics.fill({ color: accent, alpha: stripAlpha * 0.18 });
  graphics.rect(x + inset, y + h - 4, stripW, stripH);
  graphics.fill({ color: accent, alpha: stripAlpha });
  graphics.rect(x + w - stripW - inset - 1, y + 2, stripW + 2, stripH + 2);
  graphics.fill({ color: accent, alpha: stripAlpha * 0.12 });
  graphics.rect(x + w - stripW - inset, y + 3, stripW, stripH);
  graphics.fill({ color: accent, alpha: stripAlpha * 0.68 });

  if (powered || building.kind === "kitchen" || building.kind === "warehouse" || building.kind === "granary") {
    const railH = Math.max(8, h * 0.36);
    graphics.rect(x + w - 5, y + h * 0.24 - 1, 4.2, railH + 2);
    graphics.fill({ color: accent, alpha: stripAlpha * 0.14 });
    graphics.rect(x + w - 4, y + h * 0.24, 2.2, railH);
    graphics.fill({ color: accent, alpha: stripAlpha * 0.84 });
  }

  if (weather.kind === "rain" || weather.kind === "storm") {
    graphics.ellipse(cx, y + h + 3, w * 0.5, 4);
    graphics.fill({ color: accent, alpha: darkness * 0.085 * weather.intensity });
  }
}

function drawStreetLampGlow(
  graphics: Graphics,
  x: number,
  y: number,
  darkness: number,
  skinMode: boolean,
  weather: WeatherState,
) {
  const lx = x * TILE_SIZE + TILE_SIZE / 2;
  const ly = y * TILE_SIZE + TILE_SIZE / 2;
  const wetBoost = weather.kind === "rain" || weather.kind === "storm" ? 1.22 : 1;
  graphics.circle(lx, ly, 32);
  graphics.fill({ color: skinMode ? 0xd98a45 : 0xff9d54, alpha: darkness * 0.08 * wetBoost });
  graphics.circle(lx, ly, 18);
  graphics.fill({ color: skinMode ? 0xe7b566 : 0xffc178, alpha: darkness * 0.18 * wetBoost });
  graphics.circle(lx, ly, 7);
  graphics.fill({ color: skinMode ? 0xf0d49a : 0xfff0c0, alpha: darkness * 0.44 });
}

function drawNightVignette(graphics: Graphics, world: WorldMap, darkness: number) {
  if (darkness < 0.35) {
    return;
  }
  const w = world.width * TILE_SIZE;
  const h = world.height * TILE_SIZE;
  const edge = 70;
  graphics.rect(0, 0, w, edge);
  graphics.fill({ color: 0x000000, alpha: darkness * 0.12 });
  graphics.rect(0, h - edge, w, edge);
  graphics.fill({ color: 0x000000, alpha: darkness * 0.12 });
  graphics.rect(0, 0, edge, h);
  graphics.fill({ color: 0x000000, alpha: darkness * 0.1 });
  graphics.rect(w - edge, 0, edge, h);
  graphics.fill({ color: 0x000000, alpha: darkness * 0.1 });
}

/**
 * Draw one tile of a bed so the two tiles read as a single piece of furniture: a
 * wooden frame wraps the whole bed, the mattress runs unbroken across the seam
 * (the shared edge has no frame), the pillow sits at the head end, and a turned-
 * down blanket covers the foot. Falls back to a tidy one-tile bed if it has no
 * partner (a tiny room).
 */
function drawBed(graphics: Graphics, world: WorldMap, x: number, y: number, isHead: boolean, skinMode = false) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const FRAME = skinMode ? 0x4a321c : 0x5c3f24;
  const MATTRESS = skinMode ? 0x7b5b51 : 0x8a5a86;
  const PILLOW = skinMode ? 0xd8ccb6 : 0xf3eede;
  const BLANKET = skinMode ? 0x4f623d : 0x6a4a80;
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
  graphics.fill(tileColor("Floor", skinMode));
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
function drawBedSite(graphics: Graphics, world: WorldMap, x: number, y: number, skinMode = false) {
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
  graphics.fill(tileColor("Floor", skinMode));
  // Translucent fill, flush on the seam so the two halves merge into one shape.
  const F = 1.5;
  const left = pd && pd.x === -1 ? 0 : F;
  const right = pd && pd.x === 1 ? 0 : F;
  const top = pd && pd.y === -1 ? 0 : F;
  const bottom = pd && pd.y === 1 ? 0 : F;
  graphics.rect(px + left, py + top, TILE_SIZE - left - right, TILE_SIZE - top - bottom);
  graphics.fill({ color: skinMode ? 0xc0a86b : 0x8a5a86, alpha: skinMode ? 0.14 : 0.18 });
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
  graphics.stroke({ color: skinMode ? 0xc0a86b : 0xb98ab2, width: 1, alpha: 0.85 });
  graphics.circle(px + T / 2, py + T / 2, 1.4);
  graphics.fill({ color: skinMode ? 0xd6bd78 : 0xb98ab2, alpha: 0.7 });
}

function drawTile(graphics: Graphics, x: number, y: number, type: TileType, skinMode = false) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const color = tileColor(type, skinMode);

  graphics.rect(px, py, TILE_SIZE, TILE_SIZE);
  graphics.fill(color);

  if (skinMode) {
    drawSkinnedTileDetail(graphics, x, y, type);
    return;
  }

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

function drawSkinnedTileDetail(graphics: Graphics, x: number, y: number, type: TileType) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const S_ = TILE_SIZE;

  if (type === "Grass") {
    for (const [sx, sy, a] of [
      [3, 5, 0.35],
      [11, 3, 0.28],
      [7, 12, 0.3],
    ]) {
      graphics.rect(px + sx, py + sy, 1.4, 3.2);
      graphics.fill({ color: 0x4f6f2e, alpha: a });
    }
    graphics.circle(px + 13, py + 11, 0.9);
    graphics.fill({ color: 0x6b5a37, alpha: 0.35 });
    return;
  }

  if (type === "Dirt" || type === "Road") {
    const dust = type === "Road" ? 0x8a8173 : 0x6a5138;
    for (const [sx, sy, w] of [
      [2, 4, 8],
      [6, 9, 7],
      [3, 13, 5],
    ]) {
      graphics.rect(px + sx, py + sy, w, 1);
      graphics.fill({ color: dust, alpha: type === "Road" ? 0.36 : 0.24 });
    }
    if (type === "Road") {
      graphics.rect(px, py + 1, S_, 1);
      graphics.fill({ color: 0xd0c7b5, alpha: 0.12 });
      graphics.rect(px, py + S_ - 2, S_, 1);
      graphics.fill({ color: 0x1a150f, alpha: 0.16 });
    }
    return;
  }

  if (type === "Water") {
    graphics.rect(px, py, S_, S_);
    graphics.fill({ color: 0x0d2530, alpha: 0.18 });
    for (const [sx, sy, w] of [
      [2, 5, 7],
      [7, 10, 6],
      [4, 13, 10],
    ]) {
      graphics.rect(px + sx, py + sy, w, 1);
      graphics.fill({ color: 0x7da6a7, alpha: 0.22 });
    }
    return;
  }

  if (type === "Tree") {
    graphics.ellipse(px + 8.8, py + 11.2, 5.8, 2.6);
    graphics.fill({ color: 0x0c1309, alpha: 0.24 });
    graphics.rect(px + 6.5, py + 8, 3.2, 6.2);
    graphics.fill(0x5c3a1e);
    graphics.circle(px + 7.2, py + 5.7, 5.7);
    graphics.fill(0x1f431b);
    graphics.circle(px + 10.4, py + 6.5, 4.9);
    graphics.fill(0x274c20);
    graphics.circle(px + 5.2, py + 8.2, 4.4);
    graphics.fill(0x173315);
    graphics.circle(px + 8.5, py + 6.4, 6);
    graphics.stroke({ color: 0x0b1d0c, width: 1, alpha: 0.65 });
    graphics.circle(px + 10.6, py + 4.2, 1.2);
    graphics.fill({ color: 0x8f7a28, alpha: 0.45 });
    return;
  }

  if (type === "Berry") {
    graphics.circle(px + 8, py + 8, 5.4);
    graphics.fill(0x203f1e);
    graphics.circle(px + 5.8, py + 6, 3.8);
    graphics.fill(0x2e5b25);
    graphics.circle(px + 10.8, py + 9.2, 3.4);
    graphics.fill(0x244c20);
    for (const [sx, sy] of [
      [5, 6],
      [9, 5],
      [11, 10],
    ]) {
      graphics.circle(px + sx, py + sy, 1.3);
      graphics.fill(0xb33b42);
    }
    return;
  }

  if (type === "FieldEmpty" || type === "FieldGrowing" || type === "FieldRipe") {
    for (const row of [3.5, 7.5, 11.5]) {
      graphics.rect(px + 1.5, py + row, S_ - 3, 1.2);
      graphics.fill({ color: 0x2f2114, alpha: 0.85 });
      graphics.rect(px + 2, py + row + 1.2, S_ - 4, 0.8);
      graphics.fill({ color: 0x6d5131, alpha: 0.45 });
    }
    if (type !== "FieldEmpty") {
      const crop = type === "FieldRipe" ? 0xd0aa45 : 0x6ca64e;
      for (const [sx, sy] of [
        [4, 4],
        [9, 4],
        [6, 8],
        [12, 8],
        [4, 12],
        [10, 12],
      ]) {
        graphics.rect(px + sx, py + sy - 2, 1.4, 4);
        graphics.fill(crop);
        graphics.circle(px + sx + 0.7, py + sy - 2, 1.2);
        graphics.fill({ color: crop, alpha: 0.85 });
      }
    }
    return;
  }

  if (type === "Stump") {
    graphics.ellipse(px + 8, py + 9.5, 4.6, 3.5);
    graphics.fill(0x67411f);
    graphics.ellipse(px + 8, py + 8, 4, 3);
    graphics.fill(0x8d6236);
    graphics.circle(px + 8, py + 8, 1.8);
    graphics.stroke({ color: 0x4a2d16, width: 0.8, alpha: 0.7 });
    return;
  }

  if (type === "Plaza") {
    graphics.rect(px + 1, py + 1, S_ - 2, S_ - 2);
    graphics.stroke({ color: 0x524e45, width: 1, alpha: 0.7 });
    graphics.moveTo(px + 1, py + 8);
    graphics.lineTo(px + S_ - 1, py + 8);
    graphics.moveTo(px + 8, py + 1);
    graphics.lineTo(px + 8, py + S_ - 1);
    graphics.stroke({ color: 0x5d574d, width: 0.7, alpha: 0.55 });
    return;
  }

  if (type === "Fountain") {
    graphics.circle(px + 8, py + 8, 6.6);
    graphics.fill(0x5e5a50);
    graphics.circle(px + 8, py + 8, 5);
    graphics.fill(0x1f6470);
    graphics.circle(px + 8, py + 8, 2);
    graphics.fill(0xb8d0c9);
    graphics.rect(px + 4, py + 7.5, 8, 1);
    graphics.fill({ color: 0x8fb6b0, alpha: 0.7 });
    return;
  }

  if (type === "Statue") {
    graphics.rect(px + 3.5, py + 11, 9, 3);
    graphics.fill(0x5c574e);
    graphics.rect(px + 6, py + 5, 4, 7);
    graphics.fill(0xa39b8d);
    graphics.circle(px + 8, py + 4.5, 2.1);
    graphics.fill(0xb7afa0);
    graphics.rect(px + 5.2, py + 8, 5.6, 1);
    graphics.fill({ color: 0x777064, alpha: 0.65 });
    return;
  }

  if (type === "Lamp") {
    graphics.rect(px + 7, py + 5, 2, 9);
    graphics.fill(0x383125);
    graphics.circle(px + 8, py + 4.6, 3.2);
    graphics.fill({ color: 0xffd37a, alpha: 0.18 });
    graphics.circle(px + 8, py + 4.6, 1.9);
    graphics.fill(0xffd37a);
    return;
  }

  if (type === "Rail") {
    for (const tx of [2, 7, 12]) {
      graphics.rect(px + tx, py + 3, 1.4, 10);
      graphics.fill(0x45311d);
    }
    graphics.rect(px, py + 4.2, S_, 1.4);
    graphics.fill(0x777b76);
    graphics.rect(px, py + 10.4, S_, 1.4);
    graphics.fill(0x777b76);
    graphics.rect(px, py + 5.5, S_, 0.7);
    graphics.fill({ color: 0xd0d0c6, alpha: 0.2 });
    return;
  }

  if (type === "Floor") {
    for (const row of [3, 7, 11]) {
      graphics.rect(px + 1, py + row, S_ - 2, 1);
      graphics.fill({ color: 0x2d2115, alpha: 0.75 });
    }
    graphics.rect(px + 2, py + 1, 1, S_ - 2);
    graphics.fill({ color: 0x74542f, alpha: 0.18 });
    return;
  }

  if (type === "RockFloor") {
    for (const [sx, sy, r] of [
      [4, 5, 1.2],
      [11, 6, 1],
      [7, 12, 1.4],
      [13, 11, 0.8],
    ]) {
      graphics.circle(px + sx, py + sy, r);
      graphics.fill({ color: 0x2c2924, alpha: 0.65 });
    }
    return;
  }

  if (type === "Stove") {
    graphics.rect(px + 2, py + 2, S_ - 4, S_ - 4);
    graphics.fill(0x2f2c27);
    graphics.rect(px + 2, py + 2, S_ - 4, S_ - 4);
    graphics.stroke({ color: 0x141410, width: 1 });
    graphics.rect(px + 5, py + 8, S_ - 10, 4);
    graphics.fill(0xc56f38);
    graphics.circle(px + 8, py + 5, 1.3);
    graphics.fill({ color: 0xb0aaa0, alpha: 0.8 });
    return;
  }

  if (type === "Counter") {
    graphics.rect(px + 2, py + 2, S_ - 4, S_ - 4);
    graphics.fill(0x5f4328);
    graphics.rect(px + 2, py + 2, S_ - 4, S_ - 4);
    graphics.stroke({ color: 0x2a1b0e, width: 1, alpha: 0.9 });
    graphics.rect(px + 3, py + 3, S_ - 6, 1.4);
    graphics.fill({ color: 0x8c653b, alpha: 0.85 });
    graphics.rect(px + 5, py + 7, 6, 4.5);
    graphics.fill(0xbba579);
    graphics.rect(px + 10.5, py + 6, 0.9, 5);
    graphics.fill({ color: 0xaeb4b6, alpha: 0.9 });
    return;
  }

  if (type === "Table") {
    graphics.rect(px + 1, py + 1, S_ - 2, S_ - 2);
    graphics.fill(0x765231);
    graphics.rect(px + 1, py + 1, S_ - 2, S_ - 2);
    graphics.stroke({ color: 0x2a1b0e, width: 1, alpha: 0.9 });
    graphics.rect(px + 2, py + 2, S_ - 4, 1.5);
    graphics.fill({ color: 0x9a7143, alpha: 0.85 });
    graphics.circle(px + 8, py + 9, 2);
    graphics.fill(0xd8ceb7);
    graphics.circle(px + 8, py + 9, 2);
    graphics.stroke({ color: 0x9c927c, width: 0.6 });
  }
}

/**
 * A dining chair: a wooden seat with its backrest on the side away from the
 * table it serves, so the diner faces the table. Solid furniture, climbed onto
 * only to sit (see the dining logic).
 */
function drawChair(graphics: Graphics, world: WorldMap, x: number, y: number, skinMode = false) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  graphics.rect(px, py, TILE_SIZE, TILE_SIZE);
  graphics.fill(tileColor("Chair", skinMode));

  const SEAT = skinMode ? 0x75502f : 0x9a6f43;
  const SEAT_HI = skinMode ? 0xa27645 : 0xba8f5d;
  const FRAME = skinMode ? 0x46301c : 0x5c3f24;
  const OUTLINE = skinMode ? 0x1f140b : 0x2c1d10;

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
function drawFence(graphics: Graphics, world: WorldMap, x: number, y: number, isGate: boolean, skinMode = false) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const cx = px + TILE_SIZE / 2;
  const cy = py + TILE_SIZE / 2;
  const half = TILE_SIZE / 2;

  // Grass underneath the rails.
  graphics.rect(px, py, TILE_SIZE, TILE_SIZE);
  graphics.fill(tileColor("Fence", skinMode));

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

  const RAIL = skinMode ? (isGate ? 0xa47a46 : 0x7c5a34) : isGate ? 0xb89358 : 0x9a7548;
  const RAIL_HI = skinMode ? (isGate ? 0xc1985b : 0x9d7646) : isGate ? 0xd6b67e : 0xbb945e;
  const POST = skinMode ? 0x56371d : 0x6a4a2c;
  const POST_HI = skinMode ? 0x7a5832 : 0x8c6a40;
  const OUTLINE = skinMode ? 0x1f140b : 0x2c1d10;
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
  graphics.fill({ color: skinMode ? 0x081007 : 0x14250f, alpha: skinMode ? 0.4 : 0.32 });

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
  skinMode = false,
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
    drawGrainSack(graphics, interior[idx], skinMode);
  }
  for (let i = 0; i < meatTiles && idx < interior.length; i += 1, idx += 1) {
    drawMeatStore(graphics, interior[idx], skinMode);
  }
}

function drawGrainSack(graphics: Graphics, tile: Vec2, skinMode = false) {
  const px = tile.x * TILE_SIZE;
  const py = tile.y * TILE_SIZE;
  const sack = skinMode ? 0xb68a48 : 0xcaa15c;
  const edge = skinMode ? 0x513819 : 0x6b4f23;
  const neck = skinMode ? 0x936d38 : 0xb08a4c;
  graphics.roundRect(px + 3.5, py + 5, 9, 8.5, 2);
  graphics.fill({ color: sack });
  graphics.roundRect(px + 3.5, py + 5, 9, 8.5, 2);
  graphics.stroke({ width: 0.6, color: edge, alpha: 0.9 });
  // cinched neck + tie
  graphics.rect(px + 6, py + 3.6, 4, 2.4);
  graphics.fill({ color: neck });
  // a lit seam down the front
  graphics.rect(px + 5, py + 8, 6, 1);
  graphics.fill({ color: 0xe6c884, alpha: 0.7 });
}

function drawMeatStore(graphics: Graphics, tile: Vec2, skinMode = false) {
  const px = tile.x * TILE_SIZE;
  const py = tile.y * TILE_SIZE;
  const meat = skinMode ? 0x8f3e35 : 0xb05242;
  const edge = skinMode ? 0x4a1916 : 0x5e231c;
  graphics.ellipse(px + 8, py + 9, 5, 4);
  graphics.fill({ color: meat });
  graphics.ellipse(px + 8, py + 9, 5, 4);
  graphics.stroke({ width: 0.6, color: edge, alpha: 0.9 });
  // protruding bone
  graphics.roundRect(px + 10.5, py + 8, 3.6, 1.8, 0.9);
  graphics.fill({ color: 0xe8ddc8 });
  // a streak of fat catching the light
  graphics.ellipse(px + 6.6, py + 8, 1.7, 1);
  graphics.fill({ color: 0xd98b78, alpha: 0.85 });
}

function resourcePileColors(resource: ResourceKind, skinMode = false): [number, number] {
  if (skinMode) {
    switch (resource) {
      case "stone":
        return [0x827d73, 0x625d56];
      case "ironOre":
        return [0x756955, 0x9d6738];
      case "steel":
        return [0x8996a0, 0x57636b];
      default:
        return [0x74502f, 0x56381f];
    }
  }

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

function rockBaseColor(type: TileType, skinMode = false): number {
  if (skinMode) {
    switch (type) {
      case "RockSandstone":
        return 0x817050;
      case "RockLimestone":
        return 0x74746b;
      case "RockGranite":
        return 0x5b5860;
      case "OreIron":
        return 0x5c5952;
      default:
        return 0x5b5860;
    }
  }

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
function drawRock(graphics: Graphics, x: number, y: number, type: TileType, mask: number, skinMode = false) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const S_ = TILE_SIZE;
  graphics.rect(px, py, S_, S_);
  graphics.fill(rockBaseColor(type, skinMode));
  // Mineral speckle.
  for (const [sx, sy] of [
    [4, 5],
    [11, 4],
    [7, 11],
    [13, 12],
  ]) {
    graphics.circle(px + sx, py + sy, 1);
    graphics.fill({ color: 0x000000, alpha: skinMode ? 0.18 : 0.12 });
  }
  if (type === "OreIron") {
    for (const [sx, sy] of [
      [5, 6],
      [10, 9],
      [8, 3],
    ]) {
      graphics.circle(px + sx, py + sy, 1.5);
      graphics.fill(skinMode ? 0xa56b37 : 0xb5763e);
    }
    for (const [sx, sy] of [
      [12, 6],
      [6, 12],
    ]) {
      graphics.circle(px + sx, py + sy, 1);
      graphics.fill(skinMode ? 0x774a28 : 0x8a5a30);
    }
  }
  // Cliff edge shading on exposed faces.
  if (!(mask & N)) {
    graphics.rect(px, py, S_, 2.5);
    graphics.fill({ color: 0xffffff, alpha: skinMode ? 0.09 : 0.12 });
  }
  if (!(mask & S)) {
    graphics.rect(px, py + S_ - 3, S_, 3);
    graphics.fill({ color: 0x000000, alpha: skinMode ? 0.38 : 0.3 });
  }
  if (!(mask & W)) {
    graphics.rect(px, py, 2.5, S_);
    graphics.fill({ color: 0x000000, alpha: skinMode ? 0.18 : 0.12 });
  }
  if (!(mask & E)) {
    graphics.rect(px + S_ - 2.5, py, 2.5, S_);
    graphics.fill({ color: 0x000000, alpha: skinMode ? 0.24 : 0.18 });
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
function drawWall(graphics: Graphics, world: WorldMap, x: number, y: number, skinMode = false) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const S_ = TILE_SIZE;
  const body = skinMode ? 0x6f4d2c : 0x8a6638; // warm tan timber
  const lite = skinMode ? 0x9a7443 : 0xb18a4e; // lit top edge
  const shade = skinMode ? 0x4e351f : 0x6f5230; // gentle inner shade toward the base
  const outline = skinMode ? 0x211409 : 0x32230f; // dark outline around the wall mass
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
  if (skinMode) {
    graphics.rect(px + 3, py + 2, S_ - 6, 1);
    graphics.fill({ color: 0xb1844d, alpha: 0.25 });
    graphics.rect(px + 2, py + 7, S_ - 4, 1);
    graphics.fill({ color: 0x3a2415, alpha: 0.2 });
  }

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
function drawOpenDoor(graphics: Graphics, x: number, y: number, mask: number, skinMode = false) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const S_ = TILE_SIZE;
  // Cover the closed slab with a clear threshold, then a thin open leaf to one side.
  graphics.rect(px, py, S_, S_);
  graphics.fill(skinMode ? 0x3f2f1f : 0x4a3b2a);
  const alongHorizontal = Boolean(mask & E) || Boolean(mask & W);
  if (alongHorizontal) {
    graphics.rect(px + 1, py + S_ / 2 - 3.5, 2.5, 7);
  } else {
    graphics.rect(px + S_ / 2 - 3.5, py + 1, 7, 2.5);
  }
  graphics.fill(skinMode ? 0x664529 : 0x7a5a36);
}

const DOOR_OUTLINE = 0x32230f; // matches the wall outline
const DOOR_LEAF = 0x7c5c34;

/** A door slab set into the wall it breaks, oriented along the wall's run. The
 * door itself carries no building outline — the flanking walls cap the opening. */
function drawDoor(graphics: Graphics, x: number, y: number, mask: number, skinMode = false) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const S_ = TILE_SIZE;
  const outline = skinMode ? 0x211409 : DOOR_OUTLINE;
  const leaf = skinMode ? 0x684526 : DOOR_LEAF;
  graphics.rect(px, py, S_, S_);
  graphics.fill(skinMode ? 0x3f2f1f : 0x4a3b2a);
  const alongHorizontal = Boolean(mask & E) || Boolean(mask & W);
  if (alongHorizontal) {
    graphics.rect(px + 1, py + S_ / 2 - 4, S_ - 2, 8);
    graphics.fill(leaf);
    graphics.rect(px + 1, py + S_ / 2 - 4, S_ - 2, 8);
    graphics.stroke({ color: outline, width: 1, alpha: 0.9 });
  } else {
    graphics.rect(px + S_ / 2 - 4, py + 1, 8, S_ - 2);
    graphics.fill(leaf);
    graphics.rect(px + S_ / 2 - 4, py + 1, 8, S_ - 2);
    graphics.stroke({ color: outline, width: 1, alpha: 0.9 });
  }
}

/**
 * A small emblem on a walled room's floor so you can tell what it's for at a
 * glance. The house (resident sleeps inside) and warehouse (piles show inside)
 * need no emblem.
 */
function drawRoomMarker(graphics: Graphics, building: Building, skinMode = false) {
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
  const palette = buildingPalette(building.kind, 1, skinMode);
  graphics.circle(cx, cy, 5);
  graphics.fill({ color: palette.roof, alpha: 0.95 });
  graphics.circle(cx, cy, 5);
  graphics.stroke({ color: skinMode ? 0x1c130a : 0x000000, width: 1, alpha: skinMode ? 0.45 : 0.25 });
  // A tiny hint glyph for a few rooms.
  if (building.kind === "church") {
    graphics.rect(cx - 0.7, cy - 3, 1.4, 6);
    graphics.fill(skinMode ? 0xd8cfb7 : 0xf0ead8);
    graphics.rect(cx - 2.5, cy - 1.2, 5, 1.4);
    graphics.fill(skinMode ? 0xd8cfb7 : 0xf0ead8);
  } else if (building.kind === "smelter") {
    graphics.circle(cx, cy, 1.8);
    graphics.fill(skinMode ? 0xc96d36 : 0xe7873c);
  }
}

function drawCustomFloorZone(graphics: Graphics, building: Building, skinMode = false) {
  const tiles = building.tiles ?? [];
  if (tiles.length === 0) {
    return;
  }
  const color = zoneColorForKind(building.kind, skinMode);
  let sx = 0;
  let sy = 0;
  for (const tile of tiles) {
    const px = tile.x * TILE_SIZE;
    const py = tile.y * TILE_SIZE;
    graphics.rect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    graphics.fill({ color, alpha: skinMode ? 0.12 : 0.1 });
    graphics.rect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    graphics.stroke({ color, width: 0.8, alpha: 0.28 });
    sx += tile.x + 0.5;
    sy += tile.y + 0.5;
  }

  const cx = (sx / tiles.length) * TILE_SIZE;
  const cy = (sy / tiles.length) * TILE_SIZE;
  graphics.circle(cx, cy, 4.2);
  graphics.fill({ color, alpha: 0.9 });
  graphics.circle(cx, cy, 4.2);
  graphics.stroke({ color: skinMode ? 0x1a120b : 0x111111, width: 1, alpha: 0.45 });
}

function zoneColorForKind(kind: BuildingKind, skinMode = false): number {
  switch (kind) {
    case "warehouse":
      return skinMode ? 0x8fb4c8 : 0x8eb9d6;
    case "granary":
      return skinMode ? 0xbca85a : 0xd2bd5f;
    case "kitchen":
      return skinMode ? 0xcc8c62 : 0xe08f62;
    case "funfair":
      return skinMode ? 0xb26bb5 : 0xd07ad8;
    case "pasture":
      return skinMode ? 0x78a45f : 0x7fbe64;
    case "church":
      return skinMode ? 0xd8cfb7 : 0xf0ead8;
    default:
      return skinMode ? 0x6fa7c0 : 0x76c9e8;
  }
}

// The coaster railway + train are drawn FLAT and top-down, in the village train's
// style — no fake perspective, no loops. The centreline and the car positions
// come from the simulation in TILE coords (so riding residents line up exactly
// with the cars); here we just scale to pixels and draw.

/** Unit normal (perpendicular) to the track at point i, for rail offset / ties. */
function coasterNormal(track: Vec2[], i: number): { x: number; y: number } {
  const N = track.length;
  const a = track[(i - 1 + N) % N];
  const b = track[(i + 1) % N];
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const l = Math.hypot(tx, ty) || 1;
  return { x: -ty / l, y: tx / l };
}

/** Draw the flat railway from the tile-coord centreline: sleeper bed, ties, rails. */
function drawCoasterRails(graphics: Graphics, track: Vec2[], skinMode = false) {
  const N = track.length;
  if (N < 2) {
    return;
  }
  const sx = (p: Vec2) => p.x * TILE_SIZE + TILE_SIZE / 2;
  const sy = (p: Vec2) => p.y * TILE_SIZE + TILE_SIZE / 2;
  // Sleeper bed (a dark band under the rails).
  for (let i = 0; i <= N; i += 1) {
    const p = track[i % N];
    if (i === 0) graphics.moveTo(sx(p), sy(p));
    else graphics.lineTo(sx(p), sy(p));
  }
  graphics.stroke({ color: skinMode ? 0x45311f : 0x5a4631, width: 6, alpha: 0.95 });
  // Crossties.
  for (let i = 0; i < N; i += 2) {
    const p = track[i];
    const nrm = coasterNormal(track, i);
    graphics.moveTo(sx(p) - nrm.x * 3.4, sy(p) - nrm.y * 3.4);
    graphics.lineTo(sx(p) + nrm.x * 3.4, sy(p) + nrm.y * 3.4);
    graphics.stroke({ color: skinMode ? 0x291b0f : 0x3a2c1d, width: 1.6, alpha: 0.95 });
  }
  // Two steel rails, offset either side of the centreline.
  const GAUGE = 2.3;
  for (const side of [-1, 1]) {
    for (let i = 0; i <= N; i += 1) {
      const idx = i % N;
      const p = track[idx];
      const nrm = coasterNormal(track, idx);
      const x = sx(p) + nrm.x * GAUGE * side;
      const y = sy(p) + nrm.y * GAUGE * side;
      if (i === 0) graphics.moveTo(x, y);
      else graphics.lineTo(x, y);
    }
    graphics.stroke({ color: skinMode ? 0x777b76 : 0x8d847a, width: 1.4, alpha: 1 });
  }
}

const COASTER_CAR_COLORS = [0xff4d4d, 0x4f8de0, 0xf2c33a, 0x57c46a, 0xb066d8, 0xff944d];

/** Draw the train cars at their current tile positions — riders sit on top of them. */
function drawCoasterCars(graphics: Graphics, cars: Vec2[], skinMode = false) {
  const carColors = skinMode
    ? [0x8f3d32, 0x3f638f, 0xb89035, 0x4d7a3d, 0x76548e, 0xb36535]
    : COASTER_CAR_COLORS;
  for (let c = 0; c < cars.length; c += 1) {
    const cx = cars[c].x * TILE_SIZE + TILE_SIZE / 2;
    const cy = cars[c].y * TILE_SIZE + TILE_SIZE / 2;
    const w = 7.5;
    graphics.roundRect(cx - w / 2, cy - w / 2, w, w, 1.8);
    graphics.fill(c === 0 ? (skinMode ? 0x25282a : 0x2c3138) : carColors[(c - 1) % carColors.length]);
    graphics.roundRect(cx - w / 2, cy - w / 2, w, w, 1.8);
    graphics.stroke({ color: skinMode ? 0x17100a : 0x20160c, width: 0.7, alpha: 0.9 });
  }
}

/** Draw a finished fairground's compact station (the coaster track is map-wide). */
function drawFunfair(graphics: Graphics, building: Building, skinMode = false) {
  const cx = (building.x + building.width / 2) * TILE_SIZE;
  const by = (building.y + building.height - 1) * TILE_SIZE;
  graphics.roundRect(cx - 12, by - 9, 24, 9, 2);
  graphics.fill({ color: skinMode ? 0x6e4d2d : 0x8a6a44, alpha: 0.95 });
  graphics.roundRect(cx - 12, by - 9, 24, 9, 2);
  graphics.stroke({ color: skinMode ? 0x27190d : 0x4a3722, width: 1, alpha: 0.9 });
  graphics.rect(cx - 1, by - 12, 2, 4);
  graphics.fill(skinMode ? 0xd0aa45 : 0xe8d27a);
}

function drawBuilding(graphics: Graphics, building: Building, flat: boolean, skinMode = false) {
  const px = building.x * TILE_SIZE;
  const py = building.y * TILE_SIZE;
  const w = building.width * TILE_SIZE;
  const h = building.height * TILE_SIZE;
  const outline = skinMode ? 0x211409 : 0x4a3722;
  const doorColor = skinMode ? 0x1e150e : 0x2c2118;

  if (building.stage === "site") {
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.stroke({ color: skinMode ? 0xc6a35f : 0xe8d16f, width: 2, alpha: 0.9 });
    for (const [sx, sy] of [
      [px + 2, py + 2],
      [px + w - 6, py + 2],
      [px + 2, py + h - 6],
      [px + w - 6, py + h - 6],
    ]) {
      graphics.rect(sx, sy, 4, 4);
      graphics.fill(skinMode ? 0xc6a35f : 0xe8d16f);
    }
    return;
  }

  if (building.stage === "foundation") {
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.fill(skinMode ? 0x56402a : 0x6b5337);
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.stroke({ color: skinMode ? 0x95703f : 0xb08d57, width: 2 });
    for (const [sx, sy] of [
      [px + 4, py + 4],
      [px + w - 9, py + 4],
      [px + 4, py + h - 9],
      [px + w - 9, py + h - 9],
    ]) {
      graphics.rect(sx, sy, 5, 5);
      graphics.fill(skinMode ? 0x6e4d2d : 0x8a6a44);
    }
    return;
  }

  if (building.kind === "pasture") {
    // Fenced grazing yard with posts.
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.fill(skinMode ? 0x314524 : 0x39521f);
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.stroke({ color: skinMode ? 0x6e4d2d : 0x8a6a44, width: 2 });
    for (let i = 0; i <= building.width; i += 1) {
      graphics.rect(px + i * TILE_SIZE - 1, py + 1, 2, 4);
      graphics.fill(skinMode ? 0x6e4d2d : 0x8a6a44);
    }
    return;
  }

  if (building.kind === "park") {
    // Green square with crossing paths, leafy trees, a pond and flower beds.
    graphics.rect(px + 1, py + 1, w - 2, h - 2);
    graphics.fill(skinMode ? 0x365a2a : 0x3f6b32);
    graphics.rect(px + Math.floor(w / 2) - 1, py + 1, 2, h - 2);
    graphics.fill({ color: skinMode ? 0x9b8350 : 0xb6a06a, alpha: 0.6 });
    graphics.rect(px + 1, py + Math.floor(h / 2) - 1, w - 2, 2);
    graphics.fill({ color: skinMode ? 0x9b8350 : 0xb6a06a, alpha: 0.6 });
    // A small pond.
    graphics.circle(px + w - 9, py + 9, 4);
    graphics.fill(skinMode ? 0x2f6370 : 0x3f6f8a);
    // Leafy trees scattered across the lawn.
    for (const [tx, ty] of [
      [6, 6],
      [w - 8, h - 9],
      [9, h - 8],
      [w - 12, 7],
    ]) {
      graphics.circle(px + tx, py + ty, 4);
      graphics.fill(skinMode ? 0x24451f : 0x2f5a26);
      graphics.rect(px + tx - 0.8, py + ty, 1.6, 4);
      graphics.fill(skinMode ? 0x45301c : 0x5a4326);
    }
    // Flower bed dots.
    graphics.circle(px + 7, py + h - 5, 1.4);
    graphics.fill(skinMode ? 0xb97390 : 0xd98ab0);
    graphics.circle(px + 10, py + h - 6, 1.3);
    graphics.fill(skinMode ? 0xc6a35f : 0xe8d16f);
    return;
  }

  if (building.kind === "cemetery") {
    // Quiet walled graveyard with rows of headstones.
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.fill(skinMode ? 0x3c4533 : 0x44503a);
    graphics.rect(px + 2, py + 2, w - 4, h - 4);
    graphics.stroke({ color: skinMode ? 0x5c5242 : 0x6f6552, width: 2 });
    for (let gy = py + 7; gy < py + h - 4; gy += 9) {
      for (let gx = px + 6; gx < px + w - 5; gx += 9) {
        graphics.rect(gx - 1, gy, 2, 5);
        graphics.fill(skinMode ? 0x9d9c96 : 0xb9bcc2);
        graphics.rect(gx - 2.5, gy + 1, 5, 1.5);
        graphics.fill(skinMode ? 0x9d9c96 : 0xb9bcc2);
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
  const palette = buildingPalette(building.kind, level, skinMode);

  // Flat (top-down) mode: just the footprint, so the layout is easy to read
  // while the town is being built. No raised "lid" obscuring what's underneath.
  if (flat) {
    graphics.rect(px, py, w, h);
    graphics.fill(palette.roof);
    graphics.rect(px + 0.5, py + 0.5, w - 1, h - 1);
    graphics.stroke({ color: palette.wall, width: 1 });
    for (const door of building.doors ?? [building.door]) {
      graphics.rect(door.x * TILE_SIZE + 3, door.y * TILE_SIZE + 4, TILE_SIZE - 6, TILE_SIZE - 5);
      graphics.fill(doorColor);
    }
    return;
  }

  // --- Everything else is drawn as a 2.5D block rising above its footprint. ---
  const lift = buildingLift(building.kind, level);
  const top = py - lift;
  const doorX = building.door.x * TILE_SIZE + TILE_SIZE / 2;

  // Ground shadow cast to the lower-right.
  graphics.rect(px + 2, py + 3, w - 1, h - 3);
  graphics.fill({ color: 0x0c0f0b, alpha: skinMode ? 0.23 : 0.16 });
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
      graphics.fill(skinMode ? 0xcaa85e : 0x9fb8cc);
    }
  }
  // An opening at each entrance, on whichever side it faces the street.
  const doors = building.doors ?? [building.door];
  for (const door of doors) {
    const sx = door.x * TILE_SIZE;
    const sy = door.y * TILE_SIZE;
    graphics.rect(sx + 3, sy + 4, TILE_SIZE - 6, TILE_SIZE - 5);
    graphics.fill(doorColor);
  }
  if (skinMode) {
    graphics.rect(px + 2, top + 3, w - 4, 1.2);
    graphics.fill({ color: 0xffffff, alpha: 0.08 });
    graphics.rect(px + 2, top + h - 4, w - 4, 1.4);
    graphics.fill({ color: 0x000000, alpha: 0.14 });
    graphics.rect(px, top, w, h);
    graphics.stroke({ color: outline, width: 1, alpha: 0.38 });
  }
  drawRoofAccent(graphics, building.kind, px, w, top, doorX, skinMode);
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

function buildingPalette(kind: Building["kind"], level: number, skinMode = false): { roof: number; wall: number } {
  if (skinMode) {
    switch (kind) {
      case "house":
        return level >= 3 ? { roof: 0x45484a, wall: 0x675943 } : { roof: 0x6d4a2e, wall: 0x7b5a38 };
      case "warehouse":
        return { roof: 0x4d4330, wall: 0x6c5b42 };
      case "granary":
        return { roof: 0x8a6931, wall: 0x725133 };
      case "kitchen":
        return { roof: 0x4f5c34, wall: 0x765536 };
      case "church":
        return { roof: 0x697283, wall: 0x9d9584 };
      case "powerplant":
        return { roof: 0x62666a, wall: 0x4b5052 };
      case "factory":
        return { roof: 0x3e3832, wall: 0x5b3f34 };
      case "station":
        return { roof: 0x74402f, wall: 0x65482e };
      case "police":
        return { roof: 0x334c72, wall: 0x777d84 };
      case "smelter":
        return { roof: 0x443d36, wall: 0x5b4c3f };
      default:
        return { roof: 0x6d4a2e, wall: 0x7b5a38 };
    }
  }

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
  skinMode = false,
) {
  if (kind === "church") {
    graphics.rect(doorX - 1.5, top - 9, 3, 11);
    graphics.fill(skinMode ? 0xd1c5ad : 0xe9e2d0);
    graphics.rect(doorX - 0.75, top - 13, 1.5, 6);
    graphics.fill(skinMode ? 0xd1c5ad : 0xe9e2d0);
    graphics.rect(doorX - 3, top - 12, 6, 1.6);
    graphics.fill(skinMode ? 0xd1c5ad : 0xe9e2d0);
  } else if (kind === "factory") {
    graphics.rect(px + 4, top - 10, 3, 11);
    graphics.fill(skinMode ? 0x37312b : 0x4a4038);
    graphics.rect(px + w - 8, top - 8, 3, 9);
    graphics.fill(skinMode ? 0x37312b : 0x4a4038);
    graphics.circle(px + 5.5, top - 11, 2.4);
    graphics.fill({ color: skinMode ? 0x857e73 : 0x9a9488, alpha: 0.55 });
  } else if (kind === "powerplant") {
    graphics.poly([px + 5, top, px + 9, top - 10, px + w - 9, top - 10, px + w - 5, top]);
    graphics.fill(skinMode ? 0x5b5f63 : 0x70747a);
    graphics.circle(px + w / 2, top - 12, 3.2);
    graphics.fill({ color: skinMode ? 0xb7c2c9 : 0xd8dce0, alpha: 0.55 });
  } else if (kind === "kitchen") {
    graphics.rect(px + w - 8, top - 7, 3, 9);
    graphics.fill(skinMode ? 0x403932 : 0x5a5148);
    graphics.circle(px + w - 6.5, top - 8, 2);
    graphics.fill({ color: skinMode ? 0x9a9285 : 0xb0a89a, alpha: 0.5 });
  } else if (kind === "station") {
    graphics.rect(px - 1, top - 2, w + 2, 3);
    graphics.fill(skinMode ? 0x74402f : 0x9c4a38);
  } else if (kind === "police") {
    graphics.circle(doorX, top - 3, 1.8);
    graphics.fill(skinMode ? 0x76b8e0 : 0x8fd0ff);
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

const WORK_EFFECT_DURATIONS: Partial<Record<AgentState, number>> = {
  ChopTree: 1.8,
  FarmWork: 2,
  Pave: 1.5,
  Cook: 3,
  Worship: 4,
  Transplant: 1.6,
  Plant: 1.4,
  Hunt: 1.2,
  Tame: 2.5,
  Clean: 1.5,
  LoadWood: 0.6,
  StoreWood: 0.6,
  WithdrawWood: 0.6,
  Mine: 3,
  CraftTool: 3,
  Furnish: 3,
  BuildHouse: 6,
  BuildTile: 0.45,
  CollectIngredients: 0.7,
  Serve: 0.8,
  Ride: 1.2,
};

const HAND_WORK_STATES: ReadonlySet<AgentState> = new Set([
  "ChopTree",
  "FarmWork",
  "Pave",
  "Cook",
  "Transplant",
  "Plant",
  "Hunt",
  "Tame",
  "Clean",
  "LoadWood",
  "StoreWood",
  "WithdrawWood",
  "Mine",
  "CraftTool",
  "Furnish",
  "BuildHouse",
  "BuildTile",
  "CollectIngredients",
  "Serve",
]);

function isWorkState(state: AgentState): boolean {
  return WORK_EFFECT_DURATIONS[state] !== undefined;
}

function isMovingState(agent: Agent): boolean {
  return agent.state.startsWith("Move") || agent.state === "Wander" || agent.state === "Patrol" || !!agent.path?.length;
}

function agentPose(agent: Agent): { x: number; y: number; working: boolean; moving: boolean } {
  const working = isWorkState(agent.state);
  const moving = isMovingState(agent);
  if (working) {
    return {
      x: Math.sin(agent.actionTimer * 10) * 0.45,
      y: Math.sin(agent.actionTimer * 13) * 0.35,
      working,
      moving,
    };
  }
  if (moving) {
    const phase = (agent.position.x + agent.position.y) * Math.PI * 2;
    return { x: 0, y: Math.sin(phase) * 0.65, working, moving };
  }
  return { x: 0, y: 0, working, moving };
}

function workAnchor(agent: Agent): Vec2 {
  if (agent.state === "BuildTile" && agent.buildTarget) {
    return agent.buildTarget;
  }
  if (agent.state === "Cook" && agent.cookStove) {
    return agent.cookStove;
  }
  return agent.target ?? agent.buildTarget ?? agent.position;
}

function drawWorkEffect(graphics: Graphics, agent: Agent, skinMode: boolean, time: number) {
  const duration = WORK_EFFECT_DURATIONS[agent.state];
  if (!duration || agent.actionTimer < 0.04) {
    return;
  }

  const anchor = workAnchor(agent);
  const ax = anchor.x * TILE_SIZE + TILE_SIZE / 2;
  const ay = anchor.y * TILE_SIZE + TILE_SIZE / 2;
  const px = agent.position.x * TILE_SIZE + TILE_SIZE / 2;
  const py = agent.position.y * TILE_SIZE + TILE_SIZE / 2;
  const timer = Math.max(0, agent.actionTimer);
  const progress = Math.min(1, (timer % duration) / duration);
  const pulse = 0.5 + Math.sin((timer + time) * 7) * 0.5;

  if (agent.state !== "Ride" && agent.state !== "Worship") {
    drawWorkProgress(graphics, px, py - 1, progress, skinMode);
  }

  switch (agent.state) {
    case "ChopTree":
      drawToolSwing(graphics, ax, ay, timer, skinMode ? 0xd0a25a : 0xf0c46c, skinMode ? 0x6f4521 : 0x8a5a2d);
      drawScatter(graphics, ax, ay, timer, 0xb77737, skinMode ? 0x6f4521 : 0x9a6a35, 4, 4.8);
      break;
    case "Mine":
      drawToolSwing(graphics, ax, ay, timer * 0.85, skinMode ? 0xb8b4a6 : 0xd7d4ca, skinMode ? 0xb46f38 : 0xf0a64e);
      drawSparkBurst(graphics, ax, ay, timer, skinMode);
      break;
    case "BuildHouse":
    case "BuildTile":
    case "CraftTool":
    case "Furnish":
      drawHammerTap(graphics, ax, ay, timer, skinMode);
      drawScatter(graphics, ax, ay + 2, timer, skinMode ? 0x8d6a3b : 0xb08a52, skinMode ? 0x4c3824 : 0x6f5230, 5, 3.6);
      break;
    case "FarmWork":
    case "Plant":
    case "Transplant":
      drawFarmWork(graphics, ax, ay, timer, skinMode);
      break;
    case "Pave":
      drawScatter(graphics, ax, ay, timer, skinMode ? 0xa99a80 : 0xc7baa1, skinMode ? 0x5f574b : 0x81786b, 6, 4.4);
      drawStroke(graphics, ax - 5, ay + 4, ax + 5, ay - 1, skinMode ? 0x5b4930 : 0x7c6540, 1.2, 0.85);
      break;
    case "Cook":
      drawSteam(graphics, ax, ay, timer, skinMode);
      break;
    case "Clean":
      drawSweep(graphics, ax, ay, timer, skinMode);
      break;
    case "Hunt":
      drawCrosshair(graphics, ax, ay, pulse, skinMode);
      break;
    case "Tame":
      drawTameHearts(graphics, ax, ay, timer, skinMode);
      break;
    case "Worship":
      drawWorshipPulse(graphics, px, py, timer, skinMode);
      break;
    case "LoadWood":
    case "StoreWood":
    case "WithdrawWood":
    case "CollectIngredients":
    case "Serve":
      drawCarryPips(graphics, px, py, timer, skinMode);
      break;
    case "Ride":
      drawRideTrail(graphics, px, py, timer, skinMode);
      break;
  }
}

function drawWorkProgress(graphics: Graphics, px: number, py: number, progress: number, skinMode: boolean) {
  const r = 7.1;
  graphics.circle(px, py, r);
  graphics.stroke({ color: skinMode ? 0x1a120b : 0x131a10, width: 1.2, alpha: 0.35 });
  if (progress <= 0.02) {
    return;
  }
  drawArc(graphics, px, py, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  graphics.stroke({ color: skinMode ? 0xd6bd78 : 0xffdf6e, width: 1.6, alpha: 0.9 });
}

function drawToolSwing(
  graphics: Graphics,
  ax: number,
  ay: number,
  timer: number,
  toolColor: number,
  chipColor: number,
) {
  const phase = (timer * 2.4) % 1;
  const angle = -1.25 + phase * 1.9;
  const x1 = ax + Math.cos(angle) * 2.2;
  const y1 = ay - 2 + Math.sin(angle) * 2.2;
  const x2 = ax + Math.cos(angle) * 8;
  const y2 = ay - 2 + Math.sin(angle) * 8;
  drawStroke(graphics, x1, y1, x2, y2, toolColor, 1.35, 0.92);
  if (phase > 0.62) {
    graphics.circle(ax + 2, ay - 1, 1.4);
    graphics.fill({ color: chipColor, alpha: 0.8 });
  }
}

function drawHammerTap(graphics: Graphics, ax: number, ay: number, timer: number, skinMode: boolean) {
  const lift = Math.sin((timer * 14) % Math.PI) * 4;
  const handle = skinMode ? 0x5c3c20 : 0x7a5630;
  const head = skinMode ? 0xb3ad9b : 0xd8d2c3;
  drawStroke(graphics, ax - 3, ay - 5 - lift, ax + 2, ay - 1, handle, 1.2, 0.9);
  drawStroke(graphics, ax + 1, ay - 5 - lift, ax + 5, ay - 4 - lift, head, 2, 0.9);
}

function drawFarmWork(graphics: Graphics, ax: number, ay: number, timer: number, skinMode: boolean) {
  const sway = Math.sin(timer * 7) * 2.5;
  drawStroke(graphics, ax - 5 + sway, ay + 4, ax + 4 + sway, ay - 3, skinMode ? 0x7a5832 : 0x91683a, 1.2, 0.85);
  for (let i = 0; i < 3; i += 1) {
    const lift = fract(timer * 0.65 + i * 0.27);
    graphics.ellipse(ax - 4 + i * 4, ay + 3 - lift * 5, 1.2, 0.7);
    graphics.fill({ color: skinMode ? 0x92a856 : 0x9fdc62, alpha: 0.7 * (1 - lift) });
  }
}

function drawSteam(graphics: Graphics, ax: number, ay: number, timer: number, skinMode: boolean) {
  for (let i = 0; i < 3; i += 1) {
    const lift = fract(timer * 0.34 + i * 0.31);
    const x = ax - 3 + i * 3 + Math.sin(timer * 2 + i) * 0.7;
    const y = ay - 5 - lift * 12;
    graphics.circle(x, y, 1.5 + lift * 1.8);
    graphics.fill({ color: skinMode ? 0xd8d0c0 : 0xf4ead8, alpha: 0.32 * (1 - lift) });
  }
}

function drawSweep(graphics: Graphics, ax: number, ay: number, timer: number, skinMode: boolean) {
  const sweep = 0.4 + Math.sin(timer * 8) * 0.2;
  drawArc(graphics, ax, ay + 3, 6.5, Math.PI * 0.1, Math.PI * (0.75 + sweep));
  graphics.stroke({ color: skinMode ? 0xc2a164 : 0xf0d47c, width: 1.3, alpha: 0.75 });
  drawScatter(graphics, ax, ay + 5, timer, skinMode ? 0x5b4930 : 0x6f5a39, skinMode ? 0x88704a : 0xa3895d, 4, 3.8);
}

function drawCrosshair(graphics: Graphics, ax: number, ay: number, pulse: number, skinMode: boolean) {
  const r = 5 + pulse * 2;
  const color = skinMode ? 0xc5714a : 0xff8a5a;
  graphics.circle(ax, ay, r);
  graphics.stroke({ color, width: 1, alpha: 0.75 });
  drawStroke(graphics, ax - r - 2, ay, ax - r + 1, ay, color, 1, 0.7);
  drawStroke(graphics, ax + r - 1, ay, ax + r + 2, ay, color, 1, 0.7);
  drawStroke(graphics, ax, ay - r - 2, ax, ay - r + 1, color, 1, 0.7);
  drawStroke(graphics, ax, ay + r - 1, ax, ay + r + 2, color, 1, 0.7);
}

function drawTameHearts(graphics: Graphics, ax: number, ay: number, timer: number, skinMode: boolean) {
  const color = skinMode ? 0xd98b8b : 0xff9aa8;
  for (let i = 0; i < 2; i += 1) {
    const lift = fract(timer * 0.42 + i * 0.45);
    drawHeart(graphics, ax - 3 + i * 6, ay - 3 - lift * 12, 2.4, color, 0.85 * (1 - lift));
  }
}

function drawWorshipPulse(graphics: Graphics, px: number, py: number, timer: number, skinMode: boolean) {
  for (let i = 0; i < 2; i += 1) {
    const phase = fract(timer * 0.18 + i * 0.5);
    graphics.circle(px, py - 1, 6 + phase * 11);
    graphics.stroke({ color: skinMode ? 0xd6bd78 : 0xffe38a, width: 1, alpha: 0.42 * (1 - phase) });
  }
}

function drawCarryPips(graphics: Graphics, px: number, py: number, timer: number, skinMode: boolean) {
  const color = skinMode ? 0xd6bd78 : 0xffdf6e;
  for (let i = 0; i < 3; i += 1) {
    const phase = fract(timer * 1.8 + i * 0.25);
    graphics.circle(px - 4 + i * 4, py - 9 - phase * 2.4, 0.9 + phase * 0.5);
    graphics.fill({ color, alpha: 0.75 * (1 - phase) });
  }
}

function drawRideTrail(graphics: Graphics, px: number, py: number, timer: number, skinMode: boolean) {
  const color = skinMode ? 0x9fb8c0 : 0xbfeaff;
  for (let i = 0; i < 3; i += 1) {
    const lag = i * 4 + fract(timer * 0.8 + i * 0.2) * 2;
    drawStroke(graphics, px - 9 - lag, py - 3 + i * 2.2, px - 3 - lag, py - 2 + i * 2.2, color, 1, 0.36);
  }
}

function drawSparkBurst(graphics: Graphics, ax: number, ay: number, timer: number, skinMode: boolean) {
  const color = skinMode ? 0xf0c982 : 0xffe18a;
  for (let i = 0; i < 4; i += 1) {
    const phase = fract(timer * 1.7 + i * 0.19);
    const angle = i * 1.7 + timer * 0.45;
    const dist = 2 + phase * 6;
    drawStroke(
      graphics,
      ax + Math.cos(angle) * dist,
      ay + Math.sin(angle) * dist,
      ax + Math.cos(angle) * (dist + 1.8),
      ay + Math.sin(angle) * (dist + 1.8),
      color,
      0.8,
      0.75 * (1 - phase),
    );
  }
}

function drawScatter(
  graphics: Graphics,
  ax: number,
  ay: number,
  timer: number,
  colorA: number,
  colorB: number,
  count: number,
  radius: number,
) {
  for (let i = 0; i < count; i += 1) {
    const phase = fract(timer * 1.4 + i * 0.23);
    const angle = i * 2.1 + timer * 0.65;
    const dist = 1.5 + phase * radius;
    graphics.circle(ax + Math.cos(angle) * dist, ay + Math.sin(angle) * dist * 0.7, 0.7 + phase * 0.45);
    graphics.fill({ color: i % 2 === 0 ? colorA : colorB, alpha: 0.72 * (1 - phase) });
  }
}

function drawHeart(graphics: Graphics, cx: number, cy: number, size: number, color: number, alpha: number) {
  graphics.circle(cx - size * 0.28, cy - size * 0.12, size * 0.34);
  graphics.fill({ color, alpha });
  graphics.circle(cx + size * 0.28, cy - size * 0.12, size * 0.34);
  graphics.fill({ color, alpha });
  graphics.poly([cx - size * 0.66, cy, cx + size * 0.66, cy, cx, cy + size * 0.76]);
  graphics.fill({ color, alpha });
}

function drawStroke(
  graphics: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  width: number,
  alpha: number,
) {
  graphics.moveTo(x1, y1);
  graphics.lineTo(x2, y2);
  graphics.stroke({ color, width, alpha });
}

function drawArc(graphics: Graphics, cx: number, cy: number, radius: number, start: number, end: number) {
  graphics.moveTo(cx + Math.cos(start) * radius, cy + Math.sin(start) * radius);
  graphics.arc(cx, cy, radius, start, end);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function drawAgent(graphics: Graphics, agent: Agent, skinMode = false) {
  if (skinMode) {
    drawSkinnedAgent(graphics, agent);
    return;
  }

  const pose = agentPose(agent);
  const px = agent.position.x * TILE_SIZE + TILE_SIZE / 2 + pose.x;
  const py = agent.position.y * TILE_SIZE + TILE_SIZE / 2 + pose.y;
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

  if (HAND_WORK_STATES.has(agent.state)) {
    drawStroke(graphics, px - radius - 1.5, py - 0.5, px - radius + 2.2, py + 1.2, 0xe9d4a7, 1, 0.82);
    drawStroke(graphics, px + radius - 2.2, py + 1.2, px + radius + 1.5, py - 0.5, 0xe9d4a7, 1, 0.82);
  }

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

function drawSkinnedAgent(graphics: Graphics, agent: Agent) {
  const pose = agentPose(agent);
  const px = agent.position.x * TILE_SIZE + TILE_SIZE / 2 + pose.x;
  const py = agent.position.y * TILE_SIZE + TILE_SIZE / 2 + pose.y;
  const isChild = agent.age < 12;
  const bodyW = isChild ? 4.2 : 5.6;
  const bodyH = isChild ? 5.2 : 7.2;
  const jobColor = JOB_COLORS[agent.job] ?? 0x6c5b42;

  graphics.ellipse(px + 0.8, py + 4.2, bodyW * 0.9, 1.7);
  graphics.fill({ color: 0x080b07, alpha: 0.28 });

  graphics.roundRect(px - bodyW / 2, py - 0.8, bodyW, bodyH, 1.8);
  graphics.fill({ color: darkenJobColor(jobColor), alpha: 0.95 });
  graphics.roundRect(px - bodyW / 2, py - 0.8, bodyW, bodyH, 1.8);
  graphics.stroke({ color: 0x19110a, width: 0.8, alpha: 0.75 });

  graphics.rect(px - bodyW / 2 + 0.6, py + 0.2, bodyW - 1.2, 1.1);
  graphics.fill({ color: jobColor, alpha: 0.72 });

  if (HAND_WORK_STATES.has(agent.state)) {
    drawStroke(graphics, px - bodyW / 2 - 2, py + 1.5, px - bodyW / 2 + 1.4, py + 3.2, 0xd8b884, 1.1, 0.9);
    drawStroke(graphics, px + bodyW / 2 - 1.4, py + 3.2, px + bodyW / 2 + 2, py + 1.5, 0xd8b884, 1.1, 0.9);
  }

  const headR = isChild ? 2.2 : 2.8;
  graphics.circle(px, py - 3.3, headR + 0.8);
  graphics.fill(0x3a2618);
  graphics.circle(px, py - 2.8, headR);
  graphics.fill(isChild ? 0xe4c59b : 0xd8b884);
  graphics.circle(px + headR * 0.35, py - 3.3, isChild ? 0.55 : 0.75);
  graphics.fill(0x17120d);
  graphics.rect(px - 1.7, py - 5.4, 3.7, 1.2);
  graphics.fill({ color: 0x2b1b10, alpha: 0.85 });

  const carried: ResourceKind | undefined =
    agent.carry?.resource ?? (agent.inventory.wood > 0 ? "wood" : undefined);
  if (carried) {
    const [color] = resourcePileColors(carried, true);
    graphics.roundRect(px - 4.4, py - 6.8, 8.8, 2.8, 1);
    graphics.fill({ color, alpha: 0.95 });
    graphics.stroke({ color: 0x24160a, width: 0.6, alpha: 0.9 });
  }

  if (agent.state === "Chat") {
    drawSpeechBubble(graphics, px, py, true);
  } else if (agent.state === "Sleep") {
    graphics.circle(px + 5, py - 7, 1.2);
    graphics.fill(0x9db7c8);
    graphics.circle(px + 8, py - 10, 1.7);
    graphics.fill(0x9db7c8);
  }
}

function darkenJobColor(color: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * 0.54);
  const g = Math.floor(((color >> 8) & 0xff) * 0.54);
  const b = Math.floor((color & 0xff) * 0.54);
  return (r << 16) | (g << 8) | b;
}

const ANIMAL_COLORS = {
  deer: 0xb07a48,
  boar: 0x6b5240,
  rabbit: 0xcabfb0,
};

function drawAnimal(graphics: Graphics, animal: Animal, skinMode = false) {
  const px = animal.position.x * TILE_SIZE + TILE_SIZE / 2;
  const py = animal.position.y * TILE_SIZE + TILE_SIZE / 2;
  const r = animal.kind === "rabbit" ? 2.6 : animal.kind === "boar" ? 4 : 3.4;

  if (skinMode) {
    const body = animal.kind === "deer" ? 0x98693d : animal.kind === "boar" ? 0x564132 : 0xb8aa9a;
    const outline = animal.kind === "rabbit" ? 0x6e6257 : 0x2c1d10;
    if (animal.state === "tamed") {
      graphics.circle(px, py, r + 2);
      graphics.fill({ color: 0x8ebd68, alpha: 0.45 });
    }
    graphics.ellipse(px + 0.7, py + 3.2, r + 2, 1.5);
    graphics.fill({ color: 0x080b07, alpha: 0.25 });
    graphics.ellipse(px, py, r + 1.8, r);
    graphics.fill(body);
    graphics.ellipse(px, py, r + 1.8, r);
    graphics.stroke({ color: outline, width: 0.8, alpha: 0.72 });
    graphics.circle(px + r + 0.7, py - r * 0.42, r * 0.58);
    graphics.fill(body);
    graphics.circle(px + r + 0.8, py - r * 0.5, 0.55);
    graphics.fill(0x11100c);
    if (animal.kind === "deer") {
      graphics.rect(px + r + 0.4, py - r * 1.8, 0.8, 2.8);
      graphics.fill(0x55361e);
      graphics.rect(px + r - 1.4, py - r * 1.45, 2, 0.7);
      graphics.fill(0x55361e);
    } else if (animal.kind === "rabbit") {
      graphics.rect(px + r + 0.2, py - r * 1.7, 0.8, 2.8);
      graphics.fill(body);
    }
    return;
  }

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

function drawTrain(graphics: Graphics, train: Vec2, skinMode = false) {
  const px = train.x * TILE_SIZE;
  const py = train.y * TILE_SIZE + 2;
  if (skinMode) {
    graphics.rect(px - 31, py + 8, 45, 2);
    graphics.fill({ color: 0x12120f, alpha: 0.45 });
  }
  // Locomotive plus two cars trailing behind.
  graphics.rect(px, py, 14, 11);
  graphics.fill(skinMode ? 0x26292a : 0x2c3138);
  graphics.rect(px + 3, py + 2, 5, 4);
  graphics.fill(skinMode ? 0x9bb2bd : 0x8fb6d6);
  graphics.rect(px - 16, py + 1, 13, 10);
  graphics.fill(skinMode ? 0x3e352d : 0x4a3f37);
  graphics.rect(px - 31, py + 1, 13, 10);
  graphics.fill(skinMode ? 0x3e352d : 0x4a3f37);
  if (skinMode) {
    graphics.rect(px + 1, py, 4, 2);
    graphics.fill(0x12120f);
    graphics.rect(px - 14, py + 2, 9, 1.4);
    graphics.fill({ color: 0x6d5a44, alpha: 0.8 });
    graphics.rect(px - 29, py + 2, 9, 1.4);
    graphics.fill({ color: 0x6d5a44, alpha: 0.8 });
  }
}

function drawSpeechBubble(graphics: Graphics, px: number, py: number, skinMode = false) {
  graphics.roundRect(px + 2, py - 15, 14, 9, 3);
  graphics.fill({ color: skinMode ? 0xe8dec8 : 0xf7f3e8, alpha: 0.95 });
  graphics.poly([px + 5, py - 6, px + 9, py - 6, px + 4, py - 2]);
  graphics.fill({ color: skinMode ? 0xe8dec8 : 0xf7f3e8, alpha: 0.95 });
  for (const dot of [0, 1, 2]) {
    graphics.circle(px + 6 + dot * 3.4, py - 10.5, 1);
    graphics.fill(skinMode ? 0x463a2d : 0x4a4a42);
  }
}

function drawTarget(graphics: Graphics, target: Vec2, skinMode = false) {
  const px = target.x * TILE_SIZE;
  const py = target.y * TILE_SIZE;

  graphics.rect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);
  graphics.stroke({ color: skinMode ? 0xd6bd78 : 0xffffff, width: 1, alpha: skinMode ? 0.72 : 0.65 });
}

function tileColor(type: TileType, skinMode = false): number {
  if (skinMode) {
    switch (type) {
      case "Grass":
        return 0x25331f;
      case "Tree":
        return 0x1c2d18;
      case "Water":
        return 0x1c3f45;
      case "Dirt":
        return 0x4c3827;
      case "Road":
        return 0x655f55;
      case "HouseSite":
        return 0x343927;
      case "HouseFoundation":
        return 0x473a2e;
      case "House":
        return 0x4d3d29;
      case "Wall":
        return 0x62594f;
      case "Floor":
      case "Door":
      case "Stove":
      case "Counter":
      case "Bed":
      case "BedFoot":
      case "BedSite":
      case "Table":
      case "Chair":
        return 0x463421;
      case "RockSandstone":
        return 0x8a7854;
      case "RockLimestone":
        return 0x807f76;
      case "RockGranite":
        return 0x646066;
      case "OreIron":
        return 0x625e58;
      case "RockFloor":
        return 0x49453e;
      case "Fence":
      case "FenceGate":
        return 0x374d25;
      case "Berry":
        return 0x283f24;
      case "FieldEmpty":
      case "FieldGrowing":
        return 0x483622;
      case "FieldRipe":
        return 0x4f3d24;
      case "Stump":
        return 0x25331f;
      case "Plaza":
      case "Fountain":
      case "Statue":
      case "Lamp":
        return 0x7f776a;
      case "Rail":
        return 0x343533;
    }
  }

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
