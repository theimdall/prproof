#!/usr/bin/env node
// Regenerates docs/examples/*.md from the scenario fixtures.
// A tiny wrapper so the command works the same on every platform.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['vitest', 'run', 'tests/golden'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, UPDATE_GOLDEN: '1' },
});
process.exitCode = result.status ?? 1;
