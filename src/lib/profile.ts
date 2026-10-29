import { Chess } from 'chess.js';
import { evalToCp, isMistake, winPct, type Classification, type GameAnalysis } from './analysis';
import type { BotStyle } from './style';

export type Phase = 'apertura' | 'medio juego' | 'final';
export const PHASES: Phase[] = ['apertura', 'medio juego', 'final'];

export type GameSummary = {
  id: string;
  date: number;
  color: 'w' | 'b';
  result: 'win' | 'loss' | 'draw';
  timeClass: string;
  opening: string;
  accuracy: number;
  oppAccuracy: number;
  counts: Partial<Record<Classification, number>>;
  myMoves: number;
  pressure: number; // % de mis jugadas que dejan al rival con una sola respuesta buena
  oppPressure: number;
  aggressive: number; // % de mis jugadas que son jaque o captura
  oppAggressive: number;
  phase: Record<Phase, [number, number, number]>; // [suma de precisión, nº de jugadas, suma de inversas]
  errors: number; // errores + errores graves
  timeTroubleErrors: number;
  hadWinning: boolean;
};

const NON_PAWN: Record<string, number> = { n: 3, b: 3, r: 5, q: 9 };

export function phaseOf(fen: string, ply: number): Phase {
  if (ply < 20) return 'apertura';
  let material = 0;
  for (const row of new Chess(fen).board()) for (const sq of row) if (sq) material += NON_PAWN[sq.type] ?? 0;
  return material <= 26 ? 'final' : 'medio juego';
}

// Nombre de la apertura a partir de la etiqueta ECOUrl de chess.com.
export function openingName(pgn: string) {
  const url = /\[ECOUrl "([^"]+)"\]/.exec(pgn)?.[1];
  if (!url) return 'Otras';
  const words = url.split('/').pop()!.split('-');
  const cut = words.findIndex((w) => /\d/.test(w));
  const clean = (cut >= 0 ? words.slice(0, cut) : words).join(' ');
  const family = /^(.*?\b(Defense|Game|Opening|Gambit|Attack|System))\b/.exec(clean)?.[1];
  return family ?? clean.split(' ').slice(0, 3).join(' ');
}

function clocks(pgn: string): Map<string, number> {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const out = new Map<string, number>();
  for (const c of chess.getComments()) {
    const m = /\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(c.comment);
    if (m) out.set(c.fen, Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  }
  return out;
}

export function summarizeGame(
  a: GameAnalysis,
  pgn: string,
  meta: { id: string; date: number; color: 'w' | 'b'; result: GameSummary['result']; timeClass: string },
): GameSummary {
  const me = meta.color;
  const mine = a.moves.filter((m) => m.color === me);
  const theirs = a.moves.filter((m) => m.color !== me);
  const counts: GameSummary['counts'] = {};
  for (const m of mine) counts[m.cls] = (counts[m.cls] ?? 0) + 1;
  const pct = (xs: typeof mine, f: (m: (typeof mine)[number]) => boolean) => (xs.length ? (xs.filter(f).length / xs.length) * 100 : 0);
  const isAggressive = (m: (typeof mine)[number]) => m.move.san.includes('+') || !!m.move.captured;
  const phase: GameSummary['phase'] = { apertura: [0, 0, 0], 'medio juego': [0, 0, 0], final: [0, 0, 0] };
  a.moves.forEach((m, i) => {
    if (m.color !== me) return;
    const p = phaseOf(m.fenBefore, i);
    phase[p][0] += m.accuracy;
    phase[p][1] += 1;
    phase[p][2] += 1 / Math.max(m.accuracy, 1);
  });
  const base = Number(/\[TimeControl "(\d+)/.exec(pgn)?.[1] ?? 0);
  const clk = clocks(pgn);
  let timeTroubleErrors = 0;
  for (const m of mine) {
    if (!isMistake(m.cls)) continue;
    const left = clk.get(m.fenAfter);
    if (base && left !== undefined && left < Math.max(15, base * 0.1)) timeTroubleErrors++;
  }
  const sign = me === 'w' ? 1 : -1;
  const hadWinning = a.evals.some((e, i) => i > 10 && winPct(sign * evalToCp(e)) >= 85);
  const acc = (xs: typeof mine) => (xs.length ? xs.reduce((s, m) => s + m.accuracy, 0) / xs.length : 0);
  return {
    ...meta,
    opening: openingName(pgn),
    accuracy: a.accuracy[me],
    oppAccuracy: a.accuracy[me === 'w' ? 'b' : 'w'] || acc(theirs),
    counts,
    myMoves: mine.length,
    pressure: pct(mine, (m) => m.pressure),
    oppPressure: pct(theirs, (m) => m.pressure),
    aggressive: pct(mine, isAggressive),
    oppAggressive: pct(theirs, isAggressive),
    phase,
    errors: (counts.error ?? 0) + (counts.grave ?? 0),
    timeTroubleErrors,
    hadWinning,
  };
}

export type Trait = { name: string; value: number; text: string };

export type Profile = {
  games: number;
  record: { win: number; draw: number; loss: number };
  accuracy: number;
  oppAccuracy: number;
  phases: { phase: Phase; accuracy: number | null }[];
  traits: Trait[];
  openings: { name: string; color: 'w' | 'b'; games: number; score: number; accuracy: number }[];
  strengths: string[];
  weaknesses: string[];
  mirror: BotStyle;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const f1 = (v: number) => v.toFixed(1).replace('.', ',');

export function buildProfile(gs: GameSummary[]): Profile {
  const n = gs.length;
  const record = { win: 0, draw: 0, loss: 0 };
  for (const g of gs) record[g.result]++;
  const accuracy = avg(gs.map((g) => g.accuracy));
  const oppAccuracy = avg(gs.map((g) => g.oppAccuracy));

  const phases = PHASES.map((p) => {
    const sum = gs.reduce((s, g) => s + g.phase[p][0], 0);
    const cnt = gs.reduce((s, g) => s + g.phase[p][1], 0);
    // Media aritmética, como la precisión de cada partida.
    return { phase: p, accuracy: cnt >= 6 ? sum / cnt : null };
  });

  const aggr = avg(gs.map((g) => g.aggressive));
  const oppAggr = avg(gs.map((g) => g.oppAggressive));
  const press = avg(gs.map((g) => g.pressure));
  const oppPress = avg(gs.map((g) => g.oppPressure));
  const graves = gs.reduce((s, g) => s + (g.counts.grave ?? 0), 0) / Math.max(1, n);
  const errors = gs.reduce((s, g) => s + g.errors, 0);
  const tt = gs.reduce((s, g) => s + g.timeTroubleErrors, 0);
  const winning = gs.filter((g) => g.hadWinning);
  const converted = winning.filter((g) => g.result === 'win').length;

  const traits: Trait[] = [
    { name: 'Precisión', value: clamp(accuracy), text: `${f1(accuracy)} de media (rivales ${f1(oppAccuracy)})` },
    { name: 'Agresividad', value: clamp(50 + (aggr - oppAggr) * 5), text: `${f1(aggr)} % de jaques y capturas (rivales ${f1(oppAggr)} %)` },
    { name: 'Presión', value: clamp(50 + (press - oppPress) * 6), text: `${f1(press)} % de jugadas que dejan al rival con una sola salida (rivales ${f1(oppPress)} %)` },
    { name: 'Solidez', value: clamp(100 - graves * 30), text: `${f1(graves)} errores graves por partida` },
    {
      name: 'Gestión del reloj',
      value: errors ? clamp(100 - (tt / errors) * 100) : 100,
      text: errors ? `${tt} de ${errors} errores con poco tiempo` : 'Sin errores por apuros de tiempo',
    },
  ];
  if (winning.length >= 2)
    traits.push({ name: 'Remate', value: clamp((converted / winning.length) * 100), text: `Ganaste ${converted} de ${winning.length} partidas que llegaste a tener ganadas` });

  // Aperturas por color
  const byOpening = new Map<string, GameSummary[]>();
  for (const g of gs) {
    const k = `${g.color}|${g.opening}`;
    byOpening.set(k, [...(byOpening.get(k) ?? []), g]);
  }
  const openings = [...byOpening.entries()]
    .map(([k, list]) => ({
      name: k.split('|')[1],
      color: k.split('|')[0] as 'w' | 'b',
      games: list.length,
      score: (list.reduce((s, g) => s + (g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0), 0) / list.length) * 100,
      accuracy: avg(list.map((g) => g.accuracy)),
    }))
    .sort((a, b) => b.games - a.games);

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const known = phases.filter((p) => p.accuracy !== null) as { phase: Phase; accuracy: number }[];
  if (known.length >= 2) {
    const sorted = [...known].sort((a, b) => a.accuracy - b.accuracy);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    if (hi.accuracy - lo.accuracy >= 4) {
      strengths.push(`Tu mejor fase es ${art(hi.phase)} (${f1(hi.accuracy)} de precisión).`);
      weaknesses.push(`Tu fase más floja es ${art(lo.phase)}: ${f1(lo.accuracy)} de precisión, frente a ${f1(hi.accuracy)} en ${art(hi.phase)}.`);
    }
  }
  if (accuracy - oppAccuracy >= 3) strengths.push(`Juegas con más precisión que tus rivales (${f1(accuracy)} frente a ${f1(oppAccuracy)}).`);
  else if (oppAccuracy - accuracy >= 3) weaknesses.push(`Tus rivales juegan con más precisión que tú (${f1(oppAccuracy)} frente a ${f1(accuracy)}).`);
  if (graves >= 1) weaknesses.push(`Cometes ${f1(graves)} errores graves por partida. Antes de mover, mira qué piezas quedan sin defender.`);
  else if (n >= 5 && graves < 0.5) strengths.push('Casi no regalas material: menos de un error grave cada dos partidas.');
  if (errors >= 4 && tt / errors >= 0.4) weaknesses.push(`El ${Math.round((tt / errors) * 100)} % de tus errores llegan con poco tiempo en el reloj. Gasta menos en la apertura.`);
  if (winning.length >= 2 && winning.length - converted >= 2)
    weaknesses.push(`Dejaste escapar ${winning.length - converted} de ${winning.length} partidas que tenías ganadas. En ventaja, simplifica y cambia piezas.`);
  if (aggr - oppAggr >= 3) strengths.push(`Tienes un estilo activo: das más jaques y capturas que tus rivales.`);
  else if (oppAggr - aggr >= 3) weaknesses.push('Juegas más pasivo que tus rivales: das menos jaques y capturas que ellos.');
  if (press - oppPress >= 2) strengths.push(`Pones a tus rivales en apuros: les dejas con una sola jugada buena más a menudo que ellos a ti.`);
  const enough = openings.filter((o) => o.games >= 2);
  if (enough.length >= 2) {
    const best = [...enough].sort((a, b) => b.score - a.score)[0];
    const worst = [...enough].sort((a, b) => a.score - b.score)[0];
    if (best.score >= 60) strengths.push(`Con ${best.color === 'w' ? 'blancas' : 'negras'} en la ${best.name} puntúas un ${Math.round(best.score)} %.`);
    if (worst.score <= 40) weaknesses.push(`Con ${worst.color === 'w' ? 'blancas' : 'negras'} en la ${worst.name} solo puntúas un ${Math.round(worst.score)} %.`);
  }

  const round10 = (v: number) => Math.round(v / 10) * 10;
  const mirror: BotStyle = {
    aggression: clamp(round10((aggr - oppAggr) * 10), -100, 100),
    trades: 0,
    risk: clamp(round10(graves * 30), 0, 80),
  };

  return { games: n, record, accuracy, oppAccuracy, phases, traits, openings, strengths, weaknesses, mirror };
}

function art(p: Phase) {
  return p === 'final' ? 'el final' : p === 'apertura' ? 'la apertura' : 'el medio juego';
}
