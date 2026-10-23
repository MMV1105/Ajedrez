import { useEffect, useRef, useState } from 'react';
import Board from '../components/Board';
import Confetti from '../components/Confetti';
import { sound } from '../lib/sound';
import { load, save } from '../lib/storage';

const FILES = 'abcdefgh';
const DURATION = 30;
const randomSquare = (avoid?: string) => {
  let s;
  do s = FILES[Math.floor(Math.random() * 8)] + (1 + Math.floor(Math.random() * 8));
  while (s === avoid);
  return s;
};

export default function Coordinates() {
  const [side, setSide] = useState<'white' | 'black'>('white');
  const [notation, setNotation] = useState(false);
  const [withPieces, setWithPieces] = useState(false);
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState(randomSquare());
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [feedback, setFeedback] = useState<{ sq: string; ok: boolean; id: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const [best, setBest] = useState(() => load<Record<string, number>>('coordBest', {}));
  const fid = useRef(0);
  const key = `${side}`;

  useEffect(() => {
    if (!running) return;
    const t0 = performance.now();
    const id = setInterval(() => {
      const left = Math.max(0, DURATION - (performance.now() - t0) / 1000);
      setTimeLeft(left);
      if (left <= 0) {
        clearInterval(id);
        setRunning(false);
        setFinished(true);
        sound.win();
      }
    }, 50);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (finished && score > (best[key] ?? 0)) {
      const nb = { ...best, [key]: score };
      setBest(nb);
      save('coordBest', nb);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  function start() {
    setScore(0);
    setMisses(0);
    setTimeLeft(DURATION);
    setTarget(randomSquare());
    setFinished(false);
    setRunning(true);
  }

  function click(sq: string) {
    if (!running) return;
    const ok = sq === target;
    setFeedback({ sq, ok, id: ++fid.current });
    if (ok) {
      setScore((s) => s + 1);
      setTarget(randomSquare(target));
      sound.move();
    } else {
      setMisses((m) => m + 1);
      sound.bad();
    }
  }

  const styles = feedback
    ? { [feedback.sq]: { background: feedback.ok ? 'rgba(129,182,76,.85)' : 'rgba(250,65,45,.8)', transition: 'background .4s' } }
    : undefined;

  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback((f) => (f && f.id === feedback.id ? null : f)), 250);
    return () => clearTimeout(id);
  }, [feedback]);

  const isNewBest = finished && score > 0 && score >= (best[key] ?? 0);

  return (
    <div className="page play-page">
      <div className="board-col coord-board">
        <Board
          position={withPieces ? 'start' : {}}
          orientation={side}
          showNotation={notation}
          onSquareClick={click}
          squareStyles={styles}
          animation={0}
        />
        {running && (
          <div className="coord-target" key={target + score}>
            {target}
          </div>
        )}
      </div>
      <aside className="side-panel">
        <div className="card">
          <h2>🎯 Coordenadas</h2>
          <p className="muted small">Pulsa la casilla que aparece en el centro. Tienes {DURATION} segundos.</p>
          {running || finished ? (
            <>
              <div className="timer-bar">
                <div style={{ width: `${(timeLeft / DURATION) * 100}%` }} />
              </div>
              <div className="big-stats">
                <div>
                  <span className="big-num" key={score}>
                    {score}
                  </span>
                  <span className="muted small">aciertos</span>
                </div>
                <div>
                  <span className="big-num miss">{misses}</span>
                  <span className="muted small">fallos</span>
                </div>
              </div>
            </>
          ) : null}
          {finished && (
            <div className="pop-in center">
              {isNewBest && <Confetti />}
              <h3>{isNewBest ? '¡Nuevo récord!' : '¡Tiempo!'}</h3>
            </div>
          )}
          {!running && (
            <>
              <label className="field-label">Ver tablero desde</label>
              <div className="chip-row">
                <button className={`chip ${side === 'white' ? 'on' : ''}`} onClick={() => setSide('white')}>
                  ♔ Blancas
                </button>
                <button className={`chip ${side === 'black' ? 'on' : ''}`} onClick={() => setSide('black')}>
                  ♚ Negras
                </button>
              </div>
              <div className="chip-row">
                <button className={`chip ${notation ? 'on' : ''}`} onClick={() => setNotation(!notation)}>
                  Mostrar coordenadas
                </button>
                <button className={`chip ${withPieces ? 'on' : ''}`} onClick={() => setWithPieces(!withPieces)}>
                  Con piezas
                </button>
              </div>
              <p className="muted small">Récord ({side === 'white' ? 'blancas' : 'negras'}): {best[key] ?? 0}</p>
              <button className="btn primary big" onClick={start}>
                {finished ? 'Otra vez' : 'Empezar'}
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
