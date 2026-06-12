import { useEffect, useMemo, useRef, useState } from "react";
import { GameApp } from "./game/GameApp";
import type { Agent, GameLogEntry, Vec2 } from "./game/types";
import { AgentCreator } from "./ui/AgentCreator";
import { ControlPanel } from "./ui/ControlPanel";
import { GameLog } from "./ui/GameLog";

const TICK_MS = 160;

export default function App() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<GameApp | null>(null);
  const [, forceFrame] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<GameLogEntry[]>([]);
  const [pendingPlacement, setPendingPlacement] = useState(false);

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
        forceFrame((value) => value + 1);
      },
      onTileClick: (position) => {
        if (!gameRef.current?.isPlacementMode()) {
          return;
        }
        gameRef.current.addRandomAgent(position);
        gameRef.current.setPlacementMode(false);
        setPendingPlacement(false);
      },
    });

    gameRef.current = game;
    void game.start().then(() => {
      if (disposed) {
        game.destroy();
      }
    });

    const intervalId = window.setInterval(() => {
      game.tick(TICK_MS / 1000);
    }, TICK_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
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
        <ControlPanel
          onAddRandom={addRandomAgent}
          onPlaceAgent={enablePlacement}
          placementActive={pendingPlacement}
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
                    <span>{agent.state}</span>
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
