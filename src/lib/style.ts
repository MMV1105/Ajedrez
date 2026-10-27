import { Chess } from 'chess.js';
import { scoreOf, type Line } from './engine';

// Personalidad de un bot. Los valores van de -100 a 100 (riesgo de 0 a 100).
export type BotStyle = {
  aggression: number; // + busca jaques, capturas y acercarse al rey rival; - juega a la defensiva
  trades: number; // + le gusta cambiar piezas; - las evita
  risk: number; // cuánta evaluación está dispuesto a sacrificar por jugar a su estilo
};

export const STYLE_PRESETS: { id: string; name: string; blurb: string; style: BotStyle }[] = [
  { id: 'equilibrado', name: 'Equilibrado', blurb: 'Juega lo que diría el motor a su nivel.', style: { aggression: 0, trades: 0, risk: 0 } },
  { id: 'conservador', name: 'Conservador', blurb: 'Enroca pronto, simplifica y evita líos.', style: { aggression: -70, trades: 60, risk: 35 } },
  { id: 'agresivo', name: 'Agresivo', blurb: 'Va a por tu rey y prefiere mantener piezas.', style: { aggression: 75, trades: -50, risk: 45 } },
  { id: 'kamikaze', name: 'Kamikaze', blurb: 'Ataca a cualquier precio, aunque sea peor.', style: { aggression: 100, trades: -80, risk: 100 } },
];

export const isNeutral = (s: BotStyle) => s.aggression === 0 && s.trades === 0 && s.risk === 0;

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Bonificación (en centipeones) que el estilo da a una jugada concreta.
export function styleBonus(fen: string, uci: string, style: BotStyle): number {
  const chess = new Chess(fen);
  const me = chess.turn();
  let mv;
  try {
    mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return 0;
  }
  const a = style.aggression / 100;
  const t = style.trades / 100;
  let bonus = 0;
  if (mv.san.includes('+')) bonus += 60 * a;
  if (mv.captured) {
    bonus += 25 * a;
    if (VALUE[mv.captured] === VALUE[mv.piece] && VALUE[mv.piece] >= 3) bonus += 45 * t;
  }
  const king = chess
    .board()
    .flat()
    .find((p) => p && p.type === 'k' && p.color !== me);
  if (king) {
    const dist = Math.max(Math.abs(king.square.charCodeAt(0) - mv.to.charCodeAt(0)), Math.abs(Number(king.square[1]) - Number(mv.to[1])));
    if (dist <= 2) bonus += 25 * a;
  }
  const forward = (Number(mv.to[1]) - Number(mv.from[1])) * (me === 'w' ? 1 : -1);
  bonus += forward * 8 * a;
  if (mv.san.startsWith('O-O')) bonus += 30 * Math.max(0, -a) + 10;
  return bonus;
}

// Elige jugada entre las candidatas del motor según estilo y nivel.
export function pickStyled(fen: string, lines: Line[], style: BotStyle, elo: number): string {
  const best = lines[0];
  if (best.mate !== null && best.mate > 0) return best.move;
  const top = scoreOf(best);
  const window = 15 + (style.risk / 100) * 220;
  const noiseSd = Math.max(0, 1700 - elo) * 0.12;
  let pick = best.move;
  let pickScore = -Infinity;
  for (const l of lines) {
    const s = scoreOf(l);
    if (top - s > window && l !== best) continue;
    const noise = noiseSd * gaussian();
    const total = s + styleBonus(fen, l.move, style) + noise;
    if (total > pickScore) {
      pickScore = total;
      pick = l.move;
    }
  }
  return pick;
}

function gaussian() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Profundidad de búsqueda aproximada para un Elo dado (bots con estilo).
export const depthForElo = (elo: number) => Math.round(Math.max(2, Math.min(14, 2 + ((elo - 400) / 2600) * 12)));
