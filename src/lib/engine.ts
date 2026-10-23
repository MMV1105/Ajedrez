// Stockfish 19 (lite, un hilo) ejecutándose en un Web Worker.

export type Line = {
  move: string;
  cp: number | null;
  mate: number | null;
  pv: string[];
  depth: number;
};

const ENGINE_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`;

export class Engine {
  private worker: Worker;
  private listeners: ((line: string) => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private dead = false;
  ready: Promise<void>;

  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (e) => {
      const line = String(e.data);
      for (const l of [...this.listeners]) l(line);
    };
    this.ready = (async () => {
      this.send('uci');
      await this.waitFor((l) => l === 'uciok');
      this.send('setoption name Hash value 32');
      this.send('isready');
      await this.waitFor((l) => l === 'readyok');
    })();
  }

  private send(cmd: string) {
    if (!this.dead) this.worker.postMessage(cmd);
  }

  private waitFor(pred: (line: string) => boolean, onLine?: (line: string) => void): Promise<string[]> {
    return new Promise((resolve) => {
      const lines: string[] = [];
      const l = (line: string) => {
        lines.push(line);
        onLine?.(line);
        if (pred(line)) {
          this.listeners = this.listeners.filter((x) => x !== l);
          resolve(lines);
        }
      };
      this.listeners.push(l);
    });
  }

  // Encadena las peticiones para que el motor procese una cada vez.
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(() => this.ready).then(fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  analyse(
    fen: string,
    opts: { depth?: number; movetime?: number; multipv?: number },
    onInfo?: (lines: Line[]) => void,
  ): Promise<Line[]> {
    return this.run(async () => {
      const multipv = opts.multipv ?? 1;
      this.send('setoption name UCI_LimitStrength value false');
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      this.send(opts.movetime ? `go movetime ${opts.movetime}` : `go depth ${opts.depth ?? 12}`);
      const res: Line[] = [];
      await this.waitFor(
        (l) => l.startsWith('bestmove'),
        (l) => {
          const parsed = parseInfo(l);
          if (parsed) {
            res[parsed.idx] = parsed.line;
            onInfo?.(res.filter(Boolean));
          }
        },
      );
      return res.filter(Boolean);
    });
  }

  // Jugada del bot con fuerza aproximada a `elo`.
  botMove(fen: string, elo: number, movetime: number): Promise<string> {
    if (elo >= 1320) {
      return this.run(async () => {
        this.send('setoption name MultiPV value 1');
        this.send('setoption name UCI_LimitStrength value true');
        this.send(`setoption name UCI_Elo value ${Math.min(3190, Math.round(elo))}`);
        this.send(`position fen ${fen}`);
        this.send(`go movetime ${movetime}`);
        const lines = await this.waitFor((l) => l.startsWith('bestmove'));
        return lines[lines.length - 1].split(' ')[1];
      });
    }
    // Por debajo de 1320 Stockfish no limita su fuerza: elegimos entre varias
    // candidatas con una "temperatura" que crece al bajar el Elo.
    const depth = elo < 600 ? 3 : elo < 900 ? 5 : 7;
    return this.analyse(fen, { depth, multipv: 6 }).then((lines) => {
      if (!lines.length) return '0000';
      const best = lines[0];
      if (best.mate !== null && best.mate > 0 && best.mate <= 1 && elo >= 700) return best.move;
      const blunderChance = Math.max(0, (1320 - elo) / 3600);
      if (Math.random() < blunderChance) return lines[Math.floor(Math.random() * lines.length)].move;
      const temp = 25 + (1320 - elo) * 0.3;
      const scores = lines.map(scoreOf);
      const weights = scores.map((s) => Math.exp((s - scores[0]) / temp));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      for (let i = 0; i < lines.length; i++) {
        r -= weights[i];
        if (r <= 0) return lines[i].move;
      }
      return best.move;
    });
  }

  stop() {
    this.send('stop');
  }

  terminate() {
    this.dead = true;
    this.worker.terminate();
  }
}

function parseInfo(l: string): { idx: number; line: Line } | null {
  if (!l.startsWith('info') || !l.includes(' pv ') || l.includes(' currmove ')) return null;
  const mp = Number(/ multipv (\d+)/.exec(l)?.[1] ?? 1);
  const cp = / score cp (-?\d+)/.exec(l);
  const mate = / score mate (-?\d+)/.exec(l);
  const depth = Number(/ depth (\d+)/.exec(l)?.[1] ?? 0);
  // Ignora cotas (lowerbound/upperbound) para no mostrar evaluaciones provisionales raras.
  if (l.includes('bound')) return null;
  const pv = l.split(' pv ')[1].trim().split(' ');
  return {
    idx: mp - 1,
    line: { move: pv[0], cp: cp ? Number(cp[1]) : null, mate: mate ? Number(mate[1]) : null, pv, depth },
  };
}

// Puntuación comparable en centipeones (los mates valen mucho).
export function scoreOf(line: Pick<Line, 'cp' | 'mate'>): number {
  if (line.mate !== null) return line.mate > 0 ? 10000 - line.mate * 10 : -10000 - line.mate * 10;
  return line.cp ?? 0;
}
