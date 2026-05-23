import { execFile as nodeExecFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '..');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export const forbiddenEntries = [
  {
    label: 'test declarations',
    pattern: /^dist\/types\/__tests__(?:\/|$)/,
  },
  {
    label: 'type-test declarations',
    pattern: /^dist\/types\/__type_tests__(?:\/|$)/,
  },
  {
    label: 'playground files',
    pattern: /(?:^|\/)playground(?:\/|$)/,
  },
  {
    label: 'Vite scaffold declarations',
    pattern: /^dist\/types\/(?:main|vite-env)\.d\.ts$/,
  },
];

// External sourcemaps must ship alongside every code-bearing published chunk
// so consumer stack traces map back to source. Pure barrel entries
// (`react-chorus.es.js`, `react-chorus-transport.es.js`,
// `provider-requests.es.js`) are single-line re-exports — Rolldown skips
// emitting maps for those because there is no source position to preserve;
// the real implementations live in the hashed chunks below and those carry
// the maps.
//
// Hash suffixes change between builds, so each required entry is matched by
// prefix + format suffix instead of an exact filename. The check both fails
// CI on a `sourcemap: false` regression and surfaces a missing map for a
// chunk that was renamed or split.
export const requiredSourcemapPrefixes = [
  // Named entries that contain real code (not pure re-export barrels).
  { prefix: 'dist/react-chorus-headless', suffixes: ['.es.js.map', '.cjs.map'] },
  { prefix: 'dist/react-chorus-server', suffixes: ['.es.js.map', '.cjs.map'] },
  // Hashed implementation chunks shared by multiple entries. Stack traces
  // from consumer code land in these files, so the maps here are what
  // actually power the DX win this check guards.
  { prefix: 'dist/chorus-session-', suffixes: ['.js.map', '.cjs.map'] },
  { prefix: 'dist/ChatWindow-', suffixes: ['.js.map', '.cjs.map'] },
  { prefix: 'dist/chat-input-', suffixes: ['.js.map', '.cjs.map'] },
  { prefix: 'dist/markdown-', suffixes: ['.js.map', '.cjs.map'] },
  { prefix: 'dist/conversation-list-', suffixes: ['.js.map', '.cjs.map'] },
  { prefix: 'dist/conversations-', suffixes: ['.js.map', '.cjs.map'] },
  { prefix: 'dist/persistence-', suffixes: ['.js.map', '.cjs.map'] },
  { prefix: 'dist/providerRequests-', suffixes: ['.js.map', '.cjs.map'] },
  { prefix: 'dist/transport-core-', suffixes: ['.js.map', '.cjs.map'] },
  { prefix: 'dist/tools-', suffixes: ['.js.map', '.cjs.map'] },
  { prefix: 'dist/mcp-', suffixes: ['.js.map', '.cjs.map'] },
  { prefix: 'dist/src-', suffixes: ['.cjs.map'] },
];

export function normalizePackedFilePath(file) {
  const filePath = typeof file === 'string' ? file : file.path;
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function parsePackedFiles(packJson) {
  const packages = JSON.parse(packJson.trim());
  return packages.flatMap((pkg) => pkg.files ?? []).map(normalizePackedFilePath);
}

export function findForbiddenFiles(packedFiles, entries = forbiddenEntries) {
  return packedFiles.flatMap((filePath) => {
    const normalizedPath = normalizePackedFilePath(filePath);
    const entry = entries.find(({ pattern }) => pattern.test(normalizedPath));
    return entry ? [{ filePath: normalizedPath, label: entry.label }] : [];
  });
}

export function findMissingRequired(packedFiles, required = requiredSourcemapPrefixes) {
  const normalized = packedFiles.map(normalizePackedFilePath);
  const missing = [];
  for (const { prefix, suffixes } of required) {
    for (const suffix of suffixes) {
      const found = normalized.some((file) => file.startsWith(prefix) && file.endsWith(suffix));
      if (!found) missing.push(`${prefix}*${suffix}`);
    }
  }
  return missing;
}

function execFileAsync(execFileImpl, file, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export async function runAssertPackageContents({
  execFileImpl = nodeExecFile,
  cwd = rootDir,
  command = npmBin,
  logger = console,
} = {}) {
  const { stdout } = await execFileAsync(execFileImpl, command, ['pack', '--dry-run', '--json'], {
    cwd,
    maxBuffer: 1024 * 1024 * 10,
    shell: process.platform === 'win32',
  });

  let packedFiles;
  try {
    packedFiles = parsePackedFiles(stdout);
  } catch (error) {
    logger.error('Failed to parse npm pack --dry-run --json output.');
    logger.error(stdout);
    throw error;
  }

  const forbiddenFiles = findForbiddenFiles(packedFiles);
  const missingRequired = findMissingRequired(packedFiles);

  let hasError = false;
  if (forbiddenFiles.length > 0) {
    hasError = true;
    logger.error('Unexpected internal files would be included in the npm package:');
    for (const { filePath, label } of forbiddenFiles) {
      logger.error(`- ${filePath}${label ? ` (${label})` : ''}`);
    }
  }

  if (missingRequired.length > 0) {
    hasError = true;
    logger.error('Required sourcemap files are missing from the npm package (set `build.sourcemap: true` in vite.config.ts):');
    for (const filePath of missingRequired) {
      logger.error(`- ${filePath}`);
    }
  }

  if (hasError) return 1;

  const requiredCount = requiredSourcemapPrefixes.reduce(
    (sum, entry) => sum + entry.suffixes.length,
    0,
  );
  logger.log(`Package contents OK (${packedFiles.length} files checked, ${requiredCount} required sourcemaps present).`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runAssertPackageContents();
}
