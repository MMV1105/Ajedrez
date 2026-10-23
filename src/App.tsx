import { useEffect, useState, type ComponentType } from 'react';
import Home from './pages/Home';
import Play from './pages/Play';
import Analysis from './pages/Analysis';
import Puzzles from './pages/Puzzles';
import Coordinates from './pages/Coordinates';
import Memory from './pages/Memory';
import Lessons from './pages/Lessons';
import { isMuted, setMuted } from './lib/sound';

const ROUTES: { path: string; label: string; icon: string; page: ComponentType }[] = [
  { path: '', label: 'Inicio', icon: '🏠', page: Home },
  { path: 'jugar', label: 'Jugar', icon: '♟', page: Play },
  { path: 'analizar', label: 'Analizar', icon: '🔍', page: Analysis },
  { path: 'puzzles', label: 'Puzzles', icon: '🧩', page: Puzzles },
  { path: 'coordenadas', label: 'Coordenadas', icon: '🎯', page: Coordinates },
  { path: 'memoria', label: 'Memoria', icon: '🧠', page: Memory },
  { path: 'lecciones', label: 'Lecciones', icon: '📚', page: Lessons },
];

const current = () => window.location.hash.replace(/^#\/?/, '');

export default function App() {
  const [path, setPath] = useState(current());
  const [muted, setM] = useState(isMuted());

  useEffect(() => {
    const on = () => setPath(current());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  const Page = route.page;

  return (
    <div className="app">
      <nav className="nav">
        <a className="logo" href="#/">
          <span className="logo-mark">♞</span>
          <span className="logo-text">Jaque</span>
        </a>
        <div className="nav-links">
          {ROUTES.map((r) => (
            <a key={r.path} href={`#/${r.path}`} className={r === route ? 'on' : ''}>
              <span className="nav-icon">{r.icon}</span>
              <span className="nav-label">{r.label}</span>
            </a>
          ))}
        </div>
        <button
          className="mute"
          title={muted ? 'Activar sonido' : 'Silenciar'}
          onClick={() => {
            setMuted(!muted);
            setM(!muted);
          }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </nav>
      <main key={route.path} className="route-enter">
        <Page />
      </main>
    </div>
  );
}
