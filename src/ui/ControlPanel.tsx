import { tr } from "../i18n";

type ControlPanelProps = {
  onAddRandom: () => void;
  onAddImmigrant: () => void;
  onPlaceAgent: () => void;
  onReset: () => void;
  placementActive: boolean;
};

export function ControlPanel({
  onAddRandom,
  onAddImmigrant,
  onPlaceAgent,
  onReset,
  placementActive,
}: ControlPanelProps) {
  return (
    <section className="panel-section">
      <h2>{tr("Controls", "조작")}</h2>
      <div className="button-grid">
        <button type="button" onClick={onAddImmigrant}>
          {tr("Add immigrant", "이주민 추가")} 🧳
        </button>
        <button type="button" onClick={onAddRandom}>
          {tr("Random resident", "무작위 주민")}
        </button>
        <button type="button" onClick={onPlaceAgent} data-active={placementActive}>
          {tr("Place on map", "지도에 배치")}
        </button>
        <button type="button" onClick={onReset}>
          {tr("New world", "새 세계")}
        </button>
      </div>
      <p className="hint muted">
        {tr(
          "Tap a resident, animal, or building on the map to inspect it. Drag to pan, pinch or scroll to zoom, ⌖ to recenter.",
          "지도에서 주민·동물·건물을 누르면 정보를 봅니다. 드래그로 이동, 핀치/스크롤로 확대, ⌖로 중앙 정렬.",
        )}
      </p>
    </section>
  );
}
