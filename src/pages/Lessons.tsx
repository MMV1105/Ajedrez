import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board, { type MoveInput } from '../components/Board';
import Confetti from '../components/Confetti';
import { Engine } from '../lib/engine';
import { playMoveSound, sound } from '../lib/sound';
import { load, save } from '../lib/storage';
import LESSONS from '../data/lessons.json';

type Step =
  | { type: 'info'; text: string; fen: string; arrows?: [string, string][] }
  | { type: 'puzzle'; text: string; fen: string; line: string[]; acceptLast: string[] }
  | { type: 'practice'; text: string; fen: string; goal: 'mate' | 'promote'; maxMoves: number };

type Lesson = { id: string; title: string; icon: string; level: string; steps: Step[] };
const ALL = LESSONS as Lesson[];

export default function Lessons() {
  const [done, setDone] = useState<Record<string, boolean>>(() => load('lessonsDone', {}));
  const [lessonId, setLessonId] = useState<string | null>(null);

  if (!lessonId) {
    const groups = [...new Set(ALL.map((l) => l.level))];
    return (
      <div className="page narrow">
        <h1 className="page-title">Lecciones</h1>
        {groups.map((g) => (
          <section key={g}>
            <h3 className="group-title">{g}</h3>
            <div className="lesson-grid">
              {ALL.filter((l) => l.level === g).map((l, i) => (
                <button key={l.id} className={`lesson-card ${done[l.id] ? 'done' : ''}`} style={{ animationDelay: `${i * 60}ms` }} onClick={() => setLessonId(l.id)}>
                  <span className="lesson-icon">{l.icon}</span>
                  <strong>{l.title}</strong>
                  <span className="muted small">{l.steps.length} pasos</span>
                  {done[l.id] && <span className="done-badge">✓</span>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  const lesson = ALL.find((l) => l.id === lessonId)!;
  return (
    <LessonPlayer
      lesson={lesson}
      onExit={() => setLessonId(null)}
      onComplete={() => {
        const d = { ...done, [lesson.id]: true };
        setDone(d);
        save('lessonsDone', d);
      }}
    />
  );
}

function LessonPlayer({ lesson, onExit, onComplete }: { lesson: Lesson; onExit: () => void; onComplete: () => void }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [fen, setFen] = useState(lesson.steps[0].fen);
  const [ply, setPly] = useState(0);
  const [state, setState] = useState<'active' | 'success' | 'fail'>('active');
  const [msg, setMsg] = useState('');
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [moves, setMoves] = useState(0);
  const chessRef = useRef(new Chess(lesson.steps[0].fen));
  const engineRef = useRef<Engine | null>(null);
  const step = lesson.steps[stepIdx];
  const finished = stepIdx >= lesson.steps.length - 1 && state === 'success';
  const userColor = new Chess(step.fen).turn();

  useEffect(() => () => engineRef.current?.terminate(), []);

  function reset(i = stepIdx) {
    const s = lesson.steps[i];
    chessRef.current = new Chess(s.fen);
    setFen(s.fen);
    setPly(0);
    setMoves(0);
    setLastMove(null);
    setMsg('');
    setState(s.type === 'info' ? 'success' : 'active');
    if (s.type === 'practice' && !engineRef.current) engineRef.current = new Engine();
  }

  useEffect(() => {
    reset(stepIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx]);

  function play(m: MoveInput | string) {
    const chess = chessRef.current;
    const mv = chess.move(typeof m === 'string' ? { from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] } : m);
    setFen(chess.fen());
    setLastMove([mv.from, mv.to]);
    playMoveSound(mv.san);
    return mv;
  }

  function succeed(text: string) {
    setState('success');
    setMsg(text);
    sound.good();
    if (stepIdx === lesson.steps.length - 1) onComplete();
  }

  function onMove(m: MoveInput): boolean {
    if (state !== 'active') return false;
    const chess = chessRef.current;
    if (step.type === 'puzzle') {
      const uci = m.from + m.to + (m.promotion ?? '');
      const isLast = ply === step.line.length - 1;
      try {
        play(m);
      } catch {
        return false;
      }
      const ok = uci === step.line[ply] || (isLast && (step.acceptLast.includes(uci) || chess.isCheckmate()));
      if (!ok) {
        sound.bad();
        setMsg('Esa no es. Inténtalo otra vez.');
        setTimeout(() => {
          chess.undo();
          setFen(chess.fen());
          setLastMove(null);
        }, 600);
        return true;
      }
      if (isLast) succeed('¡Muy bien!');
      else {
        setMsg('');
        setPly(ply + 2);
        setTimeout(() => play(step.line[ply + 1]), 400);
      }
      return true;
    }
    if (step.type === 'practice') {
      let mv;
      try {
        mv = play(m);
      } catch {
        return false;
      }
      const n = moves + 1;
      setMoves(n);
      if (step.goal === 'promote' && mv.promotion) return succeed('¡Peón coronado!'), true;
      if (chess.isCheckmate()) return succeed(`¡Jaque mate en ${n} jugadas!`), true;
      if (chess.isDraw()) {
        setState('fail');
        setMsg(chess.isStalemate() ? '¡Ahogado! Son tablas. Deja siempre una casilla libre al rey.' : 'Tablas. Prueba otra vez.');
        sound.bad();
        return true;
      }
      if (n >= step.maxMoves) {
        setState('fail');
        setMsg('Se acabaron las jugadas. ¡Inténtalo de nuevo!');
        sound.bad();
        return true;
      }
      engineRef.current!.analyse(chess.fen(), { depth: 12 }).then(([best]) => {
        if (!best || chessRef.current !== chess) return;
        setTimeout(() => {
          play(best.move);
          // El rival capturó el peón o la pieza: no hay forma de ganar.
          const pieces = chess.board().flat().filter((p) => p && p.color === userColor && p.type !== 'k');
          if (!pieces.length) {
            setState('fail');
            setMsg('Te han capturado la pieza. ¡Otra vez!');
            sound.bad();
          }
        }, 300);
      });
      return true;
    }
    return false;
  }

  const arrows = step.type === 'info' ? (step.arrows ?? []).map(([a, b]) => [a, b, 'rgba(255,170,0,.85)']) : [];

  return (
    <div className="page play-page">
      <div className={`board-col ${state === 'success' && step.type !== 'info' ? 'flash-good' : ''}`}>
        <Board
          position={fen}
          orientation={userColor === 'w' ? 'white' : 'black'}
          movable={step.type !== 'info' && state === 'active' ? userColor : null}
          onMove={onMove}
          lastMove={lastMove}
          arrows={arrows as never}
        />
      </div>
      <aside className="side-panel">
        <div className="card">
          <div className="row-between">
            <h2>
              {lesson.icon} {lesson.title}
            </h2>
            <button className="btn ghost small" onClick={onExit}>
              ← Lecciones
            </button>
          </div>
          <div className="step-dots">
            {lesson.steps.map((_, i) => (
              <span key={i} className={i < stepIdx ? 'done' : i === stepIdx ? 'on' : ''} />
            ))}
          </div>
          <p className="lesson-text fade-in" key={stepIdx}>
            {step.text}
          </p>
          {step.type === 'practice' && (
            <p className="muted small">
              Jugadas: {moves}/{step.maxMoves}
            </p>
          )}
          {msg && (
            <p className={`lesson-msg pop-in ${state}`} key={msg}>
              {msg}
            </p>
          )}
          <div className="btn-row">
            {state === 'fail' && (
              <button className="btn primary" onClick={() => reset()}>
                Reintentar
              </button>
            )}
            {state === 'success' && !finished && (
              <button className="btn primary" onClick={() => setStepIdx(stepIdx + 1)}>
                Siguiente →
              </button>
            )}
            {step.type !== 'info' && state === 'active' && ply === 0 && moves === 0 ? null : step.type !== 'info' && state === 'active' ? (
              <button className="btn ghost" onClick={() => reset()}>
                Reiniciar
              </button>
            ) : null}
          </div>
          {finished && (
            <div className="pop-in center">
              <Confetti count={60} />
              <h3>¡Lección completada!</h3>
              <button className="btn primary" onClick={onExit}>
                Volver a lecciones
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
