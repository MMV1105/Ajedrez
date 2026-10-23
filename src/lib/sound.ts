// Sonidos sintetizados con WebAudio: sin ficheros que descargar.
import { load, save } from './storage';

let ctx: AudioContext | null = null;
let muted = load('muted', false);

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  save('muted', m);
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, delay = 0) {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch {
    /* audio no disponible */
  }
}

export const sound = {
  move: () => tone(520, 0.07, 'triangle', 0.18),
  capture: () => {
    tone(220, 0.12, 'square', 0.08);
    tone(140, 0.12, 'triangle', 0.15);
  },
  check: () => {
    tone(660, 0.09, 'sawtooth', 0.06);
    tone(880, 0.12, 'sawtooth', 0.06, 0.08);
  },
  good: () => {
    tone(660, 0.1, 'sine', 0.15);
    tone(990, 0.16, 'sine', 0.15, 0.09);
  },
  bad: () => tone(160, 0.25, 'sawtooth', 0.08),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.15, i * 0.11)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, i * 0.15)),
  tick: () => tone(1200, 0.03, 'square', 0.03),
};

export function playMoveSound(san: string) {
  if (san.includes('#') || san.includes('+')) sound.check();
  else if (san.includes('x')) sound.capture();
  else sound.move();
}
