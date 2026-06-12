type ControlPanelProps = {
  onAddRandom: () => void;
  onPlaceAgent: () => void;
  placementActive: boolean;
};

export function ControlPanel({ onAddRandom, onPlaceAgent, placementActive }: ControlPanelProps) {
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
      </div>
    </section>
  );
}
