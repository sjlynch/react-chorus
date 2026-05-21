import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractReactChorusSubpaths,
  findExampleMetadataProblems,
  findExampleReactProblems,
  findRunnableExamplePackages,
  findStartOnlyExamplePackages,
  parsePeerMajors,
  runStartOnlyExampleChecks,
} from './check-example-metadata.mjs';

const tempDirs = [];

async function makeTempRepo({ peerReact = '^18 || ^19' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'react-chorus-examples-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, 'examples'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'react-chorus',
        peerDependencies: { react: peerReact, 'react-dom': peerReact },
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

async function writePackage(cwd, relativeDir, pkg) {
  const dir = path.join(cwd, relativeDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
}

function reactExample({ major, name = `react-${major}-example` } = {}) {
  const range = `^${major}.0.0`;
  return {
    name,
    engines: { node: '>=20.19.0' },
    scripts: { build: 'vite build' },
    dependencies: { react: range, 'react-dom': range },
    devDependencies: { '@types/react': range, '@types/react-dom': range },
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('example metadata verification', () => {
  it('checks nested example packages for the required Node engine', async () => {
    const cwd = await makeTempRepo();
    await writePackage(cwd, 'examples/basic', {
      name: 'basic',
      engines: { node: '>=20.19.0' },
      scripts: { build: 'vite build' },
    });
    await writePackage(cwd, 'examples/with-openai/server', {
      name: 'server',
      scripts: { start: 'node index.js' },
    });

    await expect(
      findExampleMetadataProblems({ cwd, checkReactCompat: false }),
    ).resolves.toEqual([
      'examples/with-openai/server/package.json must declare engines.node ">=20.19.0".',
    ]);
  });

  it('discovers only runnable examples with build scripts', async () => {
    const cwd = await makeTempRepo();
    await writePackage(cwd, 'examples/basic', {
      name: 'basic',
      engines: { node: '>=20.19.0' },
      scripts: { build: 'vite build' },
    });
    await writePackage(cwd, 'examples/with-openai/server', {
      name: 'server',
      engines: { node: '>=20.19.0' },
      scripts: { start: 'node index.js' },
    });

    const runnable = await findRunnableExamplePackages({ cwd });
    expect(runnable.map((record) => record.relativePath)).toEqual(['examples/basic/package.json']);
  });

  it('discovers start-only example packages (start script, no build script)', async () => {
    const cwd = await makeTempRepo();
    await writePackage(cwd, 'examples/basic', {
      name: 'basic',
      engines: { node: '>=20.19.0' },
      scripts: { build: 'vite build' },
    });
    await writePackage(cwd, 'examples/with-openai/server', {
      name: 'server',
      engines: { node: '>=20.19.0' },
      scripts: { start: 'node index.js' },
    });

    const startOnly = await findStartOnlyExamplePackages({ cwd });
    expect(startOnly.map((record) => record.relativePath)).toEqual([
      'examples/with-openai/server/package.json',
    ]);
  });
});

describe('extractReactChorusSubpaths', () => {
  it('collects unique react-chorus subpath specifiers from source', () => {
    const source = [
      "import { sseHeaders } from 'react-chorus/server';",
      'import { toOpenAIChatCompletionsBody } from "react-chorus/provider-requests";',
      "const dynamic = await import('react-chorus/server');",
      "import { Chorus } from 'react-chorus';",
    ].join('\n');
    expect(extractReactChorusSubpaths(source)).toEqual([
      'react-chorus/provider-requests',
      'react-chorus/server',
    ]);
  });

  it('returns an empty array when no react-chorus subpaths appear', () => {
    expect(extractReactChorusSubpaths("import { WebSocketServer } from 'ws';")).toEqual([]);
  });
});

describe('runStartOnlyExampleChecks', () => {
  const silentLogger = { log() {}, error() {}, warn() {} };

  async function writeStartOnlyExample(cwd, relativeDir, entrySource, entry = 'index.js') {
    await writePackage(cwd, relativeDir, {
      name: relativeDir.replace(/\W+/g, '-'),
      type: 'module',
      engines: { node: '>=20.19.0' },
      scripts: { start: `node ${entry}` },
    });
    await fs.writeFile(path.join(cwd, relativeDir, entry), entrySource);
  }

  it('passes a start-only package with a valid entry and no react-chorus imports', async () => {
    const cwd = await makeTempRepo();
    await writeStartOnlyExample(cwd, 'examples/proxy', 'const port = 3001;\nconsole.log(port);\n');
    await expect(runStartOnlyExampleChecks({ cwd, logger: silentLogger })).resolves.toEqual([]);
  });

  it('flags a syntax error in the start entry file via node --check', async () => {
    const cwd = await makeTempRepo();
    await writeStartOnlyExample(cwd, 'examples/proxy', 'const broken = (\n');
    const problems = await runStartOnlyExampleChecks({ cwd, logger: silentLogger });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/examples\/proxy\/index\.js failed `node --check`/);
  });

  it('flags react-chorus subpath imports when the root library build is missing', async () => {
    const cwd = await makeTempRepo();
    await writeStartOnlyExample(
      cwd,
      'examples/proxy',
      "import { sseHeaders } from 'react-chorus/server';\nconsole.log(sseHeaders);\n",
    );
    const problems = await runStartOnlyExampleChecks({ cwd, logger: silentLogger });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/react-chorus\/server/);
    expect(problems[0]).toMatch(/root library build is missing/);
  });

  it('returns no problems when there are no start-only packages', async () => {
    const cwd = await makeTempRepo();
    await writePackage(cwd, 'examples/basic', {
      name: 'basic',
      engines: { node: '>=20.19.0' },
      scripts: { build: 'vite build' },
    });
    await expect(runStartOnlyExampleChecks({ cwd, logger: silentLogger })).resolves.toEqual([]);
  });
});

describe('parsePeerMajors', () => {
  it('extracts unique major numbers from a peer range string', () => {
    expect(parsePeerMajors('^18 || ^19')).toEqual([18, 19]);
    expect(parsePeerMajors('^19.0.0')).toEqual([19]);
    expect(parsePeerMajors('18.x || 19.x')).toEqual([18, 19]);
    expect(parsePeerMajors('')).toEqual([]);
    expect(parsePeerMajors(undefined)).toEqual([]);
  });
});

describe('React peer compatibility checks', () => {
  function record(relativePath, pkg) {
    return { relativePath, pkg };
  }

  it('passes when every peer major has at least one example and majors match within each example', () => {
    const records = [
      record('examples/basic/package.json', reactExample({ major: 18 })),
      record('examples/multi-conversation/package.json', reactExample({ major: 19 })),
    ];
    const { problems, warnings } = findExampleReactProblems({ records, peerMajors: [18, 19] });
    expect(problems).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('flags an example whose @types/react major differs from its react runtime major', () => {
    const drifted = {
      name: 'drifted',
      engines: { node: '>=20.19.0' },
      scripts: { build: 'vite build' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: { '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' },
    };
    const records = [
      record('examples/with-next/package.json', drifted),
      record('examples/multi-conversation/package.json', reactExample({ major: 19 })),
    ];
    const { problems } = findExampleReactProblems({ records, peerMajors: [18, 19] });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/examples\/with-next\/package\.json mixes React majors/);
    expect(problems[1]).toMatch(/No example exercises React major 18/);
  });

  it('flags missing React-family deps when react is declared', () => {
    const partial = {
      name: 'partial',
      engines: { node: '>=20.19.0' },
      dependencies: { react: '^19.0.0' },
    };
    const records = [record('examples/partial/package.json', partial)];
    const { problems } = findExampleReactProblems({ records, peerMajors: [18, 19] });
    expect(problems.some((m) => m.includes('missing react-dom, @types/react, @types/react-dom'))).toBe(true);
  });

  it('flags examples that pin a major outside the root peer range', () => {
    const records = [
      record('examples/legacy/package.json', reactExample({ major: 17 })),
      record('examples/current/package.json', reactExample({ major: 18 })),
      record('examples/next/package.json', reactExample({ major: 19 })),
    ];
    const { problems } = findExampleReactProblems({ records, peerMajors: [18, 19] });
    expect(problems).toEqual([
      'examples/legacy/package.json declares react ^17.0.0 (major 17) which does not intersect the root peerDependencies.react range (allowed majors: 18, 19).',
    ]);
  });

  it('requires at least one example per peer major', () => {
    const records = [record('examples/only-19/package.json', reactExample({ major: 19 }))];
    const { problems } = findExampleReactProblems({ records, peerMajors: [18, 19] });
    expect(problems).toEqual([
      'No example exercises React major 18 from the root peerDependencies.react range; add or retain at least one example pinned to ^18.',
    ]);
  });

  it('warns (non-fatal) when two examples on the same major drift on minor/patch', () => {
    const records = [
      record('examples/a/package.json', reactExample({ major: 19, name: 'a' })),
      record(
        'examples/b/package.json',
        {
          name: 'b',
          engines: { node: '>=20.19.0' },
          scripts: { build: 'vite build' },
          dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' },
          devDependencies: { '@types/react': '^19.1.0', '@types/react-dom': '^19.1.0' },
        },
      ),
      record('examples/c/package.json', reactExample({ major: 18, name: 'c' })),
    ];
    const { problems, warnings } = findExampleReactProblems({ records, peerMajors: [18, 19] });
    expect(problems).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((w) => w.includes('drifts across examples on React 19'))).toBe(true);
  });

  it('ignores example packages that do not declare react', () => {
    const serverOnly = {
      name: 'server-only',
      engines: { node: '>=20.19.0' },
      scripts: { start: 'node index.js' },
      dependencies: { express: '^4.0.0' },
    };
    const records = [
      record('examples/with-openai/server/package.json', serverOnly),
      record('examples/basic/package.json', reactExample({ major: 18 })),
      record('examples/multi/package.json', reactExample({ major: 19 })),
    ];
    const { problems, warnings } = findExampleReactProblems({ records, peerMajors: [18, 19] });
    expect(problems).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe('findExampleMetadataProblems with React compat enabled', () => {
  it('end-to-end: reads root peer range and validates examples against it', async () => {
    const cwd = await makeTempRepo();
    await writePackage(cwd, 'examples/basic', reactExample({ major: 18, name: 'basic' }));
    await writePackage(cwd, 'examples/modern', reactExample({ major: 19, name: 'modern' }));

    await expect(findExampleMetadataProblems({ cwd })).resolves.toEqual([]);
  });

  it('end-to-end: reports a distribution gap when only one major is exercised', async () => {
    const cwd = await makeTempRepo();
    await writePackage(cwd, 'examples/only-19', reactExample({ major: 19, name: 'only-19' }));

    const problems = await findExampleMetadataProblems({ cwd });
    expect(problems).toContain(
      'No example exercises React major 18 from the root peerDependencies.react range; add or retain at least one example pinned to ^18.',
    );
  });
});
