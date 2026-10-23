// Navegación por hash (funciona en cualquier hosting estático).
export function navigate(path: string) {
  window.location.hash = `#/${path}`;
}

let pendingPgn: string | null = null;

export function analyzePgn(pgn: string) {
  pendingPgn = pgn;
  navigate('analizar');
}

export function takePendingPgn() {
  const p = pendingPgn;
  pendingPgn = null;
  return p;
}
