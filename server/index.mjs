// Servidor de Jaque: sirve la web ya compilada (dist/) y da acceso a Stockfish nativo por WebSocket en /engine.
// Cada conexión tiene su propio proceso de Stockfish, que se cierra al desconectarse.
// Configuración por variables de entorno (en el servidor, /etc/jaque.env):
//   PORT (8080), HOST (127.0.0.1), STOCKFISH_PATH (stockfish), ENGINE_THREADS (4), ENGINE_HASH en MB (1024),
//   MAX_ENGINES (6), DIST (../dist).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const env = process.env;
const PORT = Number(env.PORT ?? 8080);
const HOST = env.HOST ?? '127.0.0.1';
const DIST = path.resolve(env.DIST ?? fileURLToPath(new URL('../dist', import.meta.url)));
const STOCKFISH = env.STOCKFISH_PATH ?? 'stockfish';
const THREADS = Number(env.ENGINE_THREADS ?? 4);
const HASH = Number(env.ENGINE_HASH ?? 1024);
const MAX_ENGINES = Number(env.MAX_ENGINES ?? 6);
const MAX_DEPTH = 40;
const MAX_MOVETIME = 30000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

// Archivos estáticos. Los de assets/ llevan hash en el nombre y se pueden cachear para siempre.
function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DIST, path.normalize(rel));
  if (!file.startsWith(DIST + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
}

// Solo se dejan pasar las órdenes UCI que usa la web, con límites de profundidad y tiempo.
// Hilos y memoria los fija el servidor.
const POSITION = /^position (startpos|fen [1-8pnbrqkPNBRQK/]{15,92} [wb] (-|[KQkq]{1,4}) (-|[a-h][36]) \d{1,3} \d{1,4})( moves( [a-h][1-8][a-h][1-8][qrbn]?){1,600})?$/;
const OPTION = /^setoption name (MultiPV|UCI_LimitStrength|UCI_Elo|Skill Level) value [\w-]{1,8}$/;
function filter(cmd) {
  cmd = cmd.trim();
  if (cmd === 'uci' || cmd === 'isready' || cmd === 'ucinewgame' || cmd === 'stop') return cmd;
  if (POSITION.test(cmd) || OPTION.test(cmd)) return cmd;
  const go = /^go (depth|movetime) (\d{1,6})$/.exec(cmd);
  if (go) return `go ${go[1]} ${Math.min(Number(go[2]), go[1] === 'depth' ? MAX_DEPTH : MAX_MOVETIME)}`;
  return null;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  if (req.url === '/api/estado') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ motores: active, max: MAX_ENGINES, hilos: THREADS }));
    return;
  }
  serveStatic(req, res);
});

let active = 0;
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://x');
  // Solo desde la propia web: otra página no puede usar este Stockfish.
  const origin = req.headers.origin ? new URL(req.headers.origin).host : null;
  if (!pathname.endsWith('/engine') || origin !== req.headers.host) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  if (active >= MAX_ENGINES) {
    socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => startEngine(ws));
});

function startEngine(ws) {
  active++;
  const sf = spawn(STOCKFISH, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    active--;
    if (sf.exitCode === null) {
      sf.stdin.end('quit\n');
      setTimeout(() => sf.kill('SIGKILL'), 2000).unref();
    }
    ws.close();
  };
  sf.on('error', (e) => {
    console.error('No se pudo arrancar Stockfish:', e.message);
    finish();
  });
  sf.on('exit', finish);
  sf.stdin.on('error', () => {});
  sf.stdin.write(`setoption name Threads value ${THREADS}\nsetoption name Hash value ${HASH}\n`);

  // Las líneas del motor se agrupan en un mensaje por trozo de salida.
  let buf = '';
  sf.stdout.on('data', (chunk) => {
    buf += chunk;
    const end = buf.lastIndexOf('\n');
    if (end < 0) return;
    const out = buf.slice(0, end);
    buf = buf.slice(end + 1);
    if (ws.readyState === ws.OPEN) ws.send(out);
  });

  ws.on('message', (data) => {
    for (const line of String(data).split('\n')) {
      const cmd = filter(line);
      if (cmd && !closed) sf.stdin.write(cmd + '\n');
    }
  });
  ws.on('close', finish);
  ws.on('error', finish);

  // Si el navegador desaparece sin cerrar, el ping lo detecta.
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
}

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) ws.terminate();
    else {
      ws.alive = false;
      ws.ping();
    }
  }
}, 30000).unref();

server.listen(PORT, HOST, () => console.log(`Jaque en http://${HOST}:${PORT} · ${STOCKFISH} · ${THREADS} hilos · ${HASH} MB · máx. ${MAX_ENGINES} motores`));
