import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '..');
const REQUIRED_NODE_RANGE = '>=20';
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', '.vite']);
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const viteLargeChunkWarningPattern = /Some chunks are larger than \d+(?:\.\d+)? kB after minification/i;

function toRelative(cwd, filePath) {
  return path.relative(cwd, filePath).replace(/\\/g, '/');
}

async function readPackage(packagePath, cwd) {
  try {
    return {
      packageDir: path.dirname(packagePath),
      packagePath,
      relativePath: toRelative(cwd, packagePath),
      pkg: JSON.parse(await fs.readFile(packagePath, 'utf8')),
    };
  } catch (error) {
    return {
      packageDir: path.dirname(packagePath),
      packagePath,
      relativePath: toRelative(cwd, packagePath),
      pkg: null,
      error,
    };
  }
}

export async function findExamplePackages({ cwd = rootDir } = {}) {
  const base = path.join(cwd, 'examples');
  const packages = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'package.json') {
        packages.push(await readPackage(entryPath, cwd));
      } else if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
        await walk(entryPath);
      }
    }
  }

  await walk(base);
  return packages.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function findExampleMetadataProblems({ cwd = rootDir } = {}) {
  const packages = await findExamplePackages({ cwd });
  const problems = [];

  for (const record of packages) {
    if (!record.pkg) {
      const message = record.error instanceof Error ? record.error.message : String(record.error);
      problems.push(`${record.relativePath} could not be read: ${message}`);
      continue;
    }

    if (record.pkg.engines?.node !== REQUIRED_NODE_RANGE) {
      problems.push(`${record.relativePath} must declare engines.node "${REQUIRED_NODE_RANGE}".`);
    }
  }

  return problems;
}

export async function findRunnableExamplePackages({ cwd = rootDir } = {}) {
  const packages = await findExamplePackages({ cwd });
  return packages.filter((record) => Boolean(record.pkg?.scripts?.build));
}

function ensureRootBuild({ cwd = rootDir } = {}) {
  const requiredBuildOutputs = [
    'dist/react-chorus.es.js',
    'dist/react-chorus.cjs',
    'dist/styles.css',
    'dist/types/index.d.ts',
  ];
  return requiredBuildOutputs
    .map((relativePath) => path.join(cwd, relativePath))
    .filter((filePath) => !existsSync(filePath))
    .map((filePath) => toRelative(cwd, filePath));
}

function commandForLog(command, args) {
  return [command, ...args].join(' ');
}

async function runCommand(command, args, { cwd, env = {} }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CI: '1',
        npm_config_update_notifier: 'false',
        ...env,
      },
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      stderr += error instanceof Error ? error.message : String(error);
      resolve({ exitCode: 1, stdout, stderr });
    });
    child.on('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

async function runNpm(args, { cwd, logger }) {
  const result = await runCommand(npmBin, args, { cwd });
  if (result.exitCode !== 0) {
    logger.error(`Command failed in ${toRelative(rootDir, cwd)}: ${commandForLog(npmBin, args)}`);
    if (result.stdout.trim()) logger.error(result.stdout.trimEnd());
    if (result.stderr.trim()) logger.error(result.stderr.trimEnd());
  }
  return result;
}

export async function runExampleBuilds({ cwd = rootDir, logger = console } = {}) {
  const runnablePackages = await findRunnableExamplePackages({ cwd });
  const problems = [];

  if (runnablePackages.length === 0) {
    problems.push('No runnable example packages with a build script were found.');
    return problems;
  }

  const missingBuildOutputs = ensureRootBuild({ cwd });
  if (missingBuildOutputs.length > 0) {
    problems.push(`Root library build outputs are missing (${missingBuildOutputs.join(', ')}). Run \`npm run build\` before \`npm run verify:examples\`.`);
    return problems;
  }

  for (const example of runnablePackages) {
    const relativeDir = toRelative(cwd, example.packageDir);
    logger.log(`Verifying runnable example ${relativeDir}...`);

    const install = await runNpm(['install', '--prefer-offline', '--no-audit', '--no-fund', '--package-lock=false'], {
      cwd: example.packageDir,
      logger,
    });
    if (install.exitCode !== 0) {
      problems.push(`${relativeDir} dependencies failed to install.`);
      continue;
    }

    const build = await runNpm(['run', 'build'], {
      cwd: example.packageDir,
      logger,
    });
    const buildOutput = `${build.stdout}\n${build.stderr}`;
    if (build.exitCode !== 0) {
      problems.push(`${relativeDir} build failed.`);
      continue;
    }

    if (viteLargeChunkWarningPattern.test(buildOutput)) {
      logger.error(buildOutput.trimEnd());
      problems.push(`${relativeDir} emitted Vite's large-chunk warning. Keep examples warning-clean by code-splitting or updating the documented chunk-size budget.`);
      continue;
    }

    logger.log(`Example build OK: ${relativeDir}`);
  }

  return problems;
}

export async function runCheckExampleMetadata({ cwd = rootDir, logger = console } = {}) {
  const metadataProblems = await findExampleMetadataProblems({ cwd });
  const buildProblems = metadataProblems.length === 0 ? await runExampleBuilds({ cwd, logger }) : [];
  const problems = [...metadataProblems, ...buildProblems];

  if (problems.length > 0) {
    logger.error('Example verification problems:');
    for (const problem of problems) logger.error(`- ${problem}`);
    return 1;
  }

  logger.log('Example metadata and build smoke checks OK.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runCheckExampleMetadata();
}
