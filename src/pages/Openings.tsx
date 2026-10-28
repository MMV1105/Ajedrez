import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board, { type MoveInput } from '../components/Board';
import EvalBar from '../components/EvalBar';
import { Engine } from '../lib/engine';
import { CLASS_INFO, evalPosition, evalToCp, judgeMove, playerAccuracy, type Classification, type PositionEval } from '../lib/analysis';
import { bookKey, bookMoves, bookName, loadBook, loadSessions, pickBookMove, saveSession, type Book, type OpeningSession } from '../lib/openings';
import { playMoveSound } from '../lib/sound';
import { load, save } from '../lib/storage';
import { formatCp } from '../lib/trainer';
import { OpeningsTrainer } from './Trainer';

const DEPTH = 12;
// Jugadas tuyas fuera de teoría antes de cerrar la sesión con el resumen.
const MOVES_AFTER_BOOK = 10;
const BOOK_COLOR = '#d6a24a';

type Mode = 'inicio' | 'posiciones';
type Status = 'setup' | 'playing' | 'thinking' | 'over';
type Judged = { cls: Classification; accuracy: number };
type Setup = { color: 'w' | 'b' | 'random'; line: number; showEval: boolean };

const START = new Chess().fen();
const uciMove = (chess: Chess, u: string) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
const sanOf = (fen: string, u: string) => uciMove(new Chess(fen), u).san;
const clamp = (v: number) => Math.max(-2000, Math.min(2000, v));
const moveNumber = (ply: number) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '…' : '.'}`;

export default function Openings() {
  const [mode, setMode] = useState<Mode>(() => load('openingsMode', 'inicio'));
  useEffect(() => save('openingsMode', mode), [mode]);
  return (
    <>
      <div className="page-tabs">
        <div className="segmented">
          <button className={mode === 'inicio' ? 'on' : ''} onClick={() => setMode('inicio')}>
            Desde el inicio
          </button>
          <button className={mode === 'posiciones' ? 'on' : ''} onClick={() => setMode('posiciones')}>
            Posiciones
          </button>
        </div>
      </div>
      {mode === 'inicio' ? <OpeningPractice /> : <OpeningsTrainer />}
    </>
  );
}

function OpeningPractice() {
  const [book, setBook] = useState<Book | null>(null);
  const [setup, setSetup] = useState<Setup>(() => load('openingSetup', { color: 'w', line: -1, showEval: false }));
  const [status, setStatus] = useState<Status>('setup');
  const [color, setColor] = useState<'w' | 'b'>('w');
  const [moves, setMoves] = useState<string[]>([]);
  const [judged, setJudged] = useState<Record<number, Judged>>({});
  const [ev, setEv] = useState<PositionEval | null>(null);
  const [showTheory, setShowTheory] = useState(false);
  const [sessions, setSessions] = useState(loadSessions);

  const chessRef = useRef(new Chess());
  const engineRef = useRef<Engine | null>(null);
  const cache = useRef(new Map<string, Promise<PositionEval>>());
  const runId = useRef(0);
  const target = useRef<string[] | null>(null);

  useEffect(() => {
    loadBook().then(setBook);
    return () => engineRef.current?.terminate();
  }, []);
  useEffect(() => save('openingSetup', setup), [setup]);

  const evalOf = useCallback((f: string) => {
    engineRef.current ??= new Engine();
    let p = cache.current.get(f);
    if (!p) {
      p = evalPosition(engineRef.current, f, DEPTH);
      cache.current.set(f, p);
    }
    return p;
  }, []);

  // Recorrido de la partida: posiciones, SAN y si cada jugada es de teoría.
  const line = useMemo(() => {
    const chess = new Chess();
    const fens = [START];
    const sans: string[] = [];
    const inBook: boolean[] = [];
    let name: { name: string; eco: string } | null = null;
    for (const u of moves) {
      const before = chess.fen();
      inBook.push(!!book && (book.nodes[bookKey(before)]?.m ?? []).some(([m]) => m === u));
      sans.push(uciMove(chess, u).san);
      fens.push(chess.fen());
      if (book) name = bookName(book, chess.fen()) ?? name;
    }
    const firstOut = inBook.indexOf(false);
    return { fens, sans, inBook, name, bookPlies: firstOut === -1 ? moves.length : firstOut };
  }, [moves, book]);

  const userPlies = moves.map((_, i) => i).filter((i) => (i % 2 === 0 ? 'w' : 'b') === color);
  const outOfBook = userPlies.filter((i) => i >= line.bookPlies);
  const outJudged = outOfBook.filter((i) => judged[i]).map((i) => judged[i]);
  const accuracy = outJudged.length ? playerAccuracy(outJudged.map((j) => j.accuracy)) : null;
  const sign = color === 'w' ? 1 : -1;
  const fen = line.fens[line.fens.length - 1];

  // El rival: sigue la línea elegida, si no la teoría (variando), y fuera de teoría juega el motor.
  const opponentMove = useCallback(
    async (played: string[]) => {
      if (!book) return null;
      const chess = new Chess();
      for (const u of played) uciMove(chess, u);
      const t = target.current;
      if (t && played.length < t.length && played.every((u, i) => u === t[i])) return t[played.length];
      if (bookMoves(book, chess.fen()).length) return pickBookMove(book, chess.fen());
      return (await evalOf(chess.fen())).best;
    },
    [book, evalOf],
  );

  const finish = useCallback(
    (played: string[], judgedNow: Record<number, Judged>, c: 'w' | 'b', lastEval: PositionEval | null) => {
      setStatus('over');
      if (!book) return;
      const chess = new Chess();
      let name = 'Apertura sin nombre';
      let bookPlies = played.length;
      played.forEach((u, i) => {
        if (bookPlies === played.length && !bookMoves(book, chess.fen()).some((m) => m.uci === u)) bookPlies = i;
        uciMove(chess, u);
        name = bookName(book, chess.fen())?.name ?? name;
      });
      const mine = played.map((_, i) => i).filter((i) => (i % 2 === 0 ? 'w' : 'b') === c && i >= bookPlies && judgedNow[i]);
      const s: OpeningSession = {
        date: Date.now(),
        name,
        color: c,
        bookPlies,
        accuracy: mine.length ? playerAccuracy(mine.map((i) => judgedNow[i].accuracy)) : null,
        errors: mine.filter((i) => ['error', 'grave'].includes(judgedNow[i].cls)).length,
        finalEval: lastEval ? clamp((c === 'w' ? 1 : -1) * evalToCp(lastEval)) : 0,
      };
      saveSession(s);
      setSessions(loadSessions());
    },
    [book],
  );

  // Juega la respuesta del rival tras `played` (si le toca) y devuelve el control.
  const reply = useCallback(
    async (played: string[], c: 'w' | 'b', judgedNow: Record<number, Judged>) => {
      const id = runId.current;
      const u = await opponentMove(played);
      await new Promise((r) => setTimeout(r, 350));
      if (id !== runId.current || !u) return;
      const chess = chessRef.current;
      const mv = uciMove(chess, u);
      const next = [...played, u];
      setMoves(next);
      playMoveSound(mv.san);
      if (chess.isGameOver()) return finish(next, judgedNow, c, await evalOf(chess.fen()));
      setStatus('playing');
      evalOf(chess.fen()).then((e) => id === runId.current && setEv(e));
    },
    [opponentMove, finish, evalOf],
  );

  function start() {
    const c = setup.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : setup.color;
    runId.current++;
    target.current = setup.line >= 0 && book ? book.mains[setup.line][1].split(' ') : null;
    chessRef.current = new Chess();
    setColor(c);
    setMoves([]);
    setJudged({});
    setEv(null);
    setShowTheory(false);
    if (c === 'b') {
      setStatus('thinking');
      reply([], c, {});
    } else setStatus('playing');
  }

  async function onMove(m: MoveInput) {
    const id = runId.current;
    const chess = chessRef.current;
    const before = chess.fen();
    const mv = chess.move(m);
    const u = mv.from + mv.to + (mv.promotion ?? '');
    const played = [...moves, u];
    const ply = played.length - 1;
    setMoves(played);
    setStatus('thinking');
    playMoveSound(mv.san);
    const [b, a] = await Promise.all([evalOf(before), evalOf(chess.fen())]);
    if (id !== runId.current) return;
    const r = judgeMove(mv, b, a);
    const judgedNow = { ...judged, [ply]: { cls: r.cls, accuracy: r.accuracy } };
    setJudged(judgedNow);
    setEv(a);
    const stillBook = line.bookPlies === moves.length && !!book && bookMoves(book, before).some((x) => x.uci === u);
    const bookPlies = stillBook ? played.length : line.bookPlies;
    const outCount = played.filter((_, i) => (i % 2 === 0 ? 'w' : 'b') === color && i >= bookPlies).length;
    if (chess.isGameOver() || outCount >= MOVES_AFTER_BOOK) return finish(played, judgedNow, color, a);
    reply(played, color, judgedNow);
  }

  function undo() {
    runId.current++;
    const m = [...moves];
    const j = { ...judged };
    while (m.length) {
      const i = m.length - 1;
      const mine = (i % 2 === 0 ? 'w' : 'b') === color;
      m.pop();
      delete j[i];
      if (mine) break;
    }
    const chess = new Chess();
    for (const u of m) uciMove(chess, u);
    chessRef.current = chess;
    setMoves(m);
    setJudged(j);
    setStatus('playing');
    evalOf(chess.fen()).then(setEv);
  }

  if (status === 'setup') {
    const recent = sessions.slice(0, 10);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const avgBook = avg(recent.map((s) => s.bookPlies / 2));
    const avgAcc = avg(recent.flatMap((s) => (s.accuracy === null ? [] : [s.accuracy])));
    return (
      <div className="page narrow">
        <header className="page-head">
          <h1 className="page-title">Aperturas</h1>
        </header>
        <p className="muted">
          Juega desde la primera jugada. El rival responde con líneas de teoría (cada vez distintas) y, cuando la partida sale de la teoría, juega Stockfish. En cada
          jugada te digo si sigues en teoría, qué apertura es y qué nota tiene la jugada. Puedes deshacer y probar otras ideas.
        </p>
        <div className="setup-block">
          <label className="field-label">Juegas con</label>
          <div className="chip-row">
            {(['w', 'b', 'random'] as const).map((c) => (
              <button key={c} className={`chip ${setup.color === c ? 'on' : ''}`} onClick={() => setSetup({ ...setup, color: c })}>
                {c === 'w' ? 'Blancas' : c === 'b' ? 'Negras' : 'Al azar'}
              </button>
            ))}
          </div>
        </div>
        <div className="setup-block">
          <label className="field-label">Apertura</label>
          <select value={setup.line} onChange={(e) => setSetup({ ...setup, line: Number(e.target.value) })}>
            <option value={-1}>Libre: el rival va variando</option>
            {book?.mains.map(([name], i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
          <p className="muted small">Si eliges una, el rival la sigue mientras tú no te salgas.</p>
        </div>
        <div className="setup-block">
          <div className="chip-row">
            <button className={`chip ${setup.showEval ? 'on' : ''}`} onClick={() => setSetup({ ...setup, showEval: !setup.showEval })}>
              Mostrar evaluación
            </button>
          </div>
        </div>
        <button className="btn primary big" onClick={start} disabled={!book}>
          {book ? 'Empezar' : 'Cargando teoría…'}
        </button>

        {recent.length > 0 && (
          <section className="profile-section">
            <h2 className="section-title">Cómo vas</h2>
            <p className="muted">
              {recent.length === 1 ? 'En tu última sesión aguantaste' : `En tus últimas ${recent.length} sesiones aguantas`} en teoría{' '}
              {avgBook!.toFixed(1).replace('.', ',')} jugadas de media
              {avgAcc !== null ? `, y fuera de teoría juegas con ${avgAcc.toFixed(0)} de precisión` : ''}.
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Apertura</th>
                    <th>Color</th>
                    <th className="num">Teoría</th>
                    <th className="num">Precisión</th>
                    <th className="num">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((s) => (
                    <tr key={s.date}>
                      <td>{s.name}</td>
                      <td>{s.color === 'w' ? 'Blancas' : 'Negras'}</td>
                      <td className="num">{Math.ceil(s.bookPlies / 2)} jug.</td>
                      <td className="num">{s.accuracy === null ? '–' : s.accuracy.toFixed(0)}</td>
                      <td className="num">{formatCp(s.finalEval)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    );
  }

  const orientation = color === 'w' ? 'white' : 'black';
  const lastPly = moves.length - 1;
  const lastUser = [...userPlies].reverse().find((i) => judged[i]);
  const myTurn = status === 'playing' && chessRef.current.turn() === color;
  const theory = book && myTurn ? bookMoves(book, fen).slice(0, 5) : [];
  const t = target.current;
  const onTarget = t && moves.length < t.length && moves.every((u, i) => u === t[i]);
  const outOfBookNow = line.bookPlies < moves.length;
  const userMine = clamp(sign * (ev ? evalToCp(ev) : 0));

  // Cómo se muestra cada jugada tuya: "Teoría" si lo es y no es mala; si no, su nota.
  const tagOf = (i: number) => {
    const j = judged[i];
    if (!j) return null;
    const bad = ['imprecision', 'error', 'grave'].includes(j.cls);
    if (line.inBook[i] && !bad) return { icon: 'T', color: BOOK_COLOR, label: 'Teoría' };
    const info = CLASS_INFO[j.cls];
    return { icon: info.icon, color: info.color, label: line.inBook[i] ? `${info.label} (es teoría, pero dudosa)` : info.label };
  };
  const lastTag = lastUser !== undefined ? tagOf(lastUser) : null;

  // Al salir de la teoría: qué se solía jugar ahí.
  const exitPly = line.bookPlies < moves.length ? line.bookPlies : null;
  const exitTheory = exitPly !== null && book ? bookMoves(book, line.fens[exitPly]).slice(0, 3).map((m) => sanOf(line.fens[exitPly], m.uci)) : [];
  const exitByMe = exitPly !== null && (exitPly % 2 === 0 ? 'w' : 'b') === color;

  return (
    <div className="page play-page">
      <div className="board-col">
        <div className="board-with-eval">
          {(setup.showEval || status === 'over') && <EvalBar ev={ev} orientation={orientation} />}
          <Board
            position={fen}
            orientation={orientation}
            movable={myTurn ? color : null}
            onMove={(m) => {
              if (!myTurn) return false;
              try {
                new Chess(fen).move(m);
              } catch {
                return false;
              }
              onMove(m);
              return true;
            }}
            lastMove={lastPly >= 0 ? [moves[lastPly].slice(0, 2), moves[lastPly].slice(2, 4)] : null}
            arrows={showTheory ? (theory.map((m, i) => [m.uci.slice(0, 2), m.uci.slice(2, 4), i === 0 ? 'rgba(214,162,74,.9)' : 'rgba(214,162,74,.45)']) as never) : undefined}
            badge={lastTag && lastUser !== undefined && lastUser >= lastPly - 1 ? { square: moves[lastUser].slice(2, 4), content: lastTag.icon, color: lastTag.color } : null}
          />
        </div>
      </div>
      <aside className="side-panel">
        <div className="card">
          <div className="row-between">
            <h2 className="panel-title">Aperturas</h2>
            <button
              className="btn ghost small"
              onClick={() => {
                runId.current++;
                setStatus('setup');
              }}
            >
              Salir
            </button>
          </div>
          <p className="opening-name">{line.name ? line.name.name : 'Posición inicial'}</p>
          <p className="muted small">
            {line.name?.eco ? `${line.name.eco} · ` : ''}
            {outOfBookNow
              ? `Fuera de teoría desde ${moveNumber(line.bookPlies)} ${line.sans[line.bookPlies]}`
              : onTarget
                ? 'En teoría, siguiendo la línea elegida'
                : 'En teoría'}
          </p>

          <div className="live-box">
            <div>
              <span className="label">En teoría</span>
              <span className="live-acc">{Math.ceil(line.bookPlies / 2)}</span>
            </div>
            <div>
              <span className="label">Precisión fuera</span>
              <span className="live-acc">{accuracy === null ? '–' : accuracy.toFixed(0)}</span>
            </div>
            {lastTag && lastUser !== undefined && (
              <div className="live-last" key={lastUser}>
                <span className="cls-dot" style={{ background: lastTag.color }}>
                  {lastTag.icon}
                </span>
                {line.sans[lastUser]} · {lastTag.label}
              </div>
            )}
          </div>

          {exitPly !== null && exitTheory.length > 0 && (
            <p className="lesson-msg pop-in" key={exitPly}>
              {exitByMe ? 'Te has salido de la teoría' : 'El rival se ha salido de la teoría'} con {line.sans[exitPly]}. Lo habitual era {exitTheory.join(', ')}.
            </p>
          )}

          {myTurn && theory.length > 0 && (
            <div className="theory-box">
              <button className="btn ghost small" onClick={() => setShowTheory(!showTheory)}>
                {showTheory ? 'Ocultar teoría' : 'Ver jugadas de teoría'}
              </button>
              {showTheory && (
                <div className="theory-list">
                  {theory.map((m) => (
                    <button key={m.uci} className="chip" onClick={() => onMove({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] })}>
                      {sanOf(fen, m.uci)} <span className="muted small">{Math.round(m.share * 100)} %</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="opening-moves">
            {line.sans.map((san, i) => {
              const tag = (i % 2 === 0 ? 'w' : 'b') === color ? tagOf(i) : null;
              return (
                <span key={i} className={`opening-move ${line.inBook[i] ? 'book' : ''}`}>
                  {i % 2 === 0 && <span className="mv-num">{i / 2 + 1}.</span>}
                  {tag && (
                    <span className="cls-dot tiny" style={{ background: tag.color }}>
                      {tag.icon}
                    </span>
                  )}
                  {san}
                </span>
              );
            })}
          </div>

          {status === 'over' && (
            <div className="pop-in">
              <h3>Resumen</h3>
              <p>
                {line.name ? line.name.name : 'Apertura sin nombre'}. Aguantaste {Math.ceil(line.bookPlies / 2)} jugadas en teoría
                {accuracy !== null ? ` y fuera de ella jugaste con ${accuracy.toFixed(0)} de precisión` : ''}. Terminas en {formatCp(userMine)}.
              </p>
            </div>
          )}

          <div className="btn-row">
            {status !== 'over' && (
              <button className="btn" onClick={undo} disabled={status === 'thinking' || !userPlies.length}>
                Deshacer
              </button>
            )}
            {status !== 'over' && moves.length > 1 && (
              <button
                className="btn ghost"
                onClick={() => {
                  runId.current++;
                  finish(moves, judged, color, ev);
                }}
                disabled={status === 'thinking'}
              >
                Terminar
              </button>
            )}
            {status === 'over' && (
              <>
                <button className="btn primary" onClick={start}>
                  Otra vez
                </button>
                <button className="btn" onClick={undo}>
                  Deshacer y seguir
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
