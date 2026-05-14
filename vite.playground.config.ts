import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Builds index.html + src/main.tsx as a static site for GitHub Pages.
 * Separate from vite.config.ts (which builds the library in lib mode).
 * The `base` matches the GitHub Pages project URL: https://sjlynch.github.io/react-chorus/
 */
export default defineConfig({
  base: '/react-chorus/',
  plugins: [react()],
  build: {
    outDir: 'dist-playground',
    emptyOutDir: true,
    sourcemap: false,
    // The playground intentionally keeps highlight.js as an async code-fence chunk.
    // It is larger than Vite's 500 kB default but is only fetched when Markdown
    // code blocks render; `npm run verify:playground-size` enforces the explicit budget.
    chunkSizeWarningLimit: 950,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'react/jsx-runtime',
      'marked',
      'marked-highlight',
      'dompurify',
      'lucide-react',
    ],
  },
});
