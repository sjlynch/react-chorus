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

function normalizeModuleId(id: string) {
  return id.split('?')[0].replace(/\\/g, '/');
}

function isExternalDependency(id: string) {
  const normalizedId = id.split('?')[0];
  return (
    isReactPeerDependency(normalizedId) ||
    externalRuntimeDependencies.has(normalizedId) ||
    externalRuntimeDependencyPrefixes.some(prefix => normalizedId.startsWith(prefix))
  );
}

function libraryManualChunks(id: string) {
  const normalizedId = normalizeModuleId(id);
  if (!normalizedId.includes('/src/')) return undefined;

  // Keep composable root named exports in focused chunks so app bundlers can
  // tree-shake hooks/components without also pulling the full widget graph.
  if (normalizedId.endsWith('/src/utils/devMode.ts')) return 'dev-mode';
  if (normalizedId.endsWith('/src/utils/errors.ts') || normalizedId.endsWith('/src/utils/async.ts') || normalizedId.endsWith('/src/utils/ids.ts')) return 'shared-utils';
  if (normalizedId.endsWith('/src/utils/warnings.ts')) return 'dev-mode';
  if (normalizedId.includes('/src/connectors/') || normalizedId.endsWith('/src/hooks/useChorusStream.ts') || normalizedId.endsWith('/src/streaming/readSSEStream.ts') || normalizedId.endsWith('/src/streaming/delayedStreamEvents.ts') || normalizedId.endsWith('/src/streaming/errors.ts') || normalizedId.endsWith('/src/streaming/toolDeltaAccumulator.ts')) return 'streaming-core';
  if (normalizedId.endsWith('/src/streaming/createFetchSSETransport.ts') || normalizedId.endsWith('/src/streaming/createWebSocketTransport.ts') || normalizedId.includes('/src/streaming/websocket/')) return 'transport-core';
  if (normalizedId.endsWith('/src/hooks/useChorusPersistence.ts') || normalizedId.includes('/src/hooks/persistence/')) return 'persistence';
  if (normalizedId.endsWith('/src/hooks/useConversations.ts') || normalizedId.includes('/src/hooks/conversations/')) return 'conversations';
  if (normalizedId.endsWith('/src/components/Markdown.tsx') || normalizedId.endsWith('/src/utils/hljsLoader.ts') || normalizedId.endsWith('/src/utils/markdownNormalizer.ts')) return 'markdown';
  if (normalizedId.endsWith('/src/components/ChatInput.tsx') || normalizedId.includes('/src/components/chat-input/') || normalizedId.endsWith('/src/utils/attachmentPreview.ts')) return 'chat-input';
  if (normalizedId.endsWith('/src/components/ConversationList.tsx') || normalizedId.endsWith('/src/components/ChorusTheme.tsx')) return 'conversation-list';
  if (normalizedId.endsWith('/src/hooks/useAssistantSession.ts') || normalizedId.includes('/src/hooks/assistant-session/') || normalizedId.endsWith('/src/hooks/useChorusMessages.ts') || normalizedId.endsWith('/src/hooks/useRAFQueue.ts')) return 'chorus-session';
  // tools.ts is shared by the chorus-session graph (handler lookup) and the
  // provider-requests subpath (defineTool, tool-definition serialization).
  // Park it in its own micro-chunk so importing one side does not drag in the other.
  if (normalizedId.endsWith('/src/tools.ts')) return 'tools';

  return undefined;
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
    // External `.map` files let consumer stack traces (and devtools) point at
    // the original TS sources instead of the minified published output. Maps
    // are shipped alongside the JS in `dist/` and excluded from gzip budgets
    // (`scripts/verify-bundle-size.mjs` only measures .js/.cjs).
    sourcemap: true,
    lib: {
      entry: {
        'react-chorus': path.resolve(__dirname, 'src/index.ts'),
        'react-chorus-headless': path.resolve(__dirname, 'src/headless.ts'),
        'react-chorus-transport': path.resolve(__dirname, 'src/transport.ts'),
        'provider-requests': path.resolve(__dirname, 'src/providerRequests.ts'),
        'react-chorus-server': path.resolve(__dirname, 'src/server.ts'),
        // Private facades (not listed in package.json exports) keep root named
        // imports measurable and independently tree-shakeable in consumer builds.
        'react-chorus-use-chorus-stream': path.resolve(__dirname, 'src/hooks/useChorusStream.ts'),
        'react-chorus-markdown': path.resolve(__dirname, 'src/components/Markdown.tsx'),
        'react-chorus-chat-window': path.resolve(__dirname, 'src/components/ChatWindow.tsx'),
        'react-chorus-conversation-list': path.resolve(__dirname, 'src/components/ConversationList.tsx'),
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
        manualChunks: libraryManualChunks,
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
