#!/usr/bin/env node
// design-sync prepare step (cfg.buildCmd). @ds/design-system ships source only
// (`exports` -> src/*.ts(x), no dist/, no .d.ts, Tailwind classes compiled by
// each consuming app). The converter needs a package-shaped build, so this
// stages one in the gitignored `packages/design-system/.ds-sync-pkg/`:
//   package.json  name/version of the real package + `types` -> types/ds-entry.d.ts
//   index.mjs     re-exports src/index.ts + src/blocks/index.ts (esbuild bundles the source)
//   types/        tsc --emitDeclarationOnly of src/ (prop contracts)
//   ds.css        Tailwind 4 compile of src/styles/globals.css + previews
// Run from the repo root after `pnpm i` and `pnpm -F @ds/schemas build`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('.');
const pkgDir = join(root, 'packages', 'design-system');
const out = join(pkgDir, '.ds-sync-pkg');
const real = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'package.json'), JSON.stringify({
  name: real.name,
  version: real.version,
  private: true,
  type: 'module',
  module: './index.mjs',
  types: './types/ds-entry.d.ts',
}, null, 2) + '\n');
// The public surface is two entries: `@ds/design-system` (root) and
// `@ds/design-system/blocks` (composed blocks). Both land on one window global.
writeFileSync(join(out, 'index.mjs'), 'export * from "../src/index.ts";\nexport * from "../src/blocks/index.ts";\n');

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });

// Prop contracts. Test files are excluded so the type tree is the shipped API only.
writeFileSync(join(out, 'tsconfig.dts.json'), JSON.stringify({
  extends: '../tsconfig.json',
  compilerOptions: {
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    rootDir: '../src',
    outDir: './types',
    types: [],
  },
  include: ['../src/**/*.ts', '../src/**/*.tsx'],
  exclude: ['../src/**/*.test.ts', '../src/**/*.test.tsx', '../node_modules'],
}, null, 2) + '\n');
run(join(pkgDir, 'node_modules', '.bin', 'tsc'), ['-p', join(out, 'tsconfig.dts.json')]);
writeFileSync(join(out, 'types', 'ds-entry.d.ts'), "export * from './index';\nexport * from './blocks/index';\n");

// Compiled stylesheet (tokens + every utility the DS sources and previews use).
run(join(root, '.ds-sync', 'node_modules', '.bin', 'tailwindcss'),
  ['-i', join(root, '.design-sync', 'tailwind-input.css'), '-o', join(out, 'ds.css')]);
console.error(`prepared ${out}`);
