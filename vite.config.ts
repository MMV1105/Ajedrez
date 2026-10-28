import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: la app funciona en cualquier ruta (GitHub Pages, subcarpetas…)
export default defineConfig({
  base: './',
  plugins: [react()],
  // En desarrollo, /engine va al servidor de server/index.mjs si está arrancado (si no, se usa el lite).
  server: { proxy: { '/engine': { target: 'ws://127.0.0.1:8080', ws: true } } },
});
