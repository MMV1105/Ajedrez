// Envoltorio mínimo de Stockfish (UCI) para scripts de Node.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(here, '../node_modules/stockfish/src/stockfish-17.1-lite-single-03e3232.js');

export class Engine {
  constructor() {
    this.proc = spawn('node', [ENGINE], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.buf = '';
    this.listeners = [];
    this.proc.stdout.on('data', (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        for (const l of [...this.listeners]) l(line);
      }
    });
  }
  send(cmd) { this.proc.stdin.write(cmd + '\n'); }
  waitFor(pred) {
    return new Promise((resolve) => {
      const lines = [];
      const l = (line) => {
        lines.push(line);
        if (pred(line)) {
          this.listeners = this.listeners.filter((x) => x !== l);
          resolve(lines);
        }
      };
      this.listeners.push(l);
    });
  }
  async init() {
    this.send('uci');
    await this.waitFor((l) => l === 'uciok');
    this.send('setoption name Hash value 64');
    this.send('isready');
    await this.waitFor((l) => l === 'readyok');
  }
  // Devuelve [{move, cp, mate, pv}] ordenado por multipv, desde el punto de vista del bando que mueve.
  async analyse(fen, { depth = 12, multipv = 1 } = {}) {
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}`);
    const lines = await this.waitFor((l) => l.startsWith('bestmove'));
    const res = [];
    for (const l of lines) {
      if (!l.startsWith('info') || !l.includes(' pv ')) continue;
      const mp = Number(/ multipv (\d+)/.exec(l)?.[1] ?? 1);
      const cp = / score cp (-?\d+)/.exec(l);
      const mate = / score mate (-?\d+)/.exec(l);
      const pv = l.split(' pv ')[1].split(' ');
      res[mp - 1] = { move: pv[0], cp: cp ? Number(cp[1]) : null, mate: mate ? Number(mate[1]) : null, pv };
    }
    return res.filter(Boolean);
  }
  quit() { this.send('quit'); this.proc.kill(); }
}

// Puntuación comparable: mates se convierten en valores grandes.
export function scoreOf(line) {
  if (!line) return -100000;
  if (line.mate !== null) return line.mate > 0 ? 100000 - line.mate * 100 : -100000 - line.mate * 100;
  return line.cp;
}
