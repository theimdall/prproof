#!/usr/bin/env node
// Bundles the two action entry points with ncc, then prunes everything that is
// not the bundle itself.
//
// ncc runs the project's tsconfig, which emits declarations, so without this
// step dist/ would also carry a tree of .d.ts files that nothing reads and that
// make the "is dist up to date?" CI check noisy.
import { rm, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const TARGETS = [
  { entry: 'src/action/analyze.ts', out: 'dist' },
  { entry: 'src/action/report.ts', out: 'report/dist' },
];

const KEEP = new Set(['index.js', 'licenses.txt', 'package.json']);

for (const target of TARGETS) {
  const result = spawnSync(
    'npx',
    ['ncc', 'build', target.entry, '-o', target.out, '--license', 'licenses.txt'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  for (const entry of await readdir(target.out)) {
    if (KEEP.has(entry)) continue;
    await rm(path.join(target.out, entry), { recursive: true, force: true });
  }
}

console.log('Bundled dist/index.js and report/dist/index.js');
