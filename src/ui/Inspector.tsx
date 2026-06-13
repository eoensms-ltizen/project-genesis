import type {
  Agent,
  Animal,
  Building,
  GameLogEntry,
  InspectionTarget,
  TileType,
} from "../game/types";

type InspectorProps = {
  selection: InspectionTarget;
  agents: Agent[];
  buildings: Building[];
  animals: Animal[];
  episodes: GameLogEntry[];
  tileType?: TileType;
  tileTraffic?: number;
  onClose: () => void;
};

export function Inspector({
  selection,
  agents,
  buildings,
  animals,
  episodes,
  tileType,
  tileTraffic,
  onClose,
}: InspectorProps) {
  return (
    <section className="panel-section inspector">
      <div className="inspector-head">
        <h2>Inspector</h2>
        <button type="button" onClick={onClose}>
          ✕
        </button>
      </div>
      {selection.kind === "agent" && (
        <AgentInfo
          agent={agents.find((agent) => agent.id === selection.agentId)}
          agents={agents}
          episodes={episodes}
        />
      )}
      {selection.kind === "building" && (
        <BuildingInfo
          building={buildings.find((building) => building.id === selection.buildingId)}
          agents={agents}
        />
      )}
      {selection.kind === "animal" && (
        <AnimalInfo animal={animals.find((animal) => animal.id === selection.animalId)} />
      )}
      {selection.kind === "tile" && (
        <TileInfo
          x={selection.position.x}
          y={selection.position.y}
          type={tileType}
          traffic={tileTraffic}
        />
      )}
    </section>
  );
}

function houseTier(level: number): string {
  if (level >= 4) return "tower";
  if (level >= 3) return "apartment";
  if (level >= 2) return "villa";
  return "house";
}

function lifeStage(age: number): string {
  if (age < 4) return "Baby";
  if (age < 12) return "Child";
  if (age < 20) return "Youth";
  if (age < 60) return "Adult";
  return "Elder";
}

// Reads the resident's strongest pull so the player can answer "why are they
// doing that?" — the same needs the brain arbitrates over.
function motivation(agent: Agent): string {
  const pulls: { label: string; urgency: number }[] = [
    { label: "hungry", urgency: agent.health.hunger },
    { label: "weary", urgency: 100 - agent.health.stamina },
    { label: "lonely", urgency: 100 - agent.needs.social },
    { label: "restless for work", urgency: 100 - agent.needs.purpose },
    { label: "seeking meaning", urgency: 100 - agent.needs.faith },
    { label: "bored", urgency: 100 - agent.needs.leisure },
    { label: "cramped", urgency: 100 - agent.needs.comfort },
  ];
  pulls.sort((a, b) => b.urgency - a.urgency);
  return pulls[0].urgency < 35 ? "content" : pulls[0].label;
}

function NeedBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const hue = Math.round((pct / 100) * 120); // red (low) -> green (full)
  return (
    <div className="need-bar">
      <span className="need-bar-label">{label}</span>
      <span className="need-bar-track">
        <span
          className="need-bar-fill"
          style={{ width: `${pct}%`, background: `hsl(${hue} 70% 45%)` }}
        />
      </span>
      <span className="need-bar-value">{pct}</span>
    </div>
  );
}

function AgentInfo({
  agent,
  agents,
  episodes,
}: {
  agent?: Agent;
  agents: Agent[];
  episodes: GameLogEntry[];
}) {
  if (!agent) {
    return <p className="muted">This resident is no longer with us.</p>;
  }

  const spouse = agent.spouseId
    ? agents.find((other) => other.id === agent.spouseId)
    : undefined;

  return (
    <div className="inspector-body">
      <strong>{agent.name}</strong>
      <dl>
        <dt>Stage</dt>
        <dd>
          {lifeStage(agent.age)} · {agent.age}y / {agent.lifespan}y
        </dd>
        <dt>Job</dt>
        <dd>{agent.job === "none" ? "villager" : agent.job}</dd>
        <dt>Motivation</dt>
        <dd>{motivation(agent)}</dd>
        <dt>Family</dt>
        <dd>{spouse ? `married to ${spouse.name}` : "single"}</dd>
        <dt>Home</dt>
        <dd>{agent.home ? `(${agent.home.x}, ${agent.home.y})` : "homeless"}</dd>
      </dl>
      <h3>Needs</h3>
      <div className="need-bars">
        <NeedBar label="Food" value={100 - agent.health.hunger} />
        <NeedBar label="Energy" value={agent.health.stamina} />
        <NeedBar label="Social" value={agent.needs.social} />
        <NeedBar label="Purpose" value={agent.needs.purpose} />
        <NeedBar label="Faith" value={agent.needs.faith} />
        <NeedBar label="Leisure" value={agent.needs.leisure} />
        <NeedBar label="Comfort" value={agent.needs.comfort} />
      </div>
      <h3>Episodes</h3>
      {episodes.length === 0 ? (
        <p className="muted">Nothing memorable yet.</p>
      ) : (
        <div className="episode-list">
          {[...episodes].reverse().map((entry) => (
            <div key={entry.id} className="log-line">
              {entry.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BuildingInfo({ building, agents }: { building?: Building; agents: Agent[] }) {
  if (!building) {
    return <p className="muted">This building no longer exists.</p>;
  }

  const owner = building.ownerId
    ? agents.find((agent) => agent.id === building.ownerId)
    : undefined;
  const builtYear =
    building.builtAtDay !== undefined ? Math.floor(building.builtAtDay / 20) + 1 : undefined;
  const builtDay =
    building.builtAtDay !== undefined ? (building.builtAtDay % 20) + 1 : undefined;

  return (
    <div className="inspector-body">
      <strong>
        {building.kind} ({building.stage})
      </strong>
      <dl>
        <dt>Owner</dt>
        <dd>
          {owner ? owner.name : building.kind === "house" ? "empty / unclaimed" : "the village"}
        </dd>
        {builtYear !== undefined && (
          <>
            <dt>Built</dt>
            <dd>
              Year {builtYear}, Day {builtDay}
            </dd>
          </>
        )}
        {building.kind === "house" && (
          <>
            <dt>Type</dt>
            <dd>
              {houseTier(building.level ?? 1)} · L{building.level ?? 1} ·{" "}
              {building.capacity ?? 1} residents
            </dd>
          </>
        )}
        {building.durability !== undefined && (
          <>
            <dt>Durability</dt>
            <dd>{Math.round(building.durability)}%</dd>
          </>
        )}
        <dt>Size</dt>
        <dd>
          {building.width}x{building.height} at ({building.x}, {building.y})
        </dd>
      </dl>
    </div>
  );
}

function AnimalInfo({ animal }: { animal?: Animal }) {
  if (!animal) {
    return <p className="muted">This animal has moved on.</p>;
  }
  return (
    <div className="inspector-body">
      <strong>{animal.kind}</strong>
      <dl>
        <dt>Status</dt>
        <dd>{animal.state === "tamed" ? "tamed livestock" : "wild"}</dd>
        <dt>Health</dt>
        <dd>{animal.health}</dd>
        <dt>Position</dt>
        <dd>
          ({Math.round(animal.position.x)}, {Math.round(animal.position.y)})
        </dd>
      </dl>
    </div>
  );
}

function TileInfo({
  x,
  y,
  type,
  traffic,
}: {
  x: number;
  y: number;
  type?: TileType;
  traffic?: number;
}) {
  return (
    <div className="inspector-body">
      <strong>{type ?? "Unknown"}</strong>
      <dl>
        <dt>Position</dt>
        <dd>
          ({x}, {y})
        </dd>
        {traffic !== undefined && traffic > 0 && (
          <>
            <dt>Foot traffic</dt>
            <dd>{traffic} crossings</dd>
          </>
        )}
      </dl>
    </div>
  );
}
