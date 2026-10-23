import { CLASS_INFO, evalToCp, winPct, type GameAnalysis } from '../lib/analysis';

export default function EvalGraph({ analysis, ply, onSelect }: { analysis: GameAnalysis; ply: number; onSelect: (ply: number) => void }) {
  const W = 600;
  const H = 110;
  const n = analysis.evals.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (i: number) => H - (winPct(evalToCp(analysis.evals[i])) / 100) * H;
  let d = `M0 ${H}`;
  for (let i = 0; i < n; i++) d += ` L${x(i).toFixed(1)} ${y(i).toFixed(1)}`;
  d += ` L${W} ${H} Z`;
  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSelect(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
      }}
    >
      <rect width={W} height={H} fill="#262b33" />
      <path d={d} fill="#e9edf2" className="eval-area" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#8892a0" strokeDasharray="4 4" strokeWidth={1} />
      {analysis.moves.map((m, i) =>
        ['grave', 'error', 'brillante', 'gran'].includes(m.cls) ? (
          <circle key={i} cx={x(i + 1)} cy={y(i + 1)} r={4.5} fill={CLASS_INFO[m.cls].color} stroke="#111" strokeWidth={1} />
        ) : null,
      )}
      <line x1={x(ply)} x2={x(ply)} y1={0} y2={H} stroke="#ffd64f" strokeWidth={2} />
    </svg>
  );
}
