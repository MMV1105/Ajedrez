import { useEffect, useState, type ComponentType } from 'react';
import Home from './pages/Home';
import Play from './pages/Play';
import Analysis from './pages/Analysis';
import Profile from './pages/Profile';
import Train from './pages/Train';
import Puzzles from './pages/Puzzles';
import Coordinates from './pages/Coordinates';
import Memory from './pages/Memory';
import Lessons from './pages/Lessons';
import { EndgameTrainer, MiddlegameTrainer } from './pages/Trainer';
import Openings from './pages/Openings';
import Icon from './components/Icon';
import { isMuted, setMuted } from './lib/sound';

type Route = { path: string; label: string; icon: string; page: ComponentType; group: 'main' | 'train' };

const ROUTES: Route[] = [
  { path: '', label: 'Inicio', icon: 'home', page: Home, group: 'main' },
  { path: 'jugar', label: 'Jugar', icon: 'play', page: Play, group: 'main' },
  { path: 'analizar', label: 'Analizar', icon: 'analyze', page: Analysis, group: 'main' },
  { path: 'perfil', label: 'Perfil', icon: 'profile', page: Profile, group: 'main' },
  { path: 'entrenar', label: 'Entrenar', icon: 'puzzle', page: Train, group: 'main' },
  { path: 'aperturas', label: 'Aperturas', icon: 'book', page: Openings, group: 'train' },
  { path: 'medio-juego', label: 'Medio juego', icon: 'bolt', page: MiddlegameTrainer, group: 'train' },
  { path: 'finales', label: 'Finales', icon: 'flag', page: EndgameTrainer, group: 'train' },
  { path: 'puzzles', label: 'Puzzles', icon: 'puzzle', page: Puzzles, group: 'train' },
  { path: 'coordenadas', label: 'Coordenadas', icon: 'target', page: Coordinates, group: 'train' },
  { path: 'memoria', label: 'Memoria', icon: 'memory', page: Memory, group: 'train' },
  { path: 'lecciones', label: 'Lecciones', icon: 'book', page: Lessons, group: 'train' },
];

const current = () => window.location.hash.replace(/^#\/?/, '');

export default function App() {
  const [path, setPath] = useState(current());
  const [muted, setM] = useState(isMuted());

  useEffect(() => {
    const on = () => {
      setPath(current());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  const Page = route.page;
  const isOn = (r: Route) => r === route || (r.path === 'entrenar' && route.group === 'train');

  const link = (r: Route) => (
    <a key={r.path} href={`#/${r.path}`} className={isOn(r) ? 'on' : ''}>
      <Icon name={r.icon} />
      <span>{r.label}</span>
    </a>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="wordmark" href="#/">
          Jaque
        </a>
        <nav className="side-nav">
          {ROUTES.filter((r) => r.group === 'main' && r.path !== 'entrenar').map(link)}
          <span className="side-group">Entrenar</span>
          {ROUTES.filter((r) => r.group === 'train').map(link)}
        </nav>
        <button
          className="sound-toggle"
          onClick={() => {
            setMuted(!muted);
            setM(!muted);
          }}
        >
          <Icon name={muted ? 'mute' : 'sound'} />
          <span>{muted ? 'Sonido apagado' : 'Sonido'}</span>
        </button>
      </aside>

      <main key={route.path} className="route-enter">
        <Page />
      </main>

      <nav className="tabbar">{ROUTES.filter((r) => r.group === 'main').map(link)}</nav>
    </div>
  );
}
