// Construye el libro de aperturas (src/data/openings.json) a partir de los ficheros a.tsv … e.tsv
// de https://github.com/lichess-org/chess-openings (dominio público, CC0).
// Uso: node scripts/build-openings.mjs <carpeta con los .tsv> src/data/openings.json
import fs from 'node:fs';
import path from 'node:path';
import { Chess } from 'chess.js';
import { OPENINGS } from './openings-main.mjs';

const [dir, out = 'openings.json'] = process.argv.slice(2);

const FAMILIES = {
  'Sicilian Defense': 'Defensa siciliana',
  'Ruy Lopez': 'Apertura española',
  "Queen's Gambit Declined": 'Gambito de dama rehusado',
  "Queen's Gambit Accepted": 'Gambito de dama aceptado',
  "Queen's Gambit Refused": 'Gambito de dama rehusado',
  "Queen's Gambit": 'Gambito de dama',
  'French Defense': 'Defensa francesa',
  'Italian Game': 'Apertura italiana',
  'English Opening': 'Apertura inglesa',
  "King's Gambit Accepted": 'Gambito de rey aceptado',
  "King's Gambit Declined": 'Gambito de rey rehusado',
  "King's Gambit": 'Gambito de rey',
  "King's Indian Defense": 'Defensa india de rey',
  "King's Indian Attack": 'Ataque indio de rey',
  'Caro-Kann Defense': 'Defensa Caro-Kann',
  'Nimzo-Indian Defense': 'Defensa nimzoindia',
  "Queen's Pawn Game": 'Apertura de peón de dama',
  "King's Pawn Game": 'Apertura de peón de rey',
  "King's Knight Opening": 'Apertura del caballo de rey',
  'Semi-Slav Defense': 'Defensa semieslava',
  'Slav Defense': 'Defensa eslava',
  'Dutch Defense': 'Defensa holandesa',
  'Benoni Defense': 'Defensa Benoni',
  'Grünfeld Defense': 'Defensa Grünfeld',
  'Neo-Grünfeld Defense': 'Defensa neo-Grünfeld',
  "Queen's Indian Defense": 'Defensa india de dama',
  'Bogo-Indian Defense': 'Defensa bogoindia',
  'Old Indian Defense': 'Defensa india antigua',
  'Indian Defense': 'Defensa india',
  'Alekhine Defense': 'Defensa Alekhine',
  'Scotch Game': 'Apertura escocesa',
  "Petrov's Defense": 'Defensa Petrov',
  'Four Knights Game': 'Apertura de los cuatro caballos',
  'Three Knights Opening': 'Apertura de los tres caballos',
  'Scandinavian Defense': 'Defensa escandinava',
  'Philidor Defense': 'Defensa Philidor',
  'Réti Opening': 'Apertura Réti',
  'Zukertort Opening': 'Apertura Zukertort',
  'Nimzowitsch Defense': 'Defensa Nimzowitsch',
  'Vienna Game': 'Apertura vienesa',
  'Vienna Gambit': 'Gambito vienés',
  "Bishop's Opening": 'Apertura de alfil',
  'Modern Defense': 'Defensa moderna',
  'Pirc Defense': 'Defensa Pirc',
  'Catalan Opening': 'Apertura catalana',
  'Bird Opening': 'Apertura Bird',
  'Tarrasch Defense': 'Defensa Tarrasch',
  'Polish Opening': 'Apertura polaca',
  'Hungarian Opening': 'Apertura húngara',
  'Grob Opening': 'Apertura Grob',
  'Center Game': 'Apertura del centro',
  'Danish Gambit': 'Gambito danés',
  'Latvian Gambit': 'Gambito letón',
  'Latvian Gambit Accepted': 'Gambito letón aceptado',
  'Elephant Gambit': 'Gambito elefante',
  'Ponziani Opening': 'Apertura Ponziani',
  'Blackmar-Diemer Gambit': 'Gambito Blackmar-Diemer',
  'Blackmar-Diemer Gambit Accepted': 'Gambito Blackmar-Diemer aceptado',
  'Blackmar-Diemer Gambit Declined': 'Gambito Blackmar-Diemer rehusado',
  'Benko Gambit': 'Gambito Benko',
  'Benko Gambit Accepted': 'Gambito Benko aceptado',
  'Benko Gambit Declined': 'Gambito Benko rehusado',
  'Budapest Defense': 'Defensa Budapest',
  'Englund Gambit': 'Gambito Englund',
  'Englund Gambit Declined': 'Gambito Englund rehusado',
  'London System': 'Sistema Londres',
  'Colle System': 'Sistema Colle',
  'Torre Attack': 'Ataque Torre',
  'Trompowsky Attack': 'Ataque Trompowsky',
  'Richter-Veresov Attack': 'Ataque Richter-Veresov',
  'Nimzo-Larsen Attack': 'Ataque Nimzo-Larsen',
  'Owen Defense': 'Defensa Owen',
  'Rat Defense': 'Defensa rata',
  'English Defense': 'Defensa inglesa',
  'Pterodactyl Defense': 'Defensa pterodáctilo',
  'Van Geet Opening': 'Apertura Van Geet',
  'Rubinstein Opening': 'Apertura Rubinstein',
};

// "Najdorf Variation" → "variante Najdorf", "Main Line" → "línea principal", etc.
const PART_RULES = [
  [/^Main Line$/, 'línea principal'],
  [/^(.+) Variation$/, 'variante $1'],
  [/^(.+) Attack$/, 'ataque $1'],
  [/^(.+) Gambit Accepted$/, 'gambito $1 aceptado'],
  [/^(.+) Gambit Declined$/, 'gambito $1 rehusado'],
  [/^(.+) Gambit$/, 'gambito $1'],
  [/^(.+) Defense$/, 'defensa $1'],
  [/^(.+) Line$/, 'línea $1'],
  [/^(.+) System$/, 'sistema $1'],
  [/^Exchange$/, 'cambio'],
  [/^Accepted$/, 'aceptado'],
  [/^Declined$/, 'rehusado'],
];

function translate(name) {
  const [family, rest] = name.split(/:\s*/, 2);
  const fam = FAMILIES[family] ?? family;
  if (!rest) return fam;
  const parts = rest.split(/,\s*/).map((p) => {
    for (const [re, to] of PART_RULES) if (re.test(p)) return p.replace(re, to);
    return p;
  });
  return `${fam}: ${parts.join(', ')}`;
}

const keyOf = (fen) => fen.split(' ').slice(0, 4).join(' ');
const uciMove = (chess, u) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

// Recorre una línea en SAN y llama a fn(clave antes, jugada UCI, clave después, índice).
function walk(sans, fn) {
  const chess = new Chess();
  sans.forEach((san, i) => {
    const before = keyOf(chess.fen());
    const m = chess.move(san);
    fn(before, m.from + m.to + (m.promotion ?? ''), keyOf(chess.fen()), i);
  });
}

// Libro: por cada posición, su nombre (si una línea termina ahí) y las jugadas de teoría con su peso.
// El peso crece con el número de líneas que pasan por la jugada y se multiplica en las líneas principales,
// para que el rival juegue sobre todo aperturas habituales sin dejar de variar.
const nodes = {};
const node = (k) => (nodes[k] ??= { m: {} });
const mainEdges = new Set();
for (const [, l] of OPENINGS) walk(l.split(' '), (k, u) => mainEdges.add(`${k}|${u}`));

let count = 0;
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const rows = fs.readFileSync(path.join(dir, `${f}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const sans = pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/);
    walk(sans, (k, u, after, i) => {
      const n = node(k);
      n.m[u] = (n.m[u] ?? 0) + 1;
      if (i === sans.length - 1) {
        const a = node(after);
        if (!a.n) Object.assign(a, { n: translate(name), e: eco });
      }
    });
    count++;
  }
}
for (const [k, n] of Object.entries(nodes)) {
  n.m = Object.entries(n.m).map(([u, c]) => [u, Math.round(Math.sqrt(c) * (mainEdges.has(`${k}|${u}`) ? 4 : 1) * 10) / 10]);
  if (!n.m.length) delete n.m;
}

// Las líneas principales también se guardan, para poder practicar una apertura concreta.
const mains = OPENINGS.map(([name, l]) => {
  const ucis = [];
  walk(l.split(' '), (k, u) => ucis.push(u));
  return [name, ucis.join(' ')];
});
fs.writeFileSync(out, JSON.stringify({ nodes, mains }));
console.log(count, 'líneas;', Object.keys(nodes).length, 'posiciones;', (fs.statSync(out).size / 1024).toFixed(0), 'KB');
