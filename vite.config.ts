import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: la app funciona en cualquier ruta (GitHub Pages, subcarpetas…)
export default defineConfig({
  base: './',
  plugins: [react()],
});
