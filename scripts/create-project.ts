/**
 * Generate a new project from this blueprint.
 *
 * This is the PRIMARY adoption path, and it is better than copying the repo and then undoing its
 * defaults: the choices (package manager, repo layout, name) are made once, up front, and the
 * output contains no adoption tooling to clean up afterwards. It also performs the identity steps
 * from README's checklist — rename, fresh CLAUDE.md and README, reset coverage — which are the ones
 * most often skipped, and whose omission leaves an agent reading instructions for a different repo.
 *
 *   node --import tsx scripts/create-project.ts ../my-service
 *   node --import tsx scripts/create-project.ts ../my-service --package-manager bun
 *   node --import tsx scripts/create-project.ts ../my-platform --layout monorepo --package core
 *
 * Options:
 *   --name <name>                 package name (default: the target directory's basename)
 *   --package-manager npm|bun     default npm
 *   --layout single|monorepo      default single
 *   --package <name>              first workspace package (monorepo only, default: core)
 *
 * The blueprint itself is the single source of truth: this copies the working tree and applies
 * transforms, rather than holding its own template. A template would be a second copy to keep in
 * sync, and it would drift — the failure this whole repo is organised against.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { BUN_MIGRATION_DELETIONS, BUN_MIGRATION_STEPS } from './lib/bun-migration.js'

const BLUEPRINT_ROOT = process.cwd()
const EXIT_FAILURE = 1

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const PACKAGE_MANAGERS = ['npm', 'bun'] as const
type PackageManager = (typeof PACKAGE_MANAGERS)[number]

const LAYOUTS = ['single', 'monorepo'] as const
type Layout = (typeof LAYOUTS)[number]

const DEFAULT_WORKSPACE_PACKAGE = 'core'

/**
 * Paths never copied into a generated project.
 *
 * Three categories: machine state (`node_modules`, `.git`), generated artifacts the new project
 * should produce itself (`coverage`, `COVERAGE.md`), and the blueprint's own meta-content — the
 * adoption docs and generator scripts, which describe how to create a project and are noise inside
 * one. Local secrets and overrides are excluded too; they are gitignored here and must never travel.
 */
const EXCLUDED_FROM_COPY: readonly string[] = [
  'node_modules',
  '.git',
  'coverage',
  'COVERAGE.md',
  'docs',
  '.env',
  'config.local.toml',
  'scripts/create-project.ts',
  'scripts/migrate-to-bun.ts',
  'scripts/lib',
]

interface GeneratorOptions {
  readonly targetDirectory: string
  readonly projectName: string
  readonly packageManager: PackageManager
  readonly layout: Layout
  readonly workspacePackage: string
}

/** Read a `--flag value` pair from argv, or undefined when the flag is absent. */
function readFlagValue(flagName: string): string | undefined {
  const flagIndex = process.argv.indexOf(`--${flagName}`)
  if (flagIndex === -1) {
    return undefined
  }
  return process.argv[flagIndex + 1]
}

function failWith(message: string): never {
  process.stderr.write(`${RED}${message}${RESET}\n`)
  process.exit(EXIT_FAILURE)
}

function parseOptions(): GeneratorOptions {
  const positionalTarget = process.argv[2]
  if (positionalTarget === undefined || positionalTarget.startsWith('--')) {
    failWith(
      'Usage: create-project.ts <target-directory> [--name x] [--package-manager npm|bun] [--layout single|monorepo]',
    )
  }
  const targetDirectory = resolve(BLUEPRINT_ROOT, positionalTarget)

  const packageManager = (readFlagValue('package-manager') ?? 'npm') as PackageManager
  if (!PACKAGE_MANAGERS.includes(packageManager)) {
    failWith(`Unknown --package-manager "${packageManager}" (expected: ${PACKAGE_MANAGERS.join(', ')})`)
  }

  const layout = (readFlagValue('layout') ?? 'single') as Layout
  if (!LAYOUTS.includes(layout)) {
    failWith(`Unknown --layout "${layout}" (expected: ${LAYOUTS.join(', ')})`)
  }

  return {
    targetDirectory,
    projectName: readFlagValue('name') ?? basename(targetDirectory),
    packageManager,
    layout,
    workspacePackage: readFlagValue('package') ?? DEFAULT_WORKSPACE_PACKAGE,
  }
}

/** Copy the blueprint tree, minus everything in {@link EXCLUDED_FROM_COPY}. */
function copyBlueprint(targetDirectory: string): void {
  const excludedAbsolutePaths = new Set(EXCLUDED_FROM_COPY.map((path) => resolve(BLUEPRINT_ROOT, path)))
  cpSync(BLUEPRINT_ROOT, targetDirectory, {
    recursive: true,
    filter: (source) => !excludedAbsolutePaths.has(source),
  })
}

function readTargetFile(options: GeneratorOptions, relativePath: string): string {
  return readFileSync(resolve(options.targetDirectory, relativePath), 'utf8')
}

function writeTargetFile(options: GeneratorOptions, relativePath: string, content: string): void {
  writeFileSync(resolve(options.targetDirectory, relativePath), content)
}

/** Set the generated project's identity and reset its version to a pre-release starting point. */
function applyProjectIdentity(options: GeneratorOptions): void {
  const packageJson = JSON.parse(readTargetFile(options, 'package.json')) as Record<string, unknown>
  packageJson.name = options.projectName
  packageJson.description = `${options.projectName} — generated from the TypeScript project blueprint.`
  packageJson.version = '0.1.0'
  if (options.layout === 'monorepo') {
    packageJson.workspaces = ['packages/*']
  }
  writeTargetFile(options, 'package.json', `${JSON.stringify(packageJson, null, 2)}\n`)
}

/**
 * Replace the blueprint's own README and CLAUDE.md with project-shaped starters.
 *
 * This is the step that matters most and is skipped most often. A CLAUDE.md that still says "this
 * repo is a blueprint" is not merely untidy — agents act on it, and will describe the project's
 * purpose wrongly to every future session.
 */
function writeProjectDocuments(options: GeneratorOptions): void {
  const runCommand = options.packageManager === 'bun' ? 'bun run' : 'npm run'
  const installCommand = options.packageManager === 'bun' ? 'bun install' : 'npm install'

  writeTargetFile(
    options,
    'README.md',
    `# ${options.projectName}

> Generated from the TypeScript project blueprint. Replace this description with what the project
> actually does.

## Quick start

\`\`\`bash
${installCommand}
${runCommand} check:all
\`\`\`

## Commands

| Command | Purpose |
|---|---|
| \`${runCommand} check:all\` | The gate: Biome → tsc → Vitest. Run before declaring any change done. |
| \`${runCommand} lint\` / \`lint:fix\` | Biome check / autofix. |
| \`${runCommand} typecheck\` | \`tsc --noEmit\`. |
| \`${options.packageManager === 'bun' ? 'bun run test' : 'npm test'}\` | Vitest. |
| \`${runCommand} coverage\` | Coverage + regenerate \`COVERAGE.md\`. Enforces the 85% floor. |

## Configuration

Three layers: \`config.defaults.toml\` (committed, safe), \`config.local.toml\` (gitignored,
machine-specific), \`.env\` (gitignored, **secrets only**, referenced by variable name). The first
two are deep-merged key by key and validated by \`src/config/config-schema.ts\`.

Copy \`.env.example\` to \`.env\` and fill it in. The example config in \`config.defaults.toml\`
demonstrates the available patterns — replace it with your own, editing the schema to match.

## Conventions

See \`CLAUDE.md\` and \`.claude/rules/\`.
`,
  )

  writeTargetFile(
    options,
    'CLAUDE.md',
    `# CLAUDE.md — ${options.projectName}

> Generated from the TypeScript project blueprint. **Replace the "What this is" section below with
> a real description before relying on this file** — agents act on it.

## What this is

<!-- Describe the project: what it does, who uses it, what the important invariants are. -->

## Toolchain

- Package manager / runtime: **${options.packageManager}**${options.packageManager === 'bun' ? ' (runs `.ts` and resolves tsconfig `paths` natively)' : ' (Node 24+, `.ts` run through tsx)'}
- **TypeScript 7**, \`strict: true\`, typecheck-only (\`noEmit\`).
- **ESM** (\`moduleResolution: NodeNext\`): imports must carry a \`.js\` extension, which resolves
  to the \`.ts\` source.
- **Path aliases**: \`@/*\` → \`src/*\`. \`tsconfig.json\`'s \`paths\` is the single source of truth.
- **Vitest** for tests, **Biome** for lint/format, **Zod 4** for boundary validation.
${options.layout === 'monorepo' ? `- **Monorepo**: workspace packages live under \`packages/\`. One lockfile and one set of devDependencies at the root.\n` : ''}
## Verification (run before declaring a change done)

\`\`\`bash
${runCommand} check:all   # THE gate: Biome → tsc --noEmit → Vitest (cheap-first)
${runCommand} coverage    # v8 coverage + regenerates COVERAGE.md; 85% floor enforced
\`\`\`

\`${runCommand} check:all\` is the single source of "green" — the pre-commit hook and CI both call
it. A passing gate is necessary but **not sufficient**: it proves the code compiles and the tests
pass, not that the behaviour is right. Run the affected path and look at the output.

To add a check (a build, a container smoke test), append one entry to \`GATES\` in
\`scripts/gate.ts\`. Every caller inherits it.

## Configuration

Three layers — \`config.defaults.toml\` (committed), \`config.local.toml\` (gitignored), \`.env\`
(gitignored, secrets only). Secrets are referenced BY NAME via \`apiKeyEnv\` and read at point of
use, never stored on the config object. Use \`getConfig()\`, never a module-level \`const\`.

## Conventions

See [\`.claude/rules/\`](.claude/rules/). Short version: verbose names (mechanically gated), comments
carry WHY, plain over clever, options objects at 3+ parameters, Zod at trust boundaries with the
type inferred, no magic values, no TODO/FIXME, no test weakening.

**Re-fit the rules' worked examples to this project's real modules.** They ship as generic
placeholders, and a rule citing a file that does not exist actively misleads.
`,
  )
}

/** Apply the Bun transforms to the generated tree. */
function applyBunPackageManager(options: GeneratorOptions): void {
  for (const step of BUN_MIGRATION_STEPS) {
    const absolutePath = resolve(options.targetDirectory, step.relativePath)
    if (!existsSync(absolutePath)) {
      continue
    }
    writeFileSync(absolutePath, step.transform(readFileSync(absolutePath, 'utf8')))
  }
  for (const deletion of BUN_MIGRATION_DELETIONS) {
    const absolutePath = resolve(options.targetDirectory, deletion.relativePath)
    if (existsSync(absolutePath)) {
      rmSync(absolutePath, { recursive: true })
    }
  }
}

/**
 * Move `src/` into `packages/<name>/` and add the tsconfig split.
 *
 * SCAFFOLD ONLY — see docs/monorepo.md. This produces a workspace containing exactly one package.
 * Deciding what belongs in a *second* package is a design judgement no script can make, and the
 * blueprint's advice is to add the second package deliberately, after the first one is green.
 */
function applyMonorepoLayout(options: GeneratorOptions): void {
  const packageDirectory = resolve(options.targetDirectory, 'packages', options.workspacePackage)
  mkdirSync(packageDirectory, { recursive: true })

  const sourceDirectory = resolve(options.targetDirectory, 'src')
  if (existsSync(sourceDirectory)) {
    cpSync(sourceDirectory, resolve(packageDirectory, 'src'), { recursive: true })
    rmSync(sourceDirectory, { recursive: true })
  }

  writeFileSync(
    resolve(packageDirectory, 'package.json'),
    `${JSON.stringify(
      { name: `@${options.projectName}/${options.workspacePackage}`, version: '0.1.0', private: true, type: 'module' },
      null,
      2,
    )}\n`,
  )

  // Per-package tsconfig extends the root. The root keeps `paths`, so the alias story is unchanged
  // for imports WITHIN a package; cross-package imports should use the package name instead.
  writeFileSync(
    resolve(packageDirectory, 'tsconfig.json'),
    `${JSON.stringify({ extends: '../../tsconfig.json', include: ['src'] }, null, 2)}\n`,
  )

  // Root tsconfig: aliases and includes now point through packages/.
  const rootTsconfig = readTargetFile(options, 'tsconfig.json')
    .replace('"@/*": ["./src/*"]', `"@/*": ["./packages/${options.workspacePackage}/src/*"]`)
    .replace(
      '"include": ["src", "test", "scripts", "vitest.config.ts"]',
      '"include": ["packages/*/src", "scripts", "vitest.config.ts"]',
    )
  writeTargetFile(options, 'tsconfig.json', rootTsconfig)

  // Vitest test discovery and coverage globs follow the packages layout.
  const vitestConfig = readTargetFile(options, 'vitest.config.ts')
    .replace("include: ['src/**/*.test.ts', 'test/**/*.test.ts']", "include: ['packages/*/src/**/*.test.ts']")
    .replace("include: ['src/**/*.ts']", "include: ['packages/*/src/**/*.ts']")
    .replace(
      "exclude: ['src/**/*.test.ts', 'src/**/types.ts']",
      "exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/types.ts']",
    )
  writeTargetFile(options, 'vitest.config.ts', vitestConfig)
}

const options = parseOptions()

if (existsSync(options.targetDirectory) && readdirSync(options.targetDirectory).length > 0) {
  failWith(`Refusing to generate into a non-empty directory: ${options.targetDirectory}`)
}

process.stdout.write(`\n${BOLD}Creating ${options.projectName}${RESET} ${DIM}at ${options.targetDirectory}${RESET}\n\n`)

copyBlueprint(options.targetDirectory)
process.stdout.write(
  `  ${GREEN}+${RESET} copied blueprint ${DIM}(excluding node_modules, .git, coverage, docs, generator scripts)${RESET}\n`,
)

applyProjectIdentity(options)
process.stdout.write(
  `  ${GREEN}~${RESET} package.json ${DIM}— name "${options.projectName}"${options.layout === 'monorepo' ? ', workspaces enabled' : ''}${RESET}\n`,
)

writeProjectDocuments(options)
process.stdout.write(
  `  ${GREEN}~${RESET} README.md + CLAUDE.md ${DIM}— project-shaped, blueprint framing removed${RESET}\n`,
)

if (options.packageManager === 'bun') {
  applyBunPackageManager(options)
  process.stdout.write(
    `  ${GREEN}~${RESET} package manager ${DIM}— bun (tsx dropped, CI on setup-bun, bun.lock committed)${RESET}\n`,
  )
}

if (options.layout === 'monorepo') {
  applyMonorepoLayout(options)
  process.stdout.write(
    `  ${GREEN}~${RESET} layout ${DIM}— monorepo, src moved to packages/${options.workspacePackage}/src${RESET}\n`,
  )
}

const installCommand = options.packageManager === 'bun' ? 'bun install' : 'npm install'
const runCommand = options.packageManager === 'bun' ? 'bun run' : 'npm run'

process.stdout.write(
  `\n${BOLD}Next:${RESET}\n` +
    `  cd ${options.targetDirectory}\n` +
    `  git init && ${installCommand}\n` +
    `  ${runCommand} check:all      ${DIM}# must be green before you write anything${RESET}\n\n` +
    `${DIM}Then: describe the project in CLAUDE.md, replace the example config in\n` +
    `config.defaults.toml + src/config/, and re-fit .claude/rules/ examples to your code.${RESET}\n`,
)
