#!/usr/bin/env node
// Bundles the two action entry points into the committed dist/ directories.
//
// esbuild rather than ncc, for one reason: reproducibility. ncc assigns webpack
// module ids in filesystem-walk order, which differs between Windows and Linux,
// so the same source produced two byte-different bundles and the "is dist up to
// date?" check in CI could never pass for a maintainer who does not happen to
// build on Linux. esbuild emits the same bytes everywhere for the same input.
import { rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { build } from 'esbuild';

const TARGETS = [
  { entry: 'src/action/analyze.ts', out: 'dist' },
  { entry: 'src/action/report.ts', out: 'report/dist' },
];

for (const target of TARGETS) {
  await rm(target.out, { recursive: true, force: true });
  await mkdir(target.out, { recursive: true });

  await build({
    entryPoints: [target.entry],
    outfile: path.join(target.out, 'index.js'),
    bundle: true,
    platform: 'node',
    // The runtime declared in action.yml. Keep the two in step.
    target: 'node24',
    format: 'cjs',
    // No sourcemap and no banner: both would embed build-machine paths.
    sourcemap: false,
    minify: false,
    // Keeps the licence notices of every bundled dependency, in a file beside
    // the bundle, which is what shipping vendored MIT code requires.
    legalComments: 'external',
    logLevel: 'warning',
    // Absolute paths would differ per machine; relative ones are stable.
    absWorkingDir: process.cwd(),
  });

  // GitHub Actions loads dist/index.js directly, and this package is ESM, so
  // without this marker Node would refuse to run a CommonJS bundle.
  await writeFile(
    path.join(target.out, 'package.json'),
    `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
    'utf8',
  );

  await writeFile(
    path.join(target.out, 'README.md'),
    [
      '# Generated bundle',
      '',
      'Do not edit. Built from `src/` by `npm run package`.',
      '',
      'GitHub Actions runs JavaScript actions from a committed bundle, which is why',
      'this directory is in version control. CI rebuilds it and fails if the result',
      'differs from what is committed.',
      '',
    ].join('\n'),
    'utf8',
  );
}

console.log('Bundled dist/index.js and report/dist/index.js');
