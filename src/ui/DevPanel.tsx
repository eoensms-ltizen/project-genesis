import type { BuildingKind, FoodKind, FurnitureKind, ResourceKind } from "../game/types";
import { tr } from "../i18n";

/** A sticky map-click tool for free-form tile edits (null = none armed). */
export type DevTileTool =
  | "field"
  | "road"
  | "wall"
  | "door"
  | "demolishTile"
  | "demolishBuilding"
  | FurnitureKind
  | null;

type Props = {
  era: number;
  placingKind: BuildingKind | null;
  instantBuild: boolean;
  tileTool: DevTileTool;
  onResource: (resource: ResourceKind, amount: number) => void;
  onFood: (kind: FoodKind, amount: number) => void;
  onFillMaterials: () => void;
  onHungerAll: (hunger: number) => void;
  onAdvanceTime: (seconds: number) => void;
  onPlaceBuild: (kind: BuildingKind) => void;
  onInstantBuild: (instant: boolean) => void;
  onTileTool: (tool: DevTileTool) => void;
  onClose: () => void;
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
  tileTool,
  onResource,
  onFood,
  onFillMaterials,
  onHungerAll,
  onAdvanceTime,
  onPlaceBuild,
  onInstantBuild,
  onTileTool,
  onClose,
  onEra,
}: Props) {
  return (
    <details
      className="panel-section"
      onToggle={(e) => {
        // Collapsing the panel disarms any placement/tile tool, so the cursor ghost
        // never lingers during normal play — it only shows while you're in here.
        if (!(e.currentTarget as HTMLDetailsElement).open) {
          onClose();
        }
      }}
    >
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
        <span style={labelStyle}>{tr("Tiles", "타일")}</span>
        <button
          type="button"
          data-active={tileTool === "road"}
          onClick={() => onTileTool("road")}
        >
          🛣️ {tr("Road", "도로")}
        </button>
        <button
          type="button"
          data-active={tileTool === "demolishTile"}
          onClick={() => onTileTool("demolishTile")}
        >
          🧹 {tr("Demolish tile", "타일 철거")}
        </button>
        <button
          type="button"
          data-active={tileTool === "demolishBuilding"}
          onClick={() => onTileTool("demolishBuilding")}
        >
          💥 {tr("Demolish building", "건물 철거")}
        </button>
      </div>
      {tileTool && (
        <p className="muted" style={{ fontSize: 11, margin: "2px 0" }}>
          {tileTool === "road"
            ? tr("Click ground tiles to pave roads.", "땅을 클릭해 도로를 깝니다.")
            : tileTool === "demolishTile"
              ? tr(
                  "Click tiles to demolish them — left alone, residents repair structures.",
                  "타일을 클릭해 철거합니다 — 방치하면 주민이 건물을 수리합니다.",
                )
              : tr("Click a building to tear it down entirely.", "건물을 클릭해 통째로 철거합니다.")}
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
