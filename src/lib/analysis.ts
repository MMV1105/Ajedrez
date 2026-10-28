import { Chess, type Move } from 'chess.js';
import { Engine, scoreOf, type Line } from './engine';

export type Classification = 'brillante' | 'gran' | 'mejor' | 'excelente' | 'buena' | 'imprecision' | 'error' | 'grave';

export const CLASS_INFO: Record<Classification, { label: string; color: string; icon: string }> = {
  brillante: { label: 'Brillante', color: '#26c2a3', icon: '!!' },
  gran: { label: 'Gran jugada', color: '#5c8bb0', icon: '!' },
  mejor: { label: 'Mejor', color: '#81b64c', icon: '★' },
  excelente: { label: 'Excelente', color: '#96bc4b', icon: '+' },
  buena: { label: 'Buena', color: '#97af8b', icon: '✓' },
  imprecision: { label: 'Imprecisión', color: '#f7c631', icon: '?!' },
  error: { label: 'Error', color: '#ffa459', icon: '?' },
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
  winBefore: number; // % de victoria del que mueve
  winAfter: number;
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
  const lines: Line[] = await engine.analyse(fen, { depth, multipv: 3 });
  const sign = whiteToMove ? 1 : -1;
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

// Exigencia del análisis. Subir CP_DIVISOR o ACCURACY_DECAY lo hace más blando; bajarlos, más duro.
// Cada centipeón perdido cuenta 1/CP_DIVISOR puntos de pérdida (8 → perder 80 cp son 10 puntos).
const CP_DIVISOR = 8;
// En posiciones decididas (más de +3) la pérdida en centipeones pesa menos, hasta este mínimo a +10.
const DECIDED_MIN_WEIGHT = 0.6;
// Pendiente de la curva de precisión (Lichess usa 0.04354): pérdida 5 → 71, pérdida 10 → 51.
const ACCURACY_DECAY = 0.065;
// Pérdida máxima (en puntos) para cada nota; por encima de la última, error grave.
const LIMITS = { mejor: 0.3, excelente: 1.5, buena: 3, imprecision: 7, error: 14 };

// Nota de una jugada a partir de la evaluación antes y después.
// Es más exigente que la de Lichess: además de la probabilidad de ganar, cuenta los
// centipeones perdidos, para que los errores en posiciones ya decididas también resten.
export function judgeMove(move: Move, before: PositionEval, after: PositionEval) {
  const color = move.color;
  const sign = color === 'w' ? 1 : -1;
  const winBefore = winPct(sign * evalToCp(before));
  const winAfter = winPct(sign * evalToCp(after));
  const winLoss = Math.max(0, winBefore - winAfter);
  const cpLoss = Math.max(0, clampCp(sign * evalToCp(before)) - clampCp(sign * evalToCp(after)));
  // En posiciones muy decididas un mismo error en centipeones importa algo menos.
  const level = Math.abs(clampCp(sign * evalToCp(before)));
  const weight = level <= 300 ? 1 : 1 - ((level - 300) / 700) * (1 - DECIDED_MIN_WEIGHT);
  // Si tras la jugada sigues aplastando (+6 o más), solo cuenta la probabilidad de ganar:
  // así no se castiga elegir un camino más largo hacia una victoria que sigue siendo clara.
  const crushing = sign * evalToCp(after) >= 600;
  const loss = crushing ? winLoss : Math.max(winLoss, (cpLoss / CP_DIVISOR) * weight);
  const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-ACCURACY_DECAY * loss) - 3.1669));
  const uci = move.from + move.to + (move.promotion ?? '');
  let cls: Classification;
  if (uci === before.best || (loss < LIMITS.mejor && cpLoss <= 3)) {
    cls = 'mejor';
    // ¿Única buena jugada? La segunda opción perdía mucho.
    const secondWin = before.second === null ? null : winPct(sign * before.second);
    if (secondWin !== null && winBefore - secondWin > 12 && winBefore < 92 && winAfter > 40) cls = 'gran';
    // Sacrificio que funciona: tras la mejor respuesta queda con menos material y sigue bien.
    if (move.piece !== 'p' && after.best && winAfter > 50 && winBefore < 97) {
      const reply = new Chess(move.after);
      try {
        reply.move({ from: after.best.slice(0, 2), to: after.best.slice(2, 4), promotion: after.best[4] });
        if (materialFor(reply.fen(), color) - materialFor(move.before, color) <= -2) cls = 'brillante';
      } catch {
        /* jugada del motor no aplicable */
      }
    }
  } else if (loss < LIMITS.excelente) cls = 'excelente';
  else if (loss < LIMITS.buena) cls = 'buena';
  else if (loss < LIMITS.imprecision) cls = 'imprecision';
  else if (loss < LIMITS.error) cls = 'error';
  else cls = 'grave';
  // Presión: tras la jugada, el rival solo tiene una respuesta que no empeora su posición.
  const decided = Math.abs(evalToCp(after)) > 600;
  const pressure = !decided && after.goodMoves === 1 && new Chess(move.after).moves().length > 1;
  return { winBefore, winAfter, cpLoss, accuracy, cls, pressure };
}

export function playerAccuracy(xs: number[]) {
  if (!xs.length) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const harmonic = xs.length / xs.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return (mean + harmonic) / 2;
}

export async function analyzeGame(
  engine: Engine,
  pgn: string,
  depth: number,
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean,
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
  const moves: AnalyzedMove[] = history.map((move, i) => ({
    move,
    fenBefore: move.before,
    fenAfter: move.after,
    color: move.color,
    evalBefore: evals[i],
    evalAfter: evals[i + 1],
    ...judgeMove(move, evals[i], evals[i + 1]),
  }));
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
