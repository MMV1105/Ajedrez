import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  sans: string[];
  current: number; // índice de la jugada activa (ply - 1)
  onSelect?: (index: number) => void;
  decorate?: (index: number) => ReactNode;
  startsWithBlack?: boolean;
};

export default function MoveList({ sans, current, onSelect, decorate }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('.mv.active')?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  const rows = [];
  for (let i = 0; i < sans.length; i += 2) {
    rows.push(
      <div className="mv-row" key={i}>
        <span className="mv-num">{i / 2 + 1}.</span>
        {[i, i + 1].map((j) =>
          j < sans.length ? (
            <button key={j} className={`mv ${j === current ? 'active' : ''}`} onClick={() => onSelect?.(j)}>
              {decorate?.(j)}
              {sans[j]}
            </button>
          ) : (
            <span key={j} />
          ),
        )}
      </div>,
    );
  }
  return (
    <div className="move-list" ref={ref}>
      {rows.length ? rows : <p className="muted small">Aún no hay jugadas.</p>}
    </div>
  );
}
