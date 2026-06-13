type ControlPanelProps = {
  onAddRandom: () => void;
  onPlaceAgent: () => void;
  onReset: () => void;
  placementActive: boolean;
};

export function ControlPanel({
  onAddRandom,
  onPlaceAgent,
  onReset,
  placementActive,
}: ControlPanelProps) {
  return (
    <section className="panel-section">
      <h2>Controls</h2>
      <div className="button-grid">
        <button type="button" onClick={onAddRandom}>
          Random resident
        </button>
        <button type="button" onClick={onPlaceAgent} data-active={placementActive}>
          Place on map
        </button>
        <button type="button" onClick={onReset}>
          New world
        </button>
      </div>
      <p className="hint muted">
        Tap a resident, animal, or building on the map to inspect it. Drag to pan, pinch or scroll to
        zoom, ⌖ to recenter.
      </p>
    </section>
  );
}
