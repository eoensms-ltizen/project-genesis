type AgentCreatorProps = {
  onCreate: () => void;
};

export function AgentCreator({ onCreate }: AgentCreatorProps) {
  return (
    <section className="panel-section">
      <h2>Agent Creator</h2>
      <button type="button" onClick={onCreate}>
        Create random agent
      </button>
    </section>
  );
}
