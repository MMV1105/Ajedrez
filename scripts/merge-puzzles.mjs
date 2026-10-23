// Une los .jsonl generados en src/data/puzzles.json (sin duplicados, ordenados por dificultad).
import fs from 'node:fs';
const seen = new Set();
const out = [];
for (const f of process.argv.slice(2)) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const p = JSON.parse(line);
    const key = p.fen.split(' ').slice(0, 2).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
}
out.sort((a, b) => a.rating - b.rating);
fs.writeFileSync(new URL('../src/data/puzzles.json', import.meta.url), JSON.stringify(out));
const by = out.reduce((m, p) => ((m[p.theme] = (m[p.theme] ?? 0) + 1), m), {});
console.log(out.length, 'puzzles', by);
