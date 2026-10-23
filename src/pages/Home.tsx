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
      for (const [c, r] of pairs) if (r) (setInitialRating(c, r), n++);
      setStatus(n ? `¡Listo! ${n} puntuaciones importadas.` : 'Ese usuario no tiene puntuaciones públicas.');
      onDone();
    } catch (err) {
      setStatus(err instanceof Error && err.message !== 'Failed to fetch' ? err.message : 'No se pudo conectar con chess.com.');
    }
  }
  return (
    <form className="card import-card" onSubmit={run}>
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
          return;
        }
        i++;
        return;
      }
      const mv = chess.move(OPERA[i++]);
      setFen(chess.fen());
      setLast([mv.from, mv.to]);
    }, 1100);
    return () => clearInterval(id);
  }, []);

  const classes: RatingClass[] = ['bullet', 'blitz', 'rapid', 'puzzles'];
  const lessonsDone = Object.keys(load<Record<string, boolean>>('lessonsDone', {})).length;
  const fresh = classes.every((c) => getRating(c).games === 0);

  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-text">
          <h1>
            Entrena. Analiza. <span className="accent">Mejora.</span>
          </h1>
          <p className="muted">Bots que se adaptan a tu nivel, análisis de tus partidas de chess.com con Stockfish 17.1 y juegos para afinar la visión del tablero. Todo en tu navegador.</p>
          <div className="btn-row">
            <button className="btn primary big" onClick={() => navigate('jugar')}>
              ♟ Jugar contra un bot
            </button>
            <button className="btn big" onClick={() => navigate('analizar')}>
              🔍 Analizar mis partidas
            </button>
          </div>
        </div>
        <div className="hero-board">
          <Board position={fen} lastMove={last} animation={450} maxWidth={420} showNotation={false} />
          <p className="muted small center">La partida de la ópera · Morphy, 1858</p>
        </div>
      </section>

      <section className="rating-grid">
        {classes.map((c, i) => {
          const r = getRating(c);
          return (
            <div key={c} className="rating-card" style={{ animationDelay: `${i * 80}ms` }}>
              <span className="muted small">{RATING_LABELS[c]}</span>
              <strong className="rating-num">{r.rating}</strong>
              <Sparkline points={r.history.map((h) => h.r)} />
              <span className="muted small">{c === 'puzzles' ? `${r.games} resueltos` : `${r.wins}V ${r.draws}T ${r.losses}D`}</span>
            </div>
          );
        })}
      </section>

      {fresh && <ImportRatings onDone={() => refresh((x) => x + 1)} />}

      <section className="feature-grid">
        {[
          ['🧩', 'Puzzles', 'Clasificados y contrarreloj', 'puzzles'],
          ['🎯', 'Coordenadas', 'Visión rápida del tablero', 'coordenadas'],
          ['🧠', 'Memoria', 'Recuerda y reconstruye posiciones', 'memoria'],
          ['📚', 'Lecciones', `${lessonsDone} completadas`, 'lecciones'],
        ].map(([icon, title, sub, path], i) => (
          <button key={path} className="feature-card" style={{ animationDelay: `${200 + i * 80}ms` }} onClick={() => navigate(path)}>
            <span className="feature-icon">{icon}</span>
            <strong>{title}</strong>
            <span className="muted small">{sub}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
