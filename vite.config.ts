import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
  plugins: [react()],
  base: './',
  server: {
    port: 2026,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        headers: { 'X-API-Key': env.API_KEY },
      },
    },
  },
  };
});
