import type { Factor } from '../types';

const STATUS_TEXT: Record<Factor['status'], string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  na: 'N/A',
};

export default function FactorGrid({ factors }: { factors: Factor[] }) {
  return (
    <div className="factor-grid" role="list" aria-label="Setup factors">
      {factors.map((f) => (
        <div key={f.key} className={`factor-card factor-${f.status}`} role="listitem">
          <div className="factor-head">
            <span className="factor-label">{f.label}</span>
            <span className={`dot dot-${f.status}`} title={STATUS_TEXT[f.status]} aria-label={STATUS_TEXT[f.status]} />
          </div>
          <div className="factor-value">{f.display}</div>
          <div className="factor-threshold">{f.threshold}</div>
        </div>
      ))}
    </div>
  );
}
