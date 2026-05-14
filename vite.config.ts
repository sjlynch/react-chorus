import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const reactPeerDependencies = new Set(['react', 'react-dom']);
// Runtime dependencies stay declared in package.json but external to the published
// library chunks so consumers can dedupe and update compatible versions.
const externalRuntimeDependencies = new Set([
  'dompurify',
  'highlight.js',
  'lucide-react',
  'marked',
  'marked-highlight',
]);
const externalRuntimeDependencyPrefixes = [
  'lucide-react/',
];

function isReactPeerDependency(id: string) {
  return reactPeerDependencies.has(id) || id.startsWith('react/') || id.startsWith('react-dom/');
}

function isExternalDependency(id: string) {
  const normalizedId = id.split('?')[0];
  return (
    isReactPeerDependency(normalizedId) ||
    externalRuntimeDependencies.has(normalizedId) ||
    externalRuntimeDependencyPrefixes.some(prefix => normalizedId.startsWith(prefix))
  );
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
        'react-chorus-transport': path.resolve(__dirname, 'src/transport.ts'),
        'provider-requests': path.resolve(__dirname, 'src/providerRequests.ts'),
      },
      name: 'ReactChorus',
      fileName: (format, entryName) => `${entryName}.${format === 'cjs' ? 'cjs' : 'es.js'}`,
      cssFileName: 'styles',
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: isExternalDependency,
      output: {
        // Keep package.json "./styles.css" export aligned with the generated CSS file.
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css') ? 'styles.css' : '[name]-[hash][extname]',
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'ReactJSXRuntime',
          'react/jsx-dev-runtime': 'ReactJSXDevRuntime',
          dompurify: 'DOMPurify',
          'highlight.js': 'hljs',
          'lucide-react': 'LucideReact',
          marked: 'marked',
          'marked-highlight': 'markedHighlight'
        }
      }
    }
  }
});
