import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board, { type MoveInput } from '../components/Board';
import EvalBar from '../components/EvalBar';
import { Engine } from '../lib/engine';
import { CLASS_INFO, evalToCp, judgeMove, playerAccuracy, type Classification, type PositionEval } from '../lib/analysis';
import { guideFor, repliesFor, type Guide, type Reply } from '../lib/guide';
import { bookMoves, bookName, loadBook, loadSessions, pickBookMove, saveSession, type Book } from '../lib/openings';
import { playMoveSound } from '../lib/sound';
import { load, save } from '../lib/storage';
import { formatCp } from '../lib/trainer';

// Jugadas tuyas fuera de teoría antes de cerrar la sesión con el resumen.
const MOVES_AFTER_BOOK = 8;
const BEST_ARROW = 'rgba(214,162,74,.9)';
const THREAT_ARROW = 'rgba(212,96,74,.85)';
const TOP_ARROWS = ['rgba(134,171,85,.9)', 'rgba(214,162,74,.8)', 'rgba(214,162,74,.45)'];

type Status = 'setup' | 'user' | 'busy' | 'over';
type Setup = { color: 'w' | 'b' | 'random'; line: number; hideHint: boolean; showEval: boolean; top3?: boolean };
type Played = { ply: number; san: string; matched: boolean; cls: Classification; accuracy: number };
type Feedback = { text: string; tone: 'good' | 'ok' | 'bad' };

const uciMove = (chess: Chess, u: string) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
const GOOD: Classification[] = ['brillante', 'gran', 'mejor', 'excelente', 'buena'];
const pct = (share: number | null) => (share === null ? null : `${Math.max(1, Math.round(share * 100))} %`);

export default function OpeningGuide() {
  const [book, setBook] = useState<Book | null>(null);
  const [setup, setSetup] = useState<Setup>(() => load('guideSetup', { color: 'w', line: -1, hideHint: false, showEval: false }));
  const [status, setStatus] = useState<Status>('setup');
  const [color, setColor] = useState<'w' | 'b'>('w');
  const [moves, setMoves] = useState<string[]>([]);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [replies, setReplies] = useState<{ after: string; san: string; list: Reply[]; chosen: string | null } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [played, setPlayed] = useState<Played[]>([]);
  const [ev, setEv] = useState<PositionEval | null>(null);
  const [peek, setPeek] = useState(false);
  const [sessions, setSessions] = useState(loadSessions);

  const engineRef = useRef<Engine | null>(null);
  const guides = useRef(new Map<string, Promise<Guide>>());
  const runId = useRef(0);
  const target = useRef<string[] | null>(null);

  useEffect(() => {
    loadBook().then(setBook);
    return () => engineRef.current?.terminate();
  }, []);
  useEffect(() => save('guideSetup', setup), [setup]);

  const engine = () => (engineRef.current ??= new Engine());
  const guideOf = useCallback(
    (fen: string) => {
      let g = guides.current.get(fen);
      if (!g) {
        g = guideFor(engine(), book, fen);
        guides.current.set(fen, g);
      }
      return g;
    },
    [book],
  );

  const line = useMemo(() => {
    const chess = new Chess();
    const sans: string[] = [];
    const inBook: boolean[] = [];
    let name: { name: string; eco: string } | null = null;
    for (const u of moves) {
      inBook.push(!!book && bookMoves(book, chess.fen()).some((m) => m.uci === u));
      sans.push(uciMove(chess, u).san);
      if (book) name = bookName(book, chess.fen()) ?? name;
    }
    const firstOut = inBook.indexOf(false);
    return { fen: chess.fen(), chess, sans, name, bookPlies: firstOut === -1 ? moves.length : firstOut };
  }, [moves, book]);

  const finish = useCallback(
    (list: Played[], name: string, bookPlies: number, lastEval: PositionEval | null, c: 'w' | 'b') => {
      setStatus('over');
      saveSession({
        date: Date.now(),
        name,
        color: c,
        bookPlies,
        accuracy: list.length ? playerAccuracy(list.map((p) => p.accuracy)) : null,
        errors: list.filter((p) => p.cls === 'error' || p.cls === 'grave').length,
        finalEval: lastEval ? Math.max(-2000, Math.min(2000, (c === 'w' ? 1 : -1) * evalToCp(lastEval))) : 0,
      });
      setSessions(loadSessions());
    },
    [],
  );

  // Prepara tu turno: la guía de la posición (mejor jugada, alternativas y amenaza).
  const userTurn = useCallback(
    async (fen: string) => {
      const id = runId.current;
      setStatus('busy');
      const g = await guideOf(fen);
      if (id !== runId.current) return;
      setGuide(g);
      setEv(g.eval);
      setPeek(false);
      setStatus('user');
    },
    [guideOf],
  );

  // Jugada del rival: la línea elegida, si no la teoría (variando), y fuera de teoría la mejor defensa.
  const opponentMove = useCallback(
    (playedMoves: string[], fen: string, best: string | null) => {
      const t = target.current;
      if (t && playedMoves.length < t.length && playedMoves.every((u, i) => u === t[i])) return t[playedMoves.length];
      if (book && bookMoves(book, fen).length) return pickBookMove(book, fen);
      return best;
    },
    [book],
  );

  async function playOpponent(playedMoves: string[], best: string | null, delay: number) {
    const id = runId.current;
    const chess = new Chess();
    for (const u of playedMoves) uciMove(chess, u);
    const u = opponentMove(playedMoves, chess.fen(), best);
    if (!u) return;
    setReplies((r) => (r ? { ...r, chosen: u } : r));
    await new Promise((r) => setTimeout(r, delay));
    if (id !== runId.current) return;
    const mv = uciMove(chess, u);
    playMoveSound(mv.san);
    setMoves([...playedMoves, u]);
    if (chess.isGameOver()) return setStatus('over');
    userTurn(chess.fen());
  }

  function start() {
    const c = setup.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : setup.color;
    runId.current++;
    target.current = setup.line >= 0 && book ? book.mains[setup.line][1].split(' ') : null;
    setColor(c);
    setMoves([]);
    setPlayed([]);
    setGuide(null);
    setReplies(null);
    setFeedback(null);
    setEv(null);
    if (c === 'b') {
      setStatus('busy');
      playOpponent([], null, 400);
    } else userTurn(new Chess().fen());
  }

  async function onMove(m: MoveInput) {
    if (status !== 'user' || !guide) return;
    const id = runId.current;
    const chess = new Chess(line.fen);
    const mv = chess.move(m);
    const u = mv.from + mv.to + (mv.promotion ?? '');
    const playedMoves = [...moves, u];
    setMoves(playedMoves);
    playMoveSound(mv.san);
    setStatus('busy');
    setFeedback(null);
    const g = guide;
    const after = chess.fen();
    setReplies({ after, san: mv.san, list: [], chosen: null });
    const res = chess.isGameOver()
      ? null
      : await repliesFor(engine(), book, after, (list) => id === runId.current && setReplies({ after, san: mv.san, list, chosen: null }));
    if (id !== runId.current) return;

    // Nota de tu jugada y comparación con la recomendada.
    const afterEval: PositionEval = res?.ev ?? { cp: chess.isCheckmate() ? (mv.color === 'w' ? 10000 : -10000) : 0, mate: chess.isCheckmate() ? 0 : null, best: null, second: null, pv: [], goodMoves: 0 };
    const r = judgeMove(mv, g.eval, afterEval);
    const matched = u === g.best.uci;
    const list = [...played, { ply: playedMoves.length - 1, san: mv.san, matched, cls: r.cls, accuracy: r.accuracy }];
    setPlayed(list);
    setEv(afterEval);
    if (matched) setFeedback({ tone: 'good', text: `Bien: ${mv.san} era la recomendada.` });
    else if (GOOD.includes(r.cls)) setFeedback({ tone: 'ok', text: `${mv.san} también vale (${CLASS_INFO[r.cls].label.toLowerCase()}). La recomendada era ${g.best.san}: ${g.best.reason}` });
    else setFeedback({ tone: 'bad', text: `${mv.san}: ${CLASS_INFO[r.cls].label.toLowerCase()}. Lo mejor era ${g.best.san}: ${g.best.reason}` });

    // ¿Se acaba? Mate, tablas o demasiadas jugadas fuera de teoría.
    const inBookNow = line.bookPlies === moves.length && !!book && bookMoves(book, line.fen).some((x) => x.uci === u);
    const bookPlies = inBookNow ? playedMoves.length : line.bookPlies;
    const outOfBook = list.filter((p) => p.ply >= bookPlies).length;
    if (chess.isGameOver() || outOfBook >= MOVES_AFTER_BOOK) {
      let name = 'Apertura sin nombre';
      const c2 = new Chess();
      for (const x of playedMoves) {
        uciMove(c2, x);
        name = (book && bookName(book, c2.fen())?.name) || name;
      }
      return finish(list, name, bookPlies, afterEval, color);
    }
    playOpponent(playedMoves, res?.replies[0]?.uci ?? null, 1600);
  }

  function undo() {
    runId.current++;
    const m = [...moves];
    while (m.length) {
      const mine = ((m.length - 1) % 2 === 0 ? 'w' : 'b') === color;
      m.pop();
      if (mine) break;
    }
    const chess = new Chess();
    for (const u of m) uciMove(chess, u);
    setMoves(m);
    setPlayed((p) => p.filter((x) => x.ply < m.length));
    setReplies(null);
    setFeedback(null);
    userTurn(chess.fen());
  }

  if (status === 'setup') {
    return (
      <div className="page narrow">
        <header className="page-head">
          <h1 className="page-title">Aperturas guiadas</h1>
        </header>
        <p className="muted">
          Juegas desde la primera jugada y en cada momento te digo la mejor jugada y por qué. Si el rival amenaza algo, te enseño cómo defenderte. Después de
          cada jugada tuya verás qué puede contestar el rival y con qué responder a cada cosa. El rival juega teoría variada, así que cada partida recorre
          ramas distintas.
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
            <button className={`chip ${setup.hideHint ? 'on' : ''}`} onClick={() => setSetup({ ...setup, hideHint: !setup.hideHint })}>
              Ponerme a prueba (la pista sale después de jugar)
            </button>
            <button className={`chip ${setup.showEval ? 'on' : ''}`} onClick={() => setSetup({ ...setup, showEval: !setup.showEval })}>
              Mostrar evaluación
            </button>
            <button className={`chip ${setup.top3 ? 'on' : ''}`} onClick={() => setSetup({ ...setup, top3: !setup.top3 })}>
              Ver las 3 mejores jugadas
            </button>
          </div>
        </div>
        <button className="btn primary big" onClick={start} disabled={!book}>
          {book ? 'Empezar' : 'Cargando teoría…'}
        </button>
        {sessions.length > 0 && (
          <p className="muted small">
            Llevas {sessions.length} {sessions.length === 1 ? 'sesión' : 'sesiones'} de aperturas. El historial está en la pestaña Práctica libre.
          </p>
        )}
      </div>
    );
  }

  const orientation = color === 'w' ? 'white' : 'black';
  const myTurn = status === 'user' && !!guide && guide.fen === line.fen;
  const showHint = myTurn && (!setup.hideHint || peek);
  const lastPly = moves.length - 1;
  // Las tres mejores según el motor, con lo que pierde cada una frente a la primera.
  const top3 = guide ? [...guide.candidates].sort((a, b) => b.cp - a.cp).slice(0, 3) : [];
  const showTop3 = showHint && !!setup.top3;
  const arrows: [string, string, string][] = [];
  if (showTop3) top3.forEach((c, i) => arrows.push([c.uci.slice(0, 2), c.uci.slice(2, 4), TOP_ARROWS[i]]));
  else if (showHint && guide) arrows.push([guide.best.uci.slice(0, 2), guide.best.uci.slice(2, 4), BEST_ARROW]);
  if (myTurn && guide?.threat) arrows.push([guide.threat.uci.slice(0, 2), guide.threat.uci.slice(2, 4), THREAT_ARROW]);
  const matchedCount = played.filter((p) => p.matched).length;
  const lastPlayed = played[played.length - 1];

  return (
    <div className="page play-page">
      <div className="board-col">
        <div className="board-with-eval">
          {(setup.showEval || status === 'over') && <EvalBar ev={ev} orientation={orientation} />}
          <Board
            position={line.fen}
            orientation={orientation}
            movable={myTurn ? color : null}
            onMove={(m) => {
              if (!myTurn) return false;
              try {
                new Chess(line.fen).move(m);
              } catch {
                return false;
              }
              onMove(m);
              return true;
            }}
            lastMove={lastPly >= 0 ? [moves[lastPly].slice(0, 2), moves[lastPly].slice(2, 4)] : null}
            arrows={arrows as never}
            badge={
              lastPlayed && lastPlayed.ply >= lastPly - 1
                ? lastPlayed.matched
                  ? { square: moves[lastPlayed.ply].slice(2, 4), content: '✓', color: '#86ab55' }
                  : { square: moves[lastPlayed.ply].slice(2, 4), content: CLASS_INFO[lastPlayed.cls].icon, color: CLASS_INFO[lastPlayed.cls].color }
                : null
            }
          />
        </div>
      </div>
      <aside className="side-panel">
        <div className="card">
          <div className="row-between">
            <h2 className="panel-title">Guía</h2>
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
            {line.bookPlies < moves.length ? `Fuera de teoría desde la jugada ${Math.floor(line.bookPlies / 2) + 1}` : 'En teoría'}
            {played.length > 0 && ` · ${matchedCount} de ${played.length} recomendadas`}
          </p>

          {feedback && (
            <p className={`guide-feedback ${feedback.tone} pop-in`} key={feedback.text}>
              {feedback.text}
            </p>
          )}

          {myTurn && guide?.threat && (
            <div className="guide-threat pop-in">
              <span className="label">Amenaza del rival</span>
              <p>
                {guide.threat.san.endsWith('#') ? (
                  <>
                    Si no haces nada, el rival te da mate con <strong>{guide.threat.san}</strong>.
                  </>
                ) : (
                  <>
                    Si no haces nada, el rival juega <strong>{guide.threat.san}</strong>
                    {guide.threat.gain >= 900 ? ' y gana mucho material' : ` y gana unos ${formatCp(guide.threat.gain).replace('+', '')} peones`}.
                  </>
                )}{' '}
                Toca defenderse.
              </p>
            </div>
          )}

          {myTurn && guide && (
            <div className="guide-box">
              <span className="label">Te toca</span>
              {showHint ? (
                <>
                  <p className="guide-best">
                    <strong>{guide.best.san}</strong> <span className="muted small">{formatCp(guide.best.cp)}</span>
                    {guide.best.share !== null && <span className="guide-tag">teoría {pct(guide.best.share)}</span>}
                  </p>
                  <p className="small">{guide.best.reason}</p>
                  {showTop3 && (
                    <table className="data-table top3">
                      <thead>
                        <tr>
                          <th>Jugada</th>
                          <th className="num">Evaluación</th>
                          <th className="num">Frente a la mejor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {top3.map((c, i) => (
                          <tr key={c.uci} onClick={() => onMove({ from: c.uci.slice(0, 2), to: c.uci.slice(2, 4), promotion: c.uci[4] })}>
                            <td>
                              <span className="top3-dot" style={{ background: TOP_ARROWS[i] }} />
                              <strong>{c.san}</strong>
                              {c.share !== null && <span className="muted small nowrap"> · teoría {pct(c.share)}</span>}
                            </td>
                            <td className="num">{formatCp(c.cp)}</td>
                            <td className={`num ${i === 0 ? 'good' : c.cp - top3[0].cp <= -50 ? 'bad' : ''}`}>{i === 0 ? 'la mejor' : `${c.cp - top3[0].cp} cp`.replace('-', '−')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {!showTop3 && guide.candidates.filter((c) => c.uci !== guide.best.uci).length > 0 && (
                    <div className="guide-alts">
                      {guide.candidates
                        .filter((c) => c.uci !== guide.best.uci)
                        .slice(0, 3)
                        .map((c) => (
                          <button key={c.uci} className="chip" onClick={() => onMove({ from: c.uci.slice(0, 2), to: c.uci.slice(2, 4), promotion: c.uci[4] })} title={c.reason}>
                            {c.san} <span className="muted small">{formatCp(c.cp)}</span>
                            {c.share !== null && <span className="muted small"> · {pct(c.share)}</span>}
                          </button>
                        ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="small">Piensa tu jugada. Cuando muevas te diré si era la mejor.</p>
                  <button className="btn ghost small" onClick={() => setPeek(true)}>
                    Ver pista
                  </button>
                </>
              )}
            </div>
          )}
          {status === 'busy' && !replies && <p className="muted small">Pensando…</p>}

          {replies && (
            <div className="guide-tree">
              <span className="label">Si el rival responde a tu {replies.san}…</span>
              {!replies.list.length && <p className="muted small">Analizando sus respuestas…</p>}
              <ul>
                {replies.list.map((r, i) => (
                  <li key={r.uci} className={replies.chosen === r.uci ? 'chosen' : ''}>
                    <span className="guide-reply">
                      <strong>{r.san}</strong>
                      {i === 0 && <span className="guide-tag">su mejor defensa</span>}
                      {r.share !== null && <span className="guide-tag">teoría {pct(r.share)}</span>}
                    </span>
                    <span className="guide-answer">
                      {r.answer ? (
                        <>
                          tú: <strong>{r.answer.san}</strong> · {r.answer.reason}
                        </>
                      ) : (
                        <span className="muted">calculando…</span>
                      )}
                    </span>
                    {replies.chosen === r.uci && <span className="guide-chosen">Ha jugado esta</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="opening-moves">
            {line.sans.map((san, i) => {
              const p = played.find((x) => x.ply === i);
              return (
                <span key={i} className="opening-move">
                  {i % 2 === 0 && <span className="mv-num">{i / 2 + 1}.</span>}
                  {p && (
                    <span className="cls-dot tiny" style={{ background: p.matched ? '#86ab55' : CLASS_INFO[p.cls].color }}>
                      {p.matched ? '✓' : CLASS_INFO[p.cls].icon}
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
                Has encontrado la jugada recomendada en {matchedCount} de {played.length} jugadas
                {played.length ? `, con ${playerAccuracy(played.map((p) => p.accuracy)).toFixed(0)} de precisión` : ''}.
              </p>
            </div>
          )}

          <div className="btn-row">
            {status !== 'over' ? (
              <>
                <button className={`btn ${setup.top3 ? 'primary' : 'ghost'}`} onClick={() => setSetup({ ...setup, top3: !setup.top3 })}>
                  3 mejores
                </button>
                <button className="btn" onClick={undo} disabled={status === 'busy' || !played.length}>
                  Deshacer
                </button>
                <button
                  className="btn ghost"
                  disabled={status === 'busy' || !played.length}
                  onClick={() => {
                    runId.current++;
                    finish(played, line.name?.name ?? 'Apertura sin nombre', line.bookPlies, ev, color);
                  }}
                >
                  Terminar
                </button>
              </>
            ) : (
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
