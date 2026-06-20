import type { BuildingKind, FoodKind, ResourceKind } from "../game/types";
import { tr } from "../i18n";

type Props = {
  era: number;
  onResource: (resource: ResourceKind, amount: number) => void;
  onFood: (kind: FoodKind, amount: number) => void;
  onBuild: (kind: BuildingKind) => void;
  onEra: (era: number) => void;
};

const BUILDINGS: { kind: BuildingKind; label: string }[] = [
  { kind: "house", label: tr("house", "집") },
  { kind: "warehouse", label: tr("warehouse", "창고") },
  { kind: "granary", label: tr("granary", "식량창고") },
  { kind: "kitchen", label: tr("kitchen", "부엌") },
  { kind: "funfair", label: tr("funfair", "놀이공원") },
  { kind: "pasture", label: tr("pasture", "목초지") },
];

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  alignItems: "center",
  margin: "4px 0",
};
const labelStyle: React.CSSProperties = { fontSize: 11, opacity: 0.7, minWidth: 44 };

/**
 * Developer-only cheat panel (hidden behind a collapsed <details>): drop in
 * materials/food, instantly raise a building, or jump the era — for testing, not
 * normal play.
 */
export function DevPanel({ era, onResource, onFood, onBuild, onEra }: Props) {
  return (
    <details className="panel-section">
      <summary style={{ cursor: "pointer" }}>🛠 {tr("Developer tools", "개발자 도구")}</summary>

      <div style={rowStyle}>
        <span style={labelStyle}>{tr("Materials", "자재")}</span>
        <button type="button" onClick={() => onResource("wood", 50)}>🪵 +50</button>
        <button type="button" onClick={() => onResource("stone", 50)}>🪨 +50</button>
        <button type="button" onClick={() => onResource("ironOre", 30)}>⛏️ +30</button>
        <button type="button" onClick={() => onResource("steel", 20)}>🔩 +20</button>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{tr("Food", "식량")}</span>
        <button type="button" onClick={() => onFood("wheat", 30)}>🌾 +30</button>
        <button type="button" onClick={() => onFood("beef", 30)}>🥩 +30</button>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{tr("Build", "건물")}</span>
        {BUILDINGS.map((b) => (
          <button type="button" key={b.kind} onClick={() => onBuild(b.kind)}>
            {b.label}
          </button>
        ))}
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{tr("Era", "시대")} {era}</span>
        <button type="button" onClick={() => onEra(era - 1)}>−</button>
        <button type="button" onClick={() => onEra(era + 1)}>+</button>
      </div>
    </details>
  );
}
