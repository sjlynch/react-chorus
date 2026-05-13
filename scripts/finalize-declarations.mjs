import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const typesDir = path.join(distDir, 'types');
const sideEffectCssImport = /^\s*import\s+['"][^'"]+\.css['"];\s*\r?\n?/gm;
const cssDeclaration = 'export {};\n';

async function* walkDeclarations(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDeclarations(entryPath);
    } else if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      yield entryPath;
    }
  }
}

for await (const declarationPath of walkDeclarations(typesDir)) {
  const declaration = await readFile(declarationPath, 'utf8');
  const withoutCssImports = declaration.replace(sideEffectCssImport, '');

  if (withoutCssImports !== declaration) {
    await writeFile(declarationPath, withoutCssImports);
  }
}

await mkdir(typesDir, { recursive: true });
await writeFile(path.join(distDir, 'styles.css.d.ts'), cssDeclaration);
await writeFile(path.join(typesDir, 'styles.css.d.ts'), cssDeclaration);
