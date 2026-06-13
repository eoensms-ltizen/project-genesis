import { useEffect, useMemo, useRef, useState } from "react";
import { GameApp } from "./game/GameApp";
import { ERA_NAMES, SAVE_KEY } from "./game/Simulation";
import type {
  Agent,
  Animal,
  Building,
  GameClock,
  GameLogEntry,
  InspectionTarget,
  Vec2,
} from "./game/types";
import { AgentCreator } from "./ui/AgentCreator";
import { ControlPanel } from "./ui/ControlPanel";
import { GameLog } from "./ui/GameLog";
import { Inspector } from "./ui/Inspector";

const TICK_MS = 160;

export default function App() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<GameApp | null>(null);
  const [, forceFrame] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<GameLogEntry[]>([]);
  const [clock, setClock] = useState<GameClock | null>(null);
  const [era, setEra] = useState(0);
  const [foodStock, setFoodStock] = useState(0);
  const [meals, setMeals] = useState(0);
  const [pendingPlacement, setPendingPlacement] = useState(false);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [selection, setSelection] = useState<InspectionTarget | null>(null);
  const [tab, setTab] = useState<"world" | "people" | "log">("world");

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
        setFoodStock(snapshot.foodStock);
        setMeals(snapshot.meals);
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

  const enablePlacement = () => {
    gameRef.current?.setPlacementMode(true);
    setPendingPlacement(true);
  };

  const changeSpeed = (value: number) => {
    speedRef.current = value;
    setSpeed(value);
  };

  const resetWorld = () => {
    if (!window.confirm("Start a new world? The current village will be lost.")) {
      return;
    }
    gameRef.current?.simulation.disableSaving();
    localStorage.removeItem(SAVE_KEY);
    window.location.reload();
  };

  const recenter = () => gameRef.current?.resetCamera();

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
                  {ERA_NAMES[era] ?? "?"} · 👥{agents.length} · 🌾{foodStock} · 🍲{meals}
                </span>
              </>
            ) : (
              <span className="hud-date">Loading…</span>
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
            <button type="button" className="hud-speed" onClick={recenter} title="Recenter">
              ⌖
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
              onClose={() => setSelection(null)}
            />
          </div>
        )}
      </section>

      <aside className="side-panel">
        <nav className="panel-tabs">
          <button type="button" data-active={tab === "world"} onClick={() => setTab("world")}>
            World
          </button>
          <button type="button" data-active={tab === "people"} onClick={() => setTab("people")}>
            People <span className="tab-count">{agents.length}</span>
          </button>
          <button type="button" data-active={tab === "log"} onClick={() => setTab("log")}>
            Log
          </button>
        </nav>

        {tab === "world" && (
          <>
            <ControlPanel
              onAddRandom={addRandomAgent}
              onPlaceAgent={enablePlacement}
              onReset={resetWorld}
              placementActive={pendingPlacement}
            />
            <AgentCreator onCreate={addRandomAgent} />
          </>
        )}

        {tab === "people" && (
          <section className="panel-section panel-grow">
            <h2>Residents</h2>
            <div className="agent-list agent-list-full">
              {agents.length === 0 ? (
                <p className="muted">Add a resident to start the simulation.</p>
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
                        {agent.job !== "none" ? `${agent.job} · ` : ""}
                        {agent.state}
                      </span>
                    </div>
                    <div>
                      <span>{agent.age}y</span>
                      <span>Stamina {Math.round(agent.health.stamina)}</span>
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
