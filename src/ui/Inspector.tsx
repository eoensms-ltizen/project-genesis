import type {
  Agent,
  Animal,
  Building,
  FoodKind,
  GameLogEntry,
  InspectionTarget,
  ItemStack,
  ResourceKind,
  TileType,
} from "../game/types";
import { tr } from "../i18n";

type InspectorProps = {
  selection: InspectionTarget;
  agents: Agent[];
  buildings: Building[];
  animals: Animal[];
  items: ItemStack[];
  episodes: GameLogEntry[];
  tileType?: TileType;
  tileTraffic?: number;
  homeAmbiance?: number;
  foodSummary?: { kind: FoodKind; fresh: number; spoiled: number }[];
  following?: boolean;
  onToggleFollow?: () => void;
  onClose: () => void;
};

export function Inspector({
  selection,
  agents,
  buildings,
  animals,
  items,
  episodes,
  tileType,
  tileTraffic,
  homeAmbiance,
  foodSummary,
  following,
  onToggleFollow,
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
          following={following}
          onToggleFollow={onToggleFollow}
        />
      )}
      {selection.kind === "building" && (
        <BuildingInfo
          building={buildings.find((building) => building.id === selection.buildingId)}
          agents={agents}
          foodSummary={foodSummary}
        />
      )}
      {selection.kind === "animal" && (
        <AnimalInfo animal={animals.find((animal) => animal.id === selection.animalId)} />
      )}
      {selection.kind === "item" && (
        <ItemInfo item={items.find((stack) => stack.id === selection.itemId)} />
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
  bedroom: () => tr("bedroom", "침실"),
  warehouse: () => tr("warehouse", "창고"),
  granary: () => tr("granary", "식량창고"),
  kitchen: () => tr("kitchen", "부엌"),
  church: () => tr("church", "교회"),
  pasture: () => tr("pasture", "목초지"),
  powerplant: () => tr("power plant", "발전소"),
  factory: () => tr("factory", "공장"),
  station: () => tr("station", "역"),
  cemetery: () => tr("cemetery", "묘지"),
  park: () => tr("park", "공원"),
  police: () => tr("police station", "경찰서"),
  smelter: () => tr("smelter", "제련소"),
  funfair: () => tr("amusement park", "놀이공원"),
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

function resourceName(resource: ResourceKind): string {
  if (resource === "wood") return tr("Wood", "나무");
  if (resource === "stone") return tr("Stone", "돌");
  if (resource === "ironOre") return tr("Iron ore", "철광석");
  return tr("Steel", "강철");
}

const FOOD_NAMES: Record<FoodKind, () => string> = {
  berry: () => tr("berries", "베리"),
  wheat: () => tr("wheat", "밀"),
  rice: () => tr("rice", "쌀"),
  beef: () => tr("beef", "쇠고기"),
  rabbit: () => tr("rabbit", "토끼고기"),
  fish: () => tr("fish", "생선"),
};

function foodName(kind: FoodKind): string {
  return FOOD_NAMES[kind]();
}

/** What a resident is physically carrying — a hauled load and/or build wood. */
function carriedSummary(agent: Agent): string {
  const counts = new Map<ResourceKind, number>();
  if (agent.carry && agent.carry.amount > 0) {
    counts.set(agent.carry.resource, agent.carry.amount);
  }
  if (agent.inventory.wood > 0) {
    counts.set("wood", (counts.get("wood") ?? 0) + agent.inventory.wood);
  }
  const parts = [...counts.entries()].map(
    ([resource, amount]) => `${resourceName(resource)} ×${amount}`,
  );
  // Raw ingredients a cook is carrying to the stove.
  if (agent.carryFood && agent.carryFood.amount > 0) {
    parts.push(
      `${tr("ingredients", "요리 재료")} ×${agent.carryFood.amount}${
        agent.carryFood.spoiled ? " 🤢" : ""
      }`,
    );
  }
  // Finished meals being carried to the table to serve.
  if (agent.carryMeal && agent.carryMeal.count > 0) {
    parts.push(
      `${tr("meals", "요리")} ×${agent.carryMeal.count}${agent.carryMeal.tainted ? " 🤢" : ""}`,
    );
  }
  return parts.join(", ");
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
  Stove: () => tr("Stove", "화덕"),
  Counter: () => tr("Counter", "조리대"),
  Bed: () => tr("Bed", "침대"),
  BedFoot: () => tr("Bed", "침대"),
  BedSite: () => tr("Planned bed", "침대 터 (제작 예정)"),
  Table: () => tr("Dining table", "식탁"),
  Chair: () => tr("Chair", "의자"),
  Fence: () => tr("Fence", "울타리"),
  FenceGate: () => tr("Gate", "울타리 문"),
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

/** A plain-language read on what the resident is doing right now. */
function activityLabel(agent: Agent): string {
  const carried = agent.carry?.amount ? resourceName(agent.carry.resource) : tr("materials", "자재");
  switch (agent.state) {
    case "Idle":
      return tr("taking a breather", "잠시 쉬는 중");
    case "Wander":
      return tr("wandering about", "어슬렁거리는 중");
    case "Rest":
      return tr("resting", "휴식 중");
    case "FindTree":
      return tr("looking for a tree to fell", "벨 나무를 찾는 중");
    case "MoveToTree":
      return tr("heading out to chop wood", "나무하러 가는 중");
    case "ChopTree":
      return tr("chopping wood", "나무를 베는 중");
    case "FindHouseSite":
      return tr("scouting a building site", "지을 자리를 찾는 중");
    case "MoveToHouseSite":
      return tr("heading to the building site", "공사장으로 가는 중");
    case "PlanHouse":
      return tr("staking out a building", "건물 터를 잡는 중");
    case "BuildHouse":
    case "BuildTile":
      return tr("building", "집을 짓는 중");
    case "MoveToBuildTile":
      return tr("heading over to build", "지을 곳으로 가는 중");
    case "FindFood":
    case "MoveToFood":
      return tr("looking for food", "먹을 것을 찾는 중");
    case "Eat":
      return tr("eating", "식사 중");
    case "MoveHome":
      return tr("heading home", "집으로 가는 중");
    case "Sleep": {
      const onBed =
        agent.bedPos &&
        Math.round(agent.position.x) === agent.bedPos.x &&
        Math.round(agent.position.y) === agent.bedPos.y;
      return onBed ? tr("sleeping in bed", "침대에서 자는 중") : tr("sleeping", "자는 중");
    }
    case "Chat":
      return tr("chatting with a neighbour", "이웃과 대화 중");
    case "MoveToFarm":
      return tr("heading to the field", "밭으로 가는 중");
    case "FarmWork":
      return tr("working the field", "밭일 하는 중");
    case "MoveToPave":
    case "Pave":
      return tr("paving a path", "길을 까는 중");
    case "MoveToPantry":
      return tr("fetching ingredients", "재료를 가지러 가는 중");
    case "CollectIngredients":
      return tr("gathering ingredients", "재료를 챙기는 중");
    case "MoveToKitchen":
      return tr("carrying ingredients to the stove", "재료를 화덕으로 옮기는 중");
    case "Cook":
      return tr("cooking a meal", "요리하는 중");
    case "MoveToServe":
      return tr("serving the meal to the table", "음식을 식탁으로 나르는 중");
    case "Serve":
      return tr("setting the table", "식탁에 음식을 차리는 중");
    case "MoveToWorship":
    case "Worship":
      return tr("at prayer", "기도하는 중");
    case "MoveToStump":
    case "Transplant":
      return tr("transplanting a sapling", "묘목을 옮겨 심는 중");
    case "MoveToPlant":
    case "Plant":
      return tr("sowing seeds", "씨를 심는 중");
    case "MoveToHunt":
    case "Hunt":
      return tr("hunting", "사냥하는 중");
    case "MoveToTame":
    case "Tame":
      return tr("taming livestock", "가축을 길들이는 중");
    case "MoveToPark":
    case "Relax":
      return tr("taking some leisure", "여가를 즐기는 중");
    case "MoveToClean":
    case "Clean":
      return tr("tidying up", "청소하는 중");
    case "Patrol":
      return tr("on patrol", "순찰하는 중");
    case "MoveToHaul":
      return tr("off to fetch a dropped load", "떨어진 자재를 가지러 가는 중");
    case "LoadWood":
      return tr("picking up a load", "자재를 줍는 중");
    case "MoveToStore":
      return tr(`hauling ${carried} to the warehouse`, `창고로 ${carried} 나르는 중`);
    case "StoreWood":
      return tr("stocking the warehouse", "창고에 자재를 넣는 중");
    case "MoveToWithdraw":
      return tr("fetching materials from the warehouse", "창고로 자재를 가지러 가는 중");
    case "WithdrawWood":
      return tr("drawing materials from the warehouse", "창고에서 자재를 꺼내는 중");
    case "MoveToMine":
      return tr("heading to the rock face", "채굴하러 가는 중");
    case "Mine":
      return tr("mining stone", "광석을 캐는 중");
    case "MoveToCraft":
      return tr("heading to the workshop", "작업장으로 가는 중");
    case "CraftTool":
      return tr("crafting a tool", "도구를 만드는 중");
    case "MoveToFurnish":
      return tr("heading home to set up furniture", "가구를 놓으러 가는 중");
    case "Furnish":
      return tr("building furniture", "가구를 만드는 중");
    default:
      return tr("busy", "활동 중");
  }
}

function moodLabel(mood: number): string {
  if (mood >= 75) return tr("happy 😊", "행복 😊");
  if (mood >= 55) return tr("content 🙂", "좋음 🙂");
  if (mood >= 40) return tr("okay 😐", "보통 😐");
  if (mood >= 25) return tr("low 😟", "우울 😟");
  return tr("miserable 😣", "비참 😣");
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
  following,
  onToggleFollow,
}: {
  agent?: Agent;
  agents: Agent[];
  episodes: GameLogEntry[];
  homeAmbiance?: number;
  following?: boolean;
  onToggleFollow?: () => void;
}) {
  if (!agent) {
    return <p className="muted">{tr("This resident is no longer with us.", "이 주민은 더 이상 없습니다.")}</p>;
  }

  const spouse = agent.spouseId
    ? agents.find((other) => other.id === agent.spouseId)
    : undefined;

  return (
    <div className="inspector-body">
      <div className="inspector-name-row">
        <strong>{agent.name}</strong>
        {onToggleFollow && (
          <button
            type="button"
            className="follow-button"
            data-active={following ? "true" : undefined}
            onClick={onToggleFollow}
          >
            {following ? tr("📷 Following", "📷 따라가는 중") : tr("📷 Follow", "📷 따라가기")}
          </button>
        )}
      </div>
      <dl>
        <dt>{tr("Doing", "하는 일")}</dt>
        <dd>{activityLabel(agent)}</dd>
        {agent.sickSeconds !== undefined && agent.sickSeconds > 0 && (
          <>
            <dt>{tr("Health", "건강")}</dt>
            <dd>{tr("food poisoning 🤢", "식중독 🤢")}</dd>
          </>
        )}
        <dt>{tr("Stage", "생애")}</dt>
        <dd>
          {lifeStage(agent.age)} · {agent.age}
          {tr("y", "세")} / {agent.lifespan}
          {tr("y", "세")}
        </dd>
        <dt>{tr("Job", "직업")}</dt>
        <dd>{jobName(agent.job)}</dd>
        <dt>{tr("Mood", "기분")}</dt>
        <dd>{moodLabel(agent.mood ?? 60)}</dd>
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
        {carriedSummary(agent) && (
          <>
            <dt>{tr("Carrying", "소지품")}</dt>
            <dd>{carriedSummary(agent)}</dd>
          </>
        )}
        {agent.home && homeAmbiance !== undefined && (
          <>
            <dt>{tr("Surroundings", "주변 환경")}</dt>
            <dd>{surroundings(homeAmbiance)}</dd>
          </>
        )}
      </dl>
      <h3>{tr("Needs", "욕구")}</h3>
      <div className="need-bars">
        <NeedBar label={tr("Mood", "기분")} value={agent.mood ?? 60} />
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

function BuildingInfo({
  building,
  agents,
  foodSummary,
}: {
  building?: Building;
  agents: Agent[];
  foodSummary?: { kind: FoodKind; fresh: number; spoiled: number }[];
}) {
  if (!building) {
    return <p className="muted">{tr("This building no longer exists.", "이 건물은 더 이상 없습니다.")}</p>;
  }

  const larder = (foodSummary ?? []).filter((f) => f.fresh > 0 || f.spoiled > 0);

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
        {(building.kind === "granary" || building.kind === "warehouse") && larder.length > 0 && (
          <>
            <dt>{tr("Larder", "식량")}</dt>
            <dd>
              {larder.map((f) => (
                <div key={f.kind}>
                  {foodName(f.kind)} {f.fresh}
                  {f.spoiled > 0 && (
                    <span className="spoiled-tag"> · {tr(`spoiled ${f.spoiled} 🤢`, `상함 ${f.spoiled} 🤢`)}</span>
                  )}
                </div>
              ))}
            </dd>
          </>
        )}
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

function ItemInfo({ item }: { item?: ItemStack }) {
  if (!item) {
    return <p className="muted">{tr("This pile is gone.", "이 더미는 사라졌습니다.")}</p>;
  }
  return (
    <div className="inspector-body">
      <strong>{resourceName(item.resource)}</strong>
      <dl>
        <dt>{tr("Type", "종류")}</dt>
        <dd>{tr("Material pile", "자재 더미")}</dd>
        <dt>{tr("Amount", "수량")}</dt>
        <dd>{item.amount}</dd>
        <dt>{tr("Position", "위치")}</dt>
        <dd>
          ({item.position.x}, {item.position.y})
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
