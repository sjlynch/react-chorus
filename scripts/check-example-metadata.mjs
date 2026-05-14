import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '..');
const examplesDir = path.join(rootDir, 'examples');
const REQUIRED_NODE_RANGE = '>=20';

export async function findExampleMetadataProblems({ cwd = rootDir } = {}) {
  const base = path.join(cwd, 'examples');
  const entries = await fs.readdir(base, { withFileTypes: true });
  const problems = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packagePath = path.join(base, entry.name, 'package.json');
    let pkg;
    try {
      pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    } catch (error) {
      problems.push(`${path.relative(cwd, packagePath)} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (pkg.engines?.node !== REQUIRED_NODE_RANGE) {
      problems.push(`${path.relative(cwd, packagePath)} must declare engines.node "${REQUIRED_NODE_RANGE}".`);
    }
  }

  return problems;
}

export async function runCheckExampleMetadata({ cwd = rootDir, logger = console } = {}) {
  const problems = await findExampleMetadataProblems({ cwd });
  if (problems.length > 0) {
    logger.error('Example package metadata problems:');
    for (const problem of problems) logger.error(`- ${problem}`);
    return 1;
  }

  logger.log('Example package metadata OK.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runCheckExampleMetadata();
}
