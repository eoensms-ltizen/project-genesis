import type {
  Agent,
  Animal,
  Building,
  GameLogEntry,
  InspectionTarget,
  TileType,
} from "../game/types";
import { tr } from "../i18n";

type InspectorProps = {
  selection: InspectionTarget;
  agents: Agent[];
  buildings: Building[];
  animals: Animal[];
  episodes: GameLogEntry[];
  tileType?: TileType;
  tileTraffic?: number;
  homeAmbiance?: number;
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
  homeAmbiance,
  onClose,
}: InspectorProps) {
  return (
    <section className="panel-section inspector">
      <div className="inspector-head">
        <h2>{tr("Inspector", "정보")}</h2>
        <button type="button" onClick={onClose}>
          ✕
        </button>
      </div>
      {selection.kind === "agent" && (
        <AgentInfo
          agent={agents.find((agent) => agent.id === selection.agentId)}
          agents={agents}
          episodes={episodes}
          homeAmbiance={homeAmbiance}
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

function surroundings(ambiance: number): string {
  if (ambiance >= 3) return tr("pleasant 🌳", "쾌적함 🌳");
  if (ambiance > 0.5) return tr("agreeable", "괜찮음");
  if (ambiance > -0.5) return tr("plain", "평범함");
  if (ambiance > -3) return tr("dreary", "황량함");
  return tr("grim 🏭", "삭막함 🏭");
}

function houseTier(level: number): string {
  if (level >= 4) return tr("tower", "타워");
  if (level >= 3) return tr("apartment", "아파트");
  if (level >= 2) return tr("villa", "빌라");
  return tr("house", "집");
}

function lifeStage(age: number): string {
  if (age < 4) return tr("Baby", "아기");
  if (age < 12) return tr("Child", "아이");
  if (age < 20) return tr("Youth", "청소년");
  if (age < 60) return tr("Adult", "성인");
  return tr("Elder", "노년");
}

const JOB_NAMES: Record<Agent["job"], () => string> = {
  none: () => tr("villager", "주민"),
  builder: () => tr("builder", "건축가"),
  farmer: () => tr("farmer", "농부"),
  fisher: () => tr("fisher", "어부"),
  woodcutter: () => tr("woodcutter", "나무꾼"),
  cook: () => tr("cook", "요리사"),
  hunter: () => tr("hunter", "사냥꾼"),
  cleaner: () => tr("cleaner", "청소부"),
  police: () => tr("police", "경찰"),
  mayor: () => tr("mayor", "시장"),
  hauler: () => tr("hauler", "운반꾼"),
};

function jobName(job: Agent["job"]): string {
  return (JOB_NAMES[job] ?? JOB_NAMES.none)();
}

const KIND_NAMES: Record<Building["kind"], () => string> = {
  house: () => tr("house", "집"),
  warehouse: () => tr("warehouse", "창고"),
  kitchen: () => tr("kitchen", "부엌"),
  church: () => tr("church", "교회"),
  pasture: () => tr("pasture", "목초지"),
  powerplant: () => tr("power plant", "발전소"),
  factory: () => tr("factory", "공장"),
  station: () => tr("station", "역"),
  cemetery: () => tr("cemetery", "묘지"),
  park: () => tr("park", "공원"),
  police: () => tr("police station", "경찰서"),
};

function kindName(kind: Building["kind"]): string {
  return (KIND_NAMES[kind] ?? (() => kind))();
}

function stageName(stage: Building["stage"]): string {
  if (stage === "site") return tr("site", "부지");
  if (stage === "foundation") return tr("foundation", "골조");
  return tr("built", "완공");
}

function animalName(kind: Animal["kind"]): string {
  if (kind === "deer") return tr("deer", "사슴");
  if (kind === "boar") return tr("boar", "멧돼지");
  if (kind === "rabbit") return tr("rabbit", "토끼");
  return kind;
}

const TILE_NAMES: Partial<Record<TileType, () => string>> = {
  Grass: () => tr("Grass", "풀밭"),
  Tree: () => tr("Tree", "나무"),
  Water: () => tr("Water", "물"),
  Dirt: () => tr("Footpath", "흙길"),
  Road: () => tr("Road", "도로"),
  House: () => tr("Building", "건물"),
  HouseSite: () => tr("Building site", "건물 부지"),
  HouseFoundation: () => tr("Foundation", "골조"),
  Wall: () => tr("Wall", "벽"),
  Floor: () => tr("Floor", "바닥"),
  Door: () => tr("Door", "문"),
  RockSandstone: () => tr("Sandstone", "사암"),
  RockLimestone: () => tr("Limestone", "석회암"),
  RockGranite: () => tr("Granite", "화강암"),
  OreIron: () => tr("Iron ore", "철광석"),
  RockFloor: () => tr("Rough stone floor", "암반 바닥"),
  Berry: () => tr("Berry bush", "베리 덤불"),
  FieldEmpty: () => tr("Field", "밭"),
  FieldGrowing: () => tr("Growing field", "자라는 밭"),
  FieldRipe: () => tr("Ripe field", "익은 밭"),
  Stump: () => tr("Stump", "그루터기"),
  Plaza: () => tr("Plaza", "광장"),
  Fountain: () => tr("Fountain", "분수"),
  Statue: () => tr("Statue", "조각상"),
  Lamp: () => tr("Street lamp", "가로등"),
  Rail: () => tr("Railway", "철로"),
};

function tileName(type?: TileType): string {
  if (!type) return tr("Unknown", "알 수 없음");
  return (TILE_NAMES[type] ?? (() => type))();
}

// Reads the resident's strongest pull so the player can answer "why are they
// doing that?" — the same needs the brain arbitrates over.
function motivation(agent: Agent): string {
  const pulls: { label: string; urgency: number }[] = [
    { label: tr("hungry", "배고픔"), urgency: agent.health.hunger },
    { label: tr("weary", "피곤함"), urgency: 100 - agent.health.stamina },
    { label: tr("lonely", "외로움"), urgency: 100 - agent.needs.social },
    { label: tr("restless for work", "일이 하고 싶음"), urgency: 100 - agent.needs.purpose },
    { label: tr("seeking meaning", "신앙을 찾음"), urgency: 100 - agent.needs.faith },
    { label: tr("bored", "지루함"), urgency: 100 - agent.needs.leisure },
    { label: tr("cramped", "답답함"), urgency: 100 - agent.needs.comfort },
  ];
  pulls.sort((a, b) => b.urgency - a.urgency);
  return pulls[0].urgency < 35 ? tr("content", "만족") : pulls[0].label;
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
  homeAmbiance,
}: {
  agent?: Agent;
  agents: Agent[];
  episodes: GameLogEntry[];
  homeAmbiance?: number;
}) {
  if (!agent) {
    return <p className="muted">{tr("This resident is no longer with us.", "이 주민은 더 이상 없습니다.")}</p>;
  }

  const spouse = agent.spouseId
    ? agents.find((other) => other.id === agent.spouseId)
    : undefined;

  return (
    <div className="inspector-body">
      <strong>{agent.name}</strong>
      <dl>
        <dt>{tr("Stage", "생애")}</dt>
        <dd>
          {lifeStage(agent.age)} · {agent.age}
          {tr("y", "세")} / {agent.lifespan}
          {tr("y", "세")}
        </dd>
        <dt>{tr("Job", "직업")}</dt>
        <dd>{jobName(agent.job)}</dd>
        <dt>{tr("Motivation", "동기")}</dt>
        <dd>{motivation(agent)}</dd>
        <dt>{tr("Family", "가족")}</dt>
        <dd>
          {spouse
            ? tr(`married to ${spouse.name}`, `${spouse.name}와(과) 결혼`)
            : tr("single", "미혼")}
        </dd>
        <dt>{tr("Home", "집")}</dt>
        <dd>{agent.home ? `(${agent.home.x}, ${agent.home.y})` : tr("homeless", "노숙")}</dd>
        {agent.home && homeAmbiance !== undefined && (
          <>
            <dt>{tr("Surroundings", "주변 환경")}</dt>
            <dd>{surroundings(homeAmbiance)}</dd>
          </>
        )}
      </dl>
      <h3>{tr("Needs", "욕구")}</h3>
      <div className="need-bars">
        <NeedBar label={tr("Food", "허기")} value={100 - agent.health.hunger} />
        <NeedBar label={tr("Energy", "체력")} value={agent.health.stamina} />
        <NeedBar label={tr("Social", "사교")} value={agent.needs.social} />
        <NeedBar label={tr("Purpose", "목적")} value={agent.needs.purpose} />
        <NeedBar label={tr("Faith", "신앙")} value={agent.needs.faith} />
        <NeedBar label={tr("Leisure", "여가")} value={agent.needs.leisure} />
        <NeedBar label={tr("Comfort", "쾌적")} value={agent.needs.comfort} />
      </div>
      <h3>{tr("Episodes", "기억")}</h3>
      {episodes.length === 0 ? (
        <p className="muted">{tr("Nothing memorable yet.", "아직 특별한 기억이 없습니다.")}</p>
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
    return <p className="muted">{tr("This building no longer exists.", "이 건물은 더 이상 없습니다.")}</p>;
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
        {kindName(building.kind)} ({stageName(building.stage)})
      </strong>
      <dl>
        <dt>{tr("Owner", "소유")}</dt>
        <dd>
          {owner
            ? owner.name
            : building.kind === "house"
              ? tr("empty / unclaimed", "비어 있음")
              : tr("the village", "마을 공용")}
        </dd>
        {builtYear !== undefined && (
          <>
            <dt>{tr("Built", "건립")}</dt>
            <dd>{tr(`Year ${builtYear}, Day ${builtDay}`, `${builtYear}년 ${builtDay}일`)}</dd>
          </>
        )}
        {building.kind === "house" && (
          <>
            <dt>{tr("Type", "유형")}</dt>
            <dd>
              {houseTier(building.level ?? 1)} · L{building.level ?? 1} ·{" "}
              {tr(`${building.capacity ?? 1} residents`, `${building.capacity ?? 1}명 거주`)}
            </dd>
          </>
        )}
        {building.durability !== undefined && (
          <>
            <dt>{tr("Durability", "내구도")}</dt>
            <dd>{Math.round(building.durability)}%</dd>
          </>
        )}
        <dt>{tr("Size", "크기")}</dt>
        <dd>
          {building.width}x{building.height} ({building.x}, {building.y})
        </dd>
      </dl>
    </div>
  );
}

function AnimalInfo({ animal }: { animal?: Animal }) {
  if (!animal) {
    return <p className="muted">{tr("This animal has moved on.", "이 동물은 떠났습니다.")}</p>;
  }
  return (
    <div className="inspector-body">
      <strong>{animalName(animal.kind)}</strong>
      <dl>
        <dt>{tr("Status", "상태")}</dt>
        <dd>{animal.state === "tamed" ? tr("tamed livestock", "길들인 가축") : tr("wild", "야생")}</dd>
        <dt>{tr("Health", "체력")}</dt>
        <dd>{animal.health}</dd>
        <dt>{tr("Position", "위치")}</dt>
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
      <strong>{tileName(type)}</strong>
      <dl>
        <dt>{tr("Position", "위치")}</dt>
        <dd>
          ({x}, {y})
        </dd>
        {traffic !== undefined && traffic > 0 && (
          <>
            <dt>{tr("Foot traffic", "통행량")}</dt>
            <dd>{tr(`${traffic} crossings`, `${traffic}회 통행`)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
