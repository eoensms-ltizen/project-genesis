import { useEffect, useMemo, useRef, useState } from "react";
import { GameApp } from "./game/GameApp";
import { ERA_NAMES, SAVE_KEY } from "./game/Simulation";
import type {
  Agent,
  AgentState,
  Animal,
  Building,
  GameClock,
  GameLogEntry,
  InspectionTarget,
  Vec2,
} from "./game/types";
import { getLang, setLang, tr, type Lang } from "./i18n";
import { AgentCreator } from "./ui/AgentCreator";
import { ControlPanel } from "./ui/ControlPanel";
import { GameLog } from "./ui/GameLog";
import { Inspector } from "./ui/Inspector";

const TICK_MS = 160;

const ERA_LABELS_KO = ["개척", "정착", "마을", "도시", "산업"];

function eraName(era: number): string {
  return tr(ERA_NAMES[era] ?? "?", ERA_LABELS_KO[era] ?? "?");
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
  MoveToKitchen: "부엌으로 이동",
  Cook: "요리",
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
  MoveToRedevelop: "재건축지로 이동",
  Redevelop: "재건축",
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
  Wander: "배회",
  Rest: "쉬기",
};

function stateName(state: AgentState): string {
  return tr(state, STATE_LABELS_KO[state] ?? state);
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
  const [era, setEra] = useState(0);
  const [supportedPop, setSupportedPop] = useState(0);
  const [foodStock, setFoodStock] = useState(0);
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
  const [tab, setTab] = useState<"world" | "people" | "log">("world");
  const [flatBuildings, setFlatBuildings] = useState(
    () => localStorage.getItem("pg-flat-buildings") === "1",
  );
  const [lang, setLangState] = useState<Lang>(() => getLang());

  const defaultSpawn = useMemo<Vec2>(() => ({ x: 32, y: 32 }), []);

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
        setEra(snapshot.era);
        setSupportedPop(snapshot.supportedPopulation);
        setFoodStock(snapshot.foodStock);
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
        if (gameRef.current.isPlacementMode()) {
          gameRef.current.addRandomAgent(position);
          gameRef.current.setPlacementMode(false);
          setPendingPlacement(false);
          return;
        }
        setSelection(gameRef.current.inspectAt(position));
      },
    });

    gameRef.current = game;
    game.setFlatBuildings(localStorage.getItem("pg-flat-buildings") === "1");
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
    document.addEventListener("visibilitychange", saveOnHide);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", saveOnHide);
      game.simulation.saveNow();
      game.destroy();
      gameRef.current = null;
    };
  }, []);

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

  const changeSpeed = (value: number) => {
    speedRef.current = value;
    setSpeed(value);
  };

  const toggleLang = () => {
    const next: Lang = lang === "ko" ? "en" : "ko";
    setLang(next);
    setLangState(next);
  };

  const resetWorld = () => {
    if (
      !window.confirm(
        tr(
          "Start a new world? The current village will be lost.",
          "새 세계를 시작할까요? 현재 마을은 사라집니다.",
        ),
      )
    ) {
      return;
    }
    gameRef.current?.simulation.disableSaving();
    localStorage.removeItem(SAVE_KEY);
    window.location.reload();
  };

  const recenter = () => gameRef.current?.resetCamera();

  const toggleFlatBuildings = () => {
    const next = !flatBuildings;
    setFlatBuildings(next);
    gameRef.current?.setFlatBuildings(next);
    localStorage.setItem("pg-flat-buildings", next ? "1" : "0");
  };

  const speedOptions = [0, 1, 2, 4] as const;

  return (
    <main className="app-shell">
      <section className="game-surface" aria-label="Project Genesis map">
        <div ref={canvasHostRef} className="canvas-host" />

        <div className="hud-bar">
          <div className="hud-clock">
            {clock ? (
              <>
                <span className="hud-date">
                  Y{clock.year} · D{clock.day} ·{" "}
                  {String(clock.hour).padStart(2, "0")}:{String(clock.minute).padStart(2, "0")}{" "}
                  {clock.isNight ? "🌙" : "☀️"}
                </span>
                <span className="hud-stats">
                  {eraName(era)} · 👥{agents.length}/{supportedPop} · 🌾{foodStock} · 🍲
                  {meals}
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
              onClose={() => setSelection(null)}
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
            />
            <AgentCreator onCreate={addRandomAgent} />
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
