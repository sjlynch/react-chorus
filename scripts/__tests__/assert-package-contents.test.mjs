import { describe, expect, it, vi } from 'vitest';
import {
  findForbiddenFiles,
  findMissingRequired,
  forbiddenEntries,
  parsePackedFiles,
  requiredSourcemapPrefixes,
  runAssertPackageContents,
} from '../assert-package-contents.mjs';

function fakePackedSourcemaps() {
  const files = [];
  for (const { prefix, suffixes } of requiredSourcemapPrefixes) {
    for (const suffix of suffixes) {
      files.push(`${prefix}${prefix.endsWith('-') ? 'AbC12345' : ''}${suffix}`);
    }
  }
  return files;
}

const forbiddenCases = [
  ['test declarations', 'dist/types/__tests__/ChatInput.test.d.ts'],
  ['type-test declarations', 'dist/types/__type_tests__/metadata-generics.d.ts'],
  ['playground files', 'dist/playground/main.js'],
  ['Vite scaffold declarations', 'dist/types/vite-env.d.ts'],
];

function packOutput(files) {
  return JSON.stringify([
    {
      files: files.map((filePath) => ({ path: filePath })),
    },
  ]);
}

function fakeExecFile(stdout) {
  return vi.fn((_command, _args, _options, callback) => {
    callback(null, stdout, '');
  });
}

describe('assert-package-contents', () => {
  it('matches every forbidden entry against the path it is meant to catch', () => {
    expect(forbiddenEntries.map(({ label }) => label)).toEqual(forbiddenCases.map(([label]) => label));

    for (const [label, filePath] of forbiddenCases) {
      expect(findForbiddenFiles([filePath], forbiddenEntries)).toEqual([{ filePath, label }]);
    }

    expect(findForbiddenFiles(['dist/types/main.d.ts'], forbiddenEntries)).toEqual([
      { filePath: 'dist/types/main.d.ts', label: 'Vite scaffold declarations' },
    ]);
  });

  it('does not flag legitimate published entry points or styles', () => {
    expect(
      findForbiddenFiles([
        'dist/react-chorus.es.js',
        'dist/types/index.d.ts',
        'dist/styles.css',
      ]),
    ).toEqual([]);
  });

  it('parses npm pack output and normalizes packed paths', () => {
    expect(parsePackedFiles(packOutput(['./dist/react-chorus.es.js', 'dist\\types\\index.d.ts']))).toEqual([
      'dist/react-chorus.es.js',
      'dist/types/index.d.ts',
    ]);
  });

  it('returns a non-zero exit code when npm pack includes a forbidden path', async () => {
    const execFileImpl = fakeExecFile(
      packOutput([
        'dist/react-chorus.es.js',
        'dist/types/__tests__/leaked.test.d.ts',
        ...fakePackedSourcemaps(),
      ]),
    );
    const logger = { log: vi.fn(), error: vi.fn() };

    await expect(runAssertPackageContents({ execFileImpl, logger })).resolves.toBe(1);

    expect(execFileImpl).toHaveBeenCalledWith(
      expect.stringContaining('npm'),
      ['pack', '--dry-run', '--json'],
      expect.objectContaining({ maxBuffer: 1024 * 1024 * 10 }),
      expect.any(Function),
    );
    expect(logger.error).toHaveBeenCalledWith(
      '- dist/types/__tests__/leaked.test.d.ts (test declarations)',
    );
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('flags missing sourcemaps so a regression to `sourcemap: false` fails the pack check', () => {
    const packedWithoutMaps = [
      'dist/react-chorus.es.js',
      'dist/react-chorus.cjs',
      'dist/react-chorus-headless.es.js',
      'dist/chorus-session-AbC12345.js',
    ];
    const missing = findMissingRequired(packedWithoutMaps);
    // Every prefix/suffix pair should be reported missing.
    const expectedCount = requiredSourcemapPrefixes.reduce(
      (sum, entry) => sum + entry.suffixes.length,
      0,
    );
    expect(missing.length).toBe(expectedCount);
    expect(missing[0]).toMatch(/^dist\/.+\*\..+\.map$/);

    expect(findMissingRequired(fakePackedSourcemaps())).toEqual([]);
  });

  it('returns a non-zero exit code when sourcemaps are missing from the pack output', async () => {
    const execFileImpl = fakeExecFile(packOutput(['dist/react-chorus.es.js']));
    const logger = { log: vi.fn(), error: vi.fn() };

    await expect(runAssertPackageContents({ execFileImpl, logger })).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Required sourcemap files are missing'),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/^- dist\/react-chorus-headless\*\.(?:es\.js|cjs)\.map$/),
    );
  });

  it('passes when every required sourcemap is present and nothing forbidden leaks', async () => {
    const execFileImpl = fakeExecFile(
      packOutput([
        'dist/react-chorus.es.js',
        'dist/types/index.d.ts',
        'dist/styles.css',
        ...fakePackedSourcemaps(),
      ]),
    );
    const logger = { log: vi.fn(), error: vi.fn() };

    await expect(runAssertPackageContents({ execFileImpl, logger })).resolves.toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('required sourcemaps present'));
  });
});
