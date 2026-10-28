// Genera las posiciones del entrenador de aperturas, medio juego y finales.
// Aperturas: líneas conocidas, al final de la teoría (igualada) o con un error del rival.
// Medio juego y finales: partidas imperfectas de Stockfish contra sí mismo.
// Cada posición se verifica a profundidad 16 desde el bando que la juega.
// Uso: node scripts/gen-trainer.mjs src/data/trainer.json
import fs from 'node:fs';
import { Chess } from 'chess.js';
import { Engine, scoreOf } from './uci.mjs';

const out = process.argv[2] ?? 'trainer.json';
const VERIFY_DEPTH = 16;
const MOVES = { apertura: 8, medio: 10, final: 12 };
const CAPS = {
  apertura: { igualada: 45, ventaja: 45, defensa: 0 },
  medio: { igualada: 22, ventaja: 26, defensa: 14 },
  final: { igualada: 20, ventaja: 26, defensa: 14 },
};

const OPENINGS = [
  ['Española, variante cerrada', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O'],
  ['Española, defensa berlinesa', 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8'],
  ['Italiana, Giuoco Piano', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O'],
  ['Gambito Evans', 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O'],
  ['Dos caballos', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6'],
  ['Escocesa', 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5'],
  ['Petrov', 'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6'],
  ['Philidor', 'e4 e5 Nf3 d6 d4 Nf6 Nc3 Nbd7 Bc4 Be7 O-O O-O'],
  ['Vienesa', 'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7'],
  ['Gambito de rey', 'e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5 Nf6'],
  ['Siciliana Najdorf', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6'],
  ['Siciliana Dragón', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6'],
  ['Siciliana Sveshnikov', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5'],
  ['Siciliana Taimanov', 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6'],
  ['Siciliana Alapin', 'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6'],
  ['Francesa Winawer', 'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7'],
  ['Francesa, avance', 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 c4'],
  ['Caro-Kann clásica', 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7'],
  ['Caro-Kann, avance', 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3'],
  ['Escandinava', 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5'],
  ['Pirc', 'e4 d6 d4 Nf6 Nc3 g6 Be3 Bg7 Qd2 c6 f3 b5'],
  ['Alekhine', 'e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4 Be2 e6 O-O Be7'],
  ['Gambito de dama aceptado', 'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6'],
  ['Gambito de dama rehusado', 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6'],
  ['Eslava', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4'],
  ['Catalana', 'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4 Qc2 a6'],
  ['Nimzoindia', 'd4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 d5'],
  ['India de rey', 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7'],
  ['Grünfeld', 'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5'],
  ['Benoni moderna', 'd4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 e4 g6 Nf3 Bg7'],
  ['Holandesa', 'd4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O c4 d6'],
  ['Sistema Londres', 'd4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6 Ngf3 Bd6 Bg3 O-O'],
  ['Inglesa', 'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6'],
  ['Réti', 'Nf3 d5 g3 Nf6 Bg2 c6 O-O Bg4 d3 Nbd7'],
  ['Bird', 'f4 d5 Nf3 Nf6 e3 g6 b3 Bg7 Bb2 O-O'],
];

// Finales clásicos con nombre. El objetivo lo fija la teoría, no la evaluación del motor.
const CLASSICS = [
  { name: 'Posición de Lucena', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', kind: 'ventaja', failLine: 200, moves: 12 },
  { name: 'Defensa de Philidor', fen: '4k3/8/r7/4PK2/8/8/8/1R6 b - - 0 1', kind: 'defensa', failLine: -350, moves: 12 },
  { name: 'Rey y peón: corona', fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', kind: 'ventaja', failLine: 200, moves: 10 },
  { name: 'Rey y peón: haz tablas', fen: '8/8/8/4k3/8/8/4P3/4K3 b - - 0 1', kind: 'defensa', failLine: -150, moves: 12 },
];

const eng = new Engine();
await eng.init();

const uciMove = (chess, uci) => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
const NON_PAWN = { n: 3, b: 3, r: 5, q: 9 };
const nonPawn = (fen) => new Chess(fen).board().flat().reduce((s, p) => s + (p ? (NON_PAWN[p.type] ?? 0) : 0), 0);
const pieceCount = (fen) => new Chess(fen).board().flat().filter(Boolean).length;
const key = (fen) => fen.split(' ').slice(0, 4).join(' ');

const items = [];
const seen = new Set();
const count = (phase, kind) => items.filter((i) => i.phase === phase && i.kind === kind).length;
const full = (phase, kind) => count(phase, kind) >= CAPS[phase][kind];

function kindOf(cp, phase) {
  if (cp >= -60 && cp <= 60) return 'igualada';
  if (cp >= 150 && cp <= (phase === 'final' ? 800 : 600)) return 'ventaja';
  if (cp >= -250 && cp <= -100) return 'defensa';
  return null;
}

function failLineFor(kind, cp) {
  if (kind === 'igualada') return -100;
  if (kind === 'ventaja') return Math.max(80, Math.round(cp * 0.5));
  return cp - 150;
}

// Añade la posición que queda tras jugar `uci` desde `prev`, si encaja en lo buscado.
async function add(phase, name, prev, uci, want) {
  const chess = new Chess(prev);
  uciMove(chess, uci);
  if (chess.isGameOver()) return false;
  const fen = chess.fen();
  if (seen.has(key(fen))) return false;
  const [line] = await eng.analyse(fen, { depth: VERIFY_DEPTH, multipv: 1 });
  if (!line || line.mate !== null) return false;
  const cp = scoreOf(line);
  const kind = kindOf(cp, phase);
  if (!kind || (want && kind !== want) || full(phase, kind)) return false;
  seen.add(key(fen));
  items.push({
    id: `${phase[0]}${items.length}`,
    phase,
    name,
    kind,
    prev,
    last: uci,
    fen,
    eval: cp,
    failLine: failLineFor(kind, cp),
    moves: MOVES[phase],
  });
  console.log(phase, kind, cp, name);
  return true;
}

// Aperturas
for (const [name, line] of OPENINGS) {
  const chess = new Chess();
  const fens = [chess.fen()];
  const ucis = [];
  for (const san of line.split(' ')) {
    const mv = chess.move(san);
    ucis.push(mv.from + mv.to + (mv.promotion ?? ''));
    fens.push(chess.fen());
  }
  const n = ucis.length;
  // Igualada al final de la teoría, con cada color.
  await add('apertura', name, fens[n - 1], ucis[n - 1], 'igualada');
  await add('apertura', name, fens[n - 2], ucis[n - 2], 'igualada');
  // El rival se equivoca en algún punto de la línea.
  const tried = new Set();
  let made = 0;
  for (let attempt = 0; attempt < 5 && made < 2; attempt++) {
    const k = 6 + Math.floor(Math.random() * (n - 5));
    if (tried.has(k)) continue;
    tried.add(k);
    const lines = await eng.analyse(fens[k], { depth: 12, multipv: 8 });
    if (!lines.length) continue;
    const best = scoreOf(lines[0]);
    if (best < -60 || best > 80) continue;
    const errors = lines.filter((l) => l.mate === null && best - scoreOf(l) >= 150 && best - scoreOf(l) <= 500);
    if (!errors.length) continue;
    const pick = errors[Math.floor(Math.random() * errors.length)];
    if (await add('apertura', name, fens[k], pick.move, 'ventaja')) made++;
  }
}

// Medio juego y finales: partidas imperfectas desde el final de cada apertura.
const pickMove = (lines) => (Math.random() < 0.7 || lines.length === 1 ? lines[0] : lines[1 + Math.floor(Math.random() * (lines.length - 1))]);
const done = () => ['medio', 'final'].every((p) => ['igualada', 'ventaja', 'defensa'].every((k) => full(p, k)));

for (let game = 0; game < 200 && !done(); game++) {
  const [name, line] = OPENINGS[game % OPENINGS.length];
  const chess = new Chess();
  for (const san of line.split(' ')) chess.move(san);
  const taken = { medio: 0, final: 0 };
  for (let ply = chess.history().length; ply < 160 && !chess.isGameOver(); ply++) {
    const fen = chess.fen();
    const lines = await eng.analyse(fen, { depth: 8, multipv: 4 });
    if (!lines.length) break;
    const best = scoreOf(lines[0]);
    const chosen = pickMove(lines);
    const material = nonPawn(fen);
    const phase = ply >= 20 && material > 26 ? 'medio' : material <= 26 && pieceCount(fen) >= 5 ? 'final' : null;
    if (phase && taken[phase] < 2 && Math.abs(best) <= 400) {
      const swing = best - scoreOf(chosen);
      const label = phase === 'medio' ? `Desde la ${name}` : 'Final';
      let ok = false;
      // Error del rival: la posición estaba igualada y la jugada elegida pierde mucho.
      if (swing >= 150 && Math.abs(best) <= 80) ok = await add(phase, label, fen, chosen.move, 'ventaja');
      // Igualada o posición difícil de defender, de vez en cuando.
      else if (Math.random() < 0.12) ok = await add(phase, label, fen, chosen.move, null);
      if (ok) taken[phase]++;
    }
    uciMove(chess, chosen.move);
  }
}

// Finales clásicos: se comprueba que el motor no los vea perdidos para quien los juega.
for (const c of CLASSICS) {
  const [line] = await eng.analyse(c.fen, { depth: VERIFY_DEPTH, multipv: 1 });
  const cp = scoreOf(line);
  if (cp < c.failLine + 50) {
    console.log('descartado', c.name, cp);
    continue;
  }
  items.push({ id: `c${items.length}`, phase: 'final', name: c.name, kind: c.kind, prev: null, last: null, fen: c.fen, eval: cp, failLine: c.failLine, moves: c.moves, classic: true });
  console.log('final', c.kind, cp, c.name);
}

fs.writeFileSync(out, JSON.stringify(items));
console.log(Object.fromEntries(['apertura', 'medio', 'final'].map((p) => [p, ['igualada', 'ventaja', 'defensa'].map((k) => count(p, k))])));
eng.quit();
process.exit(0);
