import { useMemo } from 'react';

const COLORS = ['#ffd64f', '#81b64c', '#5c8bb0', '#fa412d', '#26c2a3', '#f0f0f0'];

export default function Confetti({ count = 90 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        dur: 1.8 + Math.random() * 1.6,
        rot: Math.random() * 720 - 360,
        drift: Math.random() * 160 - 80,
        color: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 8,
      })),
    [count],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={
            {
              left: `${p.left}%`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
              background: p.color,
              width: p.size,
              height: p.size * 0.45,
              '--rot': `${p.rot}deg`,
              '--drift': `${p.drift}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
