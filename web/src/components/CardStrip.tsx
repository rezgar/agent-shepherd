import type { AgentModel } from '../types';
import { AgentCard } from './AgentCard';

function groupByProduct(agents: AgentModel[]): [string, AgentModel[]][] {
  const map = new Map<string, AgentModel[]>();
  for (const a of agents) {
    const arr = map.get(a.product) ?? [];
    arr.push(a);
    map.set(a.product, arr);
  }
  return [...map.entries()];
}

/** The persistent product-grouped strip shown across the top of focus mode. */
export function CardStrip({
  agents,
  focusedId,
  now,
  colorOf,
  onSelect,
  nameOf,
  onHide,
}: {
  agents: AgentModel[];
  focusedId: string;
  now: number;
  colorOf: (product: string) => string;
  onSelect: (a: AgentModel) => void;
  nameOf: (a: AgentModel) => string;
  onHide: (sessionId: string) => void;
}) {
  return (
    <div className="strip">
      {groupByProduct(agents).map(([product, ags]) => {
        const sorted = [...ags].sort((a, b) => a.createdAt - b.createdAt);
        return (
          <div className="strip__group" key={product}>
            <div className="strip__tab" style={{ background: colorOf(product), color: '#04121f' }}>
              {product}
            </div>
            <div className="strip__cards">
              {sorted.map((a) => (
                <AgentCard
                  key={a.sessionId}
                  agent={a}
                  now={now}
                  compact
                  selected={a.sessionId === focusedId}
                  onClick={() => onSelect(a)}
                  displayName={nameOf(a)}
                  onHide={() => onHide(a.sessionId)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
