import type {
  Agent,
  Building,
  GameLogEntry,
  InspectionTarget,
  TileType,
} from "../game/types";

type InspectorProps = {
  selection: InspectionTarget;
  agents: Agent[];
  buildings: Building[];
  episodes: GameLogEntry[];
  tileType?: TileType;
  tileTraffic?: number;
  onClose: () => void;
};

export function Inspector({
  selection,
  agents,
  buildings,
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

function lifeStage(age: number): string {
  if (age < 4) return "Baby";
  if (age < 12) return "Child";
  if (age < 20) return "Youth";
  if (age < 60) return "Adult";
  return "Elder";
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
        <dt>Condition</dt>
        <dd>
          Hunger {Math.round(agent.health.hunger)} · Stamina {Math.round(agent.health.stamina)}
        </dd>
        <dt>Family</dt>
        <dd>{spouse ? `married to ${spouse.name}` : "single"}</dd>
        <dt>Home</dt>
        <dd>{agent.home ? `(${agent.home.x}, ${agent.home.y})` : "homeless"}</dd>
      </dl>
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
