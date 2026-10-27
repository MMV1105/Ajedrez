export function formatClock(ms: number) {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return s.toFixed(1);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

type Props = { ms: number | null; active: boolean; name: string; rating?: number; color: 'w' | 'b'; note?: string };

export default function Clock({ ms, active, name, rating, color, note }: Props) {
  const low = ms !== null && ms < 20000;
  return (
    <div className={`player-bar ${active ? 'active' : ''}`}>
      <div className="player-id">
        <span className={`monogram ${color}`}>{name.slice(0, 1).toUpperCase()}</span>
        <span className="player-name">{name}</span>
        {rating !== undefined && <span className="player-rating">{rating}</span>}
        {note && <span className="player-note">{note}</span>}
      </div>
      {ms !== null && <div className={`clock ${active ? 'running' : ''} ${low ? 'low' : ''}`}>{formatClock(ms)}</div>}
    </div>
  );
}
