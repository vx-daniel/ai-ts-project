# CLAUDE.md — TypeScript Project Blueprint

**This repo is a blueprint, not a product.** It is the starting point new TypeScript projects are
copied from. Nothing here implements a feature; everything here exists to make the *next* project's
first day correct — one gate, one set of conventions, and agent rules that are true on arrival.

**If you are working in a project created from this blueprint, this file should have been replaced.**
A CLAUDE.md that still describes the blueprint is a stale file — rewrite it to describe the actual
project. See [README.md](README.md) § "Adopting the blueprint" for the full checklist.

**New projects are GENERATED, not copied**:
`node --import tsx scripts/create-project.ts <target> [--package-manager npm|bun] [--layout single|monorepo]`.
It renames the package, writes project-shaped docs, applies the chosen package manager and layout,
and omits its own tooling from the output. All four combinations are verified to pass `check:all` on
generation. If you are asked to "set up a new project from the blueprint", run that — do not
hand-copy the tree.

Two opt-in guides live in [`docs/`](docs/), both measured rather than inferred:
[`bun.md`](docs/bun.md) (what works under Bun, and the one thing that doesn't) and
[`monorepo.md`](docs/monorepo.md) (what carries over to workspaces, and what changes).

**Adoption tooling — `scripts/create-project.ts`, `scripts/migrate-to-bun.ts`, `scripts/lib/` — is
blueprint-only.** It is excluded from generated projects and must not be treated as project code.
The Bun transforms live in `scripts/lib/bun-migration.ts` and are shared by the generator and the
migrator so the two cannot drift.

## What's here

- **The gate** — [`scripts/gate.ts`](scripts/gate.ts). One ordered list of checks (Biome → tsc →
  Vitest), cheap-first. `npm run check:all` delegates to it, and both the pre-commit hook
  ([`.githooks/pre-commit`](.githooks/pre-commit), wired via `core.hooksPath` by the `prepare`
  script) and CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) invoke `check:all`. One
  list is the single definition of "green" everywhere. **Adding a project-specific check (a build,
  an IaC synth, a container smoke test) means appending to `GATES` — nothing else.**
- **Lint + format** — Biome ([`biome.json`](biome.json)), `recommended` plus repo overrides.
- **The naming gate** — [`.biome/naming.grit`](.biome/naming.grit), a GritQL plugin registered via
  biome.json's `plugins` key. Flags abbreviations and single-character names that Biome's
  `useNamingConvention` structurally cannot catch. **Its allowlist ships empty on purpose** — read
  the note above `is_allowlisted` before adding to it.
- **Coverage** — [`vitest.config.ts`](vitest.config.ts) sets an 85% floor on all four metrics, and
  [`scripts/coverage-to-markdown.ts`](scripts/coverage-to-markdown.ts) renders `COVERAGE.md` from
  the summary. CI enforces the floor; a push to main refreshes the committed doc
  ([`coverage-main.yml`](.github/workflows/coverage-main.yml)).
- **Configuration** — three layers: [`config.defaults.toml`](config.defaults.toml) (committed, safe),
  `config.local.toml` (gitignored, machine-specific), `.env` (gitignored, **secrets only**). The
  first two deep-merge key by key; secrets are referenced BY NAME via `apiKeyEnv` and read at point
  of use, never stored on the config object. [`src/config/config-schema.ts`](src/config/config-schema.ts)
  is the strict Zod contract with **no I/O** (so it unit-tests against plain objects);
  [`src/config/config.ts`](src/config/config.ts) does find → merge → validate, with the filesystem
  and environment injected. Use `getConfig()`, never a module-level `const`.
- **Agent rules** — [`.claude/rules/`](.claude/rules/). Naming, TypeScript patterns, Zod, options
  objects, discipline, broken windows, memory. These are the conventions; read the relevant one
  before writing code in its area.
- **Agent skills** — [`.claude/skills/`](.claude/skills/): `test-quality` (writing/reviewing tests),
  `sync-project-memory` and `audit-memory` (the two-index memory system).
- **CI workflows** — [`.github/workflows/`](.github/workflows/). `ci.yml` and `coverage-main.yml`
  are self-contained. The other four are **caller stubs** delegating to `Viaanix/vx-repo-tools` —
  see the caveat below.

## What's deliberately NOT here

Absent by design. Do not treat these as gaps to fill unless the project you are building needs them:

- **No build script and no emit config.** `tsconfig.json` sets `noEmit` — the blueprint typechecks
  but produces no output, because a library, a bundled app, and a directly-executed Node script want
  three different answers. Pick one when you know which you are. See README.md.
- **No application code.** `src/config/` is the only populated directory, and it is a demonstration
  of the config pattern, not a starter feature. Replace it.
- **No framework, runtime, or cloud SDK.** The blueprint previously carried an AWS CDK stack; it was
  removed. Add what the project needs, nothing pre-emptively.
- **No `.claude/memory/`.** Created by the `sync-project-memory` skill on first run.

## Toolchain

- **Node 24+** (`engines` in package.json; CI pins 24), running `.ts` through **tsx**
  (`node --import tsx scripts/gate.ts`) — no build step. **Do not "simplify" this to bare `node`**:
  Node's own resolver does not read tsconfig `paths`, so the first aliased import throws
  `ERR_MODULE_NOT_FOUND`. tsx is load-bearing, not ceremony. (Under Bun both are unnecessary — Bun
  runs `.ts` and resolves tsconfig `paths` natively. See [`docs/bun.md`](docs/bun.md).)
- **The gate detects its package manager** (`npm_config_user_agent`, falling back to a `Bun` global
  check, then npm) and prints which it chose. Do not hardcode `npm` back into
  [`scripts/gate.ts`](scripts/gate.ts) — that broke `bun scripts/gate.ts` with
  `Executable not found in $PATH: "npm"`.
- **TypeScript 7** (native compiler), `strict: true`, typecheck-only.
- **Path aliases**: `@/*` → `src/*`. `tsconfig.json`'s `paths` is the single source of truth — tsc
  reads it directly, Vitest via `resolve.tsconfigPaths`, runtime via tsx. Add an alias
  there and all three follow; never restate the mapping elsewhere. There is deliberately no
  `baseUrl` (deprecated, stops working in TS 7).
- **ESM** (`"type": "module"`, `moduleResolution: NodeNext`): imports **must** carry a `.js`
  extension — `'./thing.js'` and `'@/orders/store.js'` both resolve to the `.ts` source. Omitting
  the extension is a hard error, not a warning.
- **Vitest** for tests (not Jest, not `bun:test`), **Biome** for lint/format, **Zod 4** for
  boundary validation.

## Verification (run before declaring a change done)

```bash
npm run check:all   # THE gate: Biome → tsc --noEmit → Vitest (cheap-first)
npm run coverage    # v8 coverage + regenerates COVERAGE.md; CI enforces the 85% floor
```

`npm run check:all` is the single source of "green". A passing gate is necessary but **not
sufficient** — it proves the code compiles and the tests pass, not that the behaviour is right. Run
the affected path and see the result. This is the rule most often skipped.

## Known caveats — read before relying on these

Recorded because each has already misled a session, here or in the repo this came from.

- **Four workflows are Viaanix-org-specific.** `claude-pr-review.yml`, `claude-issue-agent.yml`,
  `secret-scan.yml`, and `test-audit.yml` are caller stubs pointing at
  `Viaanix/vx-repo-tools/.github/workflows/...@v1`. Outside that org they will fail to resolve, and
  three of the four also need the org secret `CLAUDE_CODE_OAUTH_TOKEN_TOOLING`. **If this blueprint
  is used outside Viaanix, delete those four files** — `ci.yml` and `coverage-main.yml` stand alone.
- **Committed agent memory is not auto-loaded.** `.claude/rules/agent-memory.md` describes the
  two-index system, but this repo has no `@import` of the memory index in CLAUDE.md and the PR
  reviewer does not read it. Committed memory is a shared artifact you must open explicitly. Don't
  write rules or PR text assuming auto-load.
- **Rules copied across repos rot.** Every file in `.claude/rules/` arrived here from another
  project and had to be re-fitted — the examples cited modules that did not exist, which cost real
  sessions before it was caught. `.claude/rules/broken-windows.md` § "Don't Broaden Scope While
  Cleaning" documents this failure directly. **When you copy a rule into a new project, re-fit its
  examples to that project's real code before you trust it.**

## Conventions

The rules in [`.claude/rules/`](.claude/rules/) are the detail; the short version:

- **Verbose names, no abbreviations.** Enforced by the naming gate, not just review.
- **Comments carry WHY; names carry WHAT.** Both required when the why is non-obvious.
- **Plain over clever.** No nested ternaries (gated), no one-line pipeline gymnastics.
- **Options objects at 3+ parameters.** Biome's `useMaxParams` fails at 4; the rule is stricter at 3
  and review-enforced, so a green gate does not mean the convention is met.
- **Zod at trust boundaries**, with the type *inferred* from the schema — never hand-written beside it.
- **No magic values**, no abandonment markers (`TODO`/`FIXME`/`HACK`), no test weakening, no type
  suppression in tests.
