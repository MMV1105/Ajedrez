// Datos y progreso del entrenador de aperturas, medio juego y finales.
import { Chess } from 'chess.js';
import { load, save } from './storage';
import SPOTS from '../data/trainer.json';

export type TrainerPhase = 'apertura' | 'medio' | 'final';
export type SpotKind = 'igualada' | 'ventaja' | 'defensa';

export type Spot = {
  id: string;
  phase: TrainerPhase;
  name: string;
  kind: SpotKind;
  prev: string | null; // posición antes de la última jugada del rival
  last: string | null; // última jugada del rival (UCI), se anima al empezar
  fen: string;
  eval: number; // centipeones desde el bando que entrena (profundidad 16)
  failLine: number; // si la evaluación baja de aquí, se pierde el ejercicio
  moves: number; // jugadas que hay que aguantar
  classic?: boolean;
};

// Nombre del final según las piezas que quedan (sin contar reyes ni peones).
function endgameName(fen: string) {
  const types = new Set(new Chess(fen).board().flat().flatMap((p) => (p && p.type !== 'k' && p.type !== 'p' ? [p.type] : [])));
  const only = (...t: string[]) => [...types].every((x) => t.includes(x));
  if (!types.size) return 'Final de peones';
  if (only('r')) return 'Final de torres';
  if (only('q')) return 'Final de damas';
  if (only('b')) return 'Final de alfiles';
  if (only('n')) return 'Final de caballos';
  if (only('b', 'n')) return 'Final de piezas menores';
  if (only('r', 'b', 'n')) return 'Final de torres y piezas menores';
  return 'Final con damas';
}

export const ALL_SPOTS = (SPOTS as Spot[]).map((s) => (s.name === 'Final' ? { ...s, name: endgameName(s.fen) } : s));

export const PHASE_INFO: Record<TrainerPhase, { title: string; path: string; text: string }> = {
  apertura: { title: 'Aperturas', path: 'aperturas', text: 'Juega desde la primera jugada con teoría variada, o sal de posiciones concretas sin perder la igualdad.' },
  medio: { title: 'Medio juego', path: 'medio-juego', text: 'Posiciones de partidas reales: mantén el equilibrio, aprovecha fallos o defiéndete.' },
  final: { title: 'Finales', path: 'finales', text: 'Convierte la ventaja, aguanta las tablas y repasa los finales clásicos.' },
};

export const KIND_INFO: Record<SpotKind, { label: string }> = {
  igualada: { label: 'Igualada' },
  ventaja: { label: 'El rival ha fallado' },
  defensa: { label: 'Toca defender' },
};

const DONE_KEY = 'trainerDone';
const RECENT_KEY = 'trainerRecent';

export function trainerProgress(phase: TrainerPhase) {
  const done = load<Record<string, boolean>>(DONE_KEY, {});
  const spots = ALL_SPOTS.filter((s) => s.phase === phase);
  return { done: spots.filter((s) => done[s.id]).length, total: spots.length };
}

export function markDone(id: string) {
  save(DONE_KEY, { ...load<Record<string, boolean>>(DONE_KEY, {}), [id]: true });
}

// Elige una posición de la fase, priorizando las no superadas y evitando las últimas vistas.
export function pickSpot(phase: TrainerPhase, kind: SpotKind | null): Spot {
  const done = load<Record<string, boolean>>(DONE_KEY, {});
  const recent = load<string[]>(RECENT_KEY, []);
  const pool = ALL_SPOTS.filter((s) => s.phase === phase && (!kind || s.kind === kind));
  const fresh = pool.filter((s) => !recent.includes(s.id));
  const candidates = fresh.filter((s) => !done[s.id]).length ? fresh.filter((s) => !done[s.id]) : fresh.length ? fresh : pool;
  const spot = candidates[Math.floor(Math.random() * candidates.length)];
  save(RECENT_KEY, [spot.id, ...recent].slice(0, Math.floor(pool.length / 2)));
  return spot;
}

// Evaluación en formato corto desde el bando que entrena: +1,5 / −0,8.
export function formatCp(cp: number) {
  if (Math.abs(cp) < 5) return '0,0';
  const v = (cp / 100).toFixed(1).replace('.', ',');
  return cp > 0 ? `+${v}` : cp < 0 ? v.replace('-', '−') : v;
}
