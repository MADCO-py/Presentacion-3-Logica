import { defineConfig } from 'vite';

// base relativa: el build funciona en GitHub Pages (usuario.github.io/repo/) y desde cualquier carpeta.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 900 },
});
