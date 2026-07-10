import type { SetupScore } from '../types';

export default function SetupScoreBar({ setup }: { setup: SetupScore }) {
  return (
    <div className="setup-score">
      <div className="score-left">
        <span className="score-num">{setup.score}</span>
        <span className="score-grade">{setup.grade}</span>
      </div>
      <div
        className="score-ladder"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={setup.score}
        aria-label={`Setup score ${setup.score} of 100`}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={`ladder-block ${i < setup.blocks ? 'is-filled' : ''}`} />
        ))}
      </div>
      <div className="score-verdict">
        <span className="verdict-text">{setup.verdict}</span>
        <span className="verdict-note">Heuristic screen — not advice</span>
      </div>
    </div>
  );
}
