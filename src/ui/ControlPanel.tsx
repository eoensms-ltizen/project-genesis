const SPEED_OPTIONS = [0, 1, 2, 4] as const;

type ControlPanelProps = {
  onAddRandom: () => void;
  onPlaceAgent: () => void;
  onReset: () => void;
  onSpeedChange: (speed: number) => void;
  placementActive: boolean;
  speed: number;
};

export function ControlPanel({
  onAddRandom,
  onPlaceAgent,
  onReset,
  onSpeedChange,
  placementActive,
  speed,
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
      <div className="speed-row">
        {SPEED_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onSpeedChange(option)}
            data-active={speed === option}
          >
            {option === 0 ? "⏸" : `${option}x`}
          </button>
        ))}
      </div>
    </section>
  );
}
