// API pública de datos de chess.com (sin login). https://www.chess.com/news/view/published-data-api

export type ChessComGame = {
  url: string;
  pgn: string;
  time_control: string;
  time_class: string;
  end_time: number;
  rated: boolean;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
};

const BASE = 'https://api.chess.com/pub/player';

export async function fetchArchives(username: string): Promise<string[]> {
  const res = await fetch(`${BASE}/${encodeURIComponent(username.trim().toLowerCase())}/games/archives`);
  if (res.status === 404) throw new Error('No existe ese usuario en chess.com');
  if (!res.ok) throw new Error(`chess.com respondió ${res.status}`);
  const data = (await res.json()) as { archives: string[] };
  return [...data.archives].reverse();
}

export async function fetchMonth(archiveUrl: string): Promise<ChessComGame[]> {
  const res = await fetch(archiveUrl);
  if (!res.ok) throw new Error(`chess.com respondió ${res.status}`);
  const data = (await res.json()) as { games: ChessComGame[] };
  return data.games.filter((g) => g.pgn && !g.pgn.includes('[Variant ')).reverse();
}

export function monthLabel(archiveUrl: string) {
  const [y, m] = archiveUrl.split('/').slice(-2);
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

export function resultFor(g: ChessComGame, username: string): 'win' | 'loss' | 'draw' {
  const me = g.white.username.toLowerCase() === username.toLowerCase() ? g.white : g.black;
  if (me.result === 'win') return 'win';
  if (['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(me.result)) return 'draw';
  return 'loss';
}

type Stat = { last?: { rating: number } };
export type ChessComStats = { chess_bullet?: Stat; chess_blitz?: Stat; chess_rapid?: Stat; tactics?: { highest?: { rating: number } } };

export async function fetchStats(username: string): Promise<ChessComStats> {
  const res = await fetch(`${BASE}/${encodeURIComponent(username.trim().toLowerCase())}/stats`);
  if (res.status === 404) throw new Error('No existe ese usuario en chess.com');
  if (!res.ok) throw new Error(`chess.com respondió ${res.status}`);
  return res.json();
}
