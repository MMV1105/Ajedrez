import { load, save } from './storage';

export type RatingClass = 'bullet' | 'blitz' | 'rapid' | 'puzzles';

export type RatingState = {
  rating: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  history: { t: number; r: number }[];
};

export const RATING_LABELS: Record<RatingClass, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rápidas',
  puzzles: 'Puzzles',
};

const DEFAULT_RATING = 800;

export function getRating(cls: RatingClass): RatingState {
  return load<RatingState>(`rating:${cls}`, {
    rating: DEFAULT_RATING,
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    history: [],
  });
}

export function setInitialRating(cls: RatingClass, rating: number) {
  const s = getRating(cls);
  save(`rating:${cls}`, { ...s, rating, history: [...s.history, { t: Date.now(), r: rating }] });
}

export function expected(a: number, b: number) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

// score: 1 victoria, 0.5 tablas, 0 derrota. Devuelve la variación.
export function applyResult(cls: RatingClass, opponent: number, score: number): { before: number; after: number } {
  const s = getRating(cls);
  const k = s.games < 15 ? 40 : s.games < 50 ? 24 : 16;
  const before = s.rating;
  const after = Math.max(100, Math.min(3200, Math.round(before + k * (score - expected(before, opponent)))));
  save<RatingState>(`rating:${cls}`, {
    rating: after,
    games: s.games + 1,
    wins: s.wins + (score === 1 ? 1 : 0),
    draws: s.draws + (score === 0.5 ? 1 : 0),
    losses: s.losses + (score === 0 ? 1 : 0),
    history: [...s.history, { t: Date.now(), r: after }].slice(-200),
  });
  return { before, after };
}

// Clasificación por tiempo estimado (como chess.com: base + 40 * incremento).
export function classOf(baseSec: number, incSec: number): RatingClass {
  const total = baseSec + 40 * incSec;
  if (total < 180) return 'bullet';
  if (total < 600) return 'blitz';
  return 'rapid';
}

// Elo al que corresponde una precisión (al estilo de chess.com). Curva ajustada con 13.500 precisiones públicas de
// chess.com de jugadores de 0 a 3000: precisión media ≈ 63,9 + 7,2·x + 0,374·x² (x = Elo/1000), unos 8 puntos menos
// en bala. Se invierte para pasar de precisión a Elo. Con una sola partida es muy orientativo (la mitad de las veces
// falla por más de ±500); con 20 partidas, por más de ±300.
export function timeClassOf(timeControl: string) {
  const base = Number(/^(\d+)/.exec(timeControl)?.[1] ?? NaN);
  const inc = Number(/\+(\d+)/.exec(timeControl)?.[1] ?? 0);
  if (!Number.isFinite(base) || timeControl.includes('/')) return 'rapid';
  const t = base + 40 * inc;
  return t < 180 ? 'bullet' : t < 600 ? 'blitz' : 'rapid';
}
export function eloFromAccuracy(accuracy: number, timeClass = 'rapid') {
  const c = 63.9 + (timeClass === 'bullet' ? -7.9 : 0) - accuracy;
  const x = (-7.2 + Math.sqrt(Math.max(0, 7.2 * 7.2 - 4 * 0.374 * c))) / (2 * 0.374);
  return Math.round(Math.min(2900, Math.max(100, x * 1000)) / 50) * 50;
}
