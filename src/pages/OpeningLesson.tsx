import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board, { type MoveInput } from '../components/Board';
import Confetti from '../components/Confetti';
import { explain } from '../lib/guide';
import { playMoveSound, sound } from '../lib/sound';

export type OpeningLessonData = {
  id: string;
  side: 'w' | 'b';
  title: string;
  intro: string;
  setup: string[]; // jugadas hasta la posición de la lección (UCI)
  // Una línea por cada respuesta habitual del rival: empieza con su jugada y termina con una tuya.
  branches: { reply: string; share: number | null; name: string | null; moves: string[]; book: boolean[] }[];
};

type Status = 'auto' | 'user' | 'done';
type Msg = { text: string; tone: 'good' | 'bad' | 'info' };

const uciMove = (chess: Chess, u: string) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
const numbered = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'}${san}`;
const sideName = (c: 'w' | 'b') => (c === 'w' ? 'Las blancas' : 'Las negras');
const shareText = (share: number | null) => (share === null ? ' (fuera de la teoría habitual, pero el motor la tiene en cuenta)' : ` (${share} % de las partidas)`);

export default function OpeningLesson({ lesson, onExit, onComplete }: { lesson: OpeningLessonData; onExit: () => void; onComplete: () => void }) {
  const [branch, setBranch] = useState(0);
  const [step, setStep] = useState(0);
  const [fen, setFen] = useState(new Chess().fen());
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [status, setStatus] = useState<Status>('auto');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [wrong, setWrong] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const chessRef = useRef(new Chess());
  const timers = useRef<number[]>([]);
  const runId = useRef(0);

  const b = lesson.branches[branch];
  const opponent = lesson.side === 'w' ? 'b' : 'w';
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Juega la jugada del rival en la posición actual y explica qué hace.
  function opponentPlays(i: number, id: number) {
    later(() => {
      if (id !== runId.current) return;
      const chess = chessRef.current;
      const before = chess.fen();
      const ply = chess.history().length + lesson.setup.length;
      const mv = uciMove(chess, b.moves[i]);
      setFen(chess.fen());
      setLastMove([mv.from, mv.to]);
      playMoveSound(mv.san);
      const intro = i === 0 ? `${sideName(opponent)} responden ${numbered(ply, mv.san)}${shareText(b.share)}.` : `Responden ${numbered(ply, mv.san)}.`;
      setMsgs((m) => [...m, { tone: 'info', text: `${intro} ${explain(before, b.moves[i], b.book[i] ? 1 : null)}` }]);
      setStep(i + 1);
      setStatus('user');
    }, i === 0 ? 700 : 550);
  }

  function startBranch(i: number) {
    const id = ++runId.current;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const chess = new Chess();
    for (const u of lesson.setup) uciMove(chess, u);
    chessRef.current = new Chess(chess.fen());
    setBranch(i);
    setFen(chess.fen());
    const last = lesson.setup[lesson.setup.length - 1];
    setLastMove([last.slice(0, 2), last.slice(2, 4)]);
    setStep(0);
    setWrong(0);
    setMsgs([]);
    setStatus('auto');
    // Se usa la rama nueva directamente porque `b` todavía es la anterior en este render.
    const nb = lesson.branches[i];
    later(() => {
      if (id !== runId.current) return;
      const c = chessRef.current;
      const before = c.fen();
      const mv = uciMove(c, nb.moves[0]);
      setFen(c.fen());
      setLastMove([mv.from, mv.to]);
      playMoveSound(mv.san);
      const ply = lesson.setup.length;
      setMsgs([{ tone: 'info', text: `${sideName(opponent)} responden ${numbered(ply, mv.san)}${shareText(nb.share)}. ${explain(before, nb.moves[0], nb.book[0] ? 1 : null)}` }]);
      setStep(1);
      setStatus('user');
    }, 700);
  }

  useEffect(() => {
    startBranch(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);

  function onMove(m: MoveInput): boolean {
    if (status !== 'user') return false;
    const chess = chessRef.current;
    const before = chess.fen();
    const ply = chess.history().length + lesson.setup.length;
    let mv;
    try {
      mv = chess.move(m);
    } catch {
      return false;
    }
    const uci = mv.from + mv.to + (mv.promotion ?? '');
    setFen(chess.fen());
    setLastMove([mv.from, mv.to]);
    playMoveSound(mv.san);
    if (uci !== b.moves[step]) {
      sound.bad();
      setWrong((w) => w + 1);
      setMsgs((x) => [...x, { tone: 'bad', text: `${mv.san} no es la jugada de esta línea. Prueba otra vez.` }]);
      setStatus('auto');
      later(() => {
        chess.undo();
        setFen(chess.fen());
        setLastMove(null);
        setStatus('user');
      }, 600);
      return true;
    }
    setWrong(0);
    const note = b.book[step] ? '' : ' No es la más jugada, pero aquí es la más fiable según Stockfish.';
    setMsgs((x) => [...x, { tone: 'good', text: `${numbered(ply, mv.san)}: ${explain(before, uci, b.book[step] ? 1 : null)}${note}` }]);
    const next = step + 1;
    if (next >= b.moves.length) {
      sound.good();
      setStatus('done');
      const d = new Set(done).add(branch);
      setDone(d);
      if (d.size === lesson.branches.length) onComplete();
      return true;
    }
    setStep(next);
    setStatus('auto');
    opponentPlays(next, runId.current);
    return true;
  }

  const expected = status === 'user' ? b.moves[step] : null;
  const hint = expected && wrong >= 2 ? [[expected.slice(0, 2), expected.slice(2, 4), 'rgba(214,162,74,.9)']] : undefined;
  const allDone = done.size === lesson.branches.length;
  const nextBranch = lesson.branches.findIndex((_, i) => !done.has(i) && i !== branch);

  return (
    <div className="page play-page">
      <div className={`board-col ${status === 'done' ? 'flash-good' : ''}`}>
        <Board
          position={fen}
          orientation={lesson.side === 'w' ? 'white' : 'black'}
          movable={status === 'user' ? lesson.side : null}
          onMove={onMove}
          lastMove={lastMove}
          arrows={hint as never}
        />
      </div>
      <aside className="side-panel">
        <div className="card">
          <div className="row-between">
            <h2 className="panel-title">{lesson.title}</h2>
            <button className="btn ghost small" onClick={onExit}>
              Lecciones
            </button>
          </div>
          <p className="muted small">
            Juegas con {lesson.side === 'w' ? 'blancas' : 'negras'}. {lesson.intro}
          </p>

          <div className="branch-list">
            {lesson.branches.map((x, i) => {
              const c = new Chess();
              for (const u of lesson.setup) uciMove(c, u);
              const san = numbered(lesson.setup.length, uciMove(c, x.reply).san);
              return (
                <button key={x.reply} className={`branch ${i === branch ? 'on' : ''} ${done.has(i) ? 'done' : ''}`} onClick={() => startBranch(i)}>
                  <span>
                    <strong>Contra {san}</strong>
                    <span className="muted small">{x.name ?? lesson.title}</span>
                  </span>
                  <span className="muted small nowrap">{done.has(i) ? '✓' : x.share === null ? 'motor' : `${x.share} %`}</span>
                </button>
              );
            })}
          </div>

          <div className="lesson-log">
            {msgs.map((m, i) => (
              <p key={i} className={`lesson-line ${m.tone} fade-in`}>
                {m.text}
              </p>
            ))}
            {status === 'user' && <p className="muted small">Te toca: juega la jugada de teoría.{wrong >= 2 ? ' Te marco la jugada con una flecha.' : ''}</p>}
          </div>

          {status === 'done' && !allDone && (
            <div className="btn-row">
              <button className="btn primary" onClick={() => startBranch(nextBranch >= 0 ? nextBranch : (branch + 1) % lesson.branches.length)}>
                Siguiente línea
              </button>
              <button className="btn" onClick={() => startBranch(branch)}>
                Repetir
              </button>
            </div>
          )}
          {allDone && status === 'done' && (
            <div className="pop-in center">
              <Confetti count={60} />
              <h3>¡Lección completada!</h3>
              <div className="btn-row">
                <button className="btn primary" onClick={onExit}>
                  Volver a lecciones
                </button>
                <button className="btn" onClick={() => startBranch(branch)}>
                  Repetir esta línea
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
