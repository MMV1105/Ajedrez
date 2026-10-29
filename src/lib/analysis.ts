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
  epLoss: number; // pérdida que usa la precisión
  clsLoss: number; // pérdida que usa la nota
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

const clampCp = (v: number) => Math.max(-1000, Math.min(1000, v));

// Valoración al estilo de chess.com: cada evaluación se pasa a puntos esperados (EP, de 0 a 1)
// y la nota de la jugada sale de cuántos puntos esperados pierde frente a la mejor.
export function expectedPoints(cp: number) {
  return 1 / (1 + Math.pow(10, -cp / 400));
}

// Pérdida máxima para cada nota; por encima de la última, error grave.
const LIMITS = { excelente: 0.02, buena: 0.05, imprecision: 0.1, error: 0.2 };
// Pendiente de la precisión por jugada: 100·e^(−k·pérdida). Con 3.2: perder 0.05 → 85, 0.1 → 73, 0.2 → 53.
const ACCURACY_K = 3.2;
// Los puntos esperados apenas cambian cuando ya vas muy perdido (de −8 a −12 casi no se mueven), así que
// regalar material en una partida perdida no contaría, y lo mismo con los errores del que va ganando. Por eso
// la pérdida es también, como mínimo, los centipeones perdidos / CP_SCALE (800: perder un peón son 0,125, un
// error), contando las evaluaciones hasta ±15.
const CP_SCALE = 800;
const CP_CLAMP = 1500;
// Para las notas los centipeones pesan la mitad (perder un peón = imprecisión, una pieza = error grave):
// la precisión tiene que bajar con cada regalo, pero llamar error grave a cada peón perdido es pasarse.
const CLS_CP_SCALE = 1600;
// Si tras la jugada sigues ganando claramente (+3 o más), los centipeones perdidos restan como mucho esto
// (un error en la precisión, una imprecisión en la nota): cuenta, pero no como regalar la partida.
const WINNING = 300;
const WINNING_CAP = { accuracy: 0.15, cls: 0.1 };
// Jugadas de la línea del motor que se miran para decidir si una entrega de material es un sacrificio de verdad.
const SACRIFICE_PLIES = 4;

export type MoveContext = {
  inBook?: boolean; // la jugada es de teoría y la partida sigue en el libro
  prevLoss?: number; // puntos esperados que acaba de perder el rival con su jugada anterior
  prevTo?: string; // casilla de destino de la jugada anterior del rival (para reconocer las recapturas)
};

export function judgeMove(move: Move, before: PositionEval, after: PositionEval, ctx: MoveContext = {}) {
  const color = move.color;
  const sign = color === 'w' ? 1 : -1;
  const cpBefore = sign * evalToCp(before);
  const cpAfter = sign * evalToCp(after);
  const epBefore = expectedPoints(cpBefore);
  const epAfter = expectedPoints(cpAfter);
  const cpLoss = Math.max(0, clampCp(cpBefore) - clampCp(cpAfter));
  const bigCpLoss = Math.max(0, Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cpBefore)) - Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cpAfter)));
  const epDrop = Math.max(0, epBefore - epAfter);
  const winning = cpAfter >= WINNING;
  const epLoss = Math.max(epDrop, Math.min(bigCpLoss / CP_SCALE, winning ? WINNING_CAP.accuracy : Infinity));
  const accuracy = 100 * Math.exp(-ACCURACY_K * epLoss);
  const clsLoss = Math.max(epDrop, Math.min(bigCpLoss / CLS_CP_SCALE, winning ? WINNING_CAP.cls : Infinity));
  const uci = move.from + move.to + (move.promotion ?? '');
  const best = uci === before.best || (clsLoss < 0.001 && cpLoss <= 5);

  // Brillante: casi la mejor jugada que entrega al menos 2 puntos de material: siguiendo la línea del motor,
  // dos jugadas después sigues con menos (si lo recuperas antes, es un cambio, no un sacrificio), o la línea
  // acaba en tu mate. Además la posición no queda peor y, salvo que sea un sacrificio para dar mate, no estaba
  // ya ganada.
  const sacrifice = (): 'mate' | 'material' | null => {
    if (move.piece === 'p' || after.pv.length < 2) return null;
    try {
      const line = new Chess(move.after);
      const down = () => materialFor(line.fen(), color) - materialFor(move.before, color) <= -2;
      const u0 = after.pv[0];
      line.move({ from: u0.slice(0, 2), to: u0.slice(2, 4), promotion: u0[4] });
      if (!down()) return null;
      for (const u of after.pv.slice(1, SACRIFICE_PLIES)) {
        line.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
        if (line.isCheckmate()) return line.turn() !== color ? 'mate' : null;
      }
      return after.pv.length >= SACRIFICE_PLIES && down() ? 'material' : null;
    } catch {
      return null; // línea del motor no aplicable
    }
  };
  const brilliant = () => {
    if (clsLoss > LIMITS.excelente || epAfter < 0.45) return false;
    const sac = sacrifice();
    return sac === 'mate' || (sac === 'material' && cpBefore < 500);
  };
  const recapture = !!move.captured && move.to === ctx.prevTo;

  let cls: Classification;
  if (ctx.inBook && clsLoss <= LIMITS.buena) cls = 'teoria';
  else if (brilliant()) cls = 'brillante';
  else if (best) {
    // Gran jugada: la única buena (la segunda perdía al menos 0.15), que salva o mantiene la partida.
    // Recuperar la pieza que te acaban de comer no cuenta: es obvio.
    const second = before.second === null ? null : expectedPoints(sign * before.second);
    cls = second !== null && epBefore - second >= 0.15 && epAfter >= 0.4 && !recapture ? 'gran' : 'mejor';
  } else if (clsLoss <= LIMITS.excelente) cls = 'excelente';
  else if (clsLoss <= LIMITS.buena) cls = 'buena';
  else if (clsLoss <= LIMITS.imprecision) cls = 'imprecision';
  else {
    // Ocasión fallada: el rival acababa de equivocarse y devuelves lo ganado, sin quedar peor que antes de su error.
    const prev = ctx.prevLoss ?? 0;
    const missed = prev > LIMITS.imprecision && epAfter >= epBefore - prev - 0.05;
    cls = missed ? 'fallo' : clsLoss <= LIMITS.error ? 'error' : 'grave';
  }
  // Presión: tras la jugada, el rival solo tiene una respuesta que no empeora su posición.
  const decided = Math.abs(evalToCp(after)) > 600;
  const pressure = !decided && after.goodMoves === 1 && new Chess(move.after).moves().length > 1;
  return { epBefore, epAfter, epLoss, clsLoss, cpLoss, accuracy, cls, pressure };
}

// Precisión de la partida: media entre la media normal y la armónica, que pesa más las jugadas malas
// (con la media normal, unos pocos errores graves entre muchas jugadas fáciles apenas bajan la nota).
export function playerAccuracy(xs: number[]) {
  if (!xs.length) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const harmonic = xs.length / xs.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return (mean + harmonic) / 2;
}

export const isMistake = (c: Classification) => c === 'error' || c === 'fallo' || c === 'grave';

export async function analyzeGame(
  engine: Engine,
  pgn: string,
  depth: number,
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean,
  book: Book | null = null,
): Promise<GameAnalysis | null> {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  const startFen = history.length ? history[0].before : chess.fen();
  const fens = [startFen, ...history.map((m) => m.after)];
  const evals: PositionEval[] = [];
  for (let i = 0; i < fens.length; i++) {
    if (isCancelled()) return null;
    evals.push(await evalPosition(engine, fens[i], depth));
    onProgress(i + 1, fens.length);
  }
  const moves: AnalyzedMove[] = [];
  let inTheory = !!book && history.length > 0 && history[0].before === new Chess().fen();
  history.forEach((move, i) => {
    const uci = move.from + move.to + (move.promotion ?? '');
    // La teoría solo cuenta mientras la partida no ha salido del libro.
    inTheory = inTheory && bookMoves(book!, move.before).some((m) => m.uci === uci);
    const judged = judgeMove(move, evals[i], evals[i + 1], { inBook: inTheory, prevLoss: moves[i - 1]?.clsLoss, prevTo: history[i - 1]?.to });
    moves.push({ move, fenBefore: move.before, fenAfter: move.after, color: move.color, evalBefore: evals[i], evalAfter: evals[i + 1], ...judged });
  });
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
