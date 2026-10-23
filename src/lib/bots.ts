export type Bot = { name: string; avatar: string; blurb: string };

const BOTS: [number, Bot][] = [
  [700, { name: 'Pipo el Novato', avatar: '🐣', blurb: 'Acaba de aprender cómo se mueve el caballo.' }],
  [1000, { name: 'Lía la Aprendiz', avatar: '🦊', blurb: 'Conoce los mates básicos y deja alguna pieza colgando.' }],
  [1300, { name: 'Bruno del Club', avatar: '🦉', blurb: 'Juega aperturas sólidas, pero falla en tácticas.' }],
  [1600, { name: 'Vera la Táctica', avatar: '🐺', blurb: 'Ve horquillas y clavadas a la primera.' }],
  [1900, { name: 'Iker el Experto', avatar: '🦅', blurb: 'Planes claros y buena técnica en finales.' }],
  [2200, { name: 'Maestra Noa', avatar: '🐉', blurb: 'Castiga cada imprecisión.' }],
  [9999, { name: 'Gran Maestro Zugzwang', avatar: '👑', blurb: 'Stockfish casi sin frenos.' }],
];

export function botFor(elo: number): Bot {
  return BOTS.find(([max]) => elo < max)![1];
}
