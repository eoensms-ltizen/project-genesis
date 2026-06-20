import type { BuildingKind, FoodKind, ResourceKind } from "../game/types";
import { tr } from "../i18n";

type Props = {
  era: number;
  placingKind: BuildingKind | null;
  instantBuild: boolean;
  onResource: (resource: ResourceKind, amount: number) => void;
  onFood: (kind: FoodKind, amount: number) => void;
  onFillMaterials: () => void;
  onHungerAll: (hunger: number) => void;
  onAdvanceTime: (seconds: number) => void;
  onPlaceBuild: (kind: BuildingKind) => void;
  onInstantBuild: (instant: boolean) => void;
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

const DAY = 300; // sim-seconds per day
const HOUR = DAY / 24;

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
 * materials/food, feed/starve residents, jump time/era, and click-place any
 * building — for testing, not normal play.
 */
export function DevPanel({
  era,
  placingKind,
  instantBuild,
  onResource,
  onFood,
  onFillMaterials,
  onHungerAll,
  onAdvanceTime,
  onPlaceBuild,
  onInstantBuild,
  onEra,
}: Props) {
  return (
    <details className="panel-section">
      <summary style={{ cursor: "pointer" }}>🛠 {tr("Developer tools", "개발자 도구")}</summary>

      <div style={rowStyle}>
        <span style={labelStyle}>{tr("Materials", "자재")}</span>
        <button type="button" onClick={() => onResource("wood", 50)}>🪵 +50</button>
        <button type="button" onClick={() => onResource("stone", 50)}>🪨 +50</button>
        <button type="button" onClick={() => onResource("ironOre", 30)}>⛏️ +30</button>
        <button type="button" onClick={() => onResource("steel", 20)}>🔩 +20</button>
        <button type="button" onClick={onFillMaterials}>{tr("Fill all", "전부 채우기")}</button>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{tr("Food", "식량")}</span>
        <button type="button" onClick={() => onFood("wheat", 30)}>🌾 +30</button>
        <button type="button" onClick={() => onFood("beef", 30)}>🥩 +30</button>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{tr("Residents", "주민")}</span>
        <button type="button" onClick={() => onHungerAll(0)}>{tr("Feed all", "전부 배불리기")}</button>
        <button type="button" onClick={() => onHungerAll(95)}>{tr("Starve all", "전부 굶기기")}</button>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{tr("Time", "시간")}</span>
        <button type="button" onClick={() => onAdvanceTime(HOUR)}>+1{tr("h", "시간")}</button>
        <button type="button" onClick={() => onAdvanceTime(6 * HOUR)}>+6{tr("h", "시간")}</button>
        <button type="button" onClick={() => onAdvanceTime(DAY)}>+1{tr("d", "일")}</button>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{tr("Mode", "방식")}</span>
        <button
          type="button"
          data-active={instantBuild}
          onClick={() => onInstantBuild(true)}
        >
          {tr("Instant", "즉시 완공")}
        </button>
        <button
          type="button"
          data-active={!instantBuild}
          onClick={() => onInstantBuild(false)}
        >
          {tr("Stake site", "건설 목표만")}
        </button>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{tr("Place", "배치")}</span>
        {BUILDINGS.map((b) => (
          <button
            type="button"
            key={b.kind}
            data-active={placingKind === b.kind}
            onClick={() => onPlaceBuild(b.kind)}
          >
            {b.label}
          </button>
        ))}
      </div>
      {placingKind && (
        <p className="muted" style={{ fontSize: 11, margin: "2px 0" }}>
          {instantBuild
            ? tr("Click the map to place it (finished).", "지도를 클릭해 즉시 완공합니다.")
            : tr("Click the map to stake a site — residents build it.", "지도를 클릭해 건설 목표만 세웁니다(주민이 직접 건설).")}
        </p>
      )}

      <div style={rowStyle}>
        <span style={labelStyle}>{tr("Era", "시대")} {era}</span>
        <button type="button" onClick={() => onEra(era - 1)}>−</button>
        <button type="button" onClick={() => onEra(era + 1)}>+</button>
      </div>
    </details>
  );
}
