// Libro de aperturas: posiciones de teoría con su nombre y las jugadas que siguen.
// Se carga bajo demanda porque ocupa bastante (src/data/openings.json, generado con scripts/build-openings.mjs).
import { load, save } from './storage';

type BookNode = { n?: string; e?: string; m?: [string, number][] };
export type Book = { nodes: Record<string, BookNode>; mains: [string, string][] };

let book: Promise<Book> | null = null;
export function loadBook() {
  book ??= import('../data/openings.json').then((d) => d.default as unknown as Book);
  return book;
}

export const bookKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

// Jugadas de teoría desde una posición, ordenadas por peso, con su porcentaje.
export function bookMoves(b: Book, fen: string) {
  const moves = b.nodes[bookKey(fen)]?.m ?? [];
  const total = moves.reduce((s, [, w]) => s + w, 0);
  return [...moves].sort((x, y) => y[1] - x[1]).map(([uci, w]) => ({ uci, share: w / total }));
}

export function bookName(b: Book, fen: string) {
  const n = b.nodes[bookKey(fen)];
  return n?.n ? { name: n.n, eco: n.e ?? '' } : null;
}

// Elige una jugada de teoría al azar según su peso.
export function pickBookMove(b: Book, fen: string) {
  const moves = bookMoves(b, fen);
  let r = Math.random();
  for (const m of moves) {
    r -= m.share;
    if (r <= 0) return m.uci;
  }
  return moves[0]?.uci ?? null;
}

export type OpeningSession = {
  date: number;
  name: string;
  color: 'w' | 'b';
  bookPlies: number; // jugadas seguidas en teoría desde el inicio (en medias jugadas)
  accuracy: number | null; // precisión fuera de teoría
  errors: number;
  finalEval: number; // centipeones desde tu lado al terminar
};

const SESSIONS_KEY = 'openingSessions';
export const loadSessions = () => load<OpeningSession[]>(SESSIONS_KEY, []);
export function saveSession(s: OpeningSession) {
  save(SESSIONS_KEY, [s, ...loadSessions()].slice(0, 50));
}
