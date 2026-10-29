# Jaque · entrenador de ajedrez

App web (instalable como PWA) para practicar y analizar ajedrez sin juego online.
Todo se ejecuta en el navegador: Stockfish 19 (WASM, versión lite de un hilo) en un Web Worker.

## Qué incluye el MVP

- **Jugar contra bots**: ritmos agrupados por modo (bullet, blitz, rápidas y sin reloj), Elo propio por modo,
  bot adaptativo a tu Elo o Elo elegido (400–3000). Por encima de 1320 usa `UCI_Elo` de Stockfish; por debajo,
  elige entre varias jugadas candidatas con más "ruido" cuanto más bajo es el Elo. Sin reloj se puede deshacer.
- **Estilos de bot** (`src/lib/style.ts`): equilibrado, conservador, agresivo, kamikaze o personalizado con tres
  parámetros (agresividad, cambios de piezas y riesgo). El bot elige entre las mejores jugadas del motor dando
  puntos extra a las que encajan con su estilo.
- **Precisión en directo**: un segundo motor valora cada jugada tuya mientras juegas.
- **Análisis de partidas**: tus partidas de chess.com (API pública, sin login), las jugadas contra los bots o un PGN pegado.
  Barra y gráfica de evaluación, precisión por jugador y clasificación de cada jugada
  (brillante, gran jugada, mejor, excelente, buena, teoría, imprecisión, error, ocasión fallada, error grave)
  con la mejor alternativa. La valoración sigue el modelo de puntos esperados: cada evaluación se pasa
  a EP = 1 / (1 + 10^(−cp/400)) y la nota sale de ΔEP = EP de la mejor jugada − EP tras la tuya (mejor = 0,
  excelente ≤ 0,02, buena ≤ 0,05, imprecisión ≤ 0,10, error ≤ 0,20, error grave > 0,20). Brillante: ΔEP ≤ 0,02
  entregando al menos 2 puntos netos de material; gran jugada: la mejor, cuando la segunda tiene ΔEP ≥ 0,15;
  ocasión fallada: no castigar un error grave del rival. La precisión de cada jugada es 100·e^(−3,2·ΔEP) y la de la
  partida, la media aritmética. Además mide la **presión**: el porcentaje de jugadas que dejan al rival con una sola respuesta buena.
- **Perfil de jugador**: analiza tus últimas partidas de chess.com (o contra los bots) y resume tu estilo,
  precisión por fase, aperturas, puntos fuertes y débiles. Puedes jugar contra un bot "clon" con tu estilo.
- **Aperturas guiadas**: en tu turno, la mejor jugada con su porqué (o las 3 mejores con los centipeones que pierde
  cada una), la amenaza del rival y cómo defenderla; tras tu jugada, las respuestas posibles del rival con la réplica
  recomendada a cada una. Opción de ponerte a prueba (la pista sale después de jugar).
- **Aperturas desde el inicio**: juegas desde la primera jugada; el rival responde con teoría variada (o sigue la
  apertura que elijas) y cada jugada se marca como teoría o con su nota. Se puede deshacer, ver las jugadas de teoría y
  consultar el historial de sesiones. El libro sale de [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
  (dominio público) con `scripts/build-openings.mjs`.
- **Entrenadores de aperturas, medio juego y finales**: aparece una posición (igualada, con un error del rival o
  difícil de defender) y la juegas contra Stockfish. Hay que aguantar unas jugadas sin que la evaluación baje de un
  límite. Las posiciones salen de `scripts/gen-trainer.mjs`, que incluye finales clásicos como Lucena o Philidor.
- **Puzzles**: clasificados (Elo de puzzles) y contrarreloj de 3 minutos. Generados con Stockfish a partir de errores
  en partidas (`scripts/gen-puzzles.mjs`).
- **Coordenadas**: 30 segundos para encontrar casillas, desde blancas o negras.
- **Memoria**: memoriza una posición y reconstrúyela; cada nivel añade una pieza.
- **Lecciones**: horquilla, clavada, mate del pasillo, mate del pastor, mates de dama y torre y oposición
  (los ejercicios se verifican con Stockfish en `scripts/build-lessons.mjs`; las prácticas son contra el motor).
  También hay 12 lecciones de aperturas (con blancas) y 14 de defensas (con negras), ordenadas de más a menos jugadas.
  Cada una tiene una línea por cada respuesta habitual del rival. Juegas tú la teoría y se explica cada jugada.
  Las líneas salen del libro de aperturas y se comprueban con Stockfish (`node scripts/build-opening-lessons.mjs src/data/opening-lessons.json`).
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

## Servidor propio con Stockfish completo

En GitHub Pages la web usa Stockfish 19 lite en el navegador. Si se sirve desde un servidor propio con
`server/index.mjs`, usa el Stockfish 19 nativo del servidor por WebSocket (`/engine`), mucho más fuerte y rápido.
Si el servidor no responde, sigue con el lite.

En un Ubuntu (por ejemplo Oracle Cloud Ampere A1, ARM), todo se instala con:

```sh
curl -fsSL https://raw.githubusercontent.com/MMV1105/Ajedrez/main/server/install.sh | bash
```

El script compila Stockfish 19 para la CPU, construye la web, la deja como servicio (`jaque`) y pone Caddy delante con
HTTPS (con dominio propio: `... | bash -s -- midominio.com`; sin él, `<ip>.sslip.io`). Con
`JAQUE_PASSWORD=... bash` la web pide usuario `jaque` y esa contraseña. Para actualizar, se vuelve a ejecutar.
La configuración del motor (hilos, memoria, número de motores) está en `/etc/jaque.env`.
