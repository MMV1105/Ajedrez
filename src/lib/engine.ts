// Stockfish 19. Si la web se sirve desde el servidor propio (server/index.mjs), se usa el Stockfish
// nativo completo por WebSocket; si no (GitHub Pages, sin conexión), la versión lite en un Web Worker.
import { depthForElo, isNeutral, pickStyled, type BotStyle } from './style';

export type Line = {
  move: string;
  cp: number | null;
  mate: number | null;
  pv: string[];
  depth: number;
};

const ENGINE_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`;
const CONNECT_TIMEOUT = 2500;

type Transport = { post: (cmd: string) => void; close: () => void };

// Dirección del motor del servidor, junto a la página. En GitHub Pages no hay servidor.
function remoteUrl(): string | null {
  if (typeof location === 'undefined' || location.hostname.endsWith('github.io') || location.protocol === 'file:') return null;
  const u = new URL('engine', location.href.split('#')[0]);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.href;
}

let remoteDown = false; // si el servidor no responde una vez, el resto de motores de la página van directos al lite

function connectRemote(onLine: (l: string) => void, onLost: () => void): Promise<Transport | null> {
  const url = remoteUrl();
  if (!url || remoteDown) return Promise.resolve(null);
  return new Promise((resolve) => {
    let open = false;
    const ws = new WebSocket(url);
    const fail = () => {
      if (open) return;
      remoteDown = true;
      clearTimeout(timer);
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ya cerrado */
      }
      resolve(null);
    };
    const timer = setTimeout(fail, CONNECT_TIMEOUT);
    ws.onerror = fail;
    ws.onclose = fail;
    ws.onopen = () => {
      open = true;
      clearTimeout(timer);
      ws.onclose = () => onLost();
      resolve({
        post: (cmd) => ws.readyState === WebSocket.OPEN && ws.send(cmd),
        close: () => {
          ws.onclose = null;
          ws.close();
        },
      });
    };
    ws.onmessage = (e) => {
      for (const l of String(e.data).split('\n')) if (l) onLine(l);
    };
  });
}

function connectWorker(onLine: (l: string) => void): Transport {
  const worker = new Worker(ENGINE_URL);
  worker.onmessage = (e) => onLine(String(e.data));
  return { post: (cmd) => worker.postMessage(cmd), close: () => worker.terminate() };
}

export class Engine {
  private transport: Transport | null = null;
  private listeners: ((line: string) => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private dead = false;
  // Órdenes desde el último bestmove: si se cae el servidor, se repiten en el lite.
  private pending: string[] = [];
  remote = false;
  name = 'Stockfish 19';
  ready: Promise<void>;

  constructor() {
    this.ready = this.connect();
  }

  private onLine = (line: string) => {
    if (line.startsWith('bestmove')) this.pending = [];
    if (line.startsWith('id name ')) this.name = line.slice(8);
    for (const l of [...this.listeners]) l(line);
  };

  private async connect() {
    const remote = await connectRemote(this.onLine, () => this.fallBack());
    if (this.dead) return remote?.close();
    this.transport = remote ?? connectWorker(this.onLine);
    this.remote = !!remote;
    await this.handshake();
  }

  private async handshake() {
    this.post('uci');
    await this.waitFor((l) => l === 'uciok');
    if (!this.remote) this.post('setoption name Hash value 32');
    this.post('isready');
    await this.waitFor((l) => l === 'readyok');
  }

  // Se ha perdido la conexión con el servidor a mitad de sesión (reinicio, motor caído…): se reintenta
  // conectar y, si no vuelve, se sigue con el lite. Lo que estaba en marcha se repite en el motor nuevo.
  private fallBack() {
    if (this.dead) return;
    const replay = this.pending;
    this.pending = [];
    this.transport = null;
    this.ready = (async () => {
      await new Promise((r) => setTimeout(r, 1500));
      remoteDown = false;
      const remote = await connectRemote(this.onLine, () => this.fallBack());
      if (this.dead) return remote?.close();
      this.transport = remote ?? connectWorker(this.onLine);
      this.remote = !!remote;
      await this.handshake();
      replay.forEach((c) => this.send(c));
    })();
  }

  private post(cmd: string) {
    if (!this.dead) this.transport?.post(cmd);
  }

  private send(cmd: string) {
    this.pending.push(cmd);
    this.post(cmd);
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
  botMove(fen: string, elo: number, movetime: number, style?: BotStyle): Promise<string> {
    if (style && !isNeutral(style)) {
      return this.analyse(fen, { depth: depthForElo(elo), multipv: 6 }).then((lines) => {
        if (!lines.length) return '0000';
        if (Math.random() < Math.max(0, (1100 - elo) / 3600)) return lines[Math.floor(Math.random() * lines.length)].move;
        return pickStyled(fen, lines, style, elo);
      });
    }
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
    this.post('stop');
  }

  terminate() {
    this.dead = true;
    this.transport?.close();
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
