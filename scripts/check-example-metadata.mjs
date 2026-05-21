import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '..');
const REQUIRED_NODE_RANGE = '>=20.19.0';
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', '.vite']);
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const viteLargeChunkWarningPattern = /Some chunks are larger than \d+(?:\.\d+)? kB after minification/i;
const REACT_RUNTIME_PACKAGES = ['react', 'react-dom'];
const REACT_TYPE_PACKAGES = ['@types/react', '@types/react-dom'];
const REACT_ALL_PACKAGES = [...REACT_RUNTIME_PACKAGES, ...REACT_TYPE_PACKAGES];

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

function findDeclaredVersion(pkg, depName) {
  return pkg.dependencies?.[depName] ?? pkg.devDependencies?.[depName] ?? null;
}

function extractMajor(rangeString) {
  if (typeof rangeString !== 'string') return null;
  const match = rangeString.match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function parsePeerMajors(rangeString) {
  if (typeof rangeString !== 'string') return [];
  const majors = new Set();
  for (const alternative of rangeString.split('||')) {
    const match = alternative.trim().match(/\d+/);
    if (match) majors.add(Number(match[0]));
  }
  return Array.from(majors).sort((a, b) => a - b);
}

async function readRootPeerMajors(cwd) {
  const rootPkgPath = path.join(cwd, 'package.json');
  const rootPkg = JSON.parse(await fs.readFile(rootPkgPath, 'utf8'));
  const reactPeer = rootPkg.peerDependencies?.react;
  if (typeof reactPeer !== 'string') {
    throw new Error('Root package.json must declare peerDependencies.react.');
  }
  const majors = parsePeerMajors(reactPeer);
  if (majors.length === 0) {
    throw new Error(`Root peerDependencies.react ("${reactPeer}") has no parseable major versions.`);
  }
  return { range: reactPeer, majors };
}

export function findExampleReactProblems({ records, peerMajors }) {
  const problems = [];
  const warnings = [];
  const coverage = new Map();
  const observed = new Map();

  for (const record of records) {
    if (!record.pkg) continue;
    const hasReact = findDeclaredVersion(record.pkg, 'react');
    if (!hasReact) continue;

    const declared = {};
    const missing = [];
    for (const depName of REACT_ALL_PACKAGES) {
      const version = findDeclaredVersion(record.pkg, depName);
      if (version == null) {
        missing.push(depName);
      } else {
        declared[depName] = version;
      }
    }

    if (missing.length > 0) {
      problems.push(
        `${record.relativePath} declares react but is missing ${missing.join(', ')}; examples must pin all of ${REACT_ALL_PACKAGES.join(', ')} so peer compatibility is exercised end-to-end.`,
      );
      continue;
    }

    const majors = Object.fromEntries(
      Object.entries(declared).map(([name, version]) => [name, extractMajor(version)]),
    );
    const unparseable = Object.entries(majors).filter(([, major]) => major == null);
    if (unparseable.length > 0) {
      problems.push(
        `${record.relativePath} has unparseable React-family version range(s): ${unparseable
          .map(([name]) => `${name}=${declared[name]}`)
          .join(', ')}.`,
      );
      continue;
    }

    const distinctMajors = Array.from(new Set(Object.values(majors)));
    if (distinctMajors.length > 1) {
      const detail = REACT_ALL_PACKAGES.map((name) => `${name}@${declared[name]}`).join(', ');
      problems.push(
        `${record.relativePath} mixes React majors across ${detail}; runtime and @types/react majors must match.`,
      );
      continue;
    }

    const major = distinctMajors[0];
    if (!peerMajors.includes(major)) {
      problems.push(
        `${record.relativePath} declares react ${declared.react} (major ${major}) which does not intersect the root peerDependencies.react range (allowed majors: ${peerMajors.join(', ')}).`,
      );
      continue;
    }

    if (!coverage.has(major)) coverage.set(major, []);
    coverage.get(major).push(record.relativePath);

    for (const depName of REACT_ALL_PACKAGES) {
      if (!observed.has(depName)) observed.set(depName, new Map());
      const byVersion = observed.get(depName);
      const version = declared[depName];
      if (!byVersion.has(version)) byVersion.set(version, []);
      byVersion.get(version).push(record.relativePath);
    }
  }

  for (const major of peerMajors) {
    if (!coverage.has(major)) {
      problems.push(
        `No example exercises React major ${major} from the root peerDependencies.react range; add or retain at least one example pinned to ^${major}.`,
      );
    }
  }

  for (const [depName, byVersion] of observed) {
    const versionsByMajor = new Map();
    for (const [version, examples] of byVersion) {
      const major = extractMajor(version);
      if (!versionsByMajor.has(major)) versionsByMajor.set(major, new Map());
      versionsByMajor.get(major).set(version, examples);
    }
    for (const [major, versions] of versionsByMajor) {
      if (versions.size > 1) {
        const detail = Array.from(versions, ([version, examples]) => `${version} (${examples.join(', ')})`).join(' vs ');
        warnings.push(
          `${depName} drifts across examples on React ${major}: ${detail}. Consider aligning the minor/patch range.`,
        );
      }
    }
  }

  return { problems, warnings };
}

export async function findExampleMetadataProblems({
  cwd = rootDir,
  logger = null,
  checkReactCompat = true,
} = {}) {
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

  if (checkReactCompat) {
    const peer = await readRootPeerMajors(cwd);
    const reactCheck = findExampleReactProblems({ records: packages, peerMajors: peer.majors });
    problems.push(...reactCheck.problems);

    if (logger && reactCheck.warnings.length > 0) {
      for (const warning of reactCheck.warnings) {
        logger.warn(`Warning: ${warning}`);
      }
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

async function runCommand(command, args, { cwd, env = {}, shell = process.platform === 'win32' }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CI: '1',
        npm_config_update_notifier: 'false',
        ...env,
      },
      // npm is invoked as `npm.cmd` on Windows and needs a shell; direct node
      // invocations pass `shell: false` so an executable path containing spaces
      // (e.g. C:\Program Files\nodejs\node.exe) is not re-parsed by cmd.exe.
      shell,
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

/**
 * npm install args for an example package. Examples that ship a committed
 * package-lock.json install reproducibly with `npm ci`; the rest fall back to
 * `npm install`. `--package-lock=false` is intentionally NOT passed: it would
 * make npm ignore a committed lockfile, so every CI run would re-resolve the
 * dependency tree fresh against the registry and a registry-side release could
 * change what CI builds with no source change.
 */
function exampleInstallArgs(packageDir) {
  const base = ['--prefer-offline', '--no-audit', '--no-fund'];
  return existsSync(path.join(packageDir, 'package-lock.json'))
    ? ['ci', ...base]
    : ['install', ...base];
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

    const install = await runNpm(exampleInstallArgs(example.packageDir), {
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

/**
 * Start-only example packages declare a `start` script but no `build` script,
 * so `runExampleBuilds` never installs their deps or exercises their entry
 * file. The Express/WebSocket proxy servers under examples/ are start-only.
 */
export async function findStartOnlyExamplePackages({ cwd = rootDir } = {}) {
  const packages = await findExamplePackages({ cwd });
  return packages.filter(
    (record) => Boolean(record.pkg?.scripts?.start) && !record.pkg?.scripts?.build,
  );
}

/** Resolve the entry file a package's `start` script runs (falling back to `main`). */
function resolveStartEntry(record) {
  const startScript = typeof record.pkg?.scripts?.start === 'string' ? record.pkg.scripts.start : '';
  const scriptMatch = startScript.match(/(?:^|\s)([\w./-]+\.[mc]?js)(?:\s|$)/);
  const candidate = scriptMatch
    ? scriptMatch[1]
    : (typeof record.pkg?.main === 'string' ? record.pkg.main : null);
  if (!candidate) return null;
  const absolutePath = path.join(record.packageDir, candidate);
  return existsSync(absolutePath) ? { absolutePath, relative: candidate } : null;
}

/** Collect every `react-chorus/<subpath>` specifier referenced by a source file. */
export function extractReactChorusSubpaths(source) {
  const found = new Set();
  const re = /['"`](react-chorus\/[A-Za-z0-9._\-/]+)['"`]/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    found.add(match[1]);
  }
  return Array.from(found).sort();
}

/**
 * Verify start-only example packages without running their long-lived servers:
 * `node --check` catches syntax errors in the entry file, and every
 * `react-chorus/<subpath>` it imports is import-resolved so a breaking change
 * to a subpath export (e.g. `react-chorus/server`, `react-chorus/provider-requests`)
 * fails CI instead of silently breaking the documented example server.
 */
export async function runStartOnlyExampleChecks({ cwd = rootDir, logger = console } = {}) {
  const startOnlyPackages = await findStartOnlyExamplePackages({ cwd });
  const problems = [];
  if (startOnlyPackages.length === 0) return problems;

  const rootBuilt = ensureRootBuild({ cwd }).length === 0;

  for (const record of startOnlyPackages) {
    const relativeDir = toRelative(cwd, record.packageDir);
    const entry = resolveStartEntry(record);
    if (!entry) {
      problems.push(`${relativeDir}: could not resolve the entry file from its "start" script; add a runnable entry or a "main" field.`);
      continue;
    }

    logger.log(`Checking start-only example ${relativeDir} (${entry.relative})...`);

    const syntax = await runCommand(process.execPath, ['--check', entry.absolutePath], {
      cwd: record.packageDir,
      shell: false,
    });
    if (syntax.exitCode !== 0) {
      if (syntax.stderr.trim()) logger.error(syntax.stderr.trimEnd());
      problems.push(`${relativeDir}/${entry.relative} failed \`node --check\` (syntax error).`);
      continue;
    }

    const source = await fs.readFile(entry.absolutePath, 'utf8');
    const subpaths = extractReactChorusSubpaths(source);
    if (subpaths.length === 0) {
      logger.log(`Start-only example OK: ${relativeDir}`);
      continue;
    }

    if (!rootBuilt) {
      problems.push(`${relativeDir} imports ${subpaths.join(', ')} but the root library build is missing. Run \`npm run build\` before \`npm run verify:examples\`.`);
      continue;
    }

    const install = await runNpm(exampleInstallArgs(record.packageDir), { cwd: record.packageDir, logger });
    if (install.exitCode !== 0) {
      problems.push(`${relativeDir} dependencies failed to install.`);
      continue;
    }

    const probeSource = subpaths.map((subpath) => `await import(${JSON.stringify(subpath)});`).join('\n');
    const probe = await runCommand(process.execPath, ['--input-type=module', '--eval', probeSource], {
      cwd: record.packageDir,
      shell: false,
    });
    if (probe.exitCode !== 0) {
      if (probe.stderr.trim()) logger.error(probe.stderr.trimEnd());
      problems.push(`${relativeDir}: import-resolving ${subpaths.join(', ')} failed — a react-chorus subpath export used by this example server is broken.`);
      continue;
    }

    logger.log(`Start-only example OK: ${relativeDir} (verified ${subpaths.join(', ')})`);
  }

  return problems;
}

export async function runCheckExampleMetadata({ cwd = rootDir, logger = console } = {}) {
  const metadataProblems = await findExampleMetadataProblems({ cwd, logger });
  const canRunExamples = metadataProblems.length === 0;
  const buildProblems = canRunExamples ? await runExampleBuilds({ cwd, logger }) : [];
  const startOnlyProblems = canRunExamples ? await runStartOnlyExampleChecks({ cwd, logger }) : [];
  const problems = [...metadataProblems, ...buildProblems, ...startOnlyProblems];

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
