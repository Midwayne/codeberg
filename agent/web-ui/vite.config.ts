import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Builds the chat SPA to ./dist, which the agent's node server (codeberg-web)
// serves alongside the /api/chat route. In dev (`npm run dev`), /api is proxied
// to that server so `useChat` talks to the live agent — the target must match
// codeberg-web's DEFAULT_PORT (see src/web/main.ts).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:48088' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
