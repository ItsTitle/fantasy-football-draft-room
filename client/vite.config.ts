import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_API_TARGET || 'http://localhost:5178';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    // The browser talks to one origin. The data service stays behind /api, so
    // nothing in the client needs to know where it runs.
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
});
