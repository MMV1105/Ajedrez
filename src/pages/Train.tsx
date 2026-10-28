import { getRating } from '../lib/elo';
import { load } from '../lib/storage';
import LESSONS from '../data/lessons.json';
import { PHASE_INFO, trainerProgress, type TrainerPhase } from '../lib/trainer';

export default function Train() {
  const done = Object.keys(load<Record<string, boolean>>('lessonsDone', {})).length;
  const coord = load<Record<string, number>>('coordBest', {});
  const phases: TrainerPhase[] = ['apertura', 'medio', 'final'];
  const items = [
    ...phases.map((p) => {
      const { done: ok, total } = trainerProgress(p);
      return { path: PHASE_INFO[p].path, title: PHASE_INFO[p].title, text: PHASE_INFO[p].text, stat: `${ok} de ${total}` };
    }),
    { path: 'puzzles', title: 'Puzzles', text: 'Tácticas sacadas de errores reales. Clasificados o contrarreloj.', stat: `Elo ${getRating('puzzles').rating} · récord ${load('rushBest', 0)}` },
    { path: 'coordenadas', title: 'Coordenadas', text: 'Encuentra casillas lo más rápido posible durante 30 segundos.', stat: `Récord ${Math.max(coord.white ?? 0, coord.black ?? 0)}` },
    { path: 'memoria', title: 'Memoria', text: 'Memoriza una posición y reconstrúyela pieza a pieza.', stat: `Mejor nivel ${load('memoryBest', 0)}` },
    { path: 'lecciones', title: 'Lecciones', text: 'Tácticas básicas, mates y finales, con ejercicios.', stat: `${done} de ${LESSONS.length} hechas` },
  ];
  return (
    <div className="page narrow">
      <header className="page-head">
        <h1 className="page-title">Entrenar</h1>
      </header>
      <div className="list-links">
        {items.map((it) => (
          <a key={it.path} href={`#/${it.path}`} className="list-link">
            <span>
              <strong>{it.title}</strong>
              <span className="muted">{it.text}</span>
            </span>
            <span className="list-stat">{it.stat}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
