import { tr } from "../i18n";

type AgentCreatorProps = {
  onCreate: () => void;
};

export function AgentCreator({ onCreate }: AgentCreatorProps) {
  return (
    <section className="panel-section">
      <h2>{tr("Agent Creator", "주민 생성")}</h2>
      <button type="button" onClick={onCreate}>
        {tr("Create random agent", "무작위 주민 생성")}
      </button>
    </section>
  );
}
