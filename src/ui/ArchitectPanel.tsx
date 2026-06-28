import type { BuildingKind } from "../game/types";
import { tr } from "../i18n";
import type { DevTileTool } from "./DevPanel";

type Props = {
  placingKind: BuildingKind | null;
  instantBuild: boolean;
  tileTool: DevTileTool;
  draftActive: boolean;
  onPlaceBuild: (kind: BuildingKind) => void;
  onInstantBuild: (instant: boolean) => void;
  onTileTool: (tool: DevTileTool) => void;
  onApplyDraft: () => void;
  onCancelDraft: () => void;
  onClose: () => void;
};

export function ArchitectPanel({
  placingKind,
  instantBuild,
  tileTool,
  draftActive,
  onPlaceBuild,
  onInstantBuild,
  onTileTool,
  onApplyDraft,
  onCancelDraft,
  onClose,
}: Props) {
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
          {tr("Apply", "Apply")}
        </button>
        <button type="button" disabled={!draftActive} onClick={onCancelDraft}>
          {tr("Cancel draft", "Cancel draft")}
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

      <div className="tool-label">{tr("Structure", "Structure")}</div>
      <div className="tool-row">
        <button type="button" data-active={tileTool === "wall"} onClick={() => onTileTool("wall")}>
          {tr("Wall", "Wall")}
        </button>
        <button type="button" data-active={tileTool === "door"} onClick={() => onTileTool("door")}>
          {tr("Door", "Door")}
        </button>
      </div>

      <div className="tool-label">{tr("Path / erase", "Path / erase")}</div>
      <div className="tool-row">
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
