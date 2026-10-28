// Genera las lecciones de aperturas (con blancas) y defensas (con negras): src/data/opening-lessons.json.
// Cada lección parte de una posición de teoría y tiene una línea por cada respuesta habitual del rival.
// Las líneas siguen el libro (src/data/openings.json); tus jugadas se comprueban con Stockfish a profundidad 14
// y, si la de teoría más jugada pierde demasiado, se elige otra de teoría o la del motor.
// Uso: node scripts/build-opening-lessons.mjs src/data/opening-lessons.json
import fs from 'node:fs';
import { Chess } from 'chess.js';
import { Engine, scoreOf } from './uci.mjs';

const out = process.argv[2] ?? 'opening-lessons.json';
const { nodes } = JSON.parse(fs.readFileSync(new URL('../src/data/openings.json', import.meta.url)));
const DEPTH = 14;
const MAX_LOSS = 60; // centipeones que puede perder tu jugada frente a la mejor
const USER_MOVES = 5; // jugadas tuyas por línea
const MAX_BRANCHES = 5;
const MIN_SHARE = 0.04;

// Ordenadas de más a menos jugadas.
const LESSONS = [
  { id: 'op-e4', side: 'w', title: '1.e4: peón de rey', setup: 'e4', intro: 'La apertura más jugada. Ocupa el centro y abre paso a la dama y al alfil.' },
  { id: 'op-d4', side: 'w', title: '1.d4: peón de dama', setup: 'd4', intro: 'La segunda más jugada. Más posicional: el peón de d4 está defendido por la dama.' },
  { id: 'op-espanola', side: 'w', title: 'Apertura española', setup: 'e4 e5 Nf3 Nc6 Bb5', intro: 'El alfil presiona al caballo que defiende e5. Una de las aperturas más sólidas.' },
  { id: 'op-italiana', side: 'w', title: 'Apertura italiana', setup: 'e4 e5 Nf3 Nc6 Bc4', intro: 'El alfil apunta a f7, el punto débil de las negras.' },
  { id: 'op-gambito-dama', side: 'w', title: 'Gambito de dama', setup: 'd4 d5 c4', intro: 'Se ofrece el peón de c4 para quitarle el centro a las negras.' },
  { id: 'op-londres', side: 'w', title: 'Sistema Londres', setup: 'd4 d5 Bf4', intro: 'Un esquema fácil de aprender: alfil a f4, e3, c3 y desarrollo tranquilo.' },
  { id: 'op-inglesa', side: 'w', title: 'Apertura inglesa', setup: 'c4', intro: 'Se controla d5 desde el flanco. Suele llevar a posiciones de maniobra.' },
  { id: 'op-escocesa', side: 'w', title: 'Apertura escocesa', setup: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4', intro: 'Se abre el centro enseguida y las piezas salen rápido.' },
  { id: 'op-catalana', side: 'w', title: 'Apertura catalana', setup: 'd4 Nf6 c4 e6 g3', intro: 'El alfil en g2 presiona la gran diagonal hacia b7.' },
  { id: 'op-vienesa', side: 'w', title: 'Apertura vienesa', setup: 'e4 e5 Nc3', intro: 'Se desarrolla el caballo y se prepara f4 para atacar.' },
  { id: 'op-gambito-rey', side: 'w', title: 'Gambito de rey', setup: 'e4 e5 f4', intro: 'Se sacrifica un peón para abrir la columna f y atacar.' },
  { id: 'op-reti', side: 'w', title: 'Apertura Réti', setup: 'Nf3 d5 c4', intro: 'Se ataca el centro desde los lados sin ocuparlo con peones.' },

  { id: 'def-siciliana', side: 'b', title: 'Defensa siciliana', setup: 'e4 c5', intro: 'La respuesta más jugada a 1.e4. Desequilibra la posición desde el principio.' },
  { id: 'def-e5', side: 'b', title: '1...e5 contra 1.e4', setup: 'e4 e5', intro: 'La respuesta clásica: también ocupas el centro y desarrollas con naturalidad.' },
  { id: 'def-francesa', side: 'b', title: 'Defensa francesa', setup: 'e4 e6 d4 d5', intro: 'Cadena de peones sólida; a cambio el alfil de c8 tarda en salir.' },
  { id: 'def-caro-kann', side: 'b', title: 'Defensa Caro-Kann', setup: 'e4 c6 d4 d5', intro: 'Como la francesa, pero el alfil de c8 puede salir antes de e6.' },
  { id: 'def-gdr', side: 'b', title: 'Gambito de dama rehusado', setup: 'd4 d5 c4 e6', intro: 'Mantienes el peón de d5 con e6. Muy sólida.' },
  { id: 'def-eslava', side: 'b', title: 'Defensa eslava', setup: 'd4 d5 c4 c6', intro: 'Defiendes d5 con c6 y el alfil de c8 sigue libre.' },
  { id: 'def-india-rey', side: 'b', title: 'Defensa india de rey', setup: 'd4 Nf6 c4 g6 Nc3 Bg7', intro: 'Dejas que las blancas ocupen el centro para atacarlo después.' },
  { id: 'def-nimzoindia', side: 'b', title: 'Defensa nimzoindia', setup: 'd4 Nf6 c4 e6 Nc3 Bb4', intro: 'El alfil clava el caballo de c3 y lucha por e4.' },
  { id: 'def-escandinava', side: 'b', title: 'Defensa escandinava', setup: 'e4 d5 exd5 Qxd5', intro: 'Atacas e4 en la primera jugada; la dama sale pronto.' },
  { id: 'def-petrov', side: 'b', title: 'Defensa Petrov', setup: 'e4 e5 Nf3 Nf6', intro: 'En vez de defender e5, contraatacas e4.' },
  { id: 'def-grunfeld', side: 'b', title: 'Defensa Grünfeld', setup: 'd4 Nf6 c4 g6 Nc3 d5', intro: 'Cedes el centro para atacarlo con el alfil de g7 y c5.' },
  { id: 'def-holandesa', side: 'b', title: 'Defensa holandesa', setup: 'd4 f5', intro: 'Controlas e4 con el peón de f y buscas juego en el flanco de rey.' },
  { id: 'def-pirc', side: 'b', title: 'Defensa Pirc', setup: 'e4 d6 d4 Nf6', intro: 'Desarrollo flexible con g6 y Bg7, atacando el centro más tarde.' },
  { id: 'def-alekhine', side: 'b', title: 'Defensa Alekhine', setup: 'e4 Nf6', intro: 'Provocas el avance de los peones blancos para atacarlos después.' },
];

const keyOf = (fen) => fen.split(' ').slice(0, 4).join(' ');
const uciMove = (chess, u) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
const bookAt = (fen) => {
  const m = nodes[keyOf(fen)]?.m ?? [];
  const total = m.reduce((s, [, w]) => s + w, 0);
  return [...m].sort((a, b) => b[1] - a[1]).map(([uci, w]) => ({ uci, share: w / total }));
};
const nameAt = (fen) => nodes[keyOf(fen)]?.n ?? null;

const eng = new Engine();
await eng.init();

// Puntuación (desde el bando que mueve en `fen`) de jugar `uci`.
async function scoreAfter(fen, uci) {
  const c = new Chess(fen);
  uciMove(c, uci);
  if (c.isCheckmate()) return 100000;
  if (c.isGameOver()) return 0;
  const [reply] = await eng.analyse(c.fen(), { depth: DEPTH - 1, multipv: 1 });
  return reply ? -scoreOf(reply) : 0;
}

// Tu jugada: de las tres de teoría más jugadas, la mejor según el motor si no pierde más de MAX_LOSS;
// si ninguna vale (o no hay teoría), la del motor.
async function userMove(fen) {
  const [best] = await eng.analyse(fen, { depth: DEPTH, multipv: 1 });
  if (!best) return null;
  const top = scoreOf(best);
  const options = [];
  for (const b of bookAt(fen).slice(0, 3)) {
    const sc = b.uci === best.move ? top : await scoreAfter(fen, b.uci);
    if (top - sc <= MAX_LOSS) options.push({ uci: b.uci, sc, share: b.share });
  }
  options.sort((a, b) => b.sc - a.sc || b.share - a.share);
  return options[0] ? { uci: options[0].uci, book: true } : { uci: best.move, book: false };
}

// Jugada del rival: la de teoría más jugada que sea sensata (no pierde más de 80 cp); si no, la del motor.
async function opponentMove(fen) {
  const [best] = await eng.analyse(fen, { depth: DEPTH, multipv: 1 });
  if (!best) return null;
  const top = scoreOf(best);
  for (const b of bookAt(fen).slice(0, 3)) {
    if (b.uci === best.move || top - (await scoreAfter(fen, b.uci)) <= 80) return { uci: b.uci, book: true };
  }
  return { uci: best.move, book: false };
}

// Respuestas del rival a la posición de la lección: las de teoría con al menos MIN_SHARE
// y, si hay pocas, las mejores del motor (sin porcentaje).
async function repliesAt(fen) {
  const book = bookAt(fen).filter((b) => b.share >= MIN_SHARE);
  const lines = await eng.analyse(fen, { depth: DEPTH, multipv: 4 });
  const top = lines.length ? scoreOf(lines[0]) : 0;
  const out = [];
  for (const b of book) if (lines.some((l) => l.move === b.uci) || top - (await scoreAfter(fen, b.uci)) <= 120) out.push({ uci: b.uci, share: Math.round(b.share * 100) });
  for (const l of lines) if (out.length < 4 && !out.some((o) => o.uci === l.move) && top - scoreOf(l) <= 60) out.push({ uci: l.move, share: null });
  return out.slice(0, MAX_BRANCHES);
}

const lessons = [];
for (const l of LESSONS) {
  const chess = new Chess();
  const setup = l.setup.split(' ').map((san) => {
    const m = chess.move(san);
    return m.from + m.to + (m.promotion ?? '');
  });
  if ((chess.turn() === 'w') === (l.side === 'w')) throw new Error(`${l.id}: tras la preparación debe mover el rival`);
  const start = chess.fen();
  const branches = [];
  for (const reply of await repliesAt(start)) {
    const c = new Chess(start);
    const moves = [reply.uci];
    const book = [reply.share !== null];
    uciMove(c, reply.uci);
    let name = nameAt(c.fen());
    let mine = 0;
    while (mine < USER_MOVES && !c.isGameOver()) {
      const u = await userMove(c.fen());
      if (!u || (!u.book && mine >= 3)) break; // fuera de teoría, la línea se corta pronto
      moves.push(u.uci);
      book.push(u.book);
      uciMove(c, u.uci);
      mine++;
      name = nameAt(c.fen()) ?? name;
      if (mine >= USER_MOVES || c.isGameOver()) break;
      const opp = await opponentMove(c.fen());
      if (!opp) break;
      moves.push(opp.uci);
      book.push(opp.book);
      uciMove(c, opp.uci);
      name = nameAt(c.fen()) ?? name;
    }
    // La primera jugada es del rival y las tuyas van en posiciones impares: si la línea acaba en una suya, se quita.
    if (moves.length % 2 === 1) {
      moves.pop();
      book.pop();
    }
    if (moves.length < 4) continue; // al menos dos jugadas tuyas
    branches.push({ reply: reply.uci, share: reply.share, name, moves, book });
    console.log(l.id, reply.share, name, moves.join(' '));
  }
  lessons.push({ id: l.id, side: l.side, title: l.title, intro: l.intro, setup, branches });
}

fs.writeFileSync(out, JSON.stringify(lessons, null, 0));
console.log(lessons.length, 'lecciones,', lessons.reduce((s, l) => s + l.branches.length, 0), 'líneas');
eng.quit();
process.exit(0);
