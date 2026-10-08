/* MainMenu — title screen. Starts a local game (1 human + 3 bots)
   or an AI battle (autopilot). */

import { useState } from 'react';
import { RulesModal } from '../components/MenuModals';

interface MainMenuProps {
  onStart: (opts: { name: string; seed?: number; autopilot: boolean }) => void;
}

export function MainMenu({ onStart }: MainMenuProps) {
  const [name, setName] = useState('Skipper');
  const [seedText, setSeedText] = useState('');
  const [showRules, setShowRules] = useState(false);

  const seed = seedText.trim() === '' ? undefined : Number(seedText) || undefined;

  return (
    <div className="if-menu">
      <div className="if-menu__hero">
        <svg className="if-menu__mark" viewBox="0 0 64 64" aria-hidden="true">
          <polygon points="32,4 58,19 58,45 32,60 6,45 6,19" fill="none" stroke="#d8a94e" strokeWidth="3" />
          <polygon points="32,16 46,24 46,40 32,48 18,40 18,24" fill="#d8a94e" opacity="0.9" />
          <polygon points="32,24 39,28 39,36 32,40 25,36 25,28" fill="#0d1b22" />
        </svg>
        <h1 className="if-menu__title">ISLEFORGE</h1>
        <p className="if-menu__tag">Forge your archipelago.</p>
        <p className="if-menu__sub">
          Settle wild islands, raise cities, command the longest road — an original
          strategy board game for 3–4 players.
        </p>
      </div>

      <div className="if-panel if-menu__card">
        <label className="if-field">
          <span className="if-field__label">Your captain name</span>
          <input
            className="if-input"
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skipper"
            aria-label="Your captain name"
          />
        </label>
        <label className="if-field">
          <span className="if-field__label">Island seed (optional — same seed, same island)</span>
          <input
            className="if-input"
            value={seedText}
            inputMode="numeric"
            onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Random"
            aria-label="Island seed"
          />
        </label>
        <div className="if-menu__btns">
          <button
            className="if-btn if-btn--primary if-btn--lg"
            onClick={() => onStart({ name: name.trim() || 'Skipper', seed, autopilot: false })}
          >
            Set Sail — Play vs 3 Bots
          </button>
          <button
            className="if-btn if-btn--ghost"
            onClick={() => onStart({ name: 'Spectator', seed, autopilot: true })}
          >
            Watch AI Battle
          </button>
          <button className="if-btn if-btn--ghost" onClick={() => setShowRules}>
            How to Play
          </button>
        </div>
        <p className="if-menu__note">
          Local play · No account needed · Multiplayer arrives in Milestone 5
        </p>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
