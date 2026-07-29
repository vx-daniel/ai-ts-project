# TypeScript Project Blueprint

The starting point for new TypeScript projects. It ships a single quality gate, a coverage floor, a
layered configuration system, and a set of agent rules — and no application code, so the first thing
you write is the actual feature.

Agent-facing detail lives in [CLAUDE.md](CLAUDE.md). Two opt-in guides live in [docs/](docs/):
[running on Bun](docs/bun.md) and [converting to a monorepo](docs/monorepo.md).

## Quick start

**To start a new project, generate it — don't copy this repo by hand.**

```bash
npm install
node --import tsx scripts/create-project.ts ../my-service
```

Options: `--name <name>`, `--package-manager npm|bun`, `--layout single|monorepo`,
`--package <name>` (first workspace package).

```bash
node --import tsx scripts/create-project.ts ../my-service  --package-manager bun
node --import tsx scripts/create-project.ts ../my-platform --layout monorepo --package core
```

The generator copies this tree, renames the package, writes a **project-shaped** README and
CLAUDE.md (no blueprint framing left to mislead an agent), applies the package manager and layout
you chose, and omits its own tooling from the output. All four combinations are verified to pass
`check:all` on generation — see [Verified combinations](#verified-combinations).

Prefer the generator over copy-and-edit: it makes the choices once, up front, rather than leaving
you to undo defaults, and it performs the identity steps that are otherwise most often skipped.

**To work on the blueprint itself:**

```bash
npm install        # also wires the pre-commit hook via the `prepare` script
npm run check:all  # the gate: Biome → tsc --noEmit → Vitest
```

Both should pass on a clean clone. If they don't, that's a bug in the blueprint — fix it here rather
than working around it downstream.

### Verified combinations

Each is generated and its gate run, rather than assumed:

| `--package-manager` | `--layout` | Gate | Coverage |
|---|---|---|---|
| npm | single | ✅ | ✅ 43 tests, 100% lines |
| bun | single | ✅ | ✅ |
| npm | monorepo | ✅ | ✅ |
| bun | monorepo | ✅ | ✅ |

For the monorepo variants the alias (`@/*`), the tsconfig `include`, and the coverage globs are all
rewritten to point through `packages/`, and verified to resolve — not merely to pass vacuously.

## What you get

| Piece | File | What it does |
|---|---|---|
| **Generator** | [scripts/create-project.ts](scripts/create-project.ts) | Produces a new project: name, package manager, layout. The primary adoption path. |
| The gate | [scripts/gate.ts](scripts/gate.ts) | One ordered check list. Pre-commit hook and CI both call it, so "green" means one thing everywhere. |
| Lint + format | [biome.json](biome.json) | Biome `recommended` plus stricter overrides (no nested ternaries, no `any`, no `@ts-ignore`, numeric separators). |
| Naming gate | [.biome/naming.grit](.biome/naming.grit) | GritQL plugin flagging abbreviations and single-character names. Allowlist ships empty. |
| Path aliases | [tsconfig.json](tsconfig.json) | `@/*` → `src/*`, read by tsc, Vitest, and tsx from one place. |
| Coverage floor | [vitest.config.ts](vitest.config.ts) | 85% on lines, branches, functions, statements. |
| Coverage doc | [scripts/coverage-to-markdown.ts](scripts/coverage-to-markdown.ts) | Renders `COVERAGE.md` from the v8 summary. |
| Config | [config.defaults.toml](config.defaults.toml), [src/config/](src/config/) | Three-layer TOML config, Zod-validated, secrets by env-var name. |
| Agent rules | [.claude/rules/](.claude/rules/) | Naming, TypeScript patterns, Zod, options objects, discipline, broken windows, memory. |
| Agent skills | [.claude/skills/](.claude/skills/) | Test quality; the two-index memory system. |
| CI | [.github/workflows/](.github/workflows/) | `ci.yml` runs the gate + coverage. `coverage-main.yml` refreshes `COVERAGE.md` on merge. |

## How the pieces fit

Each choice below is deliberate and several are non-obvious. If you are about to "simplify" one of
them, this is the reasoning you would be discarding.

**One gate, one definition of green.** [scripts/gate.ts](scripts/gate.ts) holds a single ordered
list of checks. `npm run check:all` delegates to it; the pre-commit hook and CI both call
`check:all`. Nothing has its own private notion of passing, so "it works on my machine" and "CI is
green" cannot diverge. Adding a project check — a build, an IaC synth, a container smoke test —
means appending one entry to `GATES`; every caller inherits it. Order is cheap-first, so a
two-second lint failure surfaces before a slow test run. The gate detects its own package manager,
so it works under npm, pnpm, yarn, and Bun alike.

**A passing gate is necessary, not sufficient.** It proves the code compiles and the tests pass. It
does not prove the behaviour is right. Run the affected path and look at the output — this is the
rule most often skipped, including by agents.

**The naming gate ships with an empty allowlist.** [.biome/naming.grit](.biome/naming.grit) flags
abbreviations and single-character names that Biome's own `useNamingConvention` structurally cannot
see (it checks case, not length). Its allowlist is deliberately empty because an allowlist is a
*specific project's* sanctioned vocabulary — this blueprint's ancestor arrived carrying a LoRaWAN
decoder's list, which would have made `ts` and `temp` legal in every project descended from it. Add
entries only with a receipt: the published field name, the spec term.

**One coverage floor, all four metrics.** [vitest.config.ts](vitest.config.ts) sets 85% on lines,
branches, functions, and statements. A split floor (lines 85 / branches 60) is where coverage
theatre hides: a suite can post a high line number while leaving most decision paths unexercised.
`coverage.include` measures every source file, not only the ones a test imported — without it, a
module with zero tests is simply absent from the report and the percentage looks healthy.

**`*.io.ts` is the escape valve that keeps the floor honest.** A hard 85% floor pushes you toward
one of two bad outcomes when you hit genuine boundary glue — a process bootstrap, an HTTP handler
that only wires request → function → response, a database write. Either you lower the floor, or you
write fig-leaf tests asserting a mock was called. So name such a file `*.io.ts` and it is excluded
from the metric, on one condition: **it must contain no branching and no computation.** Every
decision belongs in a pure module that *is* covered. If you want an `if` inside an `.io.ts`, that
condition belongs in a tested function. Verify shells by running the real thing, not by mocking.

Coverage also emits `lcov.info`, which editor extensions (VS Code's Coverage Gutters and similar)
read to annotate uncovered lines in the gutter as you edit — coverage you notice while writing,
rather than a report you remember to open.

**Agent rules are conventions with teeth.** [.claude/rules/](.claude/rules/) covers naming,
TypeScript patterns, Zod usage, options objects, discipline, and the broken-windows ratchet. Some
are mechanically gated by Biome; the rest are review-enforced, and each file says which it is — so a
green gate is never mistaken for "the conventions are met."

**Agent skills are procedures.** [.claude/skills/](.claude/skills/) holds `test-quality` (writing,
reviewing, and mutation-testing tests) and the two-index memory system. `test-quality` is
framework-adaptive by design: it detects Vitest or bun:test and loads the matching reference.

**Configuration is layered so the committed part is safe.** Three files, one job each — see
[Configuration](#configuration). The property that makes it work is that secrets are referenced *by
variable name* and read at point of use, so no credential ever lands on the config object.

**Four CI workflows are Viaanix-specific.** `ci.yml` and `coverage-main.yml` stand alone. The other
four delegate to `Viaanix/vx-repo-tools` and cannot resolve outside that org — delete them if you
are elsewhere (step 8 below).

## Adopting the blueprint

**Steps 1–4 and 8–12 are done for you by `scripts/create-project.ts`** (see
[Quick start](#quick-start)). This list is the manual equivalent — use it if you copied the repo by
hand, or as a review checklist after generating.

Work top to bottom: **1–4** are mechanical, **5–7** wire it to your code, **8–12** are decisions you
should make consciously rather than inherit. **Run `npm run check:all` after each step** — it should
never go red, and if it does you know exactly which step did it.

### Identity

- [ ] **1. Rename the package.** Set `name` and `description` in [package.json](package.json). Drop
  `"private": true` only if the project will actually be published.
- [ ] **2. Replace [CLAUDE.md](CLAUDE.md).** It currently describes *the blueprint*. A CLAUDE.md
  that still says "this repo is a blueprint" is a stale file, and stale agent instructions are worse
  than none, because agents act on them. Describe what the project actually is, what its gate
  covers, and what a newcomer needs to know.
- [ ] **3. Replace this README.** Same reasoning. Keep the sections that still apply (the gate,
  aliases, config) and delete the blueprint framing.
- [ ] **4. Reset `COVERAGE.md`.** Delete it; `npm run coverage` regenerates it from your code.

### Wire it to your project

- [ ] **5. Replace the example config.** [config.defaults.toml](config.defaults.toml) and
  [src/config/](src/config/) demonstrate the config *patterns* — `app`/`server`/`limits`/`services`/
  `features` are not a starter set to keep. Edit the TOML and
  [config-schema.ts](src/config/config-schema.ts) together; strictness means they must agree, and
  you find out immediately if they don't. Keep the mechanism (three layers, strict validation,
  inferred types, secrets by env-var name) and delete the example domain. Update
  [.env.example](.env.example) to list what your services actually need.
- [ ] **6. Delete the example tests** (`src/config/*.test.ts`) as you replace the config, and write
  tests for what you build. Note the 85% floor is live: the first source file you add without a
  test will fail `npm run coverage`. That is intended. See
  [.claude/skills/test-quality/](.claude/skills/test-quality/) for how to write tests that actually
  catch bugs, including the mutation-testing discipline.
- [ ] **7. Re-fit [.claude/rules/](.claude/rules/) to your code.** The conventions transfer; the
  worked examples are generic placeholders. Point them at real modules once you have some. Rules
  citing files that don't exist actively mislead — documented as a real, repeated cost in
  [broken-windows.md](.claude/rules/broken-windows.md) § "Don't Broaden Scope While Cleaning".

### Decisions

- [ ] **8. Outside the Viaanix org?** Delete the four caller-stub workflows —
  `claude-pr-review.yml`, `claude-issue-agent.yml`, `secret-scan.yml`, `test-audit.yml`. They
  delegate to `Viaanix/vx-repo-tools` and cannot resolve elsewhere, and three of them also need an
  org secret. `ci.yml` and `coverage-main.yml` are self-contained and stay.
- [ ] **9. Choose an emit strategy** — [below](#choosing-an-emit-strategy). Library, bundled app, and
  run-directly need incompatible settings, which is why the blueprint ships none of them.
- [ ] **10. Choose a test layout.** [vitest.config.ts](vitest.config.ts) accepts both colocated
  (`src/**/*.test.ts`) and separate (`test/**`). Pick one and delete the other glob rather than
  leaving two conventions live.
- [ ] **11. Consider the package manager.** npm is the default and the committed lockfile.
  [docs/bun.md](docs/bun.md) has a measured compatibility matrix if you want Bun — most of it works
  unchanged, with coverage the one real gap. Already adopted and want to switch later?
  `node --import tsx scripts/migrate-to-bun.ts` (dry-run by default).
- [ ] **12. Consider the repo shape.** Single package is the default;
  [docs/monorepo.md](docs/monorepo.md) covers what carries over and what changes (mainly path
  aliases and tsconfig layout).

### Then

- [ ] **13. Run the gate and see it green**, then write the first real feature. If `check:all` is red
  on a fresh adoption, that is a blueprint bug — fix it upstream rather than working around it here.

## Choosing an emit strategy

[tsconfig.json](tsconfig.json) sets `noEmit: true` and there is no `build` script. This is a real
decision deferred to you, not an omission — the three common answers need incompatible settings:

- **Run TypeScript directly, no build** (scripts, CLIs, servers on Node 24+). Change nothing — this
  is what the blueprint already does, via `tsx`. See the limits table below for when bare `node`
  would suffice and when it would not.
- **Ship a library.** Set `"noEmit": false`, `"declaration": true`, `"outDir": "dist"`; add
  `"build": "tsc"` and the `main`/`types`/`exports` fields to package.json.
- **Bundle for a runtime** (browser, Lambda, edge worker, container). Keep `noEmit` — the bundler
  owns the output — and add a `build` script plus a bundler config. Consider appending a `build`
  entry to `GATES` in gate.ts so a bundle that fails to build fails the gate.

Whichever you pick, add the output directory to [.gitignore](.gitignore) (`dist/` is pre-declared).

### Running TypeScript directly on Node — what it can't do

Node 24 runs `.ts` files natively, but it **strips** types rather than compiling them. Any TypeScript
construct that needs code *generated* for it is rejected at parse time, with a hard `SyntaxError`
rather than a graceful degradation. Measured on Node v24.12.0:

| | `node file.ts` | `node --experimental-transform-types` | `tsx` |
|---|---|---|---|
| Types, interfaces, generics | ✅ | ✅ | ✅ |
| `enum` / `const enum` | ❌ | ✅ | ✅ |
| `namespace` | ❌ | ✅ | ✅ |
| Parameter properties (`constructor(private x)`) | ❌ | ✅ | ✅ |
| **Decorators** | ❌ | ❌ | ✅ |
| **`tsconfig` `paths` aliases** | ❌ | ❌ | ✅ |

The last two rows are the ones **no Node flag covers**, and they are exactly what a decorator-driven
framework (NestJS, TypeORM, class-validator) or an aliased `@/*` import layout requires.

**This blueprint therefore runs its TypeScript through [tsx](https://github.com/privatenumber/tsx)**
(`node --import tsx …`), not bare `node` — because it ships path aliases (see below), and bare Node
throws `ERR_MODULE_NOT_FOUND` on the first aliased import. tsx also brings a watch mode
(`tsx watch <file>`).

If you strip the aliases out and never use decorators, you can drop tsx and revert the npm scripts to
plain `node scripts/*.ts`. Nothing else depends on it.

## Path aliases

`@/*` maps to `src/*`, so a deep import reads `@/orders/store.js` rather than
`../../../orders/store.js` — and survives the importing file being moved.

```ts
import { buildOrderSummary } from '@/orders/summary.js'   // not '../../orders/summary.js'
```

The `.js` extension is still required (ESM + `NodeNext`); it resolves to the `.ts` source.

[tsconfig.json](tsconfig.json)'s `paths` is the **single source of truth**. Three consumers read it
rather than restating it — add an alias in one place and all three follow:

| Consumer | How it reads tsconfig `paths` |
|---|---|
| `tsc` | Directly. |
| Vitest | `resolve.tsconfigPaths: true` in [vitest.config.ts](vitest.config.ts) — Vite's native support. The `vite-tsconfig-paths` plugin is redundant in Vitest 4. |
| Runtime | `tsx`. Node's own resolver does **not** read tsconfig. |

Note there is no `baseUrl` — it is deprecated and stops functioning in TypeScript 7 (which this repo
pins). Since TS 5, `paths` works without it, with entries relative to the tsconfig's own directory.

**A dropped consumer fails silently-ish**: turn off `resolve.tsconfigPaths` and aliased imports
still typecheck, then fail only at test time. If you add a fourth consumer (a bundler, an ESLint resolver),
point it at tsconfig too rather than copying the mapping.

## Configuration

Three layers, each with one job. The split exists so the first two can be committed or shared
without ever carrying a credential.

| Layer | File | Committed? | Holds |
|---|---|---|---|
| 1 | [config.defaults.toml](config.defaults.toml) | ✅ **yes** | Safe defaults. Every key the schema requires. |
| 2 | `config.local.toml` | ❌ gitignored | Machine-specific overrides — endpoints, ports, ids. Still no secrets. |
| 3 | `.env` | ❌ gitignored | **Secrets only**, referenced from layers 1–2 *by variable name*. |

Layers 1 and 2 are deep-merged (local wins, **key by key**) and validated together. Layer 3 never
enters the config object at all.

### Getting started

```bash
cp .env.example .env                              # then fill in the values
cp config.local.toml.example config.local.toml    # optional; only if you need overrides
```

`config.local.toml` should contain **only the keys you change**. Because the merge is key-by-key, a
`[server]` block setting just `port` leaves `host` and `requestTimeoutMs` at their defaults. Copying
the whole defaults file and editing two lines is the common mistake — it freezes every other value
at whatever the defaults said that day.

Arrays **replace** rather than concatenate, so a local `jobQueue = ["staging"]` is the complete new
chain. That is deliberate: concatenation would make it impossible to *shorten* a list locally.

### Why secrets are referenced by name

Committed config names the variable; the value is read from the environment at the point of use:

```toml
[services.primary]
kind      = "http"
baseUrl   = "http://localhost:8080"
apiKeyEnv = "PRIMARY_API_KEY"     # the NAME — never the key
```

```ts
import { getConfig, resolveServiceApiKey } from '@/config/config.js'

const config = getConfig()
// Throws a message naming both the variable and the service if PRIMARY_API_KEY is unset or blank.
const apiKey = resolveServiceApiKey({ serviceName: 'primary', service: config.services.primary })
```

The credential never lands on the config object, so a config dump, a log line, or a serialized error
cannot leak it. Add the variable to [.env.example](.env.example) too — it is the only discoverable
list of what a fresh clone needs.

Nothing in the blueprint calls `resolveServiceApiKey` yet, so a fresh clone with no `.env` passes the
gate. The snippet above is illustrative: run it before setting `PRIMARY_API_KEY` and it throws, by
design — a missing credential should fail at startup with a message naming the variable, not later as
an opaque 401.

### The code, and why it is two files

| File | Role |
|---|---|
| [src/config/config-schema.ts](src/config/config-schema.ts) | The strict Zod contract. **No I/O**, so it unit-tests against plain objects — no fixtures, no temp files. |
| [src/config/config.ts](src/config/config.ts) | Find the directory → merge the layers → validate. Filesystem and environment are injected, defaulting to the real ones. |

`zod` and `smol-toml` are `dependencies`, not `devDependencies`, because config loading happens at
**runtime** — they ship to whatever runtime you deploy to. Everything else here (`typescript`,
`vitest`, `@types/node`, `tsx`) is build- or test-time only. The blueprint is `private` and publishes
nothing today, so the split has no consumer yet; it is set correctly now so that adopting a build or
publish step later does not require re-deriving it.

The schema is **strict everywhere**: an unknown or misspelled key is a hard error naming its path,
not a silently ignored line. `parseConfig` reports *every* problem at once, so one boot tells you
everything to fix. Referential integrity is checked too — a feature naming a service that does not
exist fails at load with a message listing the services that do.

`getConfig()` is a lazy cached function, not an exported `const`. That is deliberate: a module-level
`export const config = loadConfig()` makes merely *importing* the module touch the filesystem, which
forces real TOML on disk into every test that transitively imports it.

### Adapting it

`app` / `server` / `limits` / `services` / `features` are a **demonstration of the available
patterns, not a starter set to keep**. Delete what you do not need and edit the schema to match —
the schema and the TOML must agree, and strictness guarantees you find out immediately if they do
not. What is worth preserving is the mechanism: three layers, strict validation, inferred types, and
secrets by env-var name.

## Commands

| Command | Purpose |
|---|---|
| `npm run check:all` | The gate. Run this before declaring any change done. |
| `npm run lint` / `lint:fix` | Biome check / autofix. |
| `npm run format` | Biome format, writing changes. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | `vitest run`. |
| `npm run coverage` | Coverage + regenerate `COVERAGE.md`. Enforces the 85% floor. |
| `npm run coverage:open` | Open the HTML coverage report. |
| `npm run coverage:readme` | Update the totals block in this README. |

## Coverage

<!-- COVERAGE-START -->

_Coverage at `15a533d` (2026-07-29T22:15:36.088Z) — see [COVERAGE.md](./COVERAGE.md)._

| Metric | % | Covered/Total |
|---|---|---|
| lines | 100.0% | 69/69 |
| statements | 100.0% | 69/69 |
| functions | 100.0% | 13/13 |
| branches | 95.7% | 45/47 |

<!-- COVERAGE-END -->

## Requirements

Node **24+** (`engines` in package.json; CI pins 24). `.ts` files run through `tsx` — no build step,
but not bare Node either, because the blueprint uses path aliases. See "Path aliases" above.
