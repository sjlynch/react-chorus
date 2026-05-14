import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const reactPeerDependencies = new Set(['react', 'react-dom']);

function isReactPeerDependency(id: string) {
  return reactPeerDependencies.has(id) || id.startsWith('react/') || id.startsWith('react-dom/');
}

export default defineConfig({
  plugins: [react()],
  // Pre-bundle eagerly-imported deps so the dev server (StackBlitz / WebContainer
  // cold start, in particular) doesn't discover them mid-page-load and trigger a
  // full reload race. Lazy deps like highlight.js stay out — they're code-split.
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
  build: {
    copyPublicDir: false,
    lib: {
      entry: {
        'react-chorus': path.resolve(__dirname, 'src/index.ts'),
        'react-chorus-headless': path.resolve(__dirname, 'src/headless.ts'),
      },
      name: 'ReactChorus',
      fileName: (format, entryName) => `${entryName}.${format === 'cjs' ? 'cjs' : 'es.js'}`,
      cssFileName: 'styles',
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: isReactPeerDependency,
      output: {
        // Keep package.json "./styles.css" export aligned with the generated CSS file.
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css') ? 'styles.css' : '[name]-[hash][extname]',
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'ReactJSXRuntime',
          'react/jsx-dev-runtime': 'ReactJSXDevRuntime'
        }
      }
    }
  }
});
