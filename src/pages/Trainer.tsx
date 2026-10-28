import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import Board, { type MoveInput } from '../components/Board';
import Confetti from '../components/Confetti';
import EvalBar from '../components/EvalBar';
import { Engine } from '../lib/engine';
import { CLASS_INFO, evalPosition, evalToCp, judgeMove, playerAccuracy, type Classification, type PositionEval } from '../lib/analysis';
import { playMoveSound, sound } from '../lib/sound';
import { load, save } from '../lib/storage';
import { ALL_SPOTS, KIND_INFO, PHASE_INFO, formatCp, markDone, pickSpot, trainerProgress, type Spot, type SpotKind, type TrainerPhase } from '../lib/trainer';

// Profundidad del motor rival y del juez de cada jugada.
const DEPTH = 12;

type Status = 'intro' | 'playing' | 'thinking' | 'won' | 'lost';
type Judged = { san: string; to: string; cls: Classification; accuracy: number };

const sideName = (c: 'w' | 'b') => (c === 'w' ? 'blancas' : 'negras');
const clamp = (v: number) => Math.max(-2000, Math.min(2000, v));

export function OpeningsTrainer() {
  return <Trainer phase="apertura" />;
}
export function MiddlegameTrainer() {
  return <Trainer phase="medio" />;
}
export function EndgameTrainer() {
  return <Trainer phase="final" />;
}

function Trainer({ phase }: { phase: TrainerPhase }) {
  const info = PHASE_INFO[phase];
  const [kindFilter, setKindFilter] = useState<SpotKind | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [fen, setFen] = useState(new Chess().fen());
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [status, setStatus] = useState<Status>('intro');
  const [judged, setJudged] = useState<Judged[]>([]);
  const [ev, setEv] = useState<PositionEval | null>(null);
  const [showEval, setShowEval] = useState(() => load('trainerShowEval', false));
  const [hint, setHint] = useState<[string, string] | null>(null);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(() => trainerProgress(phase));

  const chessRef = useRef(new Chess());
  const engineRef = useRef<Engine | null>(null);
  const cache = useRef(new Map<string, Promise<PositionEval>>());
  const runId = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => save('trainerShowEval', showEval), [showEval]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      engineRef.current?.terminate();
    },
    [],
  );

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const evalOf = useCallback((f: string) => {
    engineRef.current ??= new Engine();
    let p = cache.current.get(f);
    if (!p) {
      p = evalPosition(engineRef.current, f, DEPTH);
      cache.current.set(f, p);
    }
    return p;
  }, []);

  const userColor = spot ? (new Chess(spot.fen).turn() as 'w' | 'b') : 'w';
  const sign = userColor === 'w' ? 1 : -1;
  const userMoves = judged.length;

  const start = useCallback(
    (s: Spot) => {
      const id = ++runId.current;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setSpot(s);
      setJudged([]);
      setHint(null);
      setMessage('');
      setEv(null);
      evalOf(s.fen).then((e) => id === runId.current && setEv(e));
      if (s.prev && s.last) {
        const chess = new Chess(s.prev);
        chessRef.current = chess;
        setFen(s.prev);
        setLastMove(null);
        setStatus('thinking');
        // Se ve la última jugada del rival antes de empezar.
        later(() => {
          if (id !== runId.current) return;
          const mv = chess.move({ from: s.last!.slice(0, 2), to: s.last!.slice(2, 4), promotion: s.last![4] });
          setFen(chess.fen());
          setLastMove([mv.from, mv.to]);
          playMoveSound(mv.san);
          setStatus('playing');
        }, 600);
      } else {
        chessRef.current = new Chess(s.fen);
        setFen(s.fen);
        setLastMove(null);
        setStatus('playing');
      }
    },
    [evalOf],
  );

  const next = () => start(pickSpot(phase, kindFilter));

  function end(won: boolean, text: string) {
    setStatus(won ? 'won' : 'lost');
    setMessage(text);
    setHint(null);
    if (won) {
      sound.win();
      markDone(spot!.id);
      setProgress(trainerProgress(phase));
    } else sound.lose();
  }

  // Fin de partida antes de cumplir las jugadas: mate o tablas.
  function gameOverResult(chess: Chess) {
    if (chess.isCheckmate()) return chess.turn() === userColor ? end(false, 'Te han dado mate.') : end(true, '¡Jaque mate!');
    const draw = chess.isStalemate() ? 'ahogado' : chess.isThreefoldRepetition() ? 'repetición' : 'tablas';
    if (spot!.kind === 'ventaja') end(false, `Tablas por ${draw}: la ventaja se ha escapado.`);
    else end(true, `Tablas por ${draw}. Objetivo cumplido.`);
  }

  async function onMove(m: MoveInput): Promise<void> {
    const s = spot!;
    const id = runId.current;
    const chess = chessRef.current;
    let mv: Move;
    try {
      mv = chess.move(m);
    } catch {
      return;
    }
    setFen(chess.fen());
    setLastMove([mv.from, mv.to]);
    setHint(null);
    playMoveSound(mv.san);
    setStatus('thinking');
    const [before, after] = await Promise.all([evalOf(mv.before), evalOf(mv.after)]);
    if (id !== runId.current) return;
    const r = judgeMove(mv, before, after);
    const n = userMoves + 1;
    setJudged((j) => [...j, { san: mv.san, to: mv.to, cls: r.cls, accuracy: r.accuracy }]);
    setEv(after);
    if (chess.isGameOver()) return gameOverResult(chess);
    const mine = clamp(sign * evalToCp(after));
    if (mine < s.failLine) {
      const bestSan = before.best ? new Chess(mv.before).move({ from: before.best.slice(0, 2), to: before.best.slice(2, 4), promotion: before.best[4] }).san : null;
      return end(false, `La evaluación ha bajado a ${formatCp(mine)}.${bestSan && bestSan !== mv.san ? ` Era mejor ${bestSan}.` : ''}`);
    }
    if (n >= s.moves) return end(true, `Has aguantado ${s.moves} jugadas: terminas en ${formatCp(mine)}.`);
    // Responde el motor con su mejor jugada.
    later(() => {
      if (id !== runId.current || !after.best) return;
      const reply = chess.move({ from: after.best.slice(0, 2), to: after.best.slice(2, 4), promotion: after.best[4] });
      setFen(chess.fen());
      setLastMove([reply.from, reply.to]);
      playMoveSound(reply.san);
      if (chess.isGameOver()) return gameOverResult(chess);
      setStatus('playing');
      evalOf(chess.fen()); // se adelanta el cálculo de la siguiente jugada
    }, 250);
  }

  function showHint() {
    const id = runId.current;
    evalOf(chessRef.current.fen()).then((e) => {
      if (id === runId.current && e.best) setHint([e.best.slice(0, 2), e.best.slice(2, 4)]);
    });
  }

  if (!spot) {
    const kinds: (SpotKind | null)[] = [null, 'igualada', 'ventaja', 'defensa'];
    const available = (k: SpotKind | null) => ALL_SPOTS.some((s) => s.phase === phase && (!k || s.kind === k));
    return (
      <div className="page narrow">
        <header className="page-head">
          <h1 className="page-title">{info.title}</h1>
        </header>
        <p className="muted">{info.text}</p>
        <p className="muted">
          Aparece una posición y la juegas contra Stockfish. Cada posición tiene un objetivo: aguantar un número de jugadas sin que la evaluación baje de un
          límite. Si la evaluación cae por debajo, se acaba.
        </p>
        <label className="field-label">Tipo de posición</label>
        <div className="chip-row">
          {kinds.filter(available).map((k) => (
            <button key={k ?? 'all'} className={`chip ${kindFilter === k ? 'on' : ''}`} onClick={() => setKindFilter(k)}>
              {k ? KIND_INFO[k].label : 'Todas'}
            </button>
          ))}
        </div>
        <p className="muted small">
          {progress.done} de {progress.total} superadas
        </p>
        <button className="btn primary big" onClick={next}>
          Empezar
        </button>
      </div>
    );
  }

  const opponentLast = spot.prev && spot.last ? new Chess(spot.prev).move({ from: spot.last.slice(0, 2), to: spot.last.slice(2, 4), promotion: spot.last[4] }).san : null;
  const goal =
    spot.kind === 'igualada'
      ? `Juega ${spot.moves} jugadas sin que la evaluación baje de ${formatCp(spot.failLine)}.`
      : spot.kind === 'ventaja'
        ? opponentLast
          ? `El rival acaba de jugar ${opponentLast} y no es lo mejor. Aprovéchalo: ${spot.moves} jugadas sin bajar de ${formatCp(spot.failLine)}.`
          : `Tienes ventaja. No la dejes escapar: ${spot.moves} jugadas sin bajar de ${formatCp(spot.failLine)}.`
        : `Estás peor. Aguanta ${spot.moves} jugadas sin bajar de ${formatCp(spot.failLine)}.`;
  const finished = status === 'won' || status === 'lost';
  const accuracy = judged.length ? playerAccuracy(judged.map((j) => j.accuracy)) : null;
  const lastJudged = judged[judged.length - 1];
  const orientation = userColor === 'w' ? 'white' : 'black';

  return (
    <div className="page play-page">
      <div className={`board-col ${status === 'won' ? 'flash-good' : status === 'lost' ? 'flash-bad' : ''}`}>
        <div className="board-with-eval">
          {(showEval || finished) && <EvalBar ev={ev} orientation={orientation} />}
          <Board
            position={fen}
            orientation={orientation}
            movable={status === 'playing' ? userColor : null}
            onMove={(m) => {
              if (status !== 'playing') return false;
              try {
                new Chess(chessRef.current.fen()).move(m);
              } catch {
                return false;
              }
              onMove(m);
              return true;
            }}
            lastMove={lastMove}
            arrows={hint ? [[hint[0], hint[1], 'rgba(214,162,74,.9)']] as never : undefined}
            badge={lastJudged && status !== 'intro' ? { square: lastJudged.to, content: CLASS_INFO[lastJudged.cls].icon, color: CLASS_INFO[lastJudged.cls].color } : null}
          />
        </div>
      </div>
      <aside className="side-panel">
        <div className="card">
          <div className="row-between">
            <h2 className="panel-title">{info.title}</h2>
            <button
              className="btn ghost small"
              onClick={() => {
                runId.current++;
                setSpot(null);
              }}
            >
              Salir
            </button>
          </div>
          <p className="muted small">
            {spot.name} · {spot.classic ? 'Final clásico' : KIND_INFO[spot.kind].label}
          </p>
          <div className={`turn-banner ${userColor}`}>
            {status === 'won' ? 'Objetivo cumplido' : status === 'lost' ? 'Se acabó' : `Juegas con ${sideName(userColor)}`}
          </div>
          <p>{goal}</p>

          <div className="live-box">
            <div>
              <span className="label">Jugada</span>
              <span className="live-acc">
                {Math.min(userMoves, spot.moves)}/{spot.moves}
              </span>
            </div>
            <div>
              <span className="label">Precisión</span>
              <span className="live-acc">{accuracy === null ? '–' : accuracy.toFixed(0)}</span>
            </div>
            {lastJudged && (
              <div className="live-last" key={lastJudged.san + judged.length}>
                <span className="cls-dot" style={{ background: CLASS_INFO[lastJudged.cls].color }}>
                  {CLASS_INFO[lastJudged.cls].icon}
                </span>
                {lastJudged.san} · {CLASS_INFO[lastJudged.cls].label}
              </div>
            )}
          </div>

          {message && (
            <p className={`lesson-msg pop-in ${status === 'won' ? 'success' : ''}`} key={message}>
              {message}
            </p>
          )}
          {status === 'won' && <Confetti count={50} />}

          <div className="btn-row">
            {!finished && (
              <>
                <button className="btn" onClick={showHint} disabled={status !== 'playing'}>
                  Pista
                </button>
                <button className="btn ghost" onClick={() => setShowEval(!showEval)}>
                  {showEval ? 'Ocultar evaluación' : 'Ver evaluación'}
                </button>
              </>
            )}
            {finished && (
              <>
                <button className="btn primary" onClick={next}>
                  Siguiente
                </button>
                <button className="btn" onClick={() => start(spot)}>
                  Reintentar
                </button>
              </>
            )}
          </div>
          {finished && judged.length > 0 && (
            <div className="trainer-moves">
              {judged.map((j, i) => (
                <span key={i} className="trainer-move">
                  <span className="cls-dot" style={{ background: CLASS_INFO[j.cls].color }}>
                    {CLASS_INFO[j.cls].icon}
                  </span>
                  {j.san}
                </span>
              ))}
            </div>
          )}
          <p className="muted small">
            {progress.done} de {progress.total} superadas
          </p>
        </div>
      </aside>
    </div>
  );
}
