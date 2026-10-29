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
// Escala de la curva: con 400 (la fórmula teórica) Stockfish 19 sale mucho más duro que chess.com; 1100 es la que
// mejor reproduce las notas de chess.com en dos partidas de ~850 de Elo (coinciden 170 de 194 jugadas, 131 con 400).
const EP_SCALE = 1100;
export function expectedPoints(cp: number) {
  return 1 / (1 + Math.pow(10, -cp / EP_SCALE));
}

// Pérdida máxima de puntos esperados (ΔEP) para cada nota; por encima de la última, error grave.
const LIMITS = { excelente: 0.02, buena: 0.05, imprecision: 0.1, error: 0.2 };
// Precisión de cada jugada: 100·e^(−k·pérdida), con la pérdida = la ΔEP real (la que pierdes según cómo va la
// partida, con una curva de escala 1160 en la que un mate a favor vale 1 y uno en contra 0), más 0,061 si la
// jugada empeora el estado de mate (dejas escapar un mate o permites que te lo den). 100 si es la del motor o teoría.
// Todo ajustado solo con chess.com en 147 partidas reales y comprobado en otras 59 que no se usaron para ajustar:
// se desvía 4,4 de media en esas 59 (4,6 con la fórmula anterior). Igualados: 20 cp perdidos → 88, 1 peón → 53.
const ACCURACY_K = 13;
const REAL_SCALE = 1160;
const MATE_STATE_LOSS = 0.061;
// Gran jugada: la segunda mejor pierde al menos esto (ajustado con 4.200 jugadas de Chessigma).
const GREAT_GAP = 0.12;
// Brillante: material neto entregado (en puntos) y jugadas de la línea del motor que se miran para medirlo.
const SACRIFICE_POINTS = 2;
const SACRIFICE_PLIES = 4;
const BRILLIANT_FLOOR = -200;
const BRILLIANT_CEILING = 600; // ya ganando de +6 o más, sacrificar no tiene mérito
// Mate forzado que se deja escapar sin perder la posición ganadora (sigues a +3 o más): ocasión fallada,
// y la precisión se calcula como si perdieras un peón.
const MISSED_MATE_WINNING = 300;
const MISSED_MATE_CPL = 100;
// ΔEP anclado en 0: 0,5 − EP(−CPL). Con la escala de 1100, los límites equivalen a unos 38, 96, 194 y 405 cp perdidos.
export const anchoredLoss = (cpl: number) => 0.5 - expectedPoints(-cpl);
// Nota en posiciones decididas: si sigues ganando (o perdiendo) tras la jugada, lo perdido se divide por
// 1 + 0,2 por cada peón de ventaja por encima de +2,5 (hasta +10: como mucho entre 2,5). Un error se sigue
// marcando, pero perder 1,5 peones a +8 no es lo mismo que a 0. Igualados no cambia nada. Para la nota,
// un mate en contra (o un mate a favor que se escapa) vale como mucho 15 peones. Con esto Jaque coincide con
// Chessigma en el 93 % de las jugadas (bien / imprecisión / error / grave), frente al 89 % sin ello.
const DECIDED_FROM = 250;
const DECIDED_PER_PAWN = 0.2;
const DECIDED_CAP = 1000;
const MATE_VALUE = 1500;

export type MoveContext = {
  inBook?: boolean; // la jugada es de teoría y la partida sigue en el libro
  prevCpLoss?: number; // centipeones que perdió el rival en su jugada anterior
  prevCapture?: string; // casilla donde comió el rival en su jugada anterior, si comió
};

// Ocasión fallada tras un regalo del rival: devuelves al menos el 70 % de lo que regaló sin quedar más de 100 cp
// peor que antes del regalo (si te hundes más, es un error grave normal). Ajustado con las notas de chess.com.
const MISS_GIVEBACK = 0.7;
const MISS_MARGIN = 100;

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
  // Mantener un mate a favor (aunque tarde más) o seguir recibiendo mate cuando ya era inevitable cuenta como la
  // mejor: así lo hace Chessigma (subió del 78 % al 83 % de notas exactas iguales en partidas de prueba).
  const stillMated = before.mate !== null && cpBefore < 0 && after.mate !== null && cpAfter < 0;
  const best = uci === before.best || cpLoss === 0 || (hadMate && keepsMate) || stillMated;
  const epLoss = best ? 0 : anchoredLoss(cpLoss); // ΔEP como si la partida estuviera igualada
  // Pérdida para la nota (la precisión usa la de arriba, sin rebajas).
  const matedAfter = after.mate !== null && cpAfter < 0 && !(before.mate !== null && cpBefore < 0);
  const cpBeforeG = hadMate && !keepsMate ? Math.max(MATE_VALUE, cpAfter) : cpBefore;
  const cpAfterG = matedAfter ? Math.min(-MATE_VALUE, cpBefore) : cpAfter;
  const gradeCpl = missedMate ? cpLoss : Math.max(0, Math.min(cpLoss, cpBeforeG - cpAfterG));
  const still = cpBefore * cpAfter > 0 ? Math.min(Math.abs(cpBefore), Math.abs(cpAfter), DECIDED_CAP) : 0;
  const tolerance = 1 + (DECIDED_PER_PAWN * Math.max(0, still - DECIDED_FROM)) / 100;
  const gradeLoss = best ? 0 : anchoredLoss(gradeCpl / tolerance);

  // Sacrificio: dejas una pieza para que la coman (tras su respuesta pierdes 2 puntos netos o más y no recuperas
  // en esa misma casilla) o, tras la línea del motor (o al acabar en tu mate), has entregado 2 puntos netos o más.
  const sacrifice = () => {
    if (!after.pv.length) return false;
    try {
      const [reply, next] = after.pv;
      const r = new Chess(move.after);
      r.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
      const hanging = materialFor(r.fen(), color) - materialFor(move.before, color) <= -SACRIFICE_POINTS;
      if (hanging && (!next || next.slice(2, 4) !== reply.slice(2, 4))) return true;
      const line = new Chess(move.after);
      for (const u of after.pv.slice(0, SACRIFICE_PLIES)) {
        line.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
        if (line.isCheckmate()) break;
      }
      // Mate tras entregar material: cuenta lo que el rival llegó a comer antes del mate.
      if (line.isCheckmate() && line.turn() !== color) return hanging;
      const net = materialFor(line.fen(), color) - materialFor(move.before, color);
      return after.pv.length >= SACRIFICE_PLIES && net <= -SACRIFICE_POINTS;
    } catch {
      return false; // línea del motor no aplicable
    }
  };

  let cls: Classification;
  if (ctx.inBook && gradeLoss <= LIMITS.buena) cls = 'teoria';
  else if (missedMate) cls = 'fallo';
  // Brillante: la mejor jugada (o sin pérdida) y entrega material; no cuenta si ya estás perdido (−2 o peor)
  // ni si ya ganabas de sobra (+6 o más).
  else if (best && cpAfter > BRILLIANT_FLOOR && cpBefore < BRILLIANT_CEILING && sacrifice()) cls = 'brillante';
  else if (best) {
    // Gran jugada: la mejor, y la segunda mejor opción tiene ΔEP ≥ 0,12 (con la evaluación real:
    // es la única jugada que mantiene el resultado).
    const second = before.second === null ? null : expectedPoints(sign * before.second);
    // Recuperar la pieza que te acaban de comer no cuenta: es obvio aunque sea la única.
    const recapture = !!move.captured && move.to === ctx.prevCapture;
    cls = second !== null && epBefore - second >= GREAT_GAP && !recapture ? 'gran' : 'mejor';
  } else {
    if (gradeLoss <= LIMITS.excelente) cls = 'excelente';
    else if (gradeLoss <= LIMITS.buena) cls = 'buena';
    else if (gradeLoss <= LIMITS.imprecision) cls = 'imprecision';
    else if (gradeLoss <= LIMITS.error) cls = 'error';
    else cls = 'grave';
    // Ocasión fallada: el rival acababa de cometer un error (o algo peor) y no lo castigas: devuelves lo que te había regalado.
    const gift = ctx.prevCpLoss ?? 0;
    if ((cls === 'error' || cls === 'grave') && anchoredLoss(gift) > LIMITS.imprecision && cpLoss >= MISS_GIVEBACK * gift && cpLoss <= gift + MISS_MARGIN)
      cls = 'fallo';
  }
  // Presión: tras la jugada, el rival solo tiene una respuesta que no empeora su posición.
  const decided = Math.abs(evalToCp(after)) > 600;
  const pressure = !decided && after.goodMoves === 1 && new Chess(move.after).moves().length > 1;
  const realEp = (e: PositionEval, cp: number) => (e.mate !== null ? (cp > 0 ? 1 : 0) : 1 / (1 + Math.pow(10, -cp / REAL_SCALE)));
  const mateState = (e: PositionEval, cp: number) => (e.mate === null ? 0 : cp > 0 ? 1 : -1);
  const realLoss = Math.max(0, realEp(before, cpBefore) - realEp(after, cpAfter));
  const mateLoss = mateState(before, cpBefore) > mateState(after, cpAfter) ? MATE_STATE_LOSS : 0;
  const accuracy = cls === 'teoria' || best ? 100 : 100 * Math.exp(-ACCURACY_K * (realLoss + mateLoss));
  return { epBefore, epAfter, epLoss, cpLoss, accuracy, cls, pressure };
}

// Precisión de la partida: media de las raíces cúbicas de la precisión de cada jugada, al cubo. Pesa más los
// fallos que la media aritmética (un 0 entre dieciocho 100 da 85, no 95), como chess.com.
export function playerAccuracy(xs: number[]) {
  return xs.length ? (xs.reduce((a, b) => a + Math.cbrt(b), 0) / xs.length) ** 3 : 0;
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
      const prev = moves[k - 1];
      const judged = judgeMove(move, evals[k], evals[i], {
        inBook: inTheory,
        prevCpLoss: prev?.cpLoss,
        prevCapture: prev?.move.captured ? prev.move.to : undefined,
      });
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
