// Persistencia local (localStorage) con tolerancia a fallos.

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`ajedrez:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T) {
  try {
    localStorage.setItem(`ajedrez:${key}`, JSON.stringify(value));
  } catch {
    /* almacenamiento no disponible */
  }
}
