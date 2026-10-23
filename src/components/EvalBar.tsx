import { formatEval, winPct, evalToCp, type PositionEval } from '../lib/analysis';

export default function EvalBar({ ev, orientation }: { ev: Pick<PositionEval, 'cp' | 'mate'> | null; orientation: 'white' | 'black' }) {
  const white = ev ? (ev.mate !== null ? (ev.mate > 0 || (ev.mate === 0 && ev.cp > 0) ? 100 : 0) : winPct(evalToCp(ev))) : 50;
  const flipped = orientation === 'black';
  const whiteAhead = white >= 50;
  return (
    <div className={`eval-bar ${flipped ? 'flipped' : ''}`}>
      <div className="eval-white" style={{ height: `${white}%` }} />
      <span className={`eval-label ${whiteAhead !== flipped ? 'bottom' : 'top'} ${whiteAhead ? 'dark' : 'light'}`}>
        {ev ? formatEval(ev).replace('+', '') : ''}
      </span>
    </div>
  );
}
