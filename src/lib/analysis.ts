import { Chess, type Move } from 'chess.js';
import { Engine, scoreOf, type Line } from './engine';
import { bookMoves, type Book } from './openings';

export type Classification = 'brillante' | 'gran' | 'mejor' | 'excelente' | 'buena' | 'teoria' | 'imprecision' | 'error' | 'fallo' | 'grave';

export const CLASS_INFO: Record<Classification, { label: string; color: string; icon: string }> = {
  brillante: { label: 'Brillante', color: '#26c2a3', icon: '!!' },
  gran: { label: 'Gran jugada', color: '#5c8bb0', icon: '!' },
  mejor: { label: 'Mejor', color: '#81b64c', icon: '★' },
  excelente: { label: 'Excelente', color: '#96bc4b', icon: '+' },
  buena: { label: 'Buena', color: '#97af8b', icon: '✓' },
  teoria: { label: 'Teoría', color: '#a88865', icon: '≡' },
  imprecision: { label: 'Imprecisión', color: '#f7c631', icon: '?!' },
  error: { label: 'Error', color: '#ffa459', icon: '?' },
  fallo: { label: 'Ocasión fallada', color: '#ff7769', icon: '✕' },
  grave: { label: 'Error grave', color: '#fa412d', icon: '??' },
};

export type PositionEval = { cp: number; mate: number | null; best: string | null; second: number | null; pv: string[]; goodMoves: number };

export type AnalyzedMove = {
  move: Move;
  fenBefore: string;
  fenAfter: string;
  color: 'w' | 'b';
  evalBefore: PositionEval; // desde blancas
  evalAfter: PositionEval; // desde blancas
  epBefore: number; // puntos esperados del que mueve (0 a 1)
  epAfter: number;
  epLoss: number; // ΔEP
  accuracy: number;
  cpLoss: number;
  cls: Classification;
  pressure: boolean; // dejó al rival con una sola jugada buena
};

export type GameAnalysis = {
  moves: AnalyzedMove[];
  evals: PositionEval[]; // por posición, desde blancas
  accuracy: { w: number; b: number };
  pressure: { w: number; b: number }; // % de jugadas que dejan al rival con una sola respuesta buena
};

// Probabilidad de ganar (fórmula de lichess) desde la evaluación en centipeones.
export function winPct(cp: number) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function evalToCp(e: Pick<PositionEval, 'cp' | 'mate'>) {
  if (e.mate === 0) return e.cp; // posición de mate: cp ya lleva el signo del ganador
  return scoreOf({ cp: e.cp, mate: e.mate });
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Material propio menos el rival tras la mejor respuesta: detecta sacrificios.
function materialFor(fen: string, color: 'w' | 'b') {
  let m = 0;
  for (const row of new Chess(fen).board())
    for (const sq of row) if (sq) m += (sq.color === color ? 1 : -1) * PIECE_VALUE[sq.type];
  return m;
}

// Margen (en centipeones) para considerar "buena" una respuesta del rival.
const GOOD_REPLY_MARGIN = 60;

export async function evalPosition(engine: Engine, fen: string, depth: number): Promise<PositionEval> {
  const chess = new Chess(fen);
  const whiteToMove = chess.turn() === 'w';
  if (chess.isCheckmate()) return { cp: whiteToMove ? -10000 : 10000, mate: 0, best: null, second: null, pv: [], goodMoves: 0 };
  if (chess.isDraw() || chess.isStalemate()) return { cp: 0, mate: null, best: null, second: null, pv: [], goodMoves: 0 };
  return linesToEval(fen, await engine.analyse(fen, { depth, multipv: 3 }));
}

// Evaluación de una posición (no terminada) a partir de las líneas del motor, desde el punto de vista de las blancas.
export function linesToEval(fen: string, lines: Line[]): PositionEval {
  const sign = new Chess(fen).turn() === 'w' ? 1 : -1;
  const [a, b] = lines;
  const top = scoreOf(a);
  return {
    cp: sign * top,
    mate: a.mate === null ? null : sign * a.mate,
    best: a.move,
    second: b ? sign * scoreOf(b) : null,
    pv: a.pv,
    goodMoves: lines.filter((l) => top - scoreOf(l) <= GOOD_REPLY_MARGIN).length,
  };
}

// Valoración al estilo de chess.com: cada evaluación se pasa a puntos esperados (EP, de 0 a 1)
// y la nota de la jugada sale de cuántos puntos esperados pierde frente a la mejor.
// La pérdida se mide como si la partida estuviera igualada (anclada en 0): los centipeones que pierdes
// frente a la mejor jugada (CPL) se llevan de 0 a −CPL, así que un error pesa igual vayas como vayas.
export function expectedPoints(cp: number) {
  return 1 / (1 + Math.pow(10, -cp / 400));
}

// Pérdida máxima de puntos esperados (ΔEP) para cada nota; por encima de la última, error grave.
const LIMITS = { excelente: 0.02, buena: 0.05, imprecision: 0.1, error: 0.2 };
// Precisión de cada jugada: 100·e^(−k·ΔEP) con k = 3,2 (0,02 → 94, 0,05 → 85, 0,10 → 72, 0,20 → 52).
const ACCURACY_K = 3.2;
// Gran jugada: la segunda mejor pierde al menos esto.
const GREAT_GAP = 0.15;
// Brillante: material neto entregado (en puntos) y jugadas de la línea del motor que se miran para medirlo.
const SACRIFICE_POINTS = 2;
const SACRIFICE_PLIES = 4;
// Mate forzado que se deja escapar sin perder la posición ganadora (sigues a +3 o más): ocasión fallada,
// y la precisión se calcula como si perdieras un peón.
const MISSED_MATE_WINNING = 300;
const MISSED_MATE_CPL = 100;
// ΔEP anclado en 0: 0,5 − EP(−CPL). Los límites equivalen a unos 14, 35, 70 y 147 cp perdidos.
export const anchoredLoss = (cpl: number) => 0.5 - expectedPoints(-cpl);

export type MoveContext = {
  inBook?: boolean; // la jugada es de teoría y la partida sigue en el libro
  prevLoss?: number; // ΔEP (anclado) de la jugada anterior del rival
};

export function judgeMove(move: Move, before: PositionEval, after: PositionEval, ctx: MoveContext = {}) {
  const color = move.color;
  const sign = color === 'w' ? 1 : -1;
  const cpBefore = sign * evalToCp(before);
  const cpAfter = sign * evalToCp(after);
  const epBefore = expectedPoints(cpBefore); // EP de la mejor jugada
  const epAfter = expectedPoints(cpAfter); // EP tras tu jugada
  const uci = move.from + move.to + (move.promotion ?? '');
  const hadMate = before.mate !== null && sign * before.mate > 0;
  const keepsMate = after.mate !== null && cpAfter > 0; // sigue habiendo mate a favor (o ya lo has dado)
  const missedMate = hadMate && !keepsMate && uci !== before.best && cpAfter >= MISSED_MATE_WINNING;
  // CPL, sin recortar: simplificar también cuenta si no es lo óptimo.
  const cpLoss = missedMate ? MISSED_MATE_CPL : Math.max(0, cpBefore - cpAfter);
  const best = uci === before.best || cpLoss === 0;
  const epLoss = best ? 0 : anchoredLoss(cpLoss); // ΔEP como si la partida estuviera igualada
  const accuracy = 100 * Math.exp(-ACCURACY_K * epLoss);

  // Sacrificio: tras la línea del motor (o al acabar en tu mate) has entregado al menos 2 puntos netos de material.
  const sacrifice = () => {
    if (!after.pv.length) return false;
    try {
      const line = new Chess(move.after);
      for (const u of after.pv.slice(0, SACRIFICE_PLIES)) {
        line.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
        if (line.isCheckmate()) break;
      }
      const mated = line.isCheckmate() && line.turn() !== color;
      const net = materialFor(line.fen(), color) - materialFor(move.before, color);
      if (mated) {
        // Mate tras entregar material: se mira lo que el rival llegó a comer antes del mate.
        const reply = new Chess(move.after);
        const u = after.pv[0];
        reply.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
        return materialFor(reply.fen(), color) - materialFor(move.before, color) <= -SACRIFICE_POINTS;
      }
      return after.pv.length >= SACRIFICE_PLIES && net <= -SACRIFICE_POINTS;
    } catch {
      return false; // línea del motor no aplicable
    }
  };

  let cls: Classification;
  if (ctx.inBook && epLoss <= LIMITS.buena) cls = 'teoria';
  else if (missedMate) cls = 'fallo';
  // Brillante: ΔEP ≤ 0,02 (la posición no empeora) y entrega material.
  else if (epLoss <= LIMITS.excelente && sacrifice()) cls = 'brillante';
  else if (best) {
    // Gran jugada: la mejor, y la segunda mejor opción tiene ΔEP ≥ 0,15 (con la evaluación real:
    // es la única jugada que mantiene el resultado).
    const second = before.second === null ? null : expectedPoints(sign * before.second);
    cls = second !== null && epBefore - second >= GREAT_GAP ? 'gran' : 'mejor';
  } else {
    if (epLoss <= LIMITS.excelente) cls = 'excelente';
    else if (epLoss <= LIMITS.buena) cls = 'buena';
    else if (epLoss <= LIMITS.imprecision) cls = 'imprecision';
    else if (epLoss <= LIMITS.error) cls = 'error';
    else cls = 'grave';
    // Ocasión fallada: el rival acababa de cometer un error grave y no lo castigas: devuelves lo que te había regalado.
    const prev = ctx.prevLoss ?? 0;
    if ((cls === 'error' || cls === 'grave') && prev > LIMITS.error && epLoss <= prev + 0.05) cls = 'fallo';
  }
  // Presión: tras la jugada, el rival solo tiene una respuesta que no empeora su posición.
  const decided = Math.abs(evalToCp(after)) > 600;
  const pressure = !decided && after.goodMoves === 1 && new Chess(move.after).moves().length > 1;
  return { epBefore, epAfter, epLoss, cpLoss, accuracy, cls, pressure };
}

// Precisión de la partida: media aritmética de la precisión de cada jugada.
export function playerAccuracy(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export const isMistake = (c: Classification) => c === 'error' || c === 'fallo' || c === 'grave';

export async function analyzeGame(
  engine: Engine,
  pgn: string,
  depth: number,
  onProgress: (done: number, total: number, moves: AnalyzedMove[]) => void,
  isCancelled: () => boolean,
  book: Book | null = null,
): Promise<GameAnalysis | null> {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  const startFen = history.length ? history[0].before : chess.fen();
  const fens = [startFen, ...history.map((m) => m.after)];
  const evals: PositionEval[] = [];
  const moves: AnalyzedMove[] = [];
  let inTheory = !!book && history.length > 0 && history[0].before === new Chess().fen();
  // Cada jugada se valora en cuanto está evaluada la posición siguiente, para poder enseñarla mientras se analiza.
  for (let i = 0; i < fens.length; i++) {
    if (isCancelled()) return null;
    evals.push(await evalPosition(engine, fens[i], depth));
    if (i > 0) {
      const k = i - 1;
      const move = history[k];
      const uci = move.from + move.to + (move.promotion ?? '');
      // La teoría solo cuenta mientras la partida no ha salido del libro.
      inTheory = inTheory && bookMoves(book!, move.before).some((m) => m.uci === uci);
      const judged = judgeMove(move, evals[k], evals[i], { inBook: inTheory, prevLoss: moves[k - 1]?.epLoss });
      moves.push({ move, fenBefore: move.before, fenAfter: move.after, color: move.color, evalBefore: evals[k], evalAfter: evals[i], ...judged });
    }
    onProgress(i + 1, fens.length, moves);
  }
  const stats = (c: 'w' | 'b') => {
    const mine = moves.filter((m) => m.color === c);
    return {
      accuracy: playerAccuracy(mine.map((m) => m.accuracy)),
      pressure: mine.length ? (mine.filter((m) => m.pressure).length / mine.length) * 100 : 0,
    };
  };
  const w = stats('w');
  const b = stats('b');
  return { moves, evals, accuracy: { w: w.accuracy, b: b.accuracy }, pressure: { w: w.pressure, b: b.pressure } };
}

export function formatEval(e: Pick<PositionEval, 'cp' | 'mate'>) {
  if (e.mate !== null) return e.mate === 0 ? '#' : `M${Math.abs(e.mate)}`;
  const v = e.cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}
