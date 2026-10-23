import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board from '../components/Board';
import EvalBar from '../components/EvalBar';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import AnimatedNumber from '../components/AnimatedNumber';
import { Engine } from '../lib/engine';
import { analyzeGame, CLASS_INFO, formatEval, type Classification, type GameAnalysis } from '../lib/analysis';
import { fetchArchives, fetchMonth, monthLabel, resultFor, type ChessComGame } from '../lib/chesscom';
import { takePendingPgn } from '../lib/nav';
import { load, save } from '../lib/storage';
import { playMoveSound } from '../lib/sound';
import type { SavedGame } from './Play';

type Source = 'chesscom' | 'bots' | 'pgn';

const SUMMARY_ORDER: Classification[] = ['brillante', 'gran', 'mejor', 'excelente', 'buena', 'imprecision', 'error', 'grave'];

function header(pgn: string, key: string) {
  return new RegExp(`\\[${key} "([^"]*)"\\]`).exec(pgn)?.[1] ?? '';
}

export default function Analysis() {
  const [source, setSource] = useState<Source>('chesscom');
  const [username, setUsername] = useState(() => load('chesscomUser', ''));
  const [archives, setArchives] = useState<string[]>([]);
  const [archive, setArchive] = useState('');
  const [games, setGames] = useState<ChessComGame[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState('');
  const [pgnText, setPgnText] = useState('');

  const [pgn, setPgn] = useState<string | null>(null);
  const [depth, setDepth] = useState(() => load('analysisDepth', 16));
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [ply, setPly] = useState(0);
  const [flip, setFlip] = useState(false);

  const engineRef = useRef<Engine | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    engineRef.current = new Engine();
    const pending = takePendingPgn();
    if (pending) startAnalysis(pending);
    return () => {
      runId.current++;
      engineRef.current?.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchUser(e?: React.FormEvent) {
    e?.preventDefault();
    if (!username.trim()) return;
    setError('');
    setLoadingList(true);
    try {
      const a = await fetchArchives(username);
      save('chesscomUser', username.trim());
      setArchives(a);
      if (a.length) await pickArchive(a[0]);
      else setError('Este usuario no tiene partidas públicas.');
    } catch (err) {
      setError(err instanceof Error && err.message !== 'Failed to fetch' ? err.message : 'No se pudo conectar con chess.com. Puedes pegar el PGN abajo.');
    } finally {
      setLoadingList(false);
    }
  }

  async function pickArchive(a: string) {
    setArchive(a);
    setLoadingList(true);
    try {
      setGames(await fetchMonth(a));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingList(false);
    }
  }

  async function startAnalysis(p: string, d = depth) {
    const id = ++runId.current;
    try {
      new Chess().loadPgn(p);
    } catch {
      setError('El PGN no es válido.');
      return;
    }
    setError('');
    setPgn(p);
    setAnalysis(null);
    setPly(0);
    const me = username.trim().toLowerCase();
    setFlip(header(p, 'Black').toLowerCase() === me || header(p, 'Black') === 'Tú');
    setProgress([0, 1]);
    const res = await analyzeGame(engineRef.current!, p, d, (a, b) => id === runId.current && setProgress([a, b]), () => id !== runId.current);
    if (id !== runId.current || !res) return;
    setProgress(null);
    setAnalysis(res);
  }

  const total = analysis?.moves.length ?? 0;
  const go = (p: number) => {
    const np = Math.max(0, Math.min(total, p));
    if (np === ply + 1 && analysis) playMoveSound(analysis.moves[np - 1].move.san);
    setPly(np);
  };

  useEffect(() => {
    if (!analysis) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') go(ply + 1);
      if (e.key === 'ArrowLeft') go(ply - 1);
      if (e.key === 'ArrowUp') go(0);
      if (e.key === 'ArrowDown') go(total);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const summary = useMemo(() => {
    const s = { w: {} as Record<Classification, number>, b: {} as Record<Classification, number> };
    for (const m of analysis?.moves ?? []) s[m.color][m.cls] = (s[m.color][m.cls] ?? 0) + 1;
    return s;
  }, [analysis]);

  const savedGames = load<SavedGame[]>('games', []);

  // --- Vista de análisis ---
  if (pgn) {
    const current = analysis && ply > 0 ? analysis.moves[ply - 1] : null;
    const fen = analysis ? (ply === 0 ? analysis.moves[0]?.fenBefore ?? new Chess().fen() : current!.fenAfter) : new Chess().fen();
    const ev = analysis ? analysis.evals[ply] : null;
    const bestHere = analysis?.evals[ply]?.best;
    const arrows: [string, string, string][] = [];
    if (current && current.cls !== 'mejor' && current.cls !== 'gran' && current.cls !== 'brillante' && current.evalBefore.best) {
      const b = current.evalBefore.best;
      arrows.push([b.slice(0, 2), b.slice(2, 4), 'rgba(129,182,76,.85)']);
    }
    const white = header(pgn, 'White') || 'Blancas';
    const black = header(pgn, 'Black') || 'Negras';
    const orientation = flip ? 'black' : 'white';

    return (
      <div className="page analysis-page">
        <div className="board-col">
          <div className="player-bar small">
            <span>
              {flip ? '♔' : '♚'} {flip ? white : black} {header(pgn, flip ? 'WhiteElo' : 'BlackElo') && `(${header(pgn, flip ? 'WhiteElo' : 'BlackElo')})`}
            </span>
          </div>
          <div className="board-with-eval">
            <EvalBar ev={ev} orientation={orientation} />
            <Board
              position={fen}
              orientation={orientation}
              lastMove={current ? [current.move.from, current.move.to] : null}
              arrows={arrows as never}
              badge={current ? { square: current.move.to, content: CLASS_INFO[current.cls].icon, color: CLASS_INFO[current.cls].color } : null}
            />
          </div>
          <div className="player-bar small">
            <span>
              {flip ? '♚' : '♔'} {flip ? black : white} {header(pgn, flip ? 'BlackElo' : 'WhiteElo') && `(${header(pgn, flip ? 'BlackElo' : 'WhiteElo')})`}
            </span>
          </div>
          <div className="btn-row center nav-buttons">
            <button className="btn" onClick={() => go(0)}>⏮</button>
            <button className="btn" onClick={() => go(ply - 1)}>◀</button>
            <button className="btn" onClick={() => go(ply + 1)}>▶</button>
            <button className="btn" onClick={() => go(total)}>⏭</button>
            <button className="btn ghost" onClick={() => setFlip(!flip)}>⇅</button>
          </div>
        </div>

        <aside className="side-panel">
          <div className="card">
            <div className="row-between">
              <h2>Revisión de la partida</h2>
              <button
                className="btn ghost small"
                onClick={() => {
                  runId.current++;
                  setPgn(null);
                  setAnalysis(null);
                  setProgress(null);
                }}
              >
                ← Volver
              </button>
            </div>

            {progress && (
              <div className="progress-box">
                <div className="spinner-knight">♞</div>
                <p>
                  Analizando con Stockfish 17.1… {progress[0]}/{progress[1]} posiciones
                </p>
                <div className="progress">
                  <div style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
                </div>
              </div>
            )}

            {analysis && (
              <div className="fade-in">
                <div className="accuracy-row">
                  {(['w', 'b'] as const).map((c) => (
                    <div key={c} className={`accuracy ${c}`}>
                      <span className="muted small">{c === 'w' ? white : black}</span>
                      <span className="acc-num">
                        <AnimatedNumber from={0} to={analysis.accuracy[c]} decimals={1} />
                      </span>
                      <span className="muted small">precisión</span>
                    </div>
                  ))}
                </div>

                <EvalGraph analysis={analysis} ply={ply} onSelect={go} />

                {current ? (
                  <div className="move-verdict pop-in" key={ply} style={{ borderColor: CLASS_INFO[current.cls].color }}>
                    <span className="verdict-icon" style={{ background: CLASS_INFO[current.cls].color }}>
                      {CLASS_INFO[current.cls].icon}
                    </span>
                    <div>
                      <strong>
                        {current.move.san} es {CLASS_INFO[current.cls].label.toLowerCase()}
                      </strong>
                      <span className="eval-chip">{formatEval(current.evalAfter)}</span>
                      {current.evalBefore.best && current.cls !== 'mejor' && current.cls !== 'gran' && current.cls !== 'brillante' && (
                        <p className="muted small">
                          Lo mejor era <strong>{sanOf(current.fenBefore, current.evalBefore.best)}</strong> ({formatEval(current.evalBefore)})
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="move-verdict">
                    <div>
                      <strong>Posición inicial</strong>
                      {bestHere && <p className="muted small">Usa ◀ ▶ o las flechas del teclado para recorrer la partida.</p>}
                    </div>
                  </div>
                )}

                <table className="summary-table">
                  <tbody>
                    {SUMMARY_ORDER.map((k) => (
                      <tr key={k}>
                        <td className="num">{summary.w[k] ?? 0}</td>
                        <td>
                          <span className="cls-dot" style={{ background: CLASS_INFO[k].color }}>
                            {CLASS_INFO[k].icon}
                          </span>
                          {CLASS_INFO[k].label}
                        </td>
                        <td className="num">{summary.b[k] ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <MoveList
                  sans={analysis.moves.map((m) => m.move.san)}
                  current={ply - 1}
                  onSelect={(i) => go(i + 1)}
                  decorate={(i) => {
                    const c = analysis.moves[i].cls;
                    return ['brillante', 'gran', 'imprecision', 'error', 'grave'].includes(c) ? (
                      <span className="cls-dot tiny" style={{ background: CLASS_INFO[c].color }}>
                        {CLASS_INFO[c].icon}
                      </span>
                    ) : null;
                  }}
                />
              </div>
            )}
          </div>
        </aside>
      </div>
    );
  }

  // --- Selección de partida ---
  return (
    <div className="page narrow">
      <h1 className="page-title">Analizar partidas</h1>
      <div className="tabs">
        <button className={source === 'chesscom' ? 'on' : ''} onClick={() => setSource('chesscom')}>
          chess.com
        </button>
        <button className={source === 'bots' ? 'on' : ''} onClick={() => setSource('bots')}>
          Mis partidas aquí
        </button>
        <button className={source === 'pgn' ? 'on' : ''} onClick={() => setSource('pgn')}>
          Pegar PGN
        </button>
      </div>

      <div className="card">
        <div className="row-between">
          <label className="field-label">Profundidad del análisis</label>
          <div className="chip-row">
            {[
              [12, 'Rápido'],
              [16, 'Normal'],
              [20, 'Profundo'],
            ].map(([d, l]) => (
              <button
                key={d}
                className={`chip ${depth === d ? 'on' : ''}`}
                onClick={() => {
                  setDepth(d as number);
                  save('analysisDepth', d);
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="error-box">{error}</p>}

      {source === 'chesscom' && (
        <div className="card fade-in">
          <form className="search-row" onSubmit={searchUser}>
            <input placeholder="Tu usuario de chess.com" value={username} onChange={(e) => setUsername(e.target.value)} />
            <button className="btn primary" disabled={loadingList}>
              {loadingList ? 'Cargando…' : 'Buscar'}
            </button>
          </form>
          {archives.length > 0 && (
            <select className="month-select" value={archive} onChange={(e) => pickArchive(e.target.value)}>
              {archives.map((a) => (
                <option key={a} value={a}>
                  {monthLabel(a)}
                </option>
              ))}
            </select>
          )}
          <div className="game-list">
            {games.map((g, i) => {
              const r = resultFor(g, username);
              const meWhite = g.white.username.toLowerCase() === username.trim().toLowerCase();
              const opp = meWhite ? g.black : g.white;
              const me = meWhite ? g.white : g.black;
              return (
                <button key={g.url} className="game-item" style={{ animationDelay: `${Math.min(i, 15) * 30}ms` }} onClick={() => startAnalysis(g.pgn)}>
                  <span className={`result-pill ${r}`}>{r === 'win' ? 'V' : r === 'loss' ? 'D' : 'T'}</span>
                  <span className="game-main">
                    <strong>
                      {meWhite ? '♔' : '♚'} vs {opp.username} ({opp.rating})
                    </strong>
                    <span className="muted small">
                      {g.time_class} · {new Date(g.end_time * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · tu Elo {me.rating}
                    </span>
                  </span>
                  <span className="go">Analizar →</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {source === 'bots' && (
        <div className="card fade-in">
          {savedGames.length === 0 && <p className="muted">Todavía no has jugado contra los bots.</p>}
          <div className="game-list">
            {savedGames.map((g, i) => {
              const userWon = (g.result === '1-0' && g.color === 'w') || (g.result === '0-1' && g.color === 'b');
              const r = g.result === '1/2-1/2' ? 'draw' : userWon ? 'win' : 'loss';
              return (
                <button key={g.date} className="game-item" style={{ animationDelay: `${Math.min(i, 15) * 30}ms` }} onClick={() => startAnalysis(g.pgn)}>
                  <span className={`result-pill ${r}`}>{r === 'win' ? 'V' : r === 'loss' ? 'D' : 'T'}</span>
                  <span className="game-main">
                    <strong>
                      {g.color === 'w' ? '♔' : '♚'} vs bot {g.botElo}
                    </strong>
                    <span className="muted small">
                      {g.tc} · {new Date(g.date).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                  <span className="go">Analizar →</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {source === 'pgn' && (
        <div className="card fade-in">
          <textarea className="pgn-input" rows={9} placeholder="Pega aquí el PGN de la partida (en chess.com: Compartir → PGN)" value={pgnText} onChange={(e) => setPgnText(e.target.value)} />
          <button className="btn primary" onClick={() => startAnalysis(pgnText)} disabled={!pgnText.trim()}>
            Analizar
          </button>
        </div>
      )}
    </div>
  );
}

function sanOf(fen: string, uci: string) {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}
