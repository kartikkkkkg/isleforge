/* GameLog — scrollable feed of actual engine events.
   ChatPanel — room chat for online games (local games show a stub). */

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

export interface ChatApi {
  messages: { from: string; fromName: string; text: string; ts: number }[];
  sendChat: (text: string) => void;
}

export function ChatPanel({ chat }: { chat?: ChatApi }) {
  const [draft, setDraft] = useState('');
  const msgsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.messages.length]);
  if (!chat) {
    return (
      <div className="if-chat">
        <div className="if-chat__msgs if-scroll" aria-label="Chat messages">
          <div className="if-chat__sys">
            Chat unlocks in online games. For now, enjoy the peaceful island air.
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
            placeholder="Chat available online…"
            disabled
            aria-label="Chat input (disabled in local games)"
          />
          <button className="if-btn if-btn--sm if-btn--ghost" type="submit" disabled>
            Send
          </button>
        </form>
      </div>
    );
  }
  return (
    <div className="if-chat">
      <div className="if-chat__msgs if-scroll" aria-label="Chat messages" ref={msgsRef}>
        {chat.messages.length === 0 && (
          <div className="if-chat__sys">Say hello to the table.</div>
        )}
        {chat.messages.map((m, i) => (
          <div className="if-chat__msg" key={`${m.ts}-${i}`}>
            <b>{m.fromName}</b> <span>{m.text}</span>
          </div>
        ))}
      </div>
      <form
        className="if-chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (text) chat.sendChat(text);
          setDraft('');
        }}
      >
        <input
          className="if-chat__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the table…"
          maxLength={200}
          aria-label="Chat input"
        />
        <button className="if-btn if-btn--sm if-btn--ghost" type="submit">
          Send
        </button>
      </form>
    </div>
  );
}

export function LogChatTabs({
  entries,
  colorOf,
  chat,
}: {
  entries: LogEntry[];
  colorOf: (playerId?: string) => string;
  chat?: ChatApi;
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
        {tab === 'log' ? <GameLog entries={entries} colorOf={colorOf} /> : <ChatPanel chat={chat} />}
      </div>
    </div>
  );
}
