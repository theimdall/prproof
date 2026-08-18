## What changed

<!-- One or two sentences. What does this do, and why is it needed? -->

## Why

<!-- The problem behind the change. Link an issue if there is one: Closes #123 -->

## How to verify

<!-- The commands or steps a reviewer can run. -->

```console
npm run verify
```

## Checklist

- [ ] Tests cover the change (`npm test`)
- [ ] `npm run verify` passes
- [ ] Documentation updated, if behaviour changed
- [ ] `npm run demo` re-run and `docs/examples/` reviewed, if the report or scoring changed
- [ ] `npm run package` re-run and `dist/` committed, if `src/` changed
