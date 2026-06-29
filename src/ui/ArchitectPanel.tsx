import type { BuildingKind } from "../game/types";
import { tr } from "../i18n";
import type { DevTileTool } from "./DevPanel";

const FURNITURE_TOOLS = new Set(["bed", "stove", "counter", "table", "chair"]);
const ROTATION_LABELS = ["→", "↓", "←", "↑"];

type Props = {
  placingKind: BuildingKind | null;
  instantBuild: boolean;
  tileTool: DevTileTool;
  draftActive: boolean;
  rotation: number;
  onPlaceBuild: (kind: BuildingKind) => void;
  onInstantBuild: (instant: boolean) => void;
  onTileTool: (tool: DevTileTool) => void;
  onRotate: () => void;
  onApplyDraft: () => void;
  onCancelDraft: () => void;
  onClose: () => void;
};

export function ArchitectPanel({
  placingKind,
  instantBuild,
  tileTool,
  draftActive,
  rotation,
  onPlaceBuild,
  onInstantBuild,
  onTileTool,
  onRotate,
  onApplyDraft,
  onCancelDraft,
  onClose,
}: Props) {
  const furnitureArmed = tileTool !== null && FURNITURE_TOOLS.has(tileTool);
  const active = Boolean(placingKind || tileTool);
  const buildings: { kind: BuildingKind; label: string }[] = [
    { kind: "house", label: tr("House", "집") },
    { kind: "warehouse", label: tr("Warehouse", "창고") },
    { kind: "granary", label: tr("Granary", "식량창고") },
    { kind: "kitchen", label: tr("Kitchen", "부엌") },
    { kind: "funfair", label: tr("Funfair", "놀이공원") },
    { kind: "pasture", label: tr("Pasture", "목초지") },
  ];

  return (
    <section className="panel-section architect-tools">
      <div className="panel-title-row">
        <h2>{tr("Architect", "설계자")}</h2>
        {active && (
          <button type="button" className="small-button" onClick={onClose}>
            {tr("Cancel", "취소")}
          </button>
        )}
      </div>

      <div className="tool-row">
        <button type="button" data-active={!instantBuild} onClick={() => onInstantBuild(false)}>
          {tr("Residents build", "주민 건설")}
        </button>
        <button type="button" data-active={instantBuild} onClick={() => onInstantBuild(true)}>
          {tr("Instant", "즉시")}
        </button>
      </div>

      <div className="tool-row draft-actions">
        <button type="button" data-active={draftActive} disabled={!draftActive} onClick={onApplyDraft}>
          {tr("Apply", "적용")}
        </button>
        <button type="button" disabled={!draftActive} onClick={onCancelDraft}>
          {tr("Cancel draft", "초안 취소")}
        </button>
      </div>

      <div className="button-grid compact-grid">
        {buildings.map((building) => (
          <button
            type="button"
            key={building.kind}
            data-active={placingKind === building.kind}
            onClick={() => onPlaceBuild(building.kind)}
          >
            {building.label}
          </button>
        ))}
      </div>

      <div className="tool-label">{tr("Structure", "구조물")}</div>
      <div className="tool-row">
        <button type="button" data-active={tileTool === "wall"} onClick={() => onTileTool("wall")}>
          {tr("Wall", "벽")}
        </button>
        <button type="button" data-active={tileTool === "door"} onClick={() => onTileTool("door")}>
          {tr("Door", "문")}
        </button>
      </div>

      <div className="tool-label">{tr("Furniture", "가구")}</div>
      <div className="button-grid compact-grid">
        <button type="button" data-active={tileTool === "bed"} onClick={() => onTileTool("bed")}>
          {tr("Bed", "침대")}
        </button>
        <button type="button" data-active={tileTool === "stove"} onClick={() => onTileTool("stove")}>
          {tr("Stove", "화덕")}
        </button>
        <button type="button" data-active={tileTool === "counter"} onClick={() => onTileTool("counter")}>
          {tr("Counter", "조리대")}
        </button>
        <button type="button" data-active={tileTool === "table"} onClick={() => onTileTool("table")}>
          {tr("Table", "식탁")}
        </button>
        <button type="button" data-active={tileTool === "chair"} onClick={() => onTileTool("chair")}>
          {tr("Chair", "의자")}
        </button>
      </div>
      {furnitureArmed && (
        <div className="tool-row">
          <button type="button" onClick={onRotate}>
            {tr("Rotate (R)", "회전 (R)")} {ROTATION_LABELS[rotation % 4]}
          </button>
          <span className="muted" style={{ fontSize: 11 }}>
            {tr("Click to place", "클릭해서 배치")}
          </span>
        </div>
      )}

      <div className="tool-label">{tr("Path / erase", "경로 / 철거")}</div>
      <div className="tool-row">
        <button type="button" data-active={tileTool === "field"} onClick={() => onTileTool("field")}>
          {tr("Field", "밭")}
        </button>
        <button type="button" data-active={tileTool === "road"} onClick={() => onTileTool("road")}>
          {tr("Road", "도로")}
        </button>
        <button
          type="button"
          data-active={tileTool === "demolishTile"}
          onClick={() => onTileTool("demolishTile")}
        >
          {tr("Erase tile", "타일 제거")}
        </button>
      </div>
    </section>
  );
}
