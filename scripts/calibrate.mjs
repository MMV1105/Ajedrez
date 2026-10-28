// Ajusta la fórmula de precisión para que se parezca a la de chess.com.
// Entrada: un JSON con partidas y la precisión que les da chess.com:
//   [{ "pgn": "...", "white": 74.2, "black": 81.0 }, ...]   (null si no se sabe)
// Analiza cada posición con Stockfish (mejor uno nativo: STOCKFISH_PATH=/ruta/stockfish) y prueba
// varias fórmulas, buscando para cada una el parámetro que más se acerca a los números de chess.com.
// Uso: STOCKFISH_PATH=... node scripts/calibrate.mjs partidas.json [profundidad]
import fs from 'node:fs';
import { Chess } from 'chess.js';
import { Engine, scoreOf } from './uci.mjs';

const [file, depthArg] = process.argv.slice(2);
const DEPTH = Number(depthArg ?? 16);
const games = JSON.parse(fs.readFileSync(file, 'utf8'));
const cacheFile = `${file}.evals-${DEPTH}.json`;
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};

const clamp = (v) => Math.max(-3000, Math.min(3000, v));
const eng = new Engine();
await eng.init();

// Evaluación de cada posición desde las blancas (en centipeones, los mates como ±3000).
async function evalsFor(pgn) {
  if (cache[pgn]) return cache[pgn];
  const c = new Chess();
  c.loadPgn(pgn);
  const hist = c.history({ verbose: true });
  const fens = [hist[0].before, ...hist.map((m) => m.after)];
  const out = [];
  for (const fen of fens) {
    const pos = new Chess(fen);
    const sign = pos.turn() === 'w' ? 1 : -1;
    if (pos.isCheckmate()) out.push(-sign * 3000);
    else if (pos.isDraw()) out.push(0);
    else {
      const [l] = await eng.analyse(fen, { depth: DEPTH, multipv: 1 });
      out.push(sign * clamp(scoreOf(l)));
    }
  }
  cache[pgn] = out;
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  return out;
}

const ep = (cp, scale = 400) => 1 / (1 + Math.pow(10, -cp / scale));
const lichessWin = (cp) => 1 / (1 + Math.exp(-0.00368208 * cp));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const harmonic = (xs) => xs.length / xs.reduce((a, b) => a + 1 / Math.max(b, 1), 0);

// Pérdida de cada jugada de un bando, con la curva dada (0 a 1).
function losses(evals, color, curve) {
  const out = [];
  for (let i = 0; i + 1 < evals.length; i++) {
    const white = i % 2 === 0;
    if ((color === 'w') !== white) continue;
    const s = white ? 1 : -1;
    out.push(Math.max(0, curve(s * evals[i]) - curve(s * evals[i + 1])));
  }
  return out;
}

const MODELS = {
  'EP, 100·e^(−k·ΔEP), media': { curve: (cp) => ep(cp), acc: (l, k) => 100 * Math.exp(-k * l), agg: mean, ks: range(1, 40, 0.25) },
  'EP, curva Lichess, media': { curve: (cp) => ep(cp), acc: lich, agg: mean, ks: range(0.01, 0.2, 0.0025) },
  'EP, curva Lichess, media+armónica': { curve: (cp) => ep(cp), acc: lich, agg: (x) => (mean(x) + harmonic(x)) / 2, ks: range(0.01, 0.2, 0.0025) },
  'Win% Lichess, curva Lichess, media': { curve: lichessWin, acc: lich, agg: mean, ks: range(0.01, 0.2, 0.0025) },
  'Win% Lichess, curva Lichess, media+armónica': { curve: lichessWin, acc: lich, agg: (x) => (mean(x) + harmonic(x)) / 2, ks: range(0.01, 0.2, 0.0025) },
};
function lich(l, k) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-k * 100 * l) - 3.1669));
}
function range(a, b, step) {
  const r = [];
  for (let x = a; x <= b + 1e-9; x += step) r.push(Number(x.toFixed(4)));
  return r;
}

const data = [];
for (const g of games) {
  const evals = await evalsFor(g.pgn);
  for (const c of ['w', 'b']) {
    const target = c === 'w' ? g.white : g.black;
    if (target != null) data.push({ evals, color: c, target, name: `${g.name ?? data.length / 2 + 1} ${c}` });
  }
}
eng.quit();

for (const [name, m] of Object.entries(MODELS)) {
  let best = null;
  for (const k of m.ks) {
    const preds = data.map((d) => m.agg(losses(d.evals, d.color, m.curve).map((l) => m.acc(l, k))));
    const err = Math.sqrt(mean(preds.map((p, i) => (p - data[i].target) ** 2)));
    if (!best || err < best.err) best = { k, err, preds };
  }
  console.log(`\n${name}: k = ${best.k}, error medio ${best.err.toFixed(1)}`);
  data.forEach((d, i) => console.log(`  ${d.name.padEnd(12)} chess.com ${d.target.toFixed(1)}  nuestra ${best.preds[i].toFixed(1)}`));
}
process.exit(0);
