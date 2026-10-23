import { useEffect, useState } from 'react';

// Cuenta animada de `from` a `to`.
export default function AnimatedNumber({ from, to, duration = 1200, decimals = 0 }: { from: number; to: number; duration?: number; decimals?: number }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - (1 - k) ** 3;
      setV(from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [from, to, duration]);
  return <>{v.toFixed(decimals)}</>;
}
