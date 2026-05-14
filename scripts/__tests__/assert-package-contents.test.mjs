import { describe, expect, it, vi } from 'vitest';
import {
  findForbiddenFiles,
  forbiddenEntries,
  parsePackedFiles,
  runAssertPackageContents,
} from '../assert-package-contents.mjs';

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
      packOutput(['dist/react-chorus.es.js', 'dist/types/__tests__/leaked.test.d.ts']),
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
});
