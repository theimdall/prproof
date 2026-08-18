#!/usr/bin/env bash
# Builds a small repository with two branches: one pull request PRProof likes,
# one it does not. See demo/README.md for the recording script.
set -euo pipefail

TARGET="${1:-./prproof-demo}"

if [ -e "$TARGET" ]; then
  echo "error: $TARGET already exists" >&2
  exit 1
fi

mkdir -p "$TARGET"
cd "$TARGET"
git init --quiet --initial-branch=main

# ---------------------------------------------------------------- base branch

mkdir -p src src/__tests__ .github/workflows

cat > package.json <<'JSON'
{
  "name": "prproof-demo",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node --check src/session.js && node --check src/store.js",
    "test": "node --test src/__tests__/",
    "lint": "node --check src/session.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}
JSON

cat > src/session.js <<'JS'
import { store } from './store.js';

export function createSession(userId) {
  const session = { id: `s_${userId}_${store.size}`, userId, createdAt: 0 };
  store.set(session.id, session);
  return session;
}

export function getSession(id) {
  return store.get(id) ?? null;
}
JS

cat > src/store.js <<'JS'
export const store = new Map();
JS

cat > src/__tests__/session.test.js <<'JS'
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession, getSession } from '../session.js';

test('creates and reads a session', () => {
  const session = createSession('u1');
  assert.equal(getSession(session.id)?.userId, 'u1');
});
JS

cat > .github/workflows/prproof.yml <<'YAML'
name: PRProof

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  prproof:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - id: build
        run: npm run build
        continue-on-error: true
      - id: test
        run: npm test
        continue-on-error: true

      - uses: theimdall/prproof@v0.1.0
        with:
          build-result: ${{ steps.build.outcome }}
          test-result: ${{ steps.test.outcome }}
YAML

cat > .prproof.yml <<'YAML'
version: 1

limits:
  max_changed_files: 20
  max_changed_lines: 1000

tests:
  require_test_changes: true

pull_request:
  minimum_description_length: 50

fail_on: [critical]
YAML

cat > README.md <<'MD'
# PRProof demo

A tiny service, used to demonstrate what PRProof reports on two very different pull requests.
MD

mkdir -p .github
cat > .github/good-pr-body.md <<'MD'
Sessions stayed in the store after logout, so a stolen cookie kept working. This removes the
session on logout and adds a regression test for the expiry path.
MD

git add -A
git commit --quiet -m 'Add the session service'

# ------------------------------------------------------- the good pull request

git checkout --quiet -b good-change

cat >> src/session.js <<'JS'

export function endSession(id) {
  return store.delete(id);
}
JS

cat > src/__tests__/logout.test.js <<'JS'
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession, endSession, getSession } from '../session.js';

test('a session is gone after logout', () => {
  const session = createSession('u2');
  assert.equal(endSession(session.id), true);
  assert.equal(getSession(session.id), null);
});
JS

git add -A
git commit --quiet -m 'Expire sessions on logout'

# ------------------------------------------------------ the risky pull request

git checkout --quiet main
git checkout --quiet -b risky-change

# A failing test.
cat > src/__tests__/session.test.js <<'JS'
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession, getSession } from '../session.js';

test('creates and reads a session', () => {
  const session = createSession('u1');
  assert.equal(getSession(session.id)?.userId, 'u1');
});

test('sessions expire', () => {
  const session = createSession('u3');
  assert.equal(getSession(session.id), null, 'not implemented yet');
});
JS

# A new dependency.
node - <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.dependencies.axios = '^1.6.2';
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
NODE

# Thirty untested files.
mkdir -p src/modules
for index in $(seq 1 30); do
  cat > "src/modules/module-${index}.js" <<JS
export function handler${index}(input) {
  const parts = String(input).split(',');
  return parts.map((part) => part.trim()).filter(Boolean);
}
JS
done

git add -A
git commit --quiet -m 'wip'

git checkout --quiet main

cat <<'DONE'

Done. Two branches are ready:

  good-change   two files, one of them a test
  risky-change  30 new files, a failing test, a new dependency, no description

Next:

  gh repo create prproof-demo --public --source=. --push
  gh pr create --head good-change  --title 'Expire sessions on logout' --body-file .github/good-pr-body.md
  gh pr create --head risky-change --title 'wip' --body ''

DONE
