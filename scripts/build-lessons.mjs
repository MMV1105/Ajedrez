// Construye src/data/lessons.json a partir de las lecciones de abajo, verificando
// cada ejercicio con Stockfish: la jugada propuesta debe ser (casi) la mejor y
// las respuestas del rival son las del motor.
// Uso: node scripts/build-lessons.mjs
import fs from 'node:fs';
import { Chess } from 'chess.js';
import { Engine, scoreOf } from './uci.mjs';

const L = [
  {
    id: 'horquilla',
    title: 'La horquilla',
    icon: '🍴',
    level: 'Táctica básica',
    steps: [
      { type: 'info', text: 'Una horquilla es un ataque doble: una pieza amenaza dos objetivos a la vez. El rival solo puede salvar uno. El caballo es el rey de las horquillas porque salta y ataca en todas direcciones.', fen: 'r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1', arrows: [['c7', 'e8'], ['c7', 'a8']] },
      { type: 'puzzle', text: 'Busca la horquilla de caballo que gana la torre.', fen: 'r3k3/pp3ppp/8/3N4/8/8/PP3PPP/4K3 w - - 0 1', solver: ['d5c7', 'c7a8'] },
      { type: 'puzzle', text: 'Los peones también hacen horquillas. Gana una pieza.', fen: '4k3/pp3ppp/2n1n3/8/3P4/8/PP3PPP/4K3 w - - 0 1', solver: ['d4d5'] },
    ],
  },
  {
    id: 'clavada',
    title: 'La clavada',
    icon: '📌',
    level: 'Táctica básica',
    steps: [
      { type: 'info', text: 'Una pieza está clavada cuando no puede moverse sin dejar expuesta otra más valiosa detrás. Si detrás está el rey, la clavada es absoluta: ¡ni siquiera es legal moverla!', fen: 'r1bqk2r/pppp1ppp/2n2n2/1B2p3/4P3/2N5/PPPP1PPP/R1BQK1NR b KQkq - 0 1', arrows: [['b5', 'e8']] },
      { type: 'puzzle', text: 'El caballo de c6 está clavado al rey. Atácalo con un peón y ganarás una pieza.', fen: 'r3k2r/ppp2ppp/2n5/1B6/3P4/8/PPP2PPP/R3K2R w KQkq - 0 1', solver: ['d4d5'] },
      { type: 'puzzle', text: 'Clava la dama contra su rey con la torre. Perderá la dama por una torre.', fen: '4k3/pp3ppp/8/4q3/8/8/PP3PPP/3R1K2 w - - 0 1', solver: ['d1e1'] },
    ],
  },
  {
    id: 'pasillo',
    title: 'Mate del pasillo',
    icon: '🚪',
    level: 'Mates',
    steps: [
      { type: 'info', text: 'Cuando el rey se queda encerrado detrás de sus propios peones, una torre o dama en la última fila da mate. Por eso conviene abrir "luz" con h3 o g3 en algún momento.', fen: '3R2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', arrows: [['d8', 'g8']] },
      { type: 'puzzle', text: 'Mate en 1.', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solver: ['d1d8'] },
      { type: 'puzzle', text: 'Mate en 2. Pista: a veces hay que sacrificar la dama.', fen: '2r3k1/5ppp/8/8/8/8/3Q1PPP/3R2K1 w - - 0 1', solver: ['d2d8', '*'] },
    ],
  },
  {
    id: 'pastor',
    title: 'Mate del pastor (y cómo evitarlo)',
    icon: '🐑',
    level: 'Aperturas',
    steps: [
      { type: 'info', text: 'El mate del pastor ataca f7, el punto débil del negro al principio: solo lo defiende el rey. La dama y el alfil apuntan a la vez a f7.', fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', arrows: [['h5', 'f7'], ['c4', 'f7']] },
      { type: 'puzzle', text: 'Juegas con negras. La dama y el alfil amenazan mate en f7. ¡Defiéndete!', fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', solver: ['g7g6'], tolerance: 80 },
      { type: 'puzzle', text: 'Ahora juegas con blancas y el negro no se ha defendido. ¡Mate en 1!', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', solver: ['h5f7'] },
    ],
  },
  {
    id: 'mate-dama',
    title: 'Mate con rey y dama',
    icon: '👑',
    level: 'Finales',
    steps: [
      { type: 'info', text: 'Con la dama, ve encerrando al rey rival en una caja cada vez más pequeña, moviéndote a un salto de caballo de él. ¡Cuidado con el ahogado! Cuando esté en el borde, acerca tu rey y da mate.', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1' },
      { type: 'practice', text: 'Da mate a Stockfish en menos de 20 jugadas.', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', goal: 'mate', maxMoves: 20 },
    ],
  },
  {
    id: 'mate-torre',
    title: 'Mate con rey y torre',
    icon: '🏰',
    level: 'Finales',
    steps: [
      { type: 'info', text: 'La torre corta al rey por filas o columnas. Usa tu rey para tomar la oposición (reyes enfrentados) y entonces da jaque con la torre para empujarlo hacia el borde.', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', arrows: [['a1', 'a4']] },
      { type: 'practice', text: 'Da mate a Stockfish en menos de 32 jugadas.', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', goal: 'mate', maxMoves: 32 },
    ],
  },
  {
    id: 'oposicion',
    title: 'La oposición',
    icon: '♔',
    level: 'Finales',
    steps: [
      { type: 'info', text: 'Dos reyes están en oposición cuando están enfrentados con una casilla en medio. Quien NO tiene que mover "tiene la oposición" y obliga al otro a ceder el paso. Es la clave de los finales de peones.', fen: '8/8/4k3/8/4K3/4P3/8/8 b - - 0 1', arrows: [['e4', 'e6']] },
      { type: 'practice', text: 'Corona el peón contra Stockfish. Pista: tu rey debe ir delante del peón.', fen: '8/8/4k3/8/8/4K3/4P3/8 w - - 0 1', goal: 'promote', maxMoves: 25 },
    ],
  },
];

const eng = new Engine();
await eng.init();
const DEPTH = 18;
let errors = 0;

for (const lesson of L) {
  for (const step of lesson.steps) {
    const chess = new Chess(step.fen); // lanza si el FEN es inválido
    if (step.type === 'info') continue;
    if (step.type === 'practice') {
      const [best] = await eng.analyse(step.fen, { depth: 22 });
      const s = scoreOf(best);
      if (s < 400) {
        console.error(`✗ ${lesson.id}: la práctica no parece ganada (${s})`);
        errors++;
      }
      continue;
    }
    const line = [];
    let acceptLast = [];
    for (let i = 0; i < step.solver.length; i++) {
      const lines = await eng.analyse(chess.fen(), { depth: DEPTH, multipv: 5 });
      const top = scoreOf(lines[0]);
      const tol = step.tolerance ?? 40;
      const ok = lines.filter((l) => (lines[0].mate !== null && lines[0].mate > 0 ? l.mate === lines[0].mate : top - scoreOf(l) <= tol));
      const want = step.solver[i] === '*' ? lines[0].move : step.solver[i];
      if (!ok.some((l) => l.move === want)) {
        console.error(`✗ ${lesson.id}: ${want} no es la mejor en ${chess.fen()} (mejor ${lines[0].move} ${top})`);
        errors++;
      }
      chess.move({ from: want.slice(0, 2), to: want.slice(2, 4), promotion: want[4] });
      line.push(want);
      if (i === step.solver.length - 1) {
        acceptLast = ok.map((l) => l.move);
        break;
      }
      const [reply] = await eng.analyse(chess.fen(), { depth: DEPTH });
      chess.move({ from: reply.move.slice(0, 2), to: reply.move.slice(2, 4), promotion: reply.move[4] });
      line.push(reply.move);
    }
    step.line = line;
    step.acceptLast = acceptLast;
    delete step.solver;
    delete step.tolerance;
    console.log(`✓ ${lesson.id}: ${line.join(' ')} (vale también: ${acceptLast.join(', ')})`);
  }
}
eng.quit();
if (errors) {
  console.error(`${errors} errores`);
  process.exit(1);
}
fs.writeFileSync(new URL('../src/data/lessons.json', import.meta.url), JSON.stringify(L, null, 1));
console.log('lessons.json escrito');
process.exit(0);
