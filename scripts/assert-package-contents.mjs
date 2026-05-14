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

  if (forbiddenFiles.length > 0) {
    logger.error('Unexpected internal files would be included in the npm package:');
    for (const { filePath, label } of forbiddenFiles) {
      logger.error(`- ${filePath}${label ? ` (${label})` : ''}`);
    }
    return 1;
  }

  logger.log(`Package contents OK (${packedFiles.length} files checked).`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runAssertPackageContents();
}
