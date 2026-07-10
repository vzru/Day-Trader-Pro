import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The frontend only ever talks to localhost — API keys never reach the browser.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4400',
      '/ws': { target: 'ws://localhost:4400', ws: true },
    },
  },
});
