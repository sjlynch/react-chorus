import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { build } from 'vite';

const KiB = 1024;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const playgroundDir = path.join(rootDir, 'dist-playground');
const readmePath = path.join(rootDir, 'README.md');
const reportDir = path.join(rootDir, '.cache', 'react-chorus');
const args = new Set(process.argv.slice(2));
const runPlayground = args.has('--playground');
const runLibrary = !runPlayground || args.has('--library');
const require = createRequire(import.meta.url);

const failures = [];
const reports = new Map();

function formatSize(bytes) {
  return `${(bytes / KiB).toFixed(1)} kB`;
}

function gzipSize(source) {
  return zlib.gzipSync(typeof source === 'string' ? Buffer.from(source) : source, { level: 9 }).length;
}

function createMeasurement(label, size, gzip, maxSize, maxGzip) {
  return {
    label,
    sizeBytes: size,
    gzipBytes: gzip,
    size: formatSize(size),
    gzip: formatSize(gzip),
    budget: {
      sizeBytes: maxSize,
      gzipBytes: maxGzip,
      size: formatSize(maxSize),
      gzip: formatSize(maxGzip),
    },
  };
}

function fail(message) {
  failures.push(message);
}

function normalizeModuleId(id) {
  return id.replace(/\\/g, '/');
}

function overBudget(label, size, gzip, maxSize, maxGzip) {
  if (size > maxSize || gzip > maxGzip) {
    fail(`${label} is ${formatSize(size)} / gzip ${formatSize(gzip)}, over budget ${formatSize(maxSize)} / gzip ${formatSize(maxGzip)}.`);
  }
}

function printBudgetLine(label, size, gzip, maxSize, maxGzip) {
  console.log(`- ${label}: ${formatSize(size)} / gzip ${formatSize(gzip)} (budget ${formatSize(maxSize)} / gzip ${formatSize(maxGzip)})`);
}

async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

function reportPath(kind) {
  return path.join(reportDir, `${kind}-bundle-size-report.json`);
}

function reportCommand(kind) {
  return kind === 'playground' ? 'npm run build:playground' : 'npm run build && npm run verify:bundle-size';
}

async function writeReport(kind, report) {
  await mkdir(reportDir, { recursive: true });
  const filePath = reportPath(kind);
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${path.relative(rootDir, filePath).replace(/\\/g, '/')}.`);
}

function compareReadmeMeasurement({ match, readmeLabel, measured, refreshCommand }) {
  if (!match) {
    fail(`README bundle-size documentation for ${readmeLabel} was not found; update README.md or the verification parser.`);
    return;
  }

  const [, readmeSize, readmeGzip] = match;
  if (readmeSize !== measured.size || readmeGzip !== measured.gzip) {
    fail(`README bundle-size documentation for ${readmeLabel} says ${readmeSize} / gzip ${readmeGzip}, but verification measured ${measured.size} / gzip ${measured.gzip}. Run \`${refreshCommand}\` and update README.md.`);
  }
}

async function verifyReadmeLibraryMeasurements(measurements) {
  const readme = await readText(readmePath);
  const rows = [
    {
      key: 'root',
      label: 'react-chorus (`<Chorus>`)',
      pattern: /\| `react-chorus` \(`<Chorus>`\) \| ([\d.]+ kB) \| ([\d.]+ kB) \|/,
    },
    {
      key: 'headless',
      label: 'react-chorus/headless',
      pattern: /\| `react-chorus\/headless` \| ([\d.]+ kB) \| ([\d.]+ kB) \|/,
    },
    {
      key: 'rootUseChorusStream',
      label: 'react-chorus (`useChorusStream`)',
      pattern: /\| `react-chorus` \(`useChorusStream`\) \| ([\d.]+ kB) \| ([\d.]+ kB) \|/,
    },
    {
      key: 'rootMarkdown',
      label: 'react-chorus (`Markdown`)',
      pattern: /\| `react-chorus` \(`Markdown`\) \| ([\d.]+ kB) \| ([\d.]+ kB) \|/,
    },
    {
      key: 'rootChatWindow',
      label: 'react-chorus (`ChatWindow`)',
      pattern: /\| `react-chorus` \(`ChatWindow`\) \| ([\d.]+ kB) \| ([\d.]+ kB) \|/,
    },
    {
      key: 'rootConversationList',
      label: 'react-chorus (`ConversationList`)',
      pattern: /\| `react-chorus` \(`ConversationList`\) \| ([\d.]+ kB) \| ([\d.]+ kB) \|/,
    },
    {
      key: 'transport',
      label: 'react-chorus/transport',
      pattern: /\| `react-chorus\/transport` \| ([\d.]+ kB) \| ([\d.]+ kB) \|/,
    },
    {
      key: 'providerRequests',
      label: 'react-chorus/provider-requests',
      pattern: /\| `react-chorus\/provider-requests` \| ([\d.]+ kB) \| ([\d.]+ kB) \|/,
    },
    {
      key: 'server',
      label: 'react-chorus/server',
      pattern: /\| `react-chorus\/server` \| ([\d.]+ kB) \| ([\d.]+ kB) \|/,
    },
    {
      key: 'highlight',
      label: 'lazy highlight.js runtime',
      pattern: /\| Lazy `highlight\.js` runtime \| ([\d.]+ kB) \| ([\d.]+ kB) \|/,
    },
  ];

  for (const row of rows) {
    const measured = measurements[row.key];
    if (!measured) continue;
    compareReadmeMeasurement({
      match: readme.match(row.pattern),
      readmeLabel: row.label,
      measured,
      refreshCommand: reportCommand('library'),
    });
  }
}

async function verifyReadmePlaygroundMeasurements(measurements) {
  const readme = await readText(readmePath);
  const match = readme.match(/current playground initial JS graph is ([\d.]+ kB) \/ ([\d.]+ kB) gzip and its largest lazy chunk \(highlight\.js\) is ([\d.]+ kB) \/ ([\d.]+ kB) gzip/);
  if (!match) {
    fail('README playground bundle-size paragraph was not found; update README.md or the verification parser.');
    return;
  }

  const initial = measurements.initialJsGraph;
  const lazy = measurements.largestLazyJsChunk;
  if (!initial || !lazy) return;

  const [, readmeInitialSize, readmeInitialGzip, readmeLazySize, readmeLazyGzip] = match;
  if (readmeInitialSize !== initial.size || readmeInitialGzip !== initial.gzip) {
    fail(`README playground initial JS graph says ${readmeInitialSize} / gzip ${readmeInitialGzip}, but verification measured ${initial.size} / gzip ${initial.gzip}. Run \`${reportCommand('playground')}\` and update README.md.`);
  }
  if (readmeLazySize !== lazy.size || readmeLazyGzip !== lazy.gzip) {
    fail(`README playground lazy chunk says ${readmeLazySize} / gzip ${readmeLazyGzip}, but verification measured ${lazy.size} / gzip ${lazy.gzip}. Run \`${reportCommand('playground')}\` and update README.md.`);
  }
}

async function listFiles(dir, predicate = () => true) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath, predicate));
    } else if (entry.isFile() && predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

function isReactPeerDependency(id) {
  return id === 'react' || id === 'react-dom' || id.startsWith('react/') || id.startsWith('react-dom/');
}

const externalizedRuntimeModulePatterns = [
  { label: 'dompurify', pattern: /(^|\/)node_modules\/dompurify\// },
  { label: 'lucide-react', pattern: /(^|\/)node_modules\/lucide-react\// },
  { label: 'marked', pattern: /(^|\/)node_modules\/marked\// },
  { label: 'marked-highlight', pattern: /(^|\/)node_modules\/marked-highlight\// },
  { label: 'highlight.js runtime', pattern: /(^|\/)node_modules\/highlight\.js\/(?!styles\/)/ },
];

const highlightRuntimePattern = /(^|\/)node_modules\/highlight\.js\/(?!styles\/)/;
const distDirPattern = normalizeModuleId(distDir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const distUiComponentPattern = new RegExp(`${distDirPattern}/(?:ChatWindow|chat-input|conversation-list|Chorus|react-chorus-(?:headless|chat-window|conversation-list))[A-Za-z0-9_.-]*(?:\\.js|\\.cjs)$`);
const distMarkdownPattern = new RegExp(`${distDirPattern}/(?:markdown|react-chorus-markdown)[A-Za-z0-9_.-]*(?:\\.js|\\.cjs)$`);
const distWidgetPattern = new RegExp(`${distDirPattern}/(?:Chorus|react-chorus-headless)[A-Za-z0-9_.-]*(?:\\.js|\\.cjs)$`);

const transportOnlyForbiddenPatterns = [
  { label: 'React runtime', pattern: /(^|\/)node_modules\/react\// },
  { label: 'DOMPurify', pattern: /(^|\/)node_modules\/dompurify\// },
  { label: 'Lucide icons', pattern: /(^|\/)node_modules\/lucide-react\// },
  { label: 'Marked', pattern: /(^|\/)node_modules\/marked\// },
  { label: 'Marked highlight', pattern: /(^|\/)node_modules\/marked-highlight\// },
  { label: 'UI components', pattern: /\/src\/components\// },
  { label: 'published UI chunks', pattern: distUiComponentPattern },
  { label: 'published Markdown chunks', pattern: distMarkdownPattern },
  { label: 'Chorus widget', pattern: /\/src\/Chorus(?:Headless)?\.tsx$/ },
  { label: 'published Chorus widget chunks', pattern: distWidgetPattern },
];

const hookOnlyForbiddenPatterns = [
  { label: 'DOMPurify', pattern: /(^|\/)node_modules\/dompurify\// },
  { label: 'Lucide icons', pattern: /(^|\/)node_modules\/lucide-react\// },
  { label: 'Marked', pattern: /(^|\/)node_modules\/marked\// },
  { label: 'Marked highlight', pattern: /(^|\/)node_modules\/marked-highlight\// },
  { label: 'highlight.js runtime', pattern: highlightRuntimePattern },
  { label: 'UI components', pattern: /\/src\/components\// },
  { label: 'published UI chunks', pattern: distUiComponentPattern },
  { label: 'published Markdown chunks', pattern: distMarkdownPattern },
  { label: 'Chorus widget', pattern: /\/src\/Chorus(?:Headless)?\.tsx$/ },
  { label: 'published Chorus widget chunks', pattern: distWidgetPattern },
];

const markdownOnlyForbiddenPatterns = [
  { label: 'Lucide icons', pattern: /(^|\/)node_modules\/lucide-react\// },
  { label: 'ChatWindow components', pattern: /\/src\/components\/(?:ChatWindow|MessageRow|ChatInput|ConversationList|ToolCallBlock)\.tsx$/ },
  { label: 'published UI chunks', pattern: distUiComponentPattern },
  { label: 'Chorus widget', pattern: /\/src\/Chorus(?:Headless)?\.tsx$/ },
  { label: 'published Chorus widget chunks', pattern: distWidgetPattern },
];

const conversationListForbiddenPatterns = [
  { label: 'DOMPurify', pattern: /(^|\/)node_modules\/dompurify\// },
  { label: 'Lucide icons', pattern: /(^|\/)node_modules\/lucide-react\// },
  { label: 'Marked', pattern: /(^|\/)node_modules\/marked\// },
  { label: 'Marked highlight', pattern: /(^|\/)node_modules\/marked-highlight\// },
  { label: 'highlight.js runtime', pattern: highlightRuntimePattern },
  { label: 'Markdown components', pattern: /\/src\/components\/Markdown\.tsx$/ },
  { label: 'published Markdown chunks', pattern: distMarkdownPattern },
  { label: 'ChatWindow components', pattern: /\/src\/components\/(?:ChatWindow|MessageRow|ChatInput|ToolCallBlock)\.tsx$/ },
  { label: 'published widget chunks', pattern: new RegExp(`${distDirPattern}/(?:ChatWindow|chat-input|Chorus|react-chorus-(?:headless|chat-window))[A-Za-z0-9_.-]*(?:\\.js|\\.cjs)$`) },
];

async function verifyPublishedDistExternalization() {
  if (!existsSync(distDir)) {
    fail('dist/ is missing. Run `npm run build` before `npm run verify:bundle-size`.');
    return;
  }

  if (!existsSync(path.join(distDir, 'styles.css'))) {
    fail('dist/styles.css is missing; the library CSS must remain extracted and exported.');
  }

  const distJsFiles = await listFiles(distDir, filePath => /\.(?:js|cjs)$/.test(filePath));
  for (const filePath of distJsFiles) {
    const code = await readText(filePath);
    const normalizedCode = normalizeModuleId(code);
    for (const { label, pattern } of externalizedRuntimeModulePatterns) {
      if (pattern.test(normalizedCode)) {
        fail(`Published dist appears to bundle ${label} in ${path.relative(rootDir, filePath)}; runtime dependencies must stay externalized.`);
      }
    }
  }
}

async function verifyEntrypointSmoke() {
  const entrypoints = [
    { label: 'root ESM', file: 'react-chorus.es.js', kind: 'esm' },
    { label: 'root CJS', file: 'react-chorus.cjs', kind: 'cjs' },
    { label: 'headless ESM', file: 'react-chorus-headless.es.js', kind: 'esm' },
    { label: 'headless CJS', file: 'react-chorus-headless.cjs', kind: 'cjs' },
    { label: 'transport ESM', file: 'react-chorus-transport.es.js', kind: 'esm' },
    { label: 'transport CJS', file: 'react-chorus-transport.cjs', kind: 'cjs' },
    { label: 'provider-requests ESM', file: 'provider-requests.es.js', kind: 'esm' },
    { label: 'provider-requests CJS', file: 'provider-requests.cjs', kind: 'cjs' },
    { label: 'server ESM', file: 'react-chorus-server.es.js', kind: 'esm' },
    { label: 'server CJS', file: 'react-chorus-server.cjs', kind: 'cjs' },
  ];

  for (const { label, file, kind } of entrypoints) {
    const entryPath = path.join(distDir, file);
    if (!existsSync(entryPath)) {
      fail(`${label} entry ${path.relative(rootDir, entryPath)} is missing.`);
      continue;
    }

    try {
      if (kind === 'esm') {
        await import(pathToFileURL(entryPath).href);
      } else {
        require(entryPath);
      }
    } catch (error) {
      fail(`${label} entry failed to load: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function writeConsumerEntries(entryDir) {
  await mkdir(entryDir, { recursive: true });
  await writeFile(path.join(entryDir, 'root.js'), "import { Chorus } from 'react-chorus';\nconsole.log(Chorus);\n");
  await writeFile(path.join(entryDir, 'headless.js'), "import { ChorusHeadless } from 'react-chorus/headless';\nconsole.log(ChorusHeadless);\n");
  await writeFile(path.join(entryDir, 'root-use-chorus-stream.js'), "import { useChorusStream } from 'react-chorus';\nconsole.log(useChorusStream);\n");
  await writeFile(path.join(entryDir, 'root-markdown.js'), "import { Markdown } from 'react-chorus';\nconsole.log(Markdown);\n");
  await writeFile(path.join(entryDir, 'root-chat-window.js'), "import { ChatWindow } from 'react-chorus';\nconsole.log(ChatWindow);\n");
  await writeFile(path.join(entryDir, 'root-conversation-list.js'), "import { ConversationList } from 'react-chorus';\nconsole.log(ConversationList);\n");
  await writeFile(path.join(entryDir, 'transport.js'), "import { createFetchSSETransport, createWebSocketTransport } from 'react-chorus/transport';\nconsole.log(createFetchSSETransport, createWebSocketTransport);\n");
  await writeFile(path.join(entryDir, 'provider-requests.js'), "import { toOpenAIChatCompletionsBody, toAnthropicMessagesBody, toGeminiGenerateContentBody } from 'react-chorus/provider-requests';\nconsole.log(toOpenAIChatCompletionsBody, toAnthropicMessagesBody, toGeminiGenerateContentBody);\n");
  await writeFile(path.join(entryDir, 'server.js'), "import { sseHeaders, encodeSSEEvent, encodeSSEDone, encodeSSEError } from 'react-chorus/server';\nconsole.log(sseHeaders, encodeSSEEvent, encodeSSEDone, encodeSSEError);\n");
}

function normalizeRollupOutput(result) {
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap(output => output.output ?? []);
}

function chunkModules(chunk) {
  return Object.keys(chunk.modules ?? {}).map(normalizeModuleId);
}

function chunkHasModule(chunk, pattern) {
  return chunkModules(chunk).some(moduleId => pattern.test(moduleId));
}

function collectStaticChunkGraph(entryChunk, chunksByFileName) {
  const visited = new Set();
  const stack = [entryChunk.fileName];

  while (stack.length > 0) {
    const fileName = stack.pop();
    if (!fileName || visited.has(fileName)) continue;
    const chunk = chunksByFileName.get(fileName);
    if (!chunk) continue;
    visited.add(fileName);
    for (const imported of chunk.imports ?? []) {
      if (chunksByFileName.has(imported)) stack.push(imported);
    }
  }

  return [...visited];
}

function measureRollupChunks(fileNames, chunksByFileName) {
  let size = 0;
  let gzip = 0;
  for (const fileName of fileNames) {
    const chunk = chunksByFileName.get(fileName);
    if (!chunk) continue;
    size += Buffer.byteLength(chunk.code);
    gzip += gzipSize(chunk.code);
  }
  return { size, gzip };
}

function collectDynamicChunkGraph(seedChunks, chunksByFileName) {
  const visited = new Set();
  const stack = seedChunks.map(chunk => chunk.fileName);

  while (stack.length > 0) {
    const fileName = stack.pop();
    if (!fileName || visited.has(fileName)) continue;
    const chunk = chunksByFileName.get(fileName);
    if (!chunk) continue;
    visited.add(fileName);
    for (const imported of chunk.imports ?? []) {
      if (chunksByFileName.has(imported)) stack.push(imported);
    }
  }

  return [...visited];
}

function hasPublishedDistSideEffects(id, external) {
  if (external) return true;
  const normalizedId = normalizeModuleId(id.split('?')[0]);
  return !normalizedId.startsWith(`${normalizeModuleId(distDir)}/`);
}

async function buildConsumerBundle() {
  const cacheDir = path.join(rootDir, 'node_modules', '.cache', 'react-chorus-bundle-size');
  const entryDir = path.join(cacheDir, 'entries');
  const outDir = path.join(cacheDir, 'dist');

  await rm(cacheDir, { recursive: true, force: true });
  await writeConsumerEntries(entryDir);

  const result = await build({
    configFile: false,
    root: rootDir,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        treeshake: {
          // package.json declares only CSS as side-effectful. The verification
          // bundle runs from this repository instead of an installed package, so
          // mirror that published sideEffects contract for dist chunks here.
          moduleSideEffects: hasPublishedDistSideEffects,
        },
        input: {
          root: path.join(entryDir, 'root.js'),
          headless: path.join(entryDir, 'headless.js'),
          rootUseChorusStream: path.join(entryDir, 'root-use-chorus-stream.js'),
          rootMarkdown: path.join(entryDir, 'root-markdown.js'),
          rootChatWindow: path.join(entryDir, 'root-chat-window.js'),
          rootConversationList: path.join(entryDir, 'root-conversation-list.js'),
          transport: path.join(entryDir, 'transport.js'),
          providerRequests: path.join(entryDir, 'provider-requests.js'),
          server: path.join(entryDir, 'server.js'),
        },
        external: isReactPeerDependency,
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  });

  return normalizeRollupOutput(result).filter(output => output.type === 'chunk');
}

async function verifyConsumerBundleBudgets() {
  const chunks = await buildConsumerBundle();
  const chunksByFileName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
  const measurements = {};
  const entryBudgets = [
    { label: 'root entry initial JS', entry: 'root', maxSize: 203 * KiB, maxGzip: 68 * KiB },
    { label: 'headless entry initial JS', entry: 'headless', maxSize: 203 * KiB, maxGzip: 68 * KiB },
    { label: 'root useChorusStream import initial JS', entry: 'rootUseChorusStream', maxSize: 59 * KiB, maxGzip: 19 * KiB },
    { label: 'root Markdown import initial JS', entry: 'rootMarkdown', maxSize: 85 * KiB, maxGzip: 30 * KiB },
    { label: 'root ChatWindow import initial JS', entry: 'rootChatWindow', maxSize: 128 * KiB, maxGzip: 43 * KiB },
    { label: 'root ConversationList import initial JS', entry: 'rootConversationList', maxSize: 12 * KiB, maxGzip: 5 * KiB },
    { label: 'transport subpath initial JS', entry: 'transport', maxSize: 8 * KiB, maxGzip: 3 * KiB },
    { label: 'provider-requests subpath initial JS', entry: 'providerRequests', maxSize: 16 * KiB, maxGzip: 6 * KiB },
    { label: 'server subpath initial JS', entry: 'server', maxSize: 4 * KiB, maxGzip: 2 * KiB },
  ];

  const initialGraphs = new Map();
  console.log('Consumer bundle budgets (React peers excluded):');
  for (const budget of entryBudgets) {
    const entryChunk = chunks.find(chunk => chunk.isEntry && chunk.name === budget.entry);
    if (!entryChunk) {
      fail(`Consumer bundle entry ${budget.entry} was not emitted.`);
      continue;
    }

    const graph = collectStaticChunkGraph(entryChunk, chunksByFileName);
    initialGraphs.set(budget.entry, graph);
    const { size, gzip } = measureRollupChunks(graph, chunksByFileName);
    measurements[budget.entry] = createMeasurement(budget.label, size, gzip, budget.maxSize, budget.maxGzip);
    printBudgetLine(budget.label, size, gzip, budget.maxSize, budget.maxGzip);
    overBudget(budget.label, size, gzip, budget.maxSize, budget.maxGzip);
  }

  for (const entry of ['root', 'headless', 'rootMarkdown', 'rootChatWindow']) {
    const graph = initialGraphs.get(entry) ?? [];
    const highlightInInitial = graph
      .map(fileName => chunksByFileName.get(fileName))
      .filter(Boolean)
      .filter(chunk => chunkHasModule(chunk, highlightRuntimePattern));
    if (highlightInInitial.length > 0) {
      fail(`${entry} initial graph includes highlight.js runtime (${highlightInInitial.map(chunk => chunk.fileName).join(', ')}); syntax highlighting must remain lazy.`);
    }
  }

  function verifyGraphExcludes(entry, graph, patterns, guidance) {
    for (const fileName of graph) {
      const chunk = chunksByFileName.get(fileName);
      if (!chunk) continue;
      for (const { label, pattern } of patterns) {
        if (chunkHasModule(chunk, pattern)) {
          fail(`${entry} pulled ${label} into ${chunk.fileName}; ${guidance}`);
        }
      }
    }
  }

  verifyGraphExcludes(
    'root useChorusStream import',
    initialGraphs.get('rootUseChorusStream') ?? [],
    hookOnlyForbiddenPatterns,
    'keep hook-only root imports free of UI/Markdown/icon dependencies.',
  );
  verifyGraphExcludes(
    'root Markdown import',
    initialGraphs.get('rootMarkdown') ?? [],
    markdownOnlyForbiddenPatterns,
    'keep standalone Markdown free of chat-window and icon dependencies.',
  );
  verifyGraphExcludes(
    'root ConversationList import',
    initialGraphs.get('rootConversationList') ?? [],
    conversationListForbiddenPatterns,
    'keep conversation-list imports free of Markdown/widget dependencies.',
  );
  verifyGraphExcludes(
    'transport subpath',
    initialGraphs.get('transport') ?? [],
    transportOnlyForbiddenPatterns,
    'keep transport-only imports free of React/UI/Markdown dependencies.',
  );
  verifyGraphExcludes(
    'provider-requests subpath',
    initialGraphs.get('providerRequests') ?? [],
    transportOnlyForbiddenPatterns,
    'keep server-safe provider request helpers free of React/UI/Markdown dependencies.',
  );
  verifyGraphExcludes(
    'server subpath',
    initialGraphs.get('server') ?? [],
    transportOnlyForbiddenPatterns,
    'keep server-safe SSE framing helpers free of React/UI/Markdown dependencies.',
  );

  const highlightChunks = chunks.filter(chunk => chunkHasModule(chunk, highlightRuntimePattern));
  if (highlightChunks.length === 0) {
    fail('Consumer bundle did not emit a lazy highlight.js runtime chunk; the code-fence cost is no longer being measured.');
  } else {
    const highlightGraph = collectDynamicChunkGraph(highlightChunks, chunksByFileName);
    const { size, gzip } = measureRollupChunks(highlightGraph, chunksByFileName);
    const maxSize = 950 * KiB;
    const maxGzip = 330 * KiB;
    measurements.highlight = createMeasurement('lazy highlight.js runtime', size, gzip, maxSize, maxGzip);
    printBudgetLine('lazy highlight.js runtime', size, gzip, maxSize, maxGzip);
    overBudget('lazy highlight.js runtime', size, gzip, maxSize, maxGzip);
  }

  await verifyReadmeLibraryMeasurements(measurements);
  reports.set('library', {
    schemaVersion: 1,
    command: reportCommand('library'),
    generatedAt: new Date().toISOString(),
    reactPeersExcluded: true,
    measurements,
  });
}

function parseStaticImports(code) {
  const imports = [];
  const importPattern = /(?:^|[;\n])\s*import\s*(?:[^'"()]*?\bfrom\s*)?["']([^"']+)["']/g;
  const exportPattern = /(?:^|[;\n])\s*export\s+[^'"()]*?\bfrom\s*["']([^"']+)["']/g;
  for (const pattern of [importPattern, exportPattern]) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      imports.push(match[1]);
    }
  }
  return imports;
}

async function collectStaticFileGraph(entryFiles, allJsFiles) {
  const allJsByAbsolute = new Map(allJsFiles.map(filePath => [path.resolve(filePath), filePath]));
  const visited = new Set();
  const stack = entryFiles.map(filePath => path.resolve(filePath));

  while (stack.length > 0) {
    const absolutePath = stack.pop();
    if (!absolutePath || visited.has(absolutePath)) continue;
    const filePath = allJsByAbsolute.get(absolutePath);
    if (!filePath) continue;
    visited.add(absolutePath);
    const code = await readText(filePath);
    for (const specifier of parseStaticImports(code)) {
      if (!specifier.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(filePath), specifier);
      if (allJsByAbsolute.has(resolved)) stack.push(resolved);
    }
  }

  return [...visited].map(filePath => allJsByAbsolute.get(filePath)).filter(Boolean);
}

async function measureFiles(filePaths) {
  let size = 0;
  let gzip = 0;
  for (const filePath of filePaths) {
    const source = await readFile(filePath);
    size += source.length;
    gzip += gzipSize(source);
  }
  return { size, gzip };
}

function resolvePlaygroundAsset(src) {
  const url = new URL(src, 'https://example.test');
  const relativePath = url.pathname.replace(/^\/react-chorus\//, '').replace(/^\//, '');
  return path.join(playgroundDir, relativePath);
}

async function verifyPlaygroundBudgets() {
  if (!existsSync(playgroundDir)) {
    fail('dist-playground/ is missing. Run `npm run build:playground` before `npm run verify:playground-size`.');
    return;
  }

  const htmlPath = path.join(playgroundDir, 'index.html');
  if (!existsSync(htmlPath)) {
    fail('dist-playground/index.html is missing.');
    return;
  }

  const allJsFiles = await listFiles(playgroundDir, filePath => filePath.endsWith('.js'));
  if (allJsFiles.length === 0) {
    fail('dist-playground does not contain any JavaScript assets.');
    return;
  }

  const html = await readText(htmlPath);
  const moduleScriptSrcs = [...html.matchAll(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/g)].map(match => match[1]);
  const entryFiles = moduleScriptSrcs.map(resolvePlaygroundAsset).filter(filePath => existsSync(filePath));
  if (entryFiles.length === 0) {
    fail('Could not find the playground module entry script in dist-playground/index.html.');
    return;
  }

  const initialGraph = await collectStaticFileGraph(entryFiles, allJsFiles);
  const initial = await measureFiles(initialGraph);
  const initialMaxSize = 422 * KiB;
  const initialMaxGzip = 133 * KiB;
  const measurements = {
    initialJsGraph: createMeasurement('initial JS graph', initial.size, initial.gzip, initialMaxSize, initialMaxGzip),
  };

  console.log('Playground bundle budgets:');
  printBudgetLine('initial JS graph', initial.size, initial.gzip, initialMaxSize, initialMaxGzip);
  overBudget('playground initial JS graph', initial.size, initial.gzip, initialMaxSize, initialMaxGzip);

  const initialSet = new Set(initialGraph.map(filePath => path.resolve(filePath)));
  const lazyJsFiles = allJsFiles.filter(filePath => !initialSet.has(path.resolve(filePath)));
  if (lazyJsFiles.length > 0) {
    let largestLazy = null;
    for (const filePath of lazyJsFiles) {
      const source = await readFile(filePath);
      const size = source.length;
      const gzip = gzipSize(source);
      if (!largestLazy || size > largestLazy.size) {
        largestLazy = { filePath, size, gzip };
      }
    }

    const lazyMaxSize = 950 * KiB;
    const lazyMaxGzip = 330 * KiB;
    const label = `largest lazy JS chunk (${path.relative(playgroundDir, largestLazy.filePath).replace(/\\/g, '/')})`;
    measurements.largestLazyJsChunk = {
      ...createMeasurement(label, largestLazy.size, largestLazy.gzip, lazyMaxSize, lazyMaxGzip),
      fileName: path.relative(playgroundDir, largestLazy.filePath).replace(/\\/g, '/'),
    };
    printBudgetLine(label, largestLazy.size, largestLazy.gzip, lazyMaxSize, lazyMaxGzip);
    overBudget('playground largest lazy JS chunk', largestLazy.size, largestLazy.gzip, lazyMaxSize, lazyMaxGzip);
  }

  await verifyReadmePlaygroundMeasurements(measurements);
  reports.set('playground', {
    schemaVersion: 1,
    command: reportCommand('playground'),
    generatedAt: new Date().toISOString(),
    measurements,
  });
}

async function verifyLibraryBudgets() {
  await verifyPublishedDistExternalization();
  await verifyEntrypointSmoke();
  await verifyConsumerBundleBudgets();
}

if (runLibrary) await verifyLibraryBudgets();
if (runPlayground) await verifyPlaygroundBudgets();

for (const [kind, report] of reports) {
  await writeReport(kind, report);
}

if (failures.length > 0) {
  console.error('\nBundle size verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nBundle size verification passed.');
}
