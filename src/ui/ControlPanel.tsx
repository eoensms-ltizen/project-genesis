import type { GameMode } from "../game/types";
import { tr } from "../i18n";

type ControlPanelProps = {
  onAddRandom: () => void;
  onAddImmigrant: () => void;
  onPlaceAgent: () => void;
  onReset: (mode: GameMode) => void;
  placementActive: boolean;
  gameMode: GameMode;
};

export function ControlPanel({
  onAddRandom,
  onAddImmigrant,
  onPlaceAgent,
  onReset,
  placementActive,
  gameMode,
}: ControlPanelProps) {
  const modeLabel =
    gameMode === "architect" ? tr("Architect", "설계자") : tr("Auto growth", "자동 성장");

  return (
    <section className="panel-section">
      <div className="mode-row">
        <h2>{tr("Controls", "조작")}</h2>
        <span className="mode-pill">{modeLabel}</span>
      </div>
      <div className="button-grid">
        <button type="button" onClick={onAddImmigrant}>
          {tr("Add immigrant", "이주민 추가")}
        </button>
        <button type="button" onClick={onAddRandom}>
          {tr("Random resident", "무작위 주민")}
        </button>
        <button type="button" onClick={onPlaceAgent} data-active={placementActive}>
          {tr("Place on map", "지도에 배치")}
        </button>
        <button type="button" onClick={() => onReset("auto")}>
          {tr("New auto", "자동 새 세계")}
        </button>
        <button type="button" onClick={() => onReset("architect")}>
          {tr("New architect", "설계자 새 세계")}
        </button>
      </div>
      <p className="hint muted">
        {tr(
          "Tap a resident, animal, or building on the map to inspect it. Drag to pan, pinch or scroll to zoom, use recenter to return.",
          "지도에서 주민, 동물, 건물을 눌러 정보를 봅니다. 드래그로 이동하고, 핀치나 스크롤로 확대합니다.",
        )}
      </p>
    </section>
  );
}
