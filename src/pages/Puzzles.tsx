import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board, { type MoveInput } from '../components/Board';
import Confetti from '../components/Confetti';
import AnimatedNumber from '../components/AnimatedNumber';
import { applyResult, getRating } from '../lib/elo';
import { playMoveSound, sound } from '../lib/sound';
import { load, save } from '../lib/storage';
import PUZZLES from '../data/puzzles.json';

type Puzzle = { fen: string; moves: string[]; theme: string; rating: number };
const ALL = PUZZLES as Puzzle[];

const THEME_LABEL: Record<string, string> = {
  mate1: 'Mate en 1',
  mate2: 'Mate en 2',
  mate3: 'Mate en 3',
  material: 'Gana material',
};

type Mode = 'rated' | 'rush';
type Status = 'intro' | 'solving' | 'wrong' | 'solved' | 'revealed';

function pickPuzzle(target: number, recent: Set<number>) {
  const candidates = ALL.map((p, i) => [p, i] as const).filter(([p, i]) => !recent.has(i) && Math.abs(p.rating - target) < 250);
  const pool = candidates.length ? candidates : ALL.map((p, i) => [p, i] as const).filter(([, i]) => !recent.has(i));
  return pool[Math.floor(Math.random() * pool.length)] ?? ([ALL[0], 0] as const);
}

const RUSH_TIME = 180;

export default function Puzzles() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [index, setIndex] = useState(0);
  const [fen, setFen] = useState(new Chess().fen());
  const [step, setStep] = useState(0); // índice en moves de la siguiente jugada
  const [status, setStatus] = useState<Status>('intro');
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [hint, setHint] = useState(false);
  const [flash, setFlash] = useState<'good' | 'bad' | null>(null);
  const [ratingDelta, setRatingDelta] = useState<{ before: number; after: number } | null>(null);
  const [failedThis, setFailedThis] = useState(false);
  // Contrarreloj
  const [rush, setRush] = useState({ score: 0, strikes: 0, timeLeft: RUSH_TIME, over: false });
  const [best, setBest] = useState(() => load('rushBest', 0));

  const chessRef = useRef(new Chess());
  const recent = useRef(new Set<number>(load<number[]>('recentPuzzles', [])));
  const timers = useRef<number[]>([]);
  const rushLevel = useRef(600);
  const rushOver = useRef(false);
  rushOver.current = rush.over;

  const puzzle = ALL[index];
  const solverColor = new Chess(puzzle.fen).turn() === 'w' ? 'b' : 'w';

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const playUci = useCallback((uci: string) => {
    const mv = chessRef.current.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    setFen(chessRef.current.fen());
    setLastMove([mv.from, mv.to]);
    playMoveSound(mv.san);
  }, []);

  const loadPuzzle = useCallback(
    (target: number) => {
      const [, i] = pickPuzzle(target, recent.current);
      recent.current.add(i);
      if (recent.current.size > ALL.length * 0.8) recent.current.clear();
      save('recentPuzzles', [...recent.current]);
      const p = ALL[i];
      chessRef.current = new Chess(p.fen);
      setIndex(i);
      setFen(p.fen);
      setLastMove(null);
      setStep(1);
      setHint(false);
      setFailedThis(false);
      setRatingDelta(null);
      setStatus('solving');
      // La primera jugada (el error del rival) se anima tras una pausa.
      later(() => playUci(p.moves[0]), 550);
    },
    [playUci],
  );

  function start(m: Mode) {
    setMode(m);
    if (m === 'rush') {
      rushLevel.current = 600;
      setRush({ score: 0, strikes: 0, timeLeft: RUSH_TIME, over: false });
      loadPuzzle(rushLevel.current);
    } else loadPuzzle(getRating('puzzles').rating);
  }

  // Reloj de la contrarreloj
  useEffect(() => {
    if (mode !== 'rush' || rush.over) return;
    const id = setInterval(() => {
      setRush((r) => {
        if (r.over) return r;
        const t = r.timeLeft - 1;
        if (t <= 10 && t > 0) sound.tick();
        return t <= 0 ? endRush({ ...r, timeLeft: 0 }) : { ...r, timeLeft: t };
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, rush.over]);

  function endRush(r: typeof rush) {
    rushOver.current = true;
    if (r.score > best) {
      setBest(r.score);
      save('rushBest', r.score);
    }
    sound.win();
    return { ...r, over: true };
  }

  function onSolved() {
    setStatus('solved');
    setFlash('good');
    sound.good();
    later(() => setFlash(null), 600);
    if (mode === 'rated') {
      if (!failedThis) setRatingDelta(applyResult('puzzles', puzzle.rating, 1));
    } else {
      rushLevel.current += 60;
      setRush((r) => ({ ...r, score: r.score + 1 }));
      later(() => {
        if (!rushOver.current) loadPuzzle(rushLevel.current);
      }, 700);
    }
  }

  function onWrong() {
    setFlash('bad');
    sound.bad();
    later(() => setFlash(null), 600);
    if (mode === 'rated') {
      if (!failedThis) setRatingDelta(applyResult('puzzles', puzzle.rating, 0));
      setFailedThis(true);
      setStatus('wrong');
    } else {
      setRush((r) => {
        const nr = { ...r, strikes: r.strikes + 1 };
        return nr.strikes >= 3 ? endRush(nr) : nr;
      });
      later(() => {
        if (!rushOver.current) loadPuzzle(rushLevel.current);
      }, 900);
      setStatus('wrong');
    }
  }

  function handleMove(m: MoveInput) {
    if (status !== 'solving') return false;
    const chess = chessRef.current;
    const expected = puzzle.moves[step];
    const uci = m.from + m.to + (m.promotion ?? '');
    let mv;
    try {
      mv = chess.move(m);
    } catch {
      return false;
    }
    const isLast = step === puzzle.moves.length - 1;
    const correct = uci === expected || (isLast && chess.isCheckmate());
    setFen(chess.fen());
    setLastMove([mv.from, mv.to]);
    playMoveSound(mv.san);
    setHint(false);
    if (!correct) {
      onWrong();
      // Deshace el error para que pueda reintentar (en modo clasificado).
      later(() => {
        chess.undo();
        setFen(chess.fen());
        setLastMove(null);
        if (mode === 'rated') setStatus('solving');
      }, 650);
      return true;
    }
    if (isLast) {
      onSolved();
    } else {
      setStep(step + 2);
      later(() => playUci(puzzle.moves[step + 1]), 380);
    }
    return true;
  }

  function reveal() {
    setStatus('revealed');
    if (!failedThis && mode === 'rated') setRatingDelta(applyResult('puzzles', puzzle.rating, 0));
    setFailedThis(true);
    let s = step;
    const playNext = () => {
      if (s >= puzzle.moves.length) return;
      playUci(puzzle.moves[s]);
      s++;
      later(playNext, 650);
    };
    playNext();
  }

  const hintSquare = puzzle.moves[step]?.slice(0, 2);
  const rating = getRating('puzzles').rating;

  if (!mode) {
    return (
      <div className="page narrow">
        <h1 className="page-title">Puzzles</h1>
        <div className="mode-grid">
          <button className="mode-card" onClick={() => start('rated')}>
                        <strong>Puzzles clasificados</strong>
            <span className="muted small">Tu Elo de puzzles: {rating}. La dificultad se adapta a ti.</span>
          </button>
          <button className="mode-card" onClick={() => start('rush')}>
                        <strong>Contrarreloj</strong>
            <span className="muted small">3 minutos, 3 fallos. Cada acierto sube la dificultad. Récord: {best}</span>
          </button>
        </div>
        <p className="muted small center">{ALL.length} puzzles generados con Stockfish a partir de errores reales en partidas.</p>
      </div>
    );
  }

  return (
    <div className="page play-page">
      <div className={`board-col ${flash ? `flash-${flash}` : ''}`}>
        <Board
          position={fen}
          orientation={solverColor === 'w' ? 'white' : 'black'}
          movable={status === 'solving' && step % 2 === 1 && chessRef.current.turn() === solverColor ? solverColor : null}
          onMove={handleMove}
          lastMove={lastMove}
          squareStyles={hint && hintSquare ? { [hintSquare]: { boxShadow: 'inset 0 0 0 4px #26c2a3', animation: 'pulse 1s infinite' } } : undefined}
        />
      </div>
      <aside className="side-panel">
        <div className="card">
          <div className="row-between">
            <h2 className="panel-title">{mode === 'rush' ? 'Contrarreloj' : 'Puzzle'}</h2>
            <button className="btn ghost small" onClick={() => setMode(null)}>
              Salir
            </button>
          </div>

          {mode === 'rush' && (
            <div className="rush-stats">
              <div className={`rush-time ${rush.timeLeft <= 10 ? 'low' : ''}`}>
                {Math.floor(rush.timeLeft / 60)}:{String(rush.timeLeft % 60).padStart(2, '0')}
              </div>
              <div className="rush-score" key={rush.score}>
                {rush.score}
              </div>
              <div className="strikes">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={i < rush.strikes ? 'x on' : 'x'}>
                    ✕
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className={`turn-banner ${solverColor}`}>
            {status === 'solved' ? '¡Correcto!' : status === 'wrong' ? 'No es eso…' : status === 'revealed' ? 'Solución' : `Juegan las ${solverColor === 'w' ? 'blancas' : 'negras'}`}
          </div>
          <p className="muted small">
            {THEME_LABEL[puzzle.theme] ?? puzzle.theme} · dificultad {puzzle.rating}
          </p>

          {mode === 'rated' && (
            <div className="rating-inline">
              Elo de puzzles:{' '}
              <strong>{ratingDelta ? <AnimatedNumber from={ratingDelta.before} to={ratingDelta.after} /> : rating}</strong>
              {ratingDelta && (
                <span className={`delta ${ratingDelta.after >= ratingDelta.before ? 'up' : 'down'}`}>
                  {ratingDelta.after >= ratingDelta.before ? '+' : ''}
                  {ratingDelta.after - ratingDelta.before}
                </span>
              )}
            </div>
          )}

          {mode === 'rated' && (
            <div className="btn-row">
              {status === 'solving' && (
                <>
                  <button className="btn" onClick={() => setHint(true)}>
                    Pista
                  </button>
                  <button className="btn ghost" onClick={reveal}>
                    Ver solución
                  </button>
                </>
              )}
              {(status === 'solved' || status === 'revealed') && (
                <button className="btn primary" onClick={() => loadPuzzle(getRating('puzzles').rating)}>
                  Siguiente →
                </button>
              )}
            </div>
          )}

          {mode === 'rush' && rush.over && (
            <div className="rush-over pop-in">
              {rush.score >= best && rush.score > 0 && <Confetti />}
              <h3>¡Fin!</h3>
              <p>
                Has resuelto <strong>{rush.score}</strong> puzzles {rush.score >= best && rush.score > 0 ? '· ¡nuevo récord!' : `· récord ${best}`}
              </p>
              <button className="btn primary" onClick={() => start('rush')}>
                Otra vez
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
