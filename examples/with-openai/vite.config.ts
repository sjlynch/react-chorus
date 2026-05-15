import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // react-chorus keeps highlight.js in an async code-fence chunk. The example
    // build smoke test fails if Vite warns above this documented lazy budget.
    chunkSizeWarningLimit: 950,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
