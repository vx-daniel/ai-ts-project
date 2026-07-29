# Running this blueprint on Bun

**Short answer: it already works.** The gate, the tests, the type-checker, the aliases, and the
config loader all run under Bun with no source changes. The one thing that did break —
`scripts/gate.ts` hardcoding `npm` — is fixed; the gate now detects its package manager.

Everything below was measured on **Bun 1.3.14 / Node 24.12.0** against this repo, not inferred.

## What works out of the box

| Concern | Under Bun | Note |
|---|---|---|
| `bun install` | ✅ | 77 packages, ~1.8s |
| Running `.ts` directly | ✅ native | **tsx becomes unnecessary** |
| `tsconfig` `paths` aliases (`@/*`) | ✅ native | **no tsx, no Vite plugin** |
| Biome (lint + format + naming plugin) | ✅ | a standalone binary; the runtime is irrelevant |
| `tsc --noEmit` | ✅ | |
| Vitest via `bun run vitest run` | ✅ | 43 tests pass |
| `bun test` (Bun's own runner) | ✅ | passes the Vitest-API tests **unmodified**, and genuinely fails on a mutated implementation |
| `scripts/gate.ts` | ✅ | since the package-manager detection landed — see below |
| The config loader | ✅ | `smol-toml` and Zod both work unchanged |

Two nice simplifications fall out: under Bun you can drop `tsx` entirely, and the
`resolve.tsconfigPaths` line in `vitest.config.ts` is only needed if you keep Vitest.

## What does NOT carry over

**Coverage is the one real gap.** `scripts/coverage-to-markdown.ts` reads
`coverage/coverage-summary.json`, which is Vitest's `json-summary` reporter. Bun's test runner
offers only two coverage reporters:

```
--coverage-reporter=<val>   Report coverage in 'text' and/or 'lcov'. Defaults to 'text'.
```

`bun test --coverage` writes **no `coverage/` directory at all** by default, and with
`--coverage-reporter=lcov` it writes `coverage/lcov.info` — not a JSON summary. So under `bun test`:

- `npm run coverage` breaks (no `coverage-summary.json` to read).
- `COVERAGE.md` cannot be generated without rewriting the script to parse lcov.
- The 85% floor moves from `vitest.config.ts` to `bunfig.toml`'s `[test] coverageThreshold`, so the
  threshold lives in a second place.

## Recommended: Bun as runtime + package manager, keep Vitest

This gets you Bun's install and startup speed while keeping the coverage pipeline intact.

**Both paths are scripted — you should not need to make these edits by hand.**

*Starting a new project:*

```bash
node --import tsx scripts/create-project.ts ../my-service --package-manager bun
```

*Converting an existing project:*

```bash
node --import tsx scripts/migrate-to-bun.ts            # preview (default)
node --import tsx scripts/migrate-to-bun.ts --write    # apply
rm -rf node_modules && bun install
bun run check:all
```

The migrator is dry-run by default and refuses to write to a dirty git tree, so `git checkout .`
is always a way back. Its transforms live in `scripts/lib/bun-migration.ts`, shared with the
generator so the two cannot drift apart.

The edits either path performs, for reference:

1. **`.gitignore`** — invert the lockfile rule. Commit `bun.lock`; ignore `package-lock.json`.
   Committing two lockfiles for one `package.json` is the failure to avoid: they resolve
   independently and drift silently.
2. **`package.json` scripts** — drop `--import tsx`, since Bun runs TypeScript natively:
   ```jsonc
   "check:all":       "bun scripts/gate.ts",
   "coverage":        "vitest run --coverage && bun scripts/coverage-to-markdown.ts",
   "coverage:readme": "bun scripts/coverage-to-markdown.ts --readme"
   ```
3. **Remove `tsx`** from devDependencies. Nothing else uses it.
4. **`.github/workflows/`** — swap `actions/setup-node` for `oven-sh/setup-bun`, and
   `npm ci` for `bun install --frozen-lockfile`. `coverage-main.yml` also invokes the coverage
   script directly; update that call too.
5. **`engines`** in `package.json` — `node: ">=24"` no longer describes the requirement. Either add
   `"bun": ">=1.3"` or drop the field.
6. **`.githooks/pre-commit`** — it runs `npm run check:all`; change to `bun run check:all`.

**Keep Vitest as the test runner.** `bun test` passing unmodified is a genuine convenience, but
switching to it costs you `json-summary`, and rewriting `coverage-to-markdown.ts` to parse lcov is
real work for no benefit. Revisit if Bun adds a JSON summary reporter.

## If you want `bun test` anyway

You would need to:

- Rewrite `scripts/coverage-to-markdown.ts` to parse `coverage/lcov.info` instead of
  `coverage-summary.json` — lcov is line-oriented (`DA:`/`BRDA:` records), so the per-file and
  per-directory roll-ups have to be computed from raw hit counts rather than read from a summary.
- Move the coverage floor into `bunfig.toml`:
  ```toml
  [test]
  coverageThreshold = 0.85
  coverageReporter = ["text", "lcov"]
  ```
- Accept that `vitest.config.ts`'s `include`/`exclude` no longer apply; Bun has its own discovery.

The tests themselves need **no changes** — that part is genuinely free.

## Why `scripts/gate.ts` needed a fix

The gate shells out to run each package.json script. It used to hardcode `npm`:

```
$ bun scripts/gate.ts
▶ biome — lint + format + import-organize (check-only)
gate "biome" failed to spawn: Executable not found in $PATH: "npm"
```

Bun ran the TypeScript fine; the *child process* was the problem. `detectPackageManager()` now
resolves it from `npm_config_user_agent` (set by every major manager when running a script), falling
back to a `Bun` global check for the direct-invocation case, then to npm. All four paths verified:

| Invocation | Detected |
|---|---|
| `npm run check:all` | npm |
| `node scripts/gate.ts` | npm |
| `bun run check:all` | bun |
| `bun scripts/gate.ts` | bun |

The gate prints which one it chose, so a wrong guess is visible rather than mysterious.
