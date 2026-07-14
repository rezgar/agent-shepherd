import { useEffect, useMemo, useState } from 'react';
import { useShepherd, useTick } from './api';
import { ProjectLane } from './components/ProjectLane';
import { FocusView } from './components/FocusView';
import type { AgentModel } from './types';

const PALETTE = ['#58a6ff', '#bc8cff', '#39c5cf', '#e3b341', '#f0883e', '#56d364', '#ff7b72', '#79c0ff'];
const WINDOWS = [1, 4, 12, 24];

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function groupByProduct(agents: AgentModel[]): [string, AgentModel[]][] {
  const map = new Map<string, AgentModel[]>();
  for (const a of agents) {
    const arr = map.get(a.product) ?? [];
    arr.push(a);
    map.set(a.product, arr);
  }
  // Stable order by each product's earliest session creation — never reorder on activity.
  return [...map.entries()].sort(
    (a, b) => Math.min(...a[1].map((x) => x.createdAt)) - Math.min(...b[1].map((x) => x.createdAt)),
  );
}

export function App() {
  const { snap, connected, focusedId, messages, hasMore, focus, unfocus, loadMore, send, sendingIds } =
    useShepherd();
  const now = useTick(1000);
  const [windowH, setWindowH] = useState(4);
  const [fontSize, setFontSize] = useState<number>(() => load('shepherd:font', 14));
  const [renames, setRenames] = useState<Record<string, string>>(() => load('shepherd:names', {}));
  const [hidden, setHidden] = useState<Record<string, true>>(() => load('shepherd:hidden', {}));
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    localStorage.setItem('shepherd:font', JSON.stringify(fontSize));
  }, [fontSize]);
  useEffect(() => {
    localStorage.setItem('shepherd:names', JSON.stringify(renames));
  }, [renames]);
  useEffect(() => {
    localStorage.setItem('shepherd:hidden', JSON.stringify(hidden));
  }, [hidden]);

  const colorMap = useMemo(() => {
    const names = snap ? [...new Set(snap.agents.map((a) => a.product))].sort() : [];
    const m = new Map<string, string>();
    names.forEach((n, i) => m.set(n, PALETTE[i % PALETTE.length]));
    return m;
  }, [snap]);
  const colorOf = (product: string) => colorMap.get(product) ?? '#58a6ff';
  const nameOf = (a: AgentModel) => renames[a.sessionId] || a.name;
  const rename = (sessionId: string, name: string) =>
    setRenames((r) => {
      const next = { ...r };
      if (name) next[sessionId] = name;
      else delete next[sessionId];
      return next;
    });
  const changeFont = (delta: number) => setFontSize((f) => Math.max(12, Math.min(22, f + delta)));
  const hide = (sessionId: string) =>
    setHidden((h) => ({ ...h, [sessionId]: true }));
  const restore = (sessionId: string) =>
    setHidden((h) => {
      const next = { ...h };
      delete next[sessionId];
      return next;
    });

  const latest = snap ? snap.agents.reduce((mx, a) => Math.max(mx, a.lastActivity), 0) : 0;
  const cutoff = latest - windowH * 3_600_000;
  const allVisible = snap ? snap.agents.filter((a) => a.lastActivity >= cutoff) : [];
  const shownVisible = allVisible.filter((a) => !hidden[a.sessionId]);
  const hiddenVisible = allVisible.filter((a) => hidden[a.sessionId]);
  const groups = groupByProduct(shownVisible);
  // Same order the cards render in — Alt+N jumps to the Nth card, reading order.
  const flatOrder = groups.flatMap(([, ags]) => [...ags].sort((a, b) => a.createdAt - b.createdAt));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const n = Number(e.key);
      if (n < 1 || n > 9) return;
      const target = flatOrder[n - 1];
      if (!target) return;
      e.preventDefault();
      focus(target.file, target.sessionId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flatOrder, focus]);

  if (!snap) {
    return (
      <div className="shell">
        <div className="empty">{connected ? 'No sessions found.' : 'Connecting to shepherd daemon…'}</div>
      </div>
    );
  }

  const focused = focusedId ? (snap.agents.find((a) => a.sessionId === focusedId) ?? null) : null;

  if (focused) {
    return (
      <FocusView
        agents={shownVisible}
        focused={focused}
        messages={messages}
        hasMore={hasMore}
        onLoadMore={loadMore}
        now={now}
        colorOf={colorOf}
        nameOf={nameOf}
        onSelect={(a) => focus(a.file, a.sessionId)}
        onExit={unfocus}
        onRename={rename}
        fontSize={fontSize}
        onFontSize={changeFont}
        onSend={send}
        sending={sendingIds.has(focused.sessionId)}
        onHide={hide}
      />
    );
  }

  const needsYou = shownVisible.filter((a) => a.state === 'needs-you').length;
  const working = shownVisible.filter((a) => a.state === 'working').length;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">🐑 Agent Shepherd</span>
        <span className="counts">
          {shownVisible.length} agents · <b className="c-work">{working} working</b>
          {needsYou > 0 && (
            <>
              {' · '}
              <b className="c-need">{needsYou} need you</b>
            </>
          )}
        </span>
        <label className="winsel">
          active last
          <select value={windowH} onChange={(e) => setWindowH(Number(e.target.value))}>
            {WINDOWS.map((h) => (
              <option key={h} value={h}>
                {h}h
              </option>
            ))}
          </select>
        </label>
        {hiddenVisible.length > 0 && (
          <button className="hidden-toggle" onClick={() => setShowHidden((s) => !s)}>
            {hiddenVisible.length} hidden {showHidden ? '▴' : '▾'}
          </button>
        )}
        <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'live' : 'reconnecting…'}</span>
      </header>

      <main className="canvas">
        {groups.map(([product, agents]) => (
          <ProjectLane
            key={product}
            product={product}
            agents={agents}
            now={now}
            color={colorOf(product)}
            onSelect={(a) => focus(a.file, a.sessionId)}
            nameOf={nameOf}
            onHide={hide}
          />
        ))}

        {showHidden && hiddenVisible.length > 0 && (
          <div className="hidden-tray">
            <div className="hidden-tray__title">Hidden — click to restore</div>
            <div className="hidden-tray__list">
              {hiddenVisible.map((a) => (
                <button key={a.sessionId} className="hidden-chip" onClick={() => restore(a.sessionId)}>
                  <span className="hidden-chip__dot" style={{ background: colorOf(a.product) }} />
                  <span className="hidden-chip__name" title={nameOf(a)}>
                    {nameOf(a)}
                  </span>
                  <span className="hidden-chip__restore">↺ restore</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
