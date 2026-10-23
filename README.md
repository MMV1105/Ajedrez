# Jaque · entrenador de ajedrez

App web (instalable como PWA) para practicar y analizar ajedrez sin juego online.
Todo se ejecuta en el navegador: Stockfish 17.1 (WASM, versión lite de un hilo) en un Web Worker.

## Qué incluye el MVP

- **Jugar contra bots**: 9 ritmos (1 min a 30 min y sin reloj), Elo propio por ritmo (bullet, blitz, rápidas),
  bot adaptativo a tu Elo o Elo elegido (400–3000). Por encima de 1320 usa `UCI_Elo` de Stockfish; por debajo,
  elige entre varias jugadas candidatas con más "ruido" cuanto más bajo es el Elo. Sin reloj se puede deshacer.
- **Análisis de partidas**: tus partidas de chess.com (API pública, sin login), las jugadas contra los bots o un PGN pegado.
  Barra y gráfica de evaluación, precisión por jugador y clasificación de cada jugada
  (brillante, gran jugada, mejor, excelente, buena, imprecisión, error, error grave) con la mejor alternativa.
- **Puzzles**: clasificados (Elo de puzzles) y contrarreloj de 3 minutos. Generados con Stockfish a partir de errores
  en partidas (`scripts/gen-puzzles.mjs`).
- **Coordenadas**: 30 segundos para encontrar casillas, desde blancas o negras.
- **Memoria**: memoriza una posición y reconstrúyela; cada nivel añade una pieza.
- **Lecciones**: horquilla, clavada, mate del pasillo, mate del pastor, mates de dama y torre y oposición
  (los ejercicios se verifican con Stockfish en `scripts/build-lessons.mjs`; las prácticas son contra el motor).
- Importar tu Elo de chess.com como punto de partida, sonidos sintetizados y animaciones.

Los datos (Elo, historial, récords) se guardan en `localStorage` del navegador.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # genera dist/ (estático, base relativa)
```

Scripts de datos (Node):

```bash
node scripts/gen-puzzles.mjs 100 puzzles.jsonl   # genera puzzles
node scripts/merge-puzzles.mjs puzzles*.jsonl     # los vuelca a src/data/puzzles.json
node scripts/build-lessons.mjs                    # verifica y genera src/data/lessons.json
```

## Licencia

Stockfish.js es GPLv3, así que si se distribuye la app el código también debe publicarse como GPLv3.
