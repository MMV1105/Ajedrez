import { Chess, type Move } from 'chess.js';
import { Engine, scoreOf, type Line } from './engine';

export type Classification = 'brillante' | 'gran' | 'mejor' | 'excelente' | 'buena' | 'imprecision' | 'error' | 'grave';

export const CLASS_INFO: Record<Classification, { label: string; color: string; icon: string }> = {
  brillante: { label: 'Brillante', color: '#26c2a3', icon: '!!' },
  gran: { label: 'Gran jugada', color: '#5c8bb0', icon: '!' },
  mejor: { label: 'Mejor', color: '#81b64c', icon: '★' },
  excelente: { label: 'Excelente', color: '#96bc4b', icon: '👍' },
  buena: { label: 'Buena', color: '#97af8b', icon: '✓' },
  imprecision: { label: 'Imprecisión', color: '#f7c631', icon: '?!' },
  error: { label: 'Error', color: '#ffa459', icon: '?' },
  grave: { label: 'Error grave', color: '#fa412d', icon: '??' },
};

export type PositionEval = { cp: number; mate: number | null; best: string | null; second: number | null; pv: string[] };

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
  cls: Classification;
};

export type GameAnalysis = {
  moves: AnalyzedMove[];
  evals: PositionEval[]; // por posición, desde blancas
  accuracy: { w: number; b: number };
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

async function evalPosition(engine: Engine, fen: string, depth: number): Promise<PositionEval> {
  const chess = new Chess(fen);
  const whiteToMove = chess.turn() === 'w';
  if (chess.isCheckmate()) return { cp: whiteToMove ? -10000 : 10000, mate: 0, best: null, second: null, pv: [] };
  if (chess.isDraw() || chess.isStalemate()) return { cp: 0, mate: null, best: null, second: null, pv: [] };
  const lines: Line[] = await engine.analyse(fen, { depth, multipv: 2 });
  const sign = whiteToMove ? 1 : -1;
  const [a, b] = lines;
  return {
    cp: sign * scoreOf(a),
    mate: a.mate === null ? null : sign * a.mate,
    best: a.move,
    second: b ? sign * scoreOf(b) : null,
    pv: a.pv,
  };
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
  const moves: AnalyzedMove[] = history.map((move, i) => {
    const color = move.color;
    const sign = color === 'w' ? 1 : -1;
    const before = evals[i];
    const after = evals[i + 1];
    const winBefore = winPct(sign * evalToCp(before));
    const winAfter = winPct(sign * evalToCp(after));
    const loss = Math.max(0, winBefore - winAfter);
    const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
    const uci = move.from + move.to + (move.promotion ?? '');
    let cls: Classification;
    if (uci === before.best || loss < 0.5) {
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
    } else if (loss < 2) cls = 'excelente';
    else if (loss < 5) cls = 'buena';
    else if (loss < 10) cls = 'imprecision';
    else if (loss < 20) cls = 'error';
    else cls = 'grave';
    return {
      move,
      fenBefore: move.before,
      fenAfter: move.after,
      color,
      evalBefore: before,
      evalAfter: after,
      winBefore,
      winAfter,
      accuracy,
      cls,
    };
  });
  const acc = (c: 'w' | 'b') => {
    const xs = moves.filter((m) => m.color === c).map((m) => m.accuracy);
    if (!xs.length) return 0;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const harmonic = xs.length / xs.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
    return (mean + harmonic) / 2;
  };
  return { moves, evals, accuracy: { w: acc('w'), b: acc('b') } };
}

export function formatEval(e: Pick<PositionEval, 'cp' | 'mate'>) {
  if (e.mate !== null) return e.mate === 0 ? '#' : `M${Math.abs(e.mate)}`;
  const v = e.cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}
