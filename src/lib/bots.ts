export type Bot = { name: string; blurb: string };

const BOTS: [number, Bot][] = [
  [700, { name: 'Pipo', blurb: 'Acaba de aprender cómo se mueve el caballo.' }],
  [1000, { name: 'Lía', blurb: 'Conoce los mates básicos y deja alguna pieza colgando.' }],
  [1300, { name: 'Bruno', blurb: 'Juega aperturas sólidas, pero falla en tácticas.' }],
  [1600, { name: 'Vera', blurb: 'Ve horquillas y clavadas a la primera.' }],
  [1900, { name: 'Iker', blurb: 'Planes claros y buena técnica en finales.' }],
  [2200, { name: 'Noa', blurb: 'Castiga cada imprecisión.' }],
  [9999, { name: 'Zugzwang', blurb: 'Stockfish casi sin frenos.' }],
];

export function botFor(elo: number): Bot {
  return BOTS.find(([max]) => elo < max)![1];
}
