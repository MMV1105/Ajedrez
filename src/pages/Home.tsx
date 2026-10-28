import { useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import Board from '../components/Board';
import { getRating, RATING_LABELS, setInitialRating, type RatingClass } from '../lib/elo';
import { fetchStats } from '../lib/chesscom';
import { navigate } from '../lib/nav';
import { load, save } from '../lib/storage';

// La "partida de la ópera" (Morphy, 1858) se reproduce en bucle en la portada.
const OPERA = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ');

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="spark-empty" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const W = 120;
  const H = 32;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * W).toFixed(1)} ${(H - ((p - min) / (max - min || 1)) * H).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`-2 -2 ${W + 4} ${H + 4}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ImportRatings({ onDone }: { onDone: () => void }) {
  const [user, setUser] = useState(() => load('chesscomUser', ''));
  const [status, setStatus] = useState('');
  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!user.trim()) return;
    setStatus('Consultando chess.com…');
    try {
      const st = await fetchStats(user);
      save('chesscomUser', user.trim());
      const pairs: [RatingClass, number | undefined][] = [
        ['bullet', st.chess_bullet?.last?.rating],
        ['blitz', st.chess_blitz?.last?.rating],
        ['rapid', st.chess_rapid?.last?.rating],
        ['puzzles', st.tactics?.highest?.rating],
      ];
      let n = 0;
      for (const [c, r] of pairs) {
        if (!r) continue;
        setInitialRating(c, r);
        n++;
      }
      setStatus(n ? `¡Listo! ${n} puntuaciones importadas.` : 'Ese usuario no tiene puntuaciones públicas.');
      onDone();
    } catch (err) {
      setStatus(err instanceof Error && err.message !== 'Failed to fetch' ? err.message : 'No se pudo conectar con chess.com.');
    }
  }
  return (
    <form className="import-card" onSubmit={run}>
      <div>
        <strong>¿Empiezas con tu nivel de chess.com?</strong>
        <p className="muted small">Importa tu Elo para que los bots y los puzzles arranquen a tu nivel.</p>
      </div>
      <div className="search-row">
        <input placeholder="Usuario de chess.com" value={user} onChange={(e) => setUser(e.target.value)} />
        <button className="btn primary">Importar</button>
      </div>
      {status && <p className="small fade-in">{status}</p>}
    </form>
  );
}

export default function Home() {
  const [, refresh] = useState(0);
  const [fen, setFen] = useState(new Chess().fen());
  const [last, setLast] = useState<[string, string] | null>(null);
  const [ply, setPly] = useState(0);

  useEffect(() => {
    const chess = new Chess();
    let i = 0;
    const id = setInterval(() => {
      if (i >= OPERA.length) {
        if (i > OPERA.length + 3) {
          chess.reset();
          i = 0;
          setFen(chess.fen());
          setLast(null);
          setPly(0);
          return;
        }
        i++;
        return;
      }
      const mv = chess.move(OPERA[i++]);
      setPly(i);
      setFen(chess.fen());
      setLast([mv.from, mv.to]);
    }, 1100);
    return () => clearInterval(id);
  }, []);

  const moveLabel = ply ? `${Math.ceil(ply / 2)}.${ply % 2 ? '' : '..'} ${OPERA[ply - 1]}` : 'posición inicial';
  const classes: RatingClass[] = ['bullet', 'blitz', 'rapid', 'puzzles'];
  const fresh = classes.every((c) => getRating(c).games === 0);
  const profile = load<{ accuracy: number; games: number } | null>('profile', null);

  return (
    <div className="page home">
      <section className="home-main">
        <header className="page-head">
          <h1 className="page-title">Buenas, ¿echamos una?</h1>
          <p className="lede">Juega contra bots a tu nivel, revisa tus partidas de chess.com con Stockfish 19 y entrena la vista del tablero.</p>
        </header>
        <div className="btn-row">
          <button className="btn primary" onClick={() => navigate('jugar')}>
            Jugar contra un bot
          </button>
          <button className="btn" onClick={() => navigate('analizar')}>
            Analizar una partida
          </button>
        </div>

        <table className="ratings-table">
          <thead>
            <tr>
              <th>Ritmo</th>
              <th className="num">Elo</th>
              <th>Evolución</th>
              <th className="num">Partidas</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => {
              const r = getRating(c);
              return (
                <tr key={c}>
                  <td>{RATING_LABELS[c]}</td>
                  <td className="num strong">{r.rating}</td>
                  <td>
                    <Sparkline points={r.history.map((h) => h.r)} />
                  </td>
                  <td className="num muted">{c === 'puzzles' ? r.games : `${r.wins}-${r.draws}-${r.losses}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {fresh && <ImportRatings onDone={() => refresh((x) => x + 1)} />}

        <a className="list-link" href="#/perfil">
          <span>
            <strong>Perfil de jugador</strong>
            <span className="muted">{profile ? `Precisión media ${profile.accuracy.toFixed(1)} en ${profile.games} partidas analizadas.` : 'Analiza tus últimas partidas y descubre en qué fallas.'}</span>
          </span>
          <span className="list-stat">Ver</span>
        </a>
      </section>

      <aside className="home-board">
        <Board position={fen} lastMove={last} animation={450} maxWidth={440} showNotation={false} />
        <p className="caption">
          <span>Morphy contra el duque de Brunswick y el conde Isouard</span>
          <span className="muted">Ópera de París, 1858 · {moveLabel}</span>
        </p>
      </aside>
    </div>
  );
}
