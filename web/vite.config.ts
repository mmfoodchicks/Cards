import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  server: {
    port: 5273,
    host: true,
    proxy: { '/api': { target: 'http://localhost:8420', changeOrigin: true } },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});
