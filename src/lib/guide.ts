// Guía de aperturas: la mejor jugada en cada posición (con su porqué), la amenaza del rival
// y, tras tu jugada, sus respuestas posibles con la réplica recomendada a cada una.
import { Chess, type Move } from 'chess.js';
import { scoreOf, type Engine, type Line } from './engine';
import { linesToEval, type PositionEval } from './analysis';
import { bookMoves, type Book } from './openings';

// Una jugada de teoría a menos de esto (en centipeones) de la mejor del motor se recomienda antes que la del motor.
const BOOK_MARGIN = 35;
// Ganancia mínima del rival con una jugada "gratis" para avisar de una amenaza.
const THREAT_GAIN = 120;

export type Candidate = { uci: string; san: string; cp: number; share: number | null; reason: string };
export type Guide = { fen: string; best: Candidate; candidates: Candidate[]; threat: { uci: string; san: string; gain: number } | null; eval: PositionEval };
export type Reply = { uci: string; san: string; cp: number; share: number | null; answer: Candidate | null };

const clampCp = (v: number) => Math.max(-3000, Math.min(3000, v));
const uciMove = (chess: Chess, u: string) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
const PIECE: Record<string, string> = { p: 'el peón', n: 'el caballo', b: 'el alfil', r: 'la torre', q: 'la dama', k: 'el rey' };

// Explicación corta de una jugada a partir de lo que hace en el tablero.
export function explain(fen: string, uci: string, share: number | null): string {
  const m: Move = uciMove(new Chess(fen), uci);
  const parts: string[] = [];
  if (m.san.endsWith('#')) parts.push('Da jaque mate.');
  else if (m.flags.includes('k') || m.flags.includes('q')) parts.push('Enroca y pone el rey a salvo.');
  else {
    if (m.captured) parts.push(`Captura ${PIECE[m.captured]} de ${m.to}.`);
    if (m.san.includes('+')) parts.push('Da jaque.');
    if (m.promotion) parts.push('Corona.');
    if (m.piece === 'p' && ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(m.to) && !m.captured) parts.push('Ocupa el centro.');
    if ((m.piece === 'n' || m.piece === 'b') && (m.from[1] === '1' || m.from[1] === '8')) parts.push(`Desarrolla ${PIECE[m.piece]}.`);
  }
  if (!parts.length) parts.push(share ? 'Es lo que más se juega aquí.' : 'Es la que mejor aguanta según Stockfish.');
  return parts.slice(0, 2).join(' ');
}

// Recomendada: la de teoría más jugada que no pierda más de BOOK_MARGIN frente a la mejor; si no, la del motor.
function recommend(cands: Omit<Candidate, 'reason'>[]) {
  const top = Math.max(...cands.map((c) => c.cp));
  const book = cands.filter((c) => c.share !== null && c.cp >= top - BOOK_MARGIN).sort((a, b) => b.share! - a.share!);
  return book[0] ?? cands.find((c) => c.cp === top)!;
}

// Posición con el mismo bando moviendo otra vez: sirve para ver qué amenaza el rival.
function nullMoveFen(fen: string) {
  const f = fen.split(' ');
  f[1] = f[1] === 'w' ? 'b' : 'w';
  f[3] = '-';
  return f.join(' ');
}

export async function guideFor(engine: Engine, book: Book | null, fen: string, depth = 12): Promise<Guide> {
  const chess = new Chess(fen);
  const lines = await engine.analyse(fen, { depth, multipv: 3 });
  const theory = book ? bookMoves(book, fen) : [];
  const shareOf = new Map(theory.map((m) => [m.uci, m.share]));
  const base = lines.map((l) => ({ uci: l.move, san: uciMove(new Chess(fen), l.move).san, cp: clampCp(scoreOf(l)), share: shareOf.get(l.move) ?? null }));
  // Las dos jugadas de teoría más jugadas, aunque el motor no las tenga entre sus tres primeras.
  for (const t of theory.slice(0, 2)) {
    if (base.some((c) => c.uci === t.uci)) continue;
    const child = new Chess(fen);
    uciMove(child, t.uci);
    const [reply] = child.isGameOver() ? [] : await engine.analyse(child.fen(), { depth: depth - 1, multipv: 1 });
    base.push({ uci: t.uci, san: uciMove(new Chess(fen), t.uci).san, cp: reply ? clampCp(-scoreOf(reply)) : 0, share: t.share });
  }
  let threat: Guide['threat'] = null;
  if (!chess.inCheck()) {
    const nf = nullMoveFen(fen);
    try {
      new Chess(nf);
      const [l] = await engine.analyse(nf, { depth: depth - 2, multipv: 1 });
      const gain = l ? clampCp(scoreOf(l)) - -Math.max(...base.map((c) => c.cp)) : 0;
      const san = l ? uciMove(new Chess(nf), l.move).san : '';
      // Solo amenazas concretas (capturas, jaques o mates), que son las que se ven y se pueden explicar.
      if (l && gain >= THREAT_GAIN && /[x+#]/.test(san)) threat = { uci: l.move, san, gain };
    } catch {
      /* posición sin movimiento nulo válido */
    }
  }
  const candidates = base.sort((a, b) => b.cp - a.cp).map((c) => ({ ...c, reason: explain(fen, c.uci, c.share) }));
  const best = candidates.find((c) => c.uci === recommend(candidates).uci)!;
  // La recomendada ya tiene en cuenta la amenaza (el motor la ve), así que se dice explícitamente.
  if (threat) best.reason = `Frena la amenaza ${threat.san}. ${best.reason}`;
  return { fen, best, candidates, threat, eval: linesToEval(fen, lines) };
}

// Respuestas del rival tras tu jugada (le toca a él en `fen`): sus mejores defensas y las de teoría,
// cada una con tu réplica recomendada. Se van entregando a medida que se calculan.
export async function repliesFor(engine: Engine, book: Book | null, fen: string, onUpdate: (r: Reply[], ev: PositionEval) => void, depth = 11) {
  const lines: Line[] = await engine.analyse(fen, { depth: depth + 1, multipv: 3 });
  const ev = linesToEval(fen, lines);
  const theory = book ? bookMoves(book, fen) : [];
  const shareOf = new Map(theory.map((m) => [m.uci, m.share]));
  const picks = lines.map((l) => ({ uci: l.move, cp: clampCp(scoreOf(l)) }));
  for (const t of theory.slice(0, 3)) if (!picks.some((p) => p.uci === t.uci) && picks.length < 5) picks.push({ uci: t.uci, cp: NaN });
  const out: Reply[] = picks.map((p) => ({ uci: p.uci, san: uciMove(new Chess(fen), p.uci).san, cp: p.cp, share: shareOf.get(p.uci) ?? null, answer: null }));
  onUpdate([...out], ev);
  for (const r of out) {
    const child = new Chess(fen);
    uciMove(child, r.uci);
    if (child.isGameOver()) continue;
    const answers = await engine.analyse(child.fen(), { depth, multipv: 2 });
    if (!answers.length) continue;
    if (Number.isNaN(r.cp)) r.cp = clampCp(-scoreOf(answers[0]));
    const childShare = new Map((book ? bookMoves(book, child.fen()) : []).map((m) => [m.uci, m.share]));
    const cands = answers.map((a) => ({ uci: a.move, san: uciMove(new Chess(child.fen()), a.move).san, cp: clampCp(scoreOf(a)), share: childShare.get(a.move) ?? null }));
    const best = recommend(cands);
    r.answer = { ...best, reason: explain(child.fen(), best.uci, best.share) };
    onUpdate([...out], ev);
  }
  return { replies: out, ev };
}
