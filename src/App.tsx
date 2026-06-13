import { useEffect, useMemo, useRef, useState } from "react";
import { GameApp } from "./game/GameApp";
import { ERA_NAMES, SAVE_KEY } from "./game/Simulation";
import type {
  Agent,
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
  const [selection, setSelection] = useState<InspectionTarget | null>(null);

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

  const clockLabel = clock
    ? `Year ${clock.year} · Day ${clock.day} · ${String(clock.hour).padStart(2, "0")}:${String(
        clock.minute,
      ).padStart(2, "0")} ${clock.isNight ? "🌙" : "☀️"} · ${
        ERA_NAMES[era] ?? "Unknown"
      } Era · 🌾 ${foodStock} · 🍲 ${meals}`
    : "";

  return (
    <main className="app-shell">
      <section className="game-surface" aria-label="Project Genesis map">
        <div ref={canvasHostRef} className="canvas-host" />
      </section>
      <aside className="side-panel">
        <header className="panel-header">
          <h1>Project Genesis</h1>
          <span>{agents.length} residents</span>
        </header>
        {clockLabel && <p className="clock-line">{clockLabel}</p>}
        {selection && (
          <Inspector
            selection={selection}
            agents={agents}
            buildings={buildings}
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
        )}
        <ControlPanel
          onAddRandom={addRandomAgent}
          onPlaceAgent={enablePlacement}
          onReset={resetWorld}
          onSpeedChange={changeSpeed}
          placementActive={pendingPlacement}
          speed={speed}
        />
        <AgentCreator onCreate={addRandomAgent} />
        <section className="panel-section">
          <h2>Residents</h2>
          <div className="agent-list">
            {agents.length === 0 ? (
              <p className="muted">Add a resident to start the simulation.</p>
            ) : (
              agents.map((agent) => (
                <article className="agent-row" key={agent.id}>
                  <div>
                    <strong>{agent.name}</strong>
                    <span>
                      {agent.job !== "none" ? `${agent.job} · ` : ""}
                      {agent.state}
                    </span>
                  </div>
                  <div>
                    <span>Wood {agent.inventory.wood}</span>
                    <span>Stamina {Math.round(agent.health.stamina)}</span>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
        <GameLog entries={logs} />
      </aside>
    </main>
  );
}
