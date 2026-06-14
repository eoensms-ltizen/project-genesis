import type { GameLogEntry } from "../game/types";
import { tr } from "../i18n";

type GameLogProps = {
  entries: GameLogEntry[];
};

export function GameLog({ entries }: GameLogProps) {
  return (
    <section className="panel-section log-panel">
      <h2>{tr("Game Log", "기록")}</h2>
      <div className="log-list">
        {entries.map((entry) => (
          <div className="log-line" key={entry.id}>
            [{formatTime(entry.time)}] {entry.message}
          </div>
        ))}
      </div>
    </section>
  );
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const rest = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${rest}`;
}
