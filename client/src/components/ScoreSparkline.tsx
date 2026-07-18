/**
 * Tiny inline score-trend sparkline (0–100 domain). Shows whether a score is
 * building or fading — the level alone doesn't tell you that.
 */
export default function ScoreSparkline({
  points,
  width = 64,
  height = 18,
}: {
  points: number[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const step = width / (points.length - 1);
  const y = (v: number) => height - (Math.max(0, Math.min(100, v)) / 100) * height;
  const path = points.map((p, i) => `${(i * step).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const rising = points[points.length - 1] >= points[0];
  const last = points[points.length - 1];
  return (
    <svg
      className="score-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Score trend: ${points[0]} to ${last}`}
    >
      <polyline
        points={path}
        fill="none"
        stroke={rising ? 'var(--gain, #2ecc71)' : 'var(--loss, #e74c3c)'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
