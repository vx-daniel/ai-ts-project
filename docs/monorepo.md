# Converting this blueprint to a monorepo

**Short answer: yes, and most of it carries over unchanged.** The gate, Biome, the naming plugin,
and the config loader are all already workspace-safe. Two things genuinely change shape: **path
aliases** and **tsconfig layout**.

**The first step is scripted.** `scripts/create-project.ts --layout monorepo` generates a workspace
containing one package, with the tsconfig split, the `@/*` alias, the `include` globs, and the
coverage globs all rewritten to point through `packages/`. Both npm and Bun variants are verified to
pass `check:all` on generation, with coverage measuring real files and the alias resolving.

What a script cannot do is decide what belongs in a *second* package — that is a design judgement.
So the sections below are the plan for everything after the scaffold. Where a claim is verified by a
test in this repo, it says so; treat the rest as a design sketch to validate as you go.

## Target layout

```
.
├── package.json              workspaces: ["packages/*"], all scripts, all devDependencies
├── package-lock.json         ONE lockfile at the root — never per-package
├── tsconfig.base.json        compilerOptions every package shares
├── tsconfig.json             solution file: references each package
├── biome.json                one config, repo-wide
├── .biome/naming.grit        one plugin, repo-wide
├── vitest.config.ts          `projects: ['packages/*']`
├── config.defaults.toml      ONE config tree at the root
├── scripts/gate.ts           unchanged
└── packages/
    ├── core/
    │   ├── package.json      name: "@acme/core"
    │   ├── tsconfig.json     extends ../../tsconfig.base.json
    │   └── src/
    └── api/
        ├── package.json      name: "@acme/api", depends on "@acme/core"
        ├── tsconfig.json
        └── src/
```

## What carries over with no change

**`scripts/gate.ts`.** It runs root package.json scripts, and each of those already fans out across
the workspace (`biome check` walks the whole tree; `tsc -b` builds all references; `vitest run` runs
all projects). Adding a package changes nothing about the gate — which is the point of it being one
ordered list.

**Biome and the naming plugin.** `biome.json` already includes `**` and the plugin is registered
repo-wide, so both cover new packages automatically. One config, one standard, no per-package copies
to drift.

**The config loader — and this one is load-bearing.** `findConfigDirectory` walks *up* from the
current directory, so a package at `packages/api/src/routes/` finds the root `config.defaults.toml`
with zero per-package configuration. Without that, every package would need its own config copy, and
those copies would drift.

This is guarded by a test, not just asserted:

```
src/config/config.test.ts
  › findConfigDirectory
    › finds the root defaults file from inside a nested workspace package
```

It is mutation-verified: disabling the upward walk turns it red.

Keep **one** config tree at the root. Per-package config files reintroduce exactly the duplication
the layered design removes. If packages need different values, add sections
(`[packages.api]`, `[packages.worker]`) rather than files.

**The coverage script.** It reads `coverage/coverage-summary.json`, which Vitest still produces when
running multiple projects; the by-directory roll-up in `COVERAGE.md` will simply group by
`packages/<name>/src/...` instead of `src/...`.

## What actually changes

### 1. Path aliases — the real work

Today's `@/*` → `src/*` is single-package by construction. In a monorepo `@/orders/store.js` is
ambiguous: which package's `src`?

Two options.

**Option A — package-name imports (recommended).** Let the workspace resolve them, and drop `@/*`:

```ts
import { buildOrderSummary } from '@acme/core/orders/summary.js'
```

Packages reference each other by their `package.json` name; npm/bun workspaces symlink them into
`node_modules`. Nothing to configure — no `paths` at all for cross-package imports — and it matches
how the packages would be consumed if ever published. Keep relative imports inside a package.

**Option B — explicit per-package aliases.** Keep the alias style, one entry per package:

```jsonc
// tsconfig.base.json
"paths": {
  "@core/*": ["./packages/core/src/*"],
  "@api/*":  ["./packages/api/src/*"]
}
```

Costs a `paths` edit per new package, and the entries are relative to the file that declares them —
easy to get subtly wrong in a package-level tsconfig that extends a base. Option A avoids the class
of problem entirely.

Whichever you pick, the "one source of truth" story still holds: tsc, Vitest (`resolve.tsconfigPaths`),
and tsx/Bun all keep reading tsconfig. Only the mapping's shape changes.

### 2. tsconfig layout

One base plus per-package configs:

```jsonc
// tsconfig.base.json — everything the current tsconfig.json has under compilerOptions
{ "compilerOptions": { "strict": true, "module": "NodeNext", /* … */ } }
```

```jsonc
// packages/core/tsconfig.json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

```jsonc
// tsconfig.json — solution file, no files of its own
{ "files": [], "references": [{ "path": "./packages/core" }, { "path": "./packages/api" }] }
```

Then `typecheck` becomes `tsc -b` rather than `tsc --noEmit`. **Caveat:** project references require
each referenced package to emit declarations, which conflicts with today's blanket `noEmit`. Either
set `composite: true` + `declaration: true` + `outDir` per package (the standard answer), or skip
references and point one tsconfig at every package's `src` — simpler, slower, and fine until the
repo is large.

### 3. Vitest projects

Vitest 3+ replaced `vitest.workspace.ts` with a `projects` field:

```ts
export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts'],
      thresholds: { lines: 85, branches: 85, functions: 85, statements: 85 },
    },
  },
})
```

Coverage aggregates across projects, so the single 85% floor still means one thing repo-wide.
Decide deliberately whether you want **one repo-wide floor** (simple, but a well-tested package can
mask a weak one) or **`perFile`/per-project thresholds** (honest, noisier).

### 4. Dependencies

Keep **all** devDependencies and the single lockfile at the root. Per-package `node_modules` and
per-package lockfiles are the main source of monorepo version skew. Runtime dependencies (`zod`,
`smol-toml`) belong in the package that imports them.

## Suggested order

Do it in this sequence so the gate stays green at every step:

1. Add `workspaces` to the root `package.json`; create `packages/core/` and move `src/` into it.
2. Split `tsconfig.json` into base + per-package. Run `npm run typecheck`.
3. Point `vitest.config.ts` at `projects` and fix the coverage globs. Run `npm run coverage`.
4. Verify the config loader from inside the package — the upward-walk test above covers the logic,
   but run something real from `packages/core/` and see it find the root config.
5. Only then add the second package. Adding two at once hides which step broke.

## What to watch for

- **Don't let each package grow its own `biome.json` / `tsconfig` / config file.** One root standard
  is the property that makes the gate mean one thing.
- **Don't add per-package lockfiles.** See `.gitignore` — the same drift argument as bun vs npm.
- **`.claude/rules/` and `CLAUDE.md` stay at the root.** If a package genuinely needs different
  conventions, use the `paths:` frontmatter in a rule file to scope it, rather than copying the rule.
