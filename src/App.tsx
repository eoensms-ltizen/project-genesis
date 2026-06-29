import { useEffect, useMemo, useRef, useState } from "react";
import { GameApp } from "./game/GameApp";
import { lineTiles, tileKey } from "./game/planning";
import type { ArchitectDraftPreview } from "./game/render/PixiRenderer";
import { ERA_NAMES, NEW_GAME_MODE_KEY, SAVE_KEY } from "./game/Simulation";
import type {
  Agent,
  AgentState,
  Animal,
  Building,
  BuildingKind,
  FoodKind,
  FurnitureKind,
  GameMode,
  GameClock,
  GameLogEntry,
  InspectionTarget,
  ResourceKind,
  Vec2,
  WeatherState,
} from "./game/types";
import { getLang, setLang, tr, type Lang } from "./i18n";
import { AgentCreator } from "./ui/AgentCreator";
import { ArchitectPanel } from "./ui/ArchitectPanel";
import { ControlPanel } from "./ui/ControlPanel";
import { DevPanel, type DevTileTool } from "./ui/DevPanel";
import { GameLog } from "./ui/GameLog";
import { Inspector } from "./ui/Inspector";

const TICK_MS = 160;
const SOUND_KEY = "pg-sound-enabled";
const DEFAULT_WEATHER: WeatherState = { kind: "clear", intensity: 1 };

type ArchitectTileTool =
  | "field"
  | "road"
  | "wall"
  | "door"
  | "demolishTile"
  | FurnitureKind;

type ArchitectDraft =
  | { kind: "building"; building: BuildingKind; tiles: Vec2[] }
  | { kind: "tiles"; tool: ArchitectTileTool; tiles: Vec2[] };

type ArchitectStrokeMode = "add" | "remove";

const ARCHITECT_TILE_TOOLS: ReadonlySet<string> = new Set([
  "field",
  "road",
  "wall",
  "door",
  "demolishTile",
  "bed",
  "stove",
  "counter",
  "table",
  "chair",
]);

const FURNITURE_TOOLS: ReadonlySet<string> = new Set([
  "bed",
  "stove",
  "counter",
  "table",
  "chair",
]);

function isArchitectTileTool(tool: DevTileTool): tool is ArchitectTileTool {
  return tool !== null && ARCHITECT_TILE_TOOLS.has(tool);
}

function isFurnitureTool(tool: DevTileTool | ArchitectTileTool): tool is FurnitureKind {
  return tool !== null && FURNITURE_TOOLS.has(tool);
}

const ERA_LABELS_KO = ["개척", "정착", "마을", "도시", "산업"];

function eraName(era: number): string {
  return tr(ERA_NAMES[era] ?? "?", ERA_LABELS_KO[era] ?? "?");
}

function gameModeName(mode: GameMode): string {
  return mode === "architect" ? tr("Architect", "설계자") : tr("Auto", "자동");
}

const STATE_LABELS_KO: Record<AgentState, string> = {
  Idle: "대기",
  FindTree: "나무 찾기",
  MoveToTree: "나무로 이동",
  ChopTree: "벌목",
  FindHouseSite: "집터 찾기",
  MoveToHouseSite: "집터로 이동",
  PlanHouse: "집 설계",
  BuildHouse: "집 짓기",
  FindFood: "음식 찾기",
  MoveToFood: "음식으로 이동",
  Eat: "식사",
  MoveHome: "귀가",
  Sleep: "수면",
  Chat: "대화",
  MoveToFarm: "밭으로 이동",
  FarmWork: "농사",
  MoveToPave: "포장지로 이동",
  Pave: "길 포장",
  MoveToPantry: "재료 가지러 이동",
  CollectIngredients: "재료 챙기기",
  MoveToKitchen: "재료 화덕으로 이동",
  Cook: "요리",
  MoveToServe: "식탁으로 배식 이동",
  Serve: "배식",
  MoveToWorship: "교회로 이동",
  Worship: "예배",
  MoveToStump: "그루터기로 이동",
  Transplant: "옮겨심기",
  MoveToPlant: "식재지로 이동",
  Plant: "나무 심기",
  MoveToHunt: "사냥터로 이동",
  Hunt: "사냥",
  MoveToTame: "가축으로 이동",
  Tame: "길들이기",
  MoveToPark: "공원으로 이동",
  Relax: "휴식",
  MoveToClean: "청소지로 이동",
  Clean: "청소",
  Patrol: "순찰",
  MoveToHaul: "더미로 이동",
  LoadWood: "짐 싣기",
  MoveToStore: "창고로 운반",
  StoreWood: "창고 적재",
  MoveToWithdraw: "자재 가지러 가기",
  WithdrawWood: "자재 인출",
  MoveToMine: "채굴지로 이동",
  Mine: "채굴",
  MoveToCraft: "작업장으로 이동",
  CraftTool: "도구 제작",
  MoveToFurnish: "가구 놓으러 이동",
  Furnish: "가구 제작",
  MoveToBuildTile: "자재 놓으러 이동",
  BuildTile: "벽 쌓기",
  MoveToBlueprint: "설계도로 이동",
  BuildBlueprint: "설계도 건설",
  MoveToFunfair: "놀이공원으로 이동",
  Ride: "놀이기구 탑승",
  Wander: "배회",
  Rest: "쉬기",
};

function stateName(state: AgentState): string {
  return tr(state, STATE_LABELS_KO[state] ?? state);
}

function weatherLabel(weather: WeatherState): string {
  switch (weather.kind) {
    case "storm":
      return "⛈";
    case "rain":
      return "🌧";
    case "cloudy":
      return "☁";
    case "clear":
    default:
      return "☀";
  }
}

const JOB_LABELS_KO: Record<Agent["job"], string> = {
  none: "주민",
  builder: "건축가",
  farmer: "농부",
  fisher: "어부",
  woodcutter: "나무꾼",
  cook: "요리사",
  hunter: "사냥꾼",
  cleaner: "청소부",
  police: "경찰",
  mayor: "시장",
  hauler: "운반꾼",
};

function jobName(job: Agent["job"]): string {
  return tr(job, JOB_LABELS_KO[job] ?? job);
}

export default function App() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<GameApp | null>(null);
  const [, forceFrame] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<GameLogEntry[]>([]);
  const [clock, setClock] = useState<GameClock | null>(null);
  const [weather, setWeather] = useState<WeatherState>(DEFAULT_WEATHER);
  const [gameMode, setGameMode] = useState<GameMode>("auto");
  const gameModeRef = useRef<GameMode>("auto");
  const [era, setEra] = useState(0);
  const [supportedPop, setSupportedPop] = useState(0);
  const [foodStock, setFoodStock] = useState(0);
  const [grainStock, setGrainStock] = useState(0);
  const [meatStock, setMeatStock] = useState(0);
  const [litter, setLitter] = useState(0);
  const [unrest, setUnrest] = useState(0);
  const [steel, setSteel] = useState(0);
  const [woodStock, setWoodStock] = useState(0);
  const [stoneStock, setStoneStock] = useState(0);
  const [oreStock, setOreStock] = useState(0);
  const [meals, setMeals] = useState(0);
  const [pendingPlacement, setPendingPlacement] = useState(false);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [selection, setSelection] = useState<InspectionTarget | null>(null);
  const [followId, setFollowId] = useState<string | null>(null);
  const [devPlaceKind, setDevPlaceKind] = useState<BuildingKind | null>(null);
  const devPlaceKindRef = useRef<BuildingKind | null>(null);
  const [devInstant, setDevInstant] = useState(true);
  const devInstantRef = useRef(true);
  const [devTileTool, setDevTileTool] = useState<DevTileTool>(null);
  const devTileToolRef = useRef<DevTileTool>(null);
  // Furniture is click-to-place (not drag) and rotatable with R; 0..3 = R/D/L/U.
  const [architectRotation, setArchitectRotation] = useState(0);
  const architectRotationRef = useRef(0);
  const [architectDraft, setArchitectDraft] = useState<ArchitectDraft | null>(null);
  const architectDraftRef = useRef<ArchitectDraft | null>(null);
  const architectStrokeModeRef = useRef<ArchitectStrokeMode>("add");
  const architectDragLastRef = useRef<Vec2 | null>(null);
  const pausedForDraftRef = useRef<number | null>(null);
  const [tab, setTab] = useState<"world" | "people" | "log">("world");
  const [flatBuildings, setFlatBuildings] = useState(
    () => localStorage.getItem("pg-flat-buildings") === "1",
  );
  const [skinMode, setSkinMode] = useState(
    () => localStorage.getItem("pg-skin-mode") === "1",
  );
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem(SOUND_KEY) !== "0",
  );
  const [lang, setLangState] = useState<Lang>(() => getLang());

  const defaultSpawn = useMemo<Vec2>(() => ({ x: 32, y: 32 }), []);

  const updateArchitectDraft = (updater: (draft: ArchitectDraft | null) => ArchitectDraft | null) => {
    setArchitectDraft((current) => {
      const next = updater(current);
      architectDraftRef.current = next;
      return next;
    });
  };

  const clearArchitectDraft = () => {
    architectDraftRef.current = null;
    setArchitectDraft(null);
    architectDragLastRef.current = null;
    architectStrokeModeRef.current = "add";
  };

  const sameArchitectDraftTool = (
    draft: ArchitectDraft | null,
    target:
      | { kind: "building"; building: BuildingKind }
      | { kind: "tiles"; tool: ArchitectTileTool },
  ): boolean => {
    if (!draft || draft.kind !== target.kind) {
      return false;
    }
    if (draft.kind === "building" && target.kind === "building") {
      return draft.building === target.building;
    }
    if (draft.kind === "tiles" && target.kind === "tiles") {
      return draft.tool === target.tool;
    }
    return false;
  };

  const tileInDraft = (draft: ArchitectDraft | null, position: Vec2): boolean =>
    Boolean(draft?.tiles.some((tile) => tileKey(tile) === tileKey(position)));

  const editDraftTiles = (draft: ArchitectDraft, positions: Vec2[], mode: ArchitectStrokeMode): ArchitectDraft => {
    const keys = new Set(positions.map(tileKey));
    if (mode === "remove") {
      return { ...draft, tiles: draft.tiles.filter((tile) => !keys.has(tileKey(tile))) };
    }
    const tiles = [...draft.tiles];
    const seen = new Set(tiles.map(tileKey));
    for (const tile of positions) {
      const key = tileKey(tile);
      if (!seen.has(key)) {
        tiles.push(tile);
        seen.add(key);
      }
    }
    return { ...draft, tiles };
  };

  const beginArchitectDraft = (position: Vec2): boolean => {
    if (gameModeRef.current !== "architect") {
      return false;
    }
    const building = devPlaceKindRef.current;
    if (building) {
      pauseForArchitectTool();
      architectDragLastRef.current = position;
      const current = architectDraftRef.current;
      const target = { kind: "building" as const, building };
      if (sameArchitectDraftTool(current, target)) {
        const mode: ArchitectStrokeMode = tileInDraft(current, position) ? "remove" : "add";
        architectStrokeModeRef.current = mode;
        updateArchitectDraft((draft) =>
          draft && sameArchitectDraftTool(draft, target) ? editDraftTiles(draft, [position], mode) : draft,
        );
      } else {
        architectStrokeModeRef.current = "add";
        updateArchitectDraft(() => ({ kind: "building", building, tiles: [position] }));
      }
      return true;
    }
    const tool = devTileToolRef.current;
    // Furniture is click-to-place, not drag — let the tap fall through to onTileClick.
    if (isFurnitureTool(tool)) {
      return false;
    }
    if (isArchitectTileTool(tool)) {
      pauseForArchitectTool();
      architectDragLastRef.current = position;
      const current = architectDraftRef.current;
      const target = { kind: "tiles" as const, tool };
      if (sameArchitectDraftTool(current, target)) {
        const mode: ArchitectStrokeMode = tileInDraft(current, position) ? "remove" : "add";
        architectStrokeModeRef.current = mode;
        updateArchitectDraft((draft) =>
          draft && sameArchitectDraftTool(draft, target) ? editDraftTiles(draft, [position], mode) : draft,
        );
      } else {
        architectStrokeModeRef.current = "add";
        updateArchitectDraft(() => ({ kind: "tiles", tool, tiles: [position] }));
      }
      return true;
    }
    return false;
  };

  const moveArchitectDraft = (position: Vec2) => {
    updateArchitectDraft((draft) => {
      if (!draft) {
        return draft;
      }
      const last = architectDragLastRef.current ?? position;
      const edited = editDraftTiles(draft, lineTiles(last, position), architectStrokeModeRef.current);
      architectDragLastRef.current = position;
      return edited;
    });
  };

  const finishArchitectDraft = (position: Vec2) => {
    moveArchitectDraft(position);
    architectDragLastRef.current = null;
  };

  const architectDraftPreview = (draft: ArchitectDraft | null): ArchitectDraftPreview | null => {
    if (!draft) {
      return null;
    }
    if (draft.kind === "building") {
      return { kind: "tiles" as const, tiles: draft.tiles, mode: "floor" as const, building: draft.building };
    }
    const mode =
      isFurnitureTool(draft.tool)
        ? draft.tool
        : draft.tool === "field"
        ? ("field" as const)
        : draft.tool === "road"
        ? ("road" as const)
        : draft.tool === "wall"
          ? ("wall" as const)
          : draft.tool === "door"
            ? ("door" as const)
            : ("erase" as const);
    return {
      kind: "tiles" as const,
      tiles: draft.tiles,
      mode,
    };
  };

  useEffect(() => {
    if (gameMode === "architect" && devInstantRef.current) {
      devInstantRef.current = false;
      setDevInstant(false);
    }
  }, [gameMode]);

  useEffect(() => {
    if (!canvasHostRef.current) {
      return;
    }

    let disposed = false;
    const game = new GameApp(canvasHostRef.current, {
      onChange: (snapshot) => {
        if (disposed) {
          return;
        }
        setAgents(snapshot.agents);
        setLogs(snapshot.logs);
        setClock(snapshot.clock);
        setWeather(snapshot.weather);
        gameModeRef.current = snapshot.gameMode;
        setGameMode(snapshot.gameMode);
        setEra(snapshot.era);
        setSupportedPop(snapshot.supportedPopulation);
        setFoodStock(snapshot.foodStock);
        setGrainStock(snapshot.grainStock);
        setMeatStock(snapshot.meatStock);
        setMeals(snapshot.meals);
        setLitter(snapshot.litter);
        setUnrest(snapshot.unrest);
        setSteel(snapshot.steel);
        setWoodStock(snapshot.woodStock);
        setStoneStock(snapshot.stoneStock);
        setOreStock(snapshot.oreStock);
        setBuildings(snapshot.buildings);
        setAnimals(snapshot.animals);
        forceFrame((value) => value + 1);
      },
      onTileClick: (position) => {
        if (!gameRef.current) {
          return;
        }
        if (devPlaceKindRef.current) {
          gameRef.current.devBuildAt(devPlaceKindRef.current, position, devInstantRef.current);
          devPlaceKindRef.current = null;
          setDevPlaceKind(null);
          gameRef.current.setPlacementPreview(null, false);
          return;
        }
        // Tile tools stay armed across clicks so you can pave or demolish a run
        // of tiles in a row (e.g. tear out a whole wall, one tile at a time).
        if (devTileToolRef.current) {
          const tool = devTileToolRef.current;
          if (isFurnitureTool(tool)) {
            // Click-to-place a single rotated unit (bed = 2 tiles). Stays armed so
            // several can be dropped; "주민 건설" queues it as a blueprint instead.
            const rot = architectRotationRef.current;
            if (gameModeRef.current === "architect" && !devInstantRef.current) {
              gameRef.current.devPlanFurniture(tool, position, rot);
            } else {
              gameRef.current.devPlaceFurniture(tool, position, rot);
            }
          } else if (tool === "field") {
            gameRef.current.devPaintFieldTiles([position]);
          } else if (tool === "road") {
            gameRef.current.devPaveRoadAt(position);
          } else if (tool === "wall") {
            gameRef.current.devPaintStructureTiles([position], "Wall");
          } else if (tool === "door") {
            gameRef.current.devPaintStructureTiles([position], "Door");
          } else if (tool === "demolishTile") {
            gameRef.current.devDemolishTileAt(position);
          } else if (tool === "demolishBuilding") {
            gameRef.current.devDemolishBuildingAt(position);
          }
          return;
        }
        if (gameRef.current.isPlacementMode()) {
          gameRef.current.addRandomAgent(position);
          gameRef.current.setPlacementMode(false);
          setPendingPlacement(false);
          return;
        }
        setSelection(gameRef.current.inspectAt(position));
      },
      onTileDragStart: beginArchitectDraft,
      onTileDragMove: moveArchitectDraft,
      onTileDragEnd: finishArchitectDraft,
    });

    gameRef.current = game;
    game.setFlatBuildings(localStorage.getItem("pg-flat-buildings") === "1");
    game.setSkinMode(localStorage.getItem("pg-skin-mode") === "1");
    game.setSoundEnabled(localStorage.getItem(SOUND_KEY) !== "0");
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      (window as unknown as { __genesis?: GameApp }).__genesis = game;
    }
    void game.start().then(() => {
      if (disposed) {
        game.destroy();
      }
    });

    const intervalId = window.setInterval(() => {
      game.tick((TICK_MS / 1000) * speedRef.current);
    }, TICK_MS);

    const saveOnHide = () => {
      if (document.visibilityState === "hidden") {
        game.simulation.saveNow();
      }
    };
    const unlockAudio = () => game.unlockAudio();
    document.addEventListener("visibilitychange", saveOnHide);
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    // R rotates the armed furniture ghost (Architect click-to-place).
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (event.key === "r" || event.key === "R") {
        rotateArchitectFurniture();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", saveOnHide);
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("keydown", onKeyDown);
      game.simulation.saveNow();
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  // Drop follow mode if the tracked resident is no longer with us.
  useEffect(() => {
    if (followId && !agents.some((a) => a.id === followId)) {
      setFollowId(null);
    }
  }, [agents, followId]);

  const addRandomAgent = () => {
    gameRef.current?.addRandomAgent(defaultSpawn);
  };

  const addImmigrant = () => {
    gameRef.current?.addImmigrant();
  };

  const enablePlacement = () => {
    gameRef.current?.setPlacementMode(true);
    setPendingPlacement(true);
  };

  const devResource = (resource: ResourceKind, amount: number) =>
    gameRef.current?.devGiveResource(resource, amount);
  const devFood = (kind: FoodKind, amount: number) => gameRef.current?.devGiveFood(kind, amount);
  const devEra = (value: number) => gameRef.current?.devSetEra(value);
  const devFillMaterials = () => gameRef.current?.devFillMaterials();
  const devHungerAll = (hunger: number) => gameRef.current?.devSetAllHunger(hunger);
  const devAdvanceTime = (seconds: number) => gameRef.current?.devAdvanceTime(seconds);
  const devPlace = (kind: BuildingKind) => {
    // Toggle: pick a building to drop with the next map click, or cancel.
    clearArchitectDraft();
    const next = devPlaceKindRef.current === kind ? null : kind;
    devPlaceKindRef.current = next;
    setDevPlaceKind(next);
    // Arming a building cancels any tile tool, so clicks don't do two things.
    devTileToolRef.current = null;
    setDevTileTool(null);
    gameRef.current?.setFurniturePreview(null);
    gameRef.current?.setPlacementPreview(gameModeRef.current === "architect" ? null : next, false);
    if (gameModeRef.current === "architect") {
      if (next) {
        pauseForArchitectTool();
      } else {
        restoreAfterArchitectTool();
      }
    }
  };
  const devTool = (tool: DevTileTool) => {
    // Toggle a sticky tile tool (road / demolish); arming one cancels building place.
    clearArchitectDraft();
    const next = devTileToolRef.current === tool ? null : tool;
    devTileToolRef.current = next;
    setDevTileTool(next);
    devPlaceKindRef.current = null;
    setDevPlaceKind(null);
    gameRef.current?.setPlacementPreview(null, gameModeRef.current === "architect" ? false : next !== null);
    // Furniture tools show a rotatable ghost (and reset to facing right); other
    // tools clear it.
    if (isFurnitureTool(next)) {
      architectRotationRef.current = 0;
      setArchitectRotation(0);
      gameRef.current?.setFurniturePreview(next, 0);
    } else {
      gameRef.current?.setFurniturePreview(null);
    }
    if (gameModeRef.current === "architect") {
      if (next) {
        pauseForArchitectTool();
      } else {
        restoreAfterArchitectTool();
      }
    }
  };
  const devDisarm = () => {
    // Drop every armed dev tool and clear the cursor ghost.
    clearArchitectDraft();
    devPlaceKindRef.current = null;
    setDevPlaceKind(null);
    devTileToolRef.current = null;
    setDevTileTool(null);
    gameRef.current?.setPlacementPreview(null, false);
    gameRef.current?.setFurniturePreview(null);
    gameRef.current?.setArchitectDraftPreview(null);
    restoreAfterArchitectTool();
  };
  const rotateArchitectFurniture = () => {
    if (!isFurnitureTool(devTileToolRef.current)) {
      return;
    }
    const next = (architectRotationRef.current + 1) % 4;
    architectRotationRef.current = next;
    setArchitectRotation(next);
    gameRef.current?.setFurniturePreview(devTileToolRef.current, next);
  };
  const applyArchitectDraft = () => {
    const draft = architectDraftRef.current;
    if (!draft || !gameRef.current) {
      return;
    }
    // "주민 건설" (resident-build) stakes floor zones and queues walls/doors as
    // blueprints for residents to construct; "즉시" (instant) stamps them at once.
    // Fields, roads and demolition are always instant. (Furniture is no longer
    // drafted here — it's click-to-placed per unit via onTileClick.)
    const residentBuild = !devInstantRef.current;
    if (draft.kind === "building") {
      if (residentBuild) {
        gameRef.current.devPlanFloorZone(draft.building, draft.tiles);
      } else {
        gameRef.current.devPaintFloorZone(draft.building, draft.tiles);
      }
    } else if (draft.tool === "field") {
      gameRef.current.devPaintFieldTiles(draft.tiles);
    } else if (draft.tool === "road") {
      gameRef.current.devPaveRoadTiles(draft.tiles);
    } else if (draft.tool === "wall") {
      if (residentBuild) {
        gameRef.current.devPlanStructureTiles(draft.tiles, "Wall");
      } else {
        gameRef.current.devPaintStructureTiles(draft.tiles, "Wall");
      }
    } else if (draft.tool === "door") {
      if (residentBuild) {
        gameRef.current.devPlanStructureTiles(draft.tiles, "Door");
      } else {
        gameRef.current.devPaintStructureTiles(draft.tiles, "Door");
      }
    } else {
      gameRef.current.devDemolishTiles(draft.tiles);
    }
    devDisarm();
  };
  const cancelArchitectDraft = () => {
    clearArchitectDraft();
    gameRef.current?.setArchitectDraftPreview(null);
  };
  const devSetInstant = (instant: boolean) => {
    devInstantRef.current = instant;
    setDevInstant(instant);
  };
  const devSetAgent = (
    agentId: string,
    patch: Parameters<NonNullable<typeof gameRef.current>["devSetAgent"]>[1],
  ) => gameRef.current?.devSetAgent(agentId, patch);

  function isArchitectToolArmed() {
    return (
      gameModeRef.current === "architect" &&
      Boolean(devPlaceKindRef.current || devTileToolRef.current || architectDraftRef.current)
    );
  }

  const changeSpeed = (value: number) => {
    if (value > 0 && isArchitectToolArmed()) {
      pausedForDraftRef.current = value;
      speedRef.current = 0;
      setSpeed(0);
      return;
    }
    speedRef.current = value;
    setSpeed(value);
  };

  const pauseForArchitectTool = () => {
    if (pausedForDraftRef.current === null) {
      pausedForDraftRef.current = speedRef.current;
    }
    speedRef.current = 0;
    setSpeed(0);
  };

  const restoreAfterArchitectTool = () => {
    if (pausedForDraftRef.current === null) {
      return;
    }
    const restoreSpeed = pausedForDraftRef.current;
    pausedForDraftRef.current = null;
    speedRef.current = restoreSpeed;
    setSpeed(restoreSpeed);
  };

  const architectToolActive =
    gameMode === "architect" && Boolean(devPlaceKind || devTileTool || architectDraft);

  useEffect(() => {
    if (architectToolActive && pausedForDraftRef.current === null) {
      pausedForDraftRef.current = speedRef.current;
      changeSpeed(0);
    } else if (!architectToolActive && pausedForDraftRef.current !== null) {
      const restoreSpeed = pausedForDraftRef.current;
      pausedForDraftRef.current = null;
      if (speedRef.current === 0 && restoreSpeed > 0) {
        changeSpeed(restoreSpeed);
      }
    }
  }, [architectToolActive]);

  useEffect(() => {
    gameRef.current?.setArchitectDraftPreview(architectDraftPreview(architectDraft));
  }, [architectDraft]);

  const toggleLang = () => {
    const next: Lang = lang === "ko" ? "en" : "ko";
    setLang(next);
    setLangState(next);
  };

  const resetWorld = (mode: GameMode) => {
    const label = gameModeName(mode);
    if (
      !window.confirm(
        tr(
          `Start a new ${label} world? The current village will be lost.`,
          "새 세계를 시작할까요? 현재 마을은 사라집니다.",
        ),
      )
    ) {
      return;
    }
    gameRef.current?.simulation.disableSaving();
    localStorage.removeItem(SAVE_KEY);
    localStorage.setItem(NEW_GAME_MODE_KEY, mode);
    window.location.reload();
  };

  const recenter = () => gameRef.current?.resetCamera();

  const toggleFlatBuildings = () => {
    const next = !flatBuildings;
    setFlatBuildings(next);
    gameRef.current?.setFlatBuildings(next);
    localStorage.setItem("pg-flat-buildings", next ? "1" : "0");
  };

  const toggleSkinMode = () => {
    const next = !skinMode;
    setSkinMode(next);
    gameRef.current?.setSkinMode(next);
    localStorage.setItem("pg-skin-mode", next ? "1" : "0");
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    gameRef.current?.setSoundEnabled(next);
    if (next) {
      gameRef.current?.unlockAudio();
    }
    localStorage.setItem(SOUND_KEY, next ? "1" : "0");
  };

  const speedOptions = [0, 1, 2, 4] as const;

  return (
    <main className="app-shell" data-skin-mode={skinMode}>
      <section className="game-surface" aria-label="Project Genesis map">
        <div ref={canvasHostRef} className="canvas-host" />

        <div className="hud-bar">
          <div className="hud-clock">
            {clock ? (
              <>
                <span className="hud-date">
                  Y{clock.year} · D{clock.day} ·{" "}
                  {String(clock.hour).padStart(2, "0")}:{String(clock.minute).padStart(2, "0")}{" "}
                  {clock.isNight ? "🌙" : "☀️"} {weatherLabel(weather)}
                </span>
                <span className="hud-stats">
                  {eraName(era)} · {gameModeName(gameMode)} · 👥{agents.length}/{supportedPop} · 🌾{grainStock} · 🥩
                  {meatStock} · 🍲{meals}
                  {woodStock > 0 ? ` · 🪵${woodStock}` : ""}
                  {stoneStock > 0 ? ` · 🪨${stoneStock}` : ""}
                  {oreStock > 0 ? ` · ⛏️${oreStock}` : ""}
                  {litter > 0 ? ` · 🗑️${litter}` : ""}
                  {unrest >= 20 ? ` · 😠${unrest}` : ""}
                  {steel > 0 ? ` · 🔩${steel}` : ""}
                </span>
              </>
            ) : (
              <span className="hud-date">{tr("Loading…", "불러오는 중…")}</span>
            )}
          </div>
          <div className="hud-actions">
            {speedOptions.map((option) => (
              <button
                key={option}
                type="button"
                className="hud-speed"
                onClick={() => changeSpeed(option)}
                data-active={speed === option}
              >
                {option === 0 ? "⏸" : `${option}×`}
              </button>
            ))}
            <button
              type="button"
              className="hud-speed"
              onClick={recenter}
              title={tr("Recenter", "중앙 정렬")}
            >
              ⌖
            </button>
            <button
              type="button"
              className="hud-speed"
              onClick={toggleFlatBuildings}
              data-active={!flatBuildings}
              title={
                flatBuildings
                  ? tr("Flat view (tap for 2.5D)", "평면 보기 (눌러 2.5D)")
                  : tr("2.5D view (tap for flat)", "2.5D 보기 (눌러 평면)")
              }
            >
              {flatBuildings ? "▦" : "🏙"}
            </button>
            <button
              type="button"
              className="hud-speed"
              onClick={toggleSound}
              data-active={soundEnabled}
              title={soundEnabled ? "Sound on (tap to mute)" : "Sound muted (tap to enable)"}
            >
              {soundEnabled ? "Snd" : "Mute"}
            </button>
            <button
              type="button"
              className="hud-speed"
              onClick={toggleSkinMode}
              data-active={skinMode}
              title={skinMode ? "Skin mode (tap for base)" : "Base mode (tap for skin)"}
            >
              {skinMode ? "Skin" : "Base"}
            </button>
            <button
              type="button"
              className="hud-speed"
              onClick={toggleLang}
              title={tr("Switch to Korean", "Switch to English")}
            >
              {lang === "ko" ? "한" : "EN"}
            </button>
          </div>
        </div>

        {selection && (
          <div className="inspector-overlay">
            <Inspector
              selection={selection}
              agents={agents}
              buildings={buildings}
              animals={animals}
              items={gameRef.current?.simulation.items ?? []}
              episodes={
                selection.kind === "agent"
                  ? (gameRef.current?.simulation.getEpisodes(selection.agentId) ?? [])
                  : []
              }
              tileType={
                selection.kind === "tile"
                  ? gameRef.current?.simulation.world.getTile(selection.position)?.type
                  : undefined
              }
              tileTraffic={
                selection.kind === "tile"
                  ? gameRef.current?.simulation.getTrafficAt(selection.position)
                  : undefined
              }
              homeAmbiance={(() => {
                if (selection.kind !== "agent") {
                  return undefined;
                }
                const home = agents.find((a) => a.id === selection.agentId)?.home;
                return home ? gameRef.current?.simulation.ambianceAt(home) : undefined;
              })()}
              foodSummary={
                selection.kind === "building"
                  ? gameRef.current?.simulation.foodSummary()
                  : undefined
              }
              following={selection.kind === "agent" && followId === selection.agentId}
              onToggleFollow={() => {
                if (selection.kind !== "agent") {
                  return;
                }
                const next = followId === selection.agentId ? null : selection.agentId;
                setFollowId(next);
                gameRef.current?.followAgent(next);
              }}
              onClose={() => setSelection(null)}
              onDevSetAgent={devSetAgent}
            />
          </div>
        )}
      </section>

      <aside className="side-panel">
        <nav className="panel-tabs">
          <button type="button" data-active={tab === "world"} onClick={() => setTab("world")}>
            {tr("World", "세계")}
          </button>
          <button type="button" data-active={tab === "people"} onClick={() => setTab("people")}>
            {tr("People", "주민")} <span className="tab-count">{agents.length}</span>
          </button>
          <button type="button" data-active={tab === "log"} onClick={() => setTab("log")}>
            {tr("Log", "기록")}
          </button>
        </nav>

        {tab === "world" && (
          <>
            <ControlPanel
              onAddRandom={addRandomAgent}
              onAddImmigrant={addImmigrant}
              onPlaceAgent={enablePlacement}
              onReset={resetWorld}
              placementActive={pendingPlacement}
              gameMode={gameMode}
            />
            {gameMode === "architect" && (
              <ArchitectPanel
                placingKind={devPlaceKind}
                instantBuild={devInstant}
                tileTool={devTileTool}
                draftActive={architectDraft !== null}
                rotation={architectRotation}
                onPlaceBuild={devPlace}
                onInstantBuild={devSetInstant}
                onTileTool={devTool}
                onRotate={rotateArchitectFurniture}
                onApplyDraft={applyArchitectDraft}
                onCancelDraft={cancelArchitectDraft}
                onClose={devDisarm}
              />
            )}
            <AgentCreator onCreate={addRandomAgent} />
            <DevPanel
              era={era}
              placingKind={devPlaceKind}
              instantBuild={devInstant}
              tileTool={devTileTool}
              onResource={devResource}
              onFood={devFood}
              onFillMaterials={devFillMaterials}
              onHungerAll={devHungerAll}
              onAdvanceTime={devAdvanceTime}
              onPlaceBuild={devPlace}
              onInstantBuild={devSetInstant}
              onTileTool={devTool}
              onClose={devDisarm}
              onEra={devEra}
              onExport={() => gameRef.current?.exportState() ?? ""}
              onImport={(json) => gameRef.current?.importState(json) ?? false}
            />
          </>
        )}

        {tab === "people" && (
          <section className="panel-section panel-grow">
            <h2>{tr("Residents", "주민")}</h2>
            <div className="agent-list agent-list-full">
              {agents.length === 0 ? (
                <p className="muted">
                  {tr("Add a resident to start the simulation.", "주민을 추가해 시뮬레이션을 시작하세요.")}
                </p>
              ) : (
                agents.map((agent) => (
                  <article
                    className="agent-row agent-row-click"
                    key={agent.id}
                    onClick={() => setSelection({ kind: "agent", agentId: agent.id })}
                  >
                    <div>
                      <strong>{agent.name}</strong>
                      <span>
                        {agent.job !== "none" ? `${jobName(agent.job)} · ` : ""}
                        {stateName(agent.state)}
                      </span>
                    </div>
                    <div>
                      <span>
                        {agent.age}
                        {tr("y", "세")}
                      </span>
                      <span>
                        {tr("Stamina", "체력")} {Math.round(agent.health.stamina)}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        )}

        {tab === "log" && <GameLog entries={logs} />}
      </aside>
    </main>
  );
}
