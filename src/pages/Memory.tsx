import { useEffect, useRef, useState } from 'react';
import Board from '../components/Board';
import Confetti from '../components/Confetti';
import { sound } from '../lib/sound';
import { load, save } from '../lib/storage';

type Pos = Record<string, string>; // { e4: 'wN' }

const PIECES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
const GLYPH: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const FILES = 'abcdefgh';

// Posición aleatoria verosímil: reyes siempre presentes, peones fuera de la 1ª y 8ª fila.
function randomPosition(n: number): Pos {
  const pos: Pos = {};
  const free = () => {
    let s;
    do s = FILES[Math.floor(Math.random() * 8)] + (1 + Math.floor(Math.random() * 8));
    while (pos[s]);
    return s;
  };
  pos[free()] = 'wK';
  pos[free()] = 'bK';
  const pool = ['Q', 'R', 'R', 'B', 'B', 'N', 'N', 'P', 'P', 'P', 'P'];
  while (Object.keys(pos).length < n) {
    const t = pool[Math.floor(Math.random() * pool.length)];
    const c = Math.random() < 0.5 ? 'w' : 'b';
    let s = free();
    if (t === 'P') while (s[1] === '1' || s[1] === '8') s = free();
    pos[s] = c + t;
  }
  return pos;
}

type Phase = 'idle' | 'memorize' | 'recall' | 'result';

export default function Memory() {
  const [level, setLevel] = useState(1);
  const [lives, setLives] = useState(3);
  const [phase, setPhase] = useState<Phase>('idle');
  const [target, setTarget] = useState<Pos>({});
  const [guess, setGuess] = useState<Pos>({});
  const [brush, setBrush] = useState('wP');
  const [timeLeft, setTimeLeft] = useState(0);
  const [lastOk, setLastOk] = useState<boolean | null>(null);
  const [best, setBest] = useState(() => load('memoryBest', 0));
  const memTime = useRef(0);

  const count = level + 2;

  function startRound(lv: number) {
    const pos = randomPosition(lv + 2);
    setTarget(pos);
    setGuess({});
    setLastOk(null);
    memTime.current = 3 + (lv + 2) * 0.8;
    setTimeLeft(memTime.current);
    setPhase('memorize');
  }

  useEffect(() => {
    if (phase !== 'memorize') return;
    const t0 = performance.now();
    const id = setInterval(() => {
      const left = memTime.current - (performance.now() - t0) / 1000;
      setTimeLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        setPhase('recall');
      }
    }, 50);
    return () => clearInterval(id);
  }, [phase]);

  function newGame() {
    setLevel(1);
    setLives(3);
    startRound(1);
  }

  function clickSquare(sq: string) {
    if (phase !== 'recall') return;
    const g = { ...guess };
    if (g[sq] === brush) delete g[sq];
    else g[sq] = brush;
    setGuess(g);
    sound.move();
  }

  function check() {
    const keys = new Set([...Object.keys(target), ...Object.keys(guess)]);
    const ok = [...keys].every((k) => target[k] === guess[k]);
    setLastOk(ok);
    setPhase('result');
    if (ok) {
      sound.good();
      if (level > best) {
        setBest(level);
        save('memoryBest', level);
      }
    } else {
      sound.bad();
      setLives((l) => l - 1);
    }
  }

  function next() {
    if (lastOk) {
      setLevel(level + 1);
      startRound(level + 1);
    } else if (lives > 0) startRound(level);
    else setPhase('idle');
  }

  // En el resultado: verdes las acertadas, rojas las erróneas, y las que faltaban semitransparentes.
  const resultStyles: Record<string, React.CSSProperties> = {};
  if (phase === 'result') {
    for (const k of new Set([...Object.keys(target), ...Object.keys(guess)])) {
      if (target[k] && target[k] === guess[k]) resultStyles[k] = { background: 'rgba(129,182,76,.75)' };
      else if (guess[k]) resultStyles[k] = { background: 'rgba(250,65,45,.7)' };
      else resultStyles[k] = { background: 'rgba(255,214,79,.6)' };
    }
  }

  const shown = phase === 'memorize' || phase === 'result' ? target : phase === 'recall' ? guess : {};

  return (
    <div className="page play-page">
      <div className={`board-col ${phase === 'result' ? (lastOk ? 'flash-good' : 'flash-bad') : ''}`}>
        <Board position={shown} onSquareClick={clickSquare} squareStyles={resultStyles} animation={phase === 'recall' ? 0 : 300} />
        {phase === 'memorize' && (
          <div className="timer-bar over-board">
            <div style={{ width: `${(timeLeft / memTime.current) * 100}%` }} />
          </div>
        )}
      </div>
      <aside className="side-panel">
        <div className="card">
          <h2 className="panel-title">Memoria</h2>
          {phase === 'idle' ? (
            <>
              <p className="muted">
                Memoriza la posición antes de que desaparezca y reconstrúyela. Cada nivel añade una pieza. Tienes 3 vidas.
              </p>
              <p className="muted small">Mejor nivel: {best}</p>
              <button className="btn primary big" onClick={newGame}>
                Empezar
              </button>
            </>
          ) : (
            <>
              <div className="big-stats">
                <div>
                  <span className="big-num" key={level}>
                    {level}
                  </span>
                  <span className="muted small">nivel · {count} piezas</span>
                </div>
                <div>
                  <span className="big-num lives">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className={i < lives ? 'life on' : 'life'} />
                    ))}
                  </span>
                  <span className="muted small">vidas</span>
                </div>
              </div>
              {phase === 'memorize' && <p className="pulse-text">¡Memoriza! {timeLeft.toFixed(1)} s</p>}
              {phase === 'recall' && (
                <>
                  <p className="muted small">Elige una pieza y pulsa casillas para colocarla (pulsa otra vez para quitarla).</p>
                  <div className="palette">
                    {PIECES.map((p) => (
                      <button key={p} className={`palette-piece ${p[0]} ${brush === p ? 'on' : ''}`} onClick={() => setBrush(p)}>
                        {GLYPH[p[1]]}
                      </button>
                    ))}
                  </div>
                  <div className="btn-row">
                    <button className="btn primary" onClick={check}>
                      Comprobar ({Object.keys(guess).length}/{count})
                    </button>
                    <button className="btn ghost" onClick={() => setGuess({})}>
                      Borrar
                    </button>
                  </div>
                </>
              )}
              {phase === 'result' && (
                <div className="pop-in">
                  {lastOk && <Confetti count={40} />}
                  <h3>{lastOk ? '¡Perfecto!' : lives > 0 ? 'Casi… mira las diferencias' : 'Fin de la partida'}</h3>
                  <p className="muted small">Verde: bien · Rojo: pieza incorrecta · Amarillo: te faltó</p>
                  <button className="btn primary" onClick={next}>
                    {lastOk ? 'Siguiente nivel →' : lives > 0 ? 'Reintentar' : 'Volver'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
