import type { AnalysisContext } from '../../src/core/model/context.js';
import { check, context, file, openPullRequest } from './context.js';

const PACKAGE_JSON_PATCH = [
  '@@ -12,6 +12,7 @@',
  '   "dependencies": {',
  '     "express": "^4.18.2",',
  '     "pino": "^8.16.0",',
  '+    "axios": "^1.6.2"',
  '   },',
].join('\n');

function manyFiles(count: number, additions = 40, deletions = 12) {
  return Array.from({ length: count }, (_, index) =>
    file(`src/module-${index}/index.ts`, { additions, deletions }),
  );
}

export interface Scenario {
  readonly name: string;
  readonly description: string;
  build(): AnalysisContext;
}

/**
 * The scenarios used by the golden report tests and by the demo generator.
 *
 * They double as the specification of what PRProof is for: each one is a shape
 * of pull request a maintainer recognises immediately.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'small-good-pr',
    description: 'Focused change with tests, a real description and no surprises.',
    build: () =>
      context({
        files: [
          file('src/session.ts', { additions: 48, deletions: 12 }),
          file('src/session.test.ts', { additions: 96, deletions: 0, status: 'added' }),
        ],
        pullRequest: {
          number: 214,
          title: 'Expire sessions on logout',
          body: 'Sessions stayed in the store after logout, so a stolen cookie kept working. This removes the session row on logout and adds a regression test for the expiry path. Closes #211.',
          linkedIssues: [211],
        },
        openPullRequestsAvailable: true,
        openPullRequests: [openPullRequest({ number: 200, files: ['docs/api.md'] })],
      }),
  },
  {
    name: 'large-pr',
    description: 'Well-tested but very large change.',
    build: () =>
      context({
        files: [...manyFiles(34), file('src/session.test.ts', { additions: 120 })],
        pullRequest: {
          number: 218,
          title: 'Refactor the storage layer',
          body: 'Splits the storage layer into adapters and moves every caller onto the new interface. Mechanical, but large.',
        },
        openPullRequestsAvailable: true,
      }),
  },
  {
    name: 'failed-build',
    description: 'The build did not compile.',
    build: () =>
      context({
        checks: [
          check('build', { status: 'failed', detail: '`npm run build` exited with code 2.', source: 'run' }),
          check('test', { status: 'skipped', detail: 'Not run because the build failed.' }),
          check('lint', { status: 'passed', required: false }),
        ],
        files: [file('src/session.ts'), file('src/session.test.ts')],
        pullRequest: { number: 219, title: 'Add retry to the fetch helper' },
        openPullRequestsAvailable: true,
      }),
  },
  {
    name: 'failed-tests',
    description: 'The suite is red.',
    build: () =>
      context({
        checks: [
          check('build'),
          check('test', {
            status: 'failed',
            source: 'run',
            detail: '`npm test` exited with code 1.',
            outputTail: ['FAIL src/session.test.ts', '  ● expires the session on logout'],
          }),
          check('lint', { required: false }),
        ],
        files: [file('src/session.ts'), file('src/session.test.ts')],
        pullRequest: { number: 220, title: 'Expire sessions on logout' },
        openPullRequestsAvailable: true,
      }),
  },
  {
    name: 'no-test-changes',
    description: 'Source changed, nothing tested.',
    build: () =>
      context({
        files: [
          file('src/session.ts', { additions: 61, deletions: 8 }),
          file('src/user.ts', { additions: 30, deletions: 4 }),
        ],
        pullRequest: { number: 221, title: 'Rework session storage' },
        openPullRequestsAvailable: true,
      }),
  },
  {
    name: 'dependency-change',
    description: 'A new runtime dependency appears in the diff.',
    build: () =>
      context({
        files: [
          file('package.json', { patch: PACKAGE_JSON_PATCH, additions: 1, deletions: 0 }),
          file('package-lock.json', { additions: 240, deletions: 12 }),
          file('src/http.ts', { additions: 24, deletions: 30 }),
          file('src/http.test.ts', { additions: 40, deletions: 0 }),
        ],
        pullRequest: { number: 222, title: 'Use axios for outbound requests' },
        openPullRequestsAvailable: true,
      }),
  },
  {
    name: 'documentation-only',
    description: 'Docs only — build, tests and the test-change rule step aside.',
    build: () =>
      context({
        files: [file('README.md', { additions: 18, deletions: 4 }), file('docs/configuration.md')],
        checks: [
          check('build', { status: 'unknown', source: 'not-configured' }),
          check('test', { status: 'unknown', source: 'not-configured' }),
          check('lint', { status: 'unknown', source: 'not-configured', required: false }),
        ],
        pullRequest: {
          number: 223,
          title: 'Document the scoring model',
          body: 'Adds a walkthrough of how the score is calculated, with a worked example.',
        },
        openPullRequestsAvailable: true,
      }),
  },
  {
    name: 'empty-description',
    description: 'No description beyond the untouched template.',
    build: () =>
      context({
        files: [file('src/session.ts'), file('src/session.test.ts')],
        pullRequest: {
          number: 224,
          title: 'fix',
          body: '<!-- Describe your change. Why is it needed? -->',
        },
        openPullRequestsAvailable: true,
      }),
  },
  {
    name: 'potential-duplicate',
    description: 'Another open pull request is doing the same work.',
    build: () => {
      const shared = ['src/session.ts', 'src/session.test.ts', 'src/store.ts', 'src/store.test.ts'];
      return context({
        files: shared.map((path) => file(path)),
        pullRequest: { number: 225, title: 'Clean up expired sessions', linkedIssues: [211] },
        openPullRequestsAvailable: true,
        openPullRequests: [
          openPullRequest({
            number: 183,
            title: 'Fix session cleanup',
            files: shared,
            linkedIssues: [211],
          }),
        ],
      });
    },
  },
  {
    name: 'high-risk',
    description: 'Everything at once — the pull request nobody should start reviewing.',
    build: () =>
      context({
        files: [
          ...manyFiles(33),
          file('package.json', { patch: PACKAGE_JSON_PATCH, additions: 1 }),
          file('package-lock.json', { additions: 800, deletions: 40 }),
        ],
        checks: [
          check('build'),
          check('test', { status: 'failed', source: 'run', detail: '`npm test` exited with code 1.' }),
          check('lint', { status: 'failed', required: false, detail: '`npm run lint` exited with code 1.' }),
        ],
        pullRequest: { number: 226, title: 'wip', body: '' },
        openPullRequestsAvailable: true,
        openPullRequests: [
          openPullRequest({
            number: 183,
            title: 'Fix session cleanup',
            files: manyFiles(33).map((entry) => entry.path),
          }),
        ],
      }),
  },
];

export function scenario(name: string): Scenario {
  const found = SCENARIOS.find((entry) => entry.name === name);
  if (!found) throw new Error(`unknown scenario: ${name}`);
  return found;
}
