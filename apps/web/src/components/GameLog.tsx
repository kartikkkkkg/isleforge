/* GameLog — scrollable feed of actual engine events.
   ChatPanel — placeholder until multiplayer (Milestone 5). */

import { memo, useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../game/log';

const KIND_ICON: Record<LogEntry['kind'], string> = {
  info: '•',
  dice: '⚄',
  build: '⌂',
  trade: '⇄',
  card: '▣',
  raider: '◉',
  victory: '★',
  turn: '➤',
};

export const GameLog = memo(function GameLog({
  entries,
  colorOf,
}: {
  entries: LogEntry[];
  colorOf: (playerId?: string) => string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    const el = boxRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div
      ref={boxRef}
      className="if-log if-scroll"
      role="log"
      aria-label="Game log"
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {entries.map((en) => (
        <div key={en.seq} className={`if-log__entry if-log__entry--${en.kind}`}>
          <span
            className="if-log__icon"
            style={en.playerId ? { color: colorOf(en.playerId) } : undefined}
            aria-hidden="true"
          >
            {KIND_ICON[en.kind]}
          </span>
          <span className="if-log__text">{en.text}</span>
        </div>
      ))}
    </div>
  );
});

export function ChatPanel() {
  const [draft, setDraft] = useState('');
  return (
    <div className="if-chat">
      <div className="if-chat__msgs if-scroll" aria-label="Chat messages">
        <div className="if-chat__sys">
          Chat unlocks with multiplayer in Milestone 5. For now, enjoy the
          peaceful island air.
        </div>
      </div>
      <form
        className="if-chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          setDraft('');
        }}
      >
        <input
          className="if-chat__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Chat coming in Milestone 5…"
          disabled
          aria-label="Chat input (disabled until multiplayer)"
        />
        <button className="if-btn if-btn--sm if-btn--ghost" type="submit" disabled>
          Send
        </button>
      </form>
    </div>
  );
}

export function LogChatTabs({
  entries,
  colorOf,
}: {
  entries: LogEntry[];
  colorOf: (playerId?: string) => string;
}) {
  const [tab, setTab] = useState<'log' | 'chat'>('log');
  return (
    <div className="if-panel if-sidecol__tabs">
      <div className="if-tabs" role="tablist" aria-label="Log and chat">
        <button
          role="tab"
          aria-selected={tab === 'log'}
          className={`if-tabs__tab${tab === 'log' ? ' if-tabs__tab--active' : ''}`}
          onClick={() => setTab('log')}
        >
          Game Log
        </button>
        <button
          role="tab"
          aria-selected={tab === 'chat'}
          className={`if-tabs__tab${tab === 'chat' ? ' if-tabs__tab--active' : ''}`}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
      </div>
      <div className="if-sidecol__tabbody">
        {tab === 'log' ? <GameLog entries={entries} colorOf={colorOf} /> : <ChatPanel />}
      </div>
    </div>
  );
}
