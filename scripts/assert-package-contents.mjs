import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const { stdout } = await execFileAsync(npmBin, ['pack', '--dry-run', '--json'], {
  cwd: rootDir,
  maxBuffer: 1024 * 1024 * 10,
  shell: process.platform === 'win32',
});

let packages;
try {
  packages = JSON.parse(stdout.trim());
} catch (error) {
  console.error('Failed to parse npm pack --dry-run --json output.');
  console.error(stdout);
  throw error;
}

const packedFiles = packages.flatMap((pkg) => pkg.files ?? []).map((file) => {
  const filePath = typeof file === 'string' ? file : file.path;
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
});

const forbiddenEntries = [
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

const forbiddenFiles = packedFiles.filter((filePath) =>
  forbiddenEntries.some(({ pattern }) => pattern.test(filePath)),
);

if (forbiddenFiles.length > 0) {
  console.error('Unexpected internal files would be included in the npm package:');
  for (const filePath of forbiddenFiles) {
    const entry = forbiddenEntries.find(({ pattern }) => pattern.test(filePath));
    console.error(`- ${filePath}${entry ? ` (${entry.label})` : ''}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Package contents OK (${packedFiles.length} files checked).`);
}
