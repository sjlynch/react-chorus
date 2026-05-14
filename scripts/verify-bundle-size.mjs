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
const args = new Set(process.argv.slice(2));
const runPlayground = args.has('--playground');
const runLibrary = !runPlayground || args.has('--library');
const require = createRequire(import.meta.url);

const failures = [];

function formatSize(bytes) {
  return `${(bytes / KiB).toFixed(1)} kB`;
}

function gzipSize(source) {
  return zlib.gzipSync(typeof source === 'string' ? Buffer.from(source) : source, { level: 9 }).length;
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
const transportOnlyForbiddenPatterns = [
  { label: 'React runtime', pattern: /(^|\/)node_modules\/react\// },
  { label: 'DOMPurify', pattern: /(^|\/)node_modules\/dompurify\// },
  { label: 'Lucide icons', pattern: /(^|\/)node_modules\/lucide-react\// },
  { label: 'Marked', pattern: /(^|\/)node_modules\/marked\// },
  { label: 'Marked highlight', pattern: /(^|\/)node_modules\/marked-highlight\// },
  { label: 'UI components', pattern: /\/src\/components\// },
  { label: 'Chorus widget', pattern: /\/src\/Chorus(?:Headless)?\.tsx$/ },
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
  await writeFile(path.join(entryDir, 'transport.js'), "import { createFetchSSETransport, createWebSocketTransport } from 'react-chorus/transport';\nconsole.log(createFetchSSETransport, createWebSocketTransport);\n");
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
        input: {
          root: path.join(entryDir, 'root.js'),
          headless: path.join(entryDir, 'headless.js'),
          transport: path.join(entryDir, 'transport.js'),
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
  const entryBudgets = [
    { label: 'root entry initial JS', entry: 'root', maxSize: 160 * KiB, maxGzip: 55 * KiB },
    { label: 'headless entry initial JS', entry: 'headless', maxSize: 165 * KiB, maxGzip: 56 * KiB },
    { label: 'transport subpath initial JS', entry: 'transport', maxSize: 8 * KiB, maxGzip: 3 * KiB },
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
    printBudgetLine(budget.label, size, gzip, budget.maxSize, budget.maxGzip);
    overBudget(budget.label, size, gzip, budget.maxSize, budget.maxGzip);
  }

  for (const entry of ['root', 'headless']) {
    const graph = initialGraphs.get(entry) ?? [];
    const highlightInInitial = graph
      .map(fileName => chunksByFileName.get(fileName))
      .filter(Boolean)
      .filter(chunk => chunkHasModule(chunk, highlightRuntimePattern));
    if (highlightInInitial.length > 0) {
      fail(`${entry} initial graph includes highlight.js runtime (${highlightInInitial.map(chunk => chunk.fileName).join(', ')}); syntax highlighting must remain lazy.`);
    }
  }

  const transportGraph = initialGraphs.get('transport') ?? [];
  for (const fileName of transportGraph) {
    const chunk = chunksByFileName.get(fileName);
    if (!chunk) continue;
    for (const { label, pattern } of transportOnlyForbiddenPatterns) {
      if (chunkHasModule(chunk, pattern)) {
        fail(`transport subpath pulled ${label} into ${chunk.fileName}; keep transport-only imports free of UI/Markdown dependencies.`);
      }
    }
  }

  const highlightChunks = chunks.filter(chunk => chunkHasModule(chunk, highlightRuntimePattern));
  if (highlightChunks.length === 0) {
    fail('Consumer bundle did not emit a lazy highlight.js runtime chunk; the code-fence cost is no longer being measured.');
  } else {
    const highlightGraph = collectDynamicChunkGraph(highlightChunks, chunksByFileName);
    const { size, gzip } = measureRollupChunks(highlightGraph, chunksByFileName);
    const maxSize = 950 * KiB;
    const maxGzip = 330 * KiB;
    printBudgetLine('lazy highlight.js runtime', size, gzip, maxSize, maxGzip);
    overBudget('lazy highlight.js runtime', size, gzip, maxSize, maxGzip);
  }
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
  const initialMaxSize = 380 * KiB;
  const initialMaxGzip = 125 * KiB;

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
    printBudgetLine(label, largestLazy.size, largestLazy.gzip, lazyMaxSize, lazyMaxGzip);
    overBudget('playground largest lazy JS chunk', largestLazy.size, largestLazy.gzip, lazyMaxSize, lazyMaxGzip);
  }
}

async function verifyLibraryBudgets() {
  await verifyPublishedDistExternalization();
  await verifyEntrypointSmoke();
  await verifyConsumerBundleBudgets();
}

if (runLibrary) await verifyLibraryBudgets();
if (runPlayground) await verifyPlaygroundBudgets();

if (failures.length > 0) {
  console.error('\nBundle size verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nBundle size verification passed.');
}
