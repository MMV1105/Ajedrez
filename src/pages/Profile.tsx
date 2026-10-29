import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Engine } from '../lib/engine';
import { analyzeGame } from '../lib/analysis';
import { loadBook } from '../lib/openings';
import { fetchArchives, fetchMonth, resultFor } from '../lib/chesscom';
import { buildProfile, summarizeGame, type GameSummary, type Profile as ProfileData } from '../lib/profile';
import { navigate } from '../lib/nav';
import { load, save } from '../lib/storage';
import type { SavedGame } from './Play';

type Pending = { id: string; pgn: string; date: number; color: 'w' | 'b'; result: GameSummary['result']; timeClass: string };

const CLASSES = [
  ['all', 'Todas'],
  ['bullet', 'Bullet'],
  ['blitz', 'Blitz'],
  ['rapid', 'Rápidas'],
] as const;

const DEPTH = 12;
const DEPTH_SERVER = 16; // con el Stockfish completo del servidor se puede ir más hondo
// Sube la versión cuando cambie la forma de puntuar, para no mezclar notas viejas y nuevas.
const SUMMARIES_KEY = 'summaries7';

export default function Profile() {
  const [source, setSource] = useState<'chesscom' | 'local'>('chesscom');
  const [username, setUsername] = useState(() => load('chesscomUser', ''));
  const [count, setCount] = useState(20);
  const [timeClass, setTimeClass] = useState<string>('all');
  const [progress, setProgress] = useState<{ game: number; total: number; pos: number } | null>(null);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<ProfileData | null>(() => load<ProfileData | null>('profile', null));
  const [profileLabel, setProfileLabel] = useState(() => load('profileLabel', ''));
  const engineRef = useRef<Engine | null>(null);
  const runId = useRef(0);

  useEffect(
    () => () => {
      runId.current++;
      engineRef.current?.terminate();
    },
    [],
  );

  async function collect(): Promise<Pending[]> {
    if (source === 'local') {
      return load<SavedGame[]>('games', [])
        .slice(0, count)
        .map((g) => {
          const userWon = (g.result === '1-0' && g.color === 'w') || (g.result === '0-1' && g.color === 'b');
          return {
            id: `local-${g.date}`,
            pgn: g.pgn,
            date: g.date,
            color: g.color,
            result: g.result === '1/2-1/2' ? 'draw' : userWon ? 'win' : 'loss',
            timeClass: 'bot',
          };
        });
    }
    const user = username.trim();
    const archives = await fetchArchives(user);
    save('chesscomUser', user);
    const out: Pending[] = [];
    for (const a of archives) {
      const games = await fetchMonth(a);
      for (const g of games) {
        if (timeClass !== 'all' && g.time_class !== timeClass) continue;
        if (g.time_class === 'daily') continue;
        out.push({
          id: g.url,
          pgn: g.pgn,
          date: g.end_time * 1000,
          color: g.white.username.toLowerCase() === user.toLowerCase() ? 'w' : 'b',
          result: resultFor(g, user),
          timeClass: g.time_class,
        });
        if (out.length >= count) return out;
      }
      if (out.length >= count) break;
    }
    return out;
  }

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (source === 'chesscom' && !username.trim()) return;
    const id = ++runId.current;
    setError('');
    setProgress({ game: 0, total: count, pos: 0 });
    try {
      const pending = await collect();
      if (!pending.length) throw new Error('No hay partidas que analizar con esos filtros.');
      engineRef.current ??= new Engine();
      await engineRef.current.ready;
      const book = await loadBook();
      const cache = load<Record<string, GameSummary>>(SUMMARIES_KEY, {});
      const summaries: GameSummary[] = [];
      for (let i = 0; i < pending.length; i++) {
        if (id !== runId.current) return;
        const p = pending[i];
        setProgress({ game: i + 1, total: pending.length, pos: 0 });
        let s = cache[p.id];
        if (!s) {
          try {
            new Chess().loadPgn(p.pgn);
          } catch {
            continue;
          }
          const a = await analyzeGame(engineRef.current, p.pgn, engineRef.current.remote ? DEPTH_SERVER : DEPTH, (d, t) => id === runId.current && setProgress({ game: i + 1, total: pending.length, pos: d / t }), () => id !== runId.current, book);
          if (!a) return;
          if (a.moves.length < 10) continue; // partidas demasiado cortas no dicen nada
          s = summarizeGame(a, p.pgn, { id: p.id, date: p.date, color: p.color, result: p.result, timeClass: p.timeClass });
          cache[p.id] = s;
          save(SUMMARIES_KEY, trimCache(cache));
        }
        summaries.push(s);
      }
      const prof = buildProfile(summaries);
      const label = source === 'local' ? 'Partidas contra los bots' : `${username.trim()} · ${CLASSES.find((c) => c[0] === timeClass)?.[1]}`;
      setProfile(prof);
      setProfileLabel(label);
      save('profile', prof);
      save('profileLabel', label);
    } catch (err) {
      setError(err instanceof Error && err.message !== 'Failed to fetch' ? err.message : 'No se pudo conectar con chess.com.');
    } finally {
      if (id === runId.current) setProgress(null);
    }
  }

  function playClone() {
    if (!profile) return;
    const settings = load<Record<string, unknown>>('playSettings2', {});
    save('playSettings2', { ...settings, styleId: 'custom', custom: profile.mirror, adaptive: true });
    navigate('jugar');
  }

  const total = profile ? profile.record.win + profile.record.draw + profile.record.loss : 0;

  return (
    <div className="page narrow">
      <header className="page-head">
        <h1 className="page-title">Perfil de jugador</h1>
        <p className="lede">Analizo tus últimas partidas con Stockfish y resumo cómo juegas: en qué fase fallas, cuánto presionas y qué aperturas te funcionan.</p>
      </header>

      <form className="panel" onSubmit={run}>
        <div className="segmented">
          <button type="button" className={source === 'chesscom' ? 'on' : ''} onClick={() => setSource('chesscom')}>
            chess.com
          </button>
          <button type="button" className={source === 'local' ? 'on' : ''} onClick={() => setSource('local')}>
            Mis partidas contra bots
          </button>
        </div>
        <div className="form-grid">
          {source === 'chesscom' && (
            <>
              <label className="field" htmlFor="profile-user">
                <span className="field-label">Usuario</span>
                <input id="profile-user" placeholder="Tu usuario de chess.com" value={username} onChange={(e) => setUsername(e.target.value)} />
              </label>
              <label className="field" htmlFor="profile-class">
                <span className="field-label">Ritmo</span>
                <select id="profile-class" value={timeClass} onChange={(e) => setTimeClass(e.target.value)}>
                  {CLASSES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="field" htmlFor="profile-count">
            <span className="field-label">Partidas</span>
            <select id="profile-count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[10, 20, 40].map((v) => (
                <option key={v} value={v}>
                  Últimas {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="btn-row">
          <button className="btn primary" disabled={!!progress}>
            {profile ? 'Volver a analizar' : 'Crear mi perfil'}
          </button>
          {progress && (
            <button type="button" className="btn ghost" onClick={() => {
                runId.current++;
                setProgress(null);
              }}>
              Cancelar
            </button>
          )}
        </div>
        {progress && (
          <div className="progress-line">
            <span>
              Partida {progress.game} de {progress.total}
            </span>
            <div className="progress">
              <div style={{ width: `${((progress.game - 1 + progress.pos) / progress.total) * 100}%` }} />
            </div>
          </div>
        )}
        <p className="hint">Las partidas ya analizadas se guardan, así que repetir el perfil es rápido.</p>
      </form>

      {error && <p className="error-box">{error}</p>}

      {profile && (
        <div className="profile fade-in">
          <section className="profile-summary">
            <div>
              <span className="label">{profileLabel}</span>
              <div className="big-figure">{profile.accuracy.toFixed(1)}</div>
              <span className="muted">precisión media en {profile.games} partidas</span>
            </div>
            <div className="record">
              <div className="record-bar">
                <span className="w" style={{ flex: profile.record.win || 0.001 }} />
                <span className="d" style={{ flex: profile.record.draw || 0.001 }} />
                <span className="l" style={{ flex: profile.record.loss || 0.001 }} />
              </div>
              <span className="muted small">
                {plural(profile.record.win, 'victoria', 'victorias')} · {profile.record.draw} tablas · {plural(profile.record.loss, 'derrota', 'derrotas')}
                {total ? ` (${Math.round(((profile.record.win + profile.record.draw / 2) / total) * 100)} %)` : ''}
              </span>
            </div>
          </section>

          <section className="profile-section">
            <h2 className="section-title">Tu estilo</h2>
            <div className="traits">
              {profile.traits.map((t) => (
                <div key={t.name} className="trait">
                  <div className="trait-head">
                    <strong>{t.name}</strong>
                    <span className="num">{Math.round(t.value)}</span>
                  </div>
                  <div className="meter">
                    <div style={{ width: `${t.value}%` }} />
                  </div>
                  <span className="hint">{t.text}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="profile-section">
            <h2 className="section-title">Precisión por fase</h2>
            <div className="phase-cols">
              {profile.phases.map((p) => (
                <div key={p.phase} className="phase-col">
                  <div className="phase-bar">
                    <div style={{ height: `${p.accuracy ?? 0}%` }} />
                  </div>
                  <strong className="num">{p.accuracy === null ? '–' : p.accuracy.toFixed(1)}</strong>
                  <span className="muted small">{p.phase}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="profile-section two-col">
            <div>
              <h2 className="section-title">Puntos fuertes</h2>
              <ul className="insights good">{profile.strengths.length ? profile.strengths.map((s) => <li key={s}>{s}</li>) : <li>Analiza más partidas para encontrarlos.</li>}</ul>
            </div>
            <div>
              <h2 className="section-title">A mejorar</h2>
              <ul className="insights bad">{profile.weaknesses.length ? profile.weaknesses.map((s) => <li key={s}>{s}</li>) : <li>No veo ningún patrón claro de errores.</li>}</ul>
            </div>
          </section>

          {profile.openings.length > 0 && (
            <section className="profile-section">
              <h2 className="section-title">Aperturas</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Apertura</th>
                      <th>Color</th>
                      <th className="num">Partidas</th>
                      <th className="num">Puntos</th>
                      <th className="num">Precisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.openings.slice(0, 8).map((o) => (
                      <tr key={o.color + o.name}>
                        <td>{o.name}</td>
                        <td>{o.color === 'w' ? 'Blancas' : 'Negras'}</td>
                        <td className="num">{o.games}</td>
                        <td className="num">{Math.round(o.score)} %</td>
                        <td className="num">{o.accuracy.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="profile-section clone">
            <div>
              <h2 className="section-title">Juega contra tu clon</h2>
              <p className="muted">
                Un bot a tu nivel con tu estilo: agresividad {profile.mirror.aggression}, riesgo {profile.mirror.risk}.
              </p>
            </div>
            <button className="btn primary" onClick={playClone}>
              Jugar contra mi clon
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Mantiene como mucho 300 partidas resumidas en el almacenamiento local.
function trimCache(c: Record<string, GameSummary>) {
  const entries = Object.entries(c).sort((a, b) => b[1].date - a[1].date);
  return Object.fromEntries(entries.slice(0, 300));
}
