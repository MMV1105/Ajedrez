// Genera puzzles tácticos jugando partidas imperfectas de Stockfish contra sí mismo
// y buscando posiciones con una única jugada ganadora (mates cortos o ganancia de material).
// Uso: node scripts/gen-puzzles.mjs <objetivo> <salida.jsonl>
import fs from 'node:fs';
import { Chess } from 'chess.js';
import { Engine, scoreOf } from './uci.mjs';

const target = Number(process.argv[2] ?? 50);
const out = process.argv[3] ?? 'puzzles.jsonl';
const DEPTH = 16;

const eng = new Engine();
await eng.init();

const uciMove = (chess, uci) => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
let found = 0;
const seen = new Set();

function pickMove(lines) {
  if (Math.random() < 0.6 || lines.length === 1) return lines[0].move;
  return lines[1 + Math.floor(Math.random() * (lines.length - 1))].move;
}

async function tryPuzzle(fenBefore, blunder, prevScoreForS) {
  const chess = new Chess(fenBefore);
  uciMove(chess, blunder);
  if (chess.isGameOver()) return null;
  const fen = chess.fen();
  const lines = await eng.analyse(fen, { depth: DEPTH, multipv: 2 });
  if (!lines.length) return null;
  const [best, second] = lines;
  const b = scoreOf(best), s = scoreOf(second);
  let theme, solution;
  if (best.mate !== null && best.mate > 0 && best.mate <= 3) {
    // Para mate en 1 se aceptan varias jugadas; para mates más largos la primera debe ser única.
    if (best.mate > 1 && second && second.mate !== null && second.mate > 0 && second.mate <= best.mate) return null;
    theme = `mate${best.mate}`;
    solution = best.pv.slice(0, best.mate * 2 - 1);
    if (solution.length !== best.mate * 2 - 1) return null;
  } else if (best.cp !== null && b >= 200 && b <= 1500 && b - s >= 200 && prevScoreForS <= 60) {
    const first = best.move;
    // Evita la simple recaptura en la casilla donde acaba de caer la pieza.
    if (first.slice(2, 4) === blunder.slice(2, 4)) return null;
    theme = 'material';
    solution = [first];
    const c2 = new Chess(fen);
    uciMove(c2, first);
    if (best.pv[1] && !c2.isGameOver()) {
      uciMove(c2, best.pv[1]);
      const l2 = await eng.analyse(c2.fen(), { depth: DEPTH, multipv: 2 });
      if (l2.length && scoreOf(l2[0]) >= 200 && scoreOf(l2[0]) - scoreOf(l2[1]) >= 200) {
        solution.push(best.pv[1], l2[0].move);
      }
    }
  } else return null;
  // Comprueba legalidad de toda la línea.
  const check = new Chess(fen);
  for (const m of solution) if (!uciMove(check, m)) return null;
  const rating = { mate1: 700, mate2: 1300, mate3: 1700 }[theme] ?? (solution.length > 1 ? 1500 : 1050);
  return { fen: fenBefore, moves: [blunder, ...solution], theme, rating: rating + Math.round((Math.random() - 0.5) * 300) };
}

while (found < target) {
  const chess = new Chess();
  let prevForMover = 0; // evaluación de la posición actual desde el bando que mueve
  for (let ply = 0; ply < 140 && !chess.isGameOver() && found < target; ply++) {
    const fen = chess.fen();
    const lines = await eng.analyse(fen, { depth: 8, multipv: 4 });
    if (!lines.length) break;
    prevForMover = scoreOf(lines[0]);
    const mv = pickMove(lines);
    if (ply >= 12 && mv !== lines[0].move && Math.abs(prevForMover) < 400) {
      const key = fen.split(' ').slice(0, 2).join(' ');
      if (!seen.has(key)) {
        seen.add(key);
        // Desde el punto de vista del rival (el que resolverá el puzzle) antes del error.
        const p = await tryPuzzle(fen, mv, -prevForMover);
        if (p) {
          fs.appendFileSync(out, JSON.stringify(p) + '\n');
          found++;
          console.log(found, p.theme, p.moves.join(' '));
        }
      }
    }
    uciMove(chess, mv);
  }
}
eng.quit();
process.exit(0);
