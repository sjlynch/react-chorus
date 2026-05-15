import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findExampleMetadataProblems,
  findRunnableExamplePackages,
} from './check-example-metadata.mjs';

const tempDirs = [];

async function makeTempRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'react-chorus-examples-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, 'examples'), { recursive: true });
  return dir;
}

async function writePackage(cwd, relativeDir, pkg) {
  const dir = path.join(cwd, relativeDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('example metadata verification', () => {
  it('checks nested example packages for the required Node engine', async () => {
    const cwd = await makeTempRepo();
    await writePackage(cwd, 'examples/basic', {
      name: 'basic',
      engines: { node: '>=20' },
      scripts: { build: 'vite build' },
    });
    await writePackage(cwd, 'examples/with-openai/server', {
      name: 'server',
      scripts: { start: 'node index.js' },
    });

    await expect(findExampleMetadataProblems({ cwd })).resolves.toEqual([
      'examples/with-openai/server/package.json must declare engines.node ">=20".',
    ]);
  });

  it('discovers only runnable examples with build scripts', async () => {
    const cwd = await makeTempRepo();
    await writePackage(cwd, 'examples/basic', {
      name: 'basic',
      engines: { node: '>=20' },
      scripts: { build: 'vite build' },
    });
    await writePackage(cwd, 'examples/with-openai/server', {
      name: 'server',
      engines: { node: '>=20' },
      scripts: { start: 'node index.js' },
    });

    const runnable = await findRunnableExamplePackages({ cwd });
    expect(runnable.map((record) => record.relativePath)).toEqual(['examples/basic/package.json']);
  });
});
