/**
 * One-shot migration: npm + tsx  ->  Bun.
 *
 * Every step this performs is mechanical, which is why it can be a script at all. It rewires the
 * package.json scripts, drops tsx (Bun runs TypeScript natively), flips the committed lockfile,
 * updates the pre-commit hook, and swaps the CI workflows to setup-bun. What it does NOT do is
 * change the test runner: Vitest stays, because Bun's runner emits only text/lcov coverage and the
 * COVERAGE.md pipeline needs Vitest's json-summary. See docs/bun.md for the measurements.
 *
 *   node --import tsx scripts/migrate-to-bun.ts            # preview (default)
 *   node --import tsx scripts/migrate-to-bun.ts --write     # apply
 *
 * DRY-RUN BY DEFAULT, and it refuses to write to a dirty git tree. Both exist for the same reason:
 * a migration you cannot `git checkout .` out of is a migration you cannot safely try. Pass
 * --allow-dirty only if you have another way back.
 *
 * Delete this script once the migration has landed — it is adoption tooling, not part of the
 * project it produces.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = process.cwd()
const EXIT_FAILURE = 1

const BUN_MINIMUM_VERSION = '>=1.3'
const BUN_SETUP_ACTION = 'oven-sh/setup-bun@v2'

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

/** One planned change to one file. `transform` must be a pure function of the file's content. */
interface PlannedEdit {
  readonly relativePath: string
  readonly reason: string
  readonly transform: (content: string) => string
}

/** Files the migration deletes outright, with the reason shown in the preview. */
interface PlannedDeletion {
  readonly relativePath: string
  readonly reason: string
}

/**
 * Rewrite the package.json scripts, dependencies, and engines.
 *
 * Operates on the parsed object rather than by regex because these are structural edits — removing
 * a dependency key, replacing a runner prefix in every script value. A regex over the raw JSON
 * would also match the same strings inside comments or unrelated fields.
 */
function migratePackageJson(content: string): string {
  const packageJson = JSON.parse(content) as {
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
    engines?: Record<string, string>
  }

  if (packageJson.scripts !== undefined) {
    for (const [scriptName, command] of Object.entries(packageJson.scripts)) {
      // `node --import tsx <file>` becomes plain `bun <file>` — Bun needs no loader for TypeScript.
      packageJson.scripts[scriptName] = command.replaceAll('node --import tsx ', 'bun ')
    }
  }

  // tsx exists solely to give Node TypeScript execution and tsconfig path resolution. Bun has both
  // natively, so keeping tsx would leave an unused dependency — exactly what this blueprint removes.
  if (packageJson.devDependencies !== undefined) {
    delete packageJson.devDependencies.tsx
  }

  // `engines.node` no longer describes the requirement once the toolchain is Bun.
  packageJson.engines = { bun: BUN_MINIMUM_VERSION }

  return `${JSON.stringify(packageJson, null, 2)}\n`
}

/** Flip the lockfile block: commit bun's, ignore npm's. Exactly one lockfile stays committed. */
function migrateGitignore(content: string): string {
  const npmFirstBlock = `bun.lock
bun.lockb
pnpm-lock.yaml
yarn.lock`
  const bunFirstBlock = `package-lock.json
pnpm-lock.yaml
yarn.lock`
  return content
    .replace(
      'This blueprint is npm-first, so package-lock.json is COMMITTED',
      'This project is Bun-first, so bun.lock is COMMITTED',
    )
    .replace(npmFirstBlock, bunFirstBlock)
}

/** The pre-commit hook shells out to the package manager by name. */
function migratePreCommitHook(content: string): string {
  return content.replaceAll('npm run check:all', 'bun run check:all')
}

/**
 * Swap a GitHub Actions workflow from Node to Bun.
 *
 * The `setup-node` block carries a `node-version` line and a `cache: npm` line that `setup-bun`
 * does not accept, so both are removed rather than translated — passing an unknown input to an
 * action is a hard failure, not a warning.
 */
function migrateWorkflow(content: string): string {
  return content
    .replace(/ {6}- uses: actions\/setup-node@v4\n {8}with:\n(?: {10}.*\n)+/g, `      - uses: ${BUN_SETUP_ACTION}\n`)
    .replaceAll('run: npm ci', 'run: bun install --frozen-lockfile')
    .replaceAll('npm run ', 'bun run ')
    .replaceAll('node --import tsx ', 'bun ')
    .replaceAll('`npm run check:all`', '`bun run check:all`')
}

const PLANNED_EDITS: readonly PlannedEdit[] = [
  {
    relativePath: 'package.json',
    reason: 'scripts run through bun; tsx dropped; engines now bun',
    transform: migratePackageJson,
  },
  {
    relativePath: '.gitignore',
    reason: 'commit bun.lock, ignore package-lock.json',
    transform: migrateGitignore,
  },
  {
    relativePath: '.githooks/pre-commit',
    reason: 'hook invokes bun',
    transform: migratePreCommitHook,
  },
  {
    relativePath: '.github/workflows/ci.yml',
    reason: 'setup-bun, bun install --frozen-lockfile',
    transform: migrateWorkflow,
  },
  {
    relativePath: '.github/workflows/coverage-main.yml',
    reason: 'setup-bun, bun install, bun-run coverage script',
    transform: migrateWorkflow,
  },
]

const PLANNED_DELETIONS: readonly PlannedDeletion[] = [
  {
    relativePath: 'package-lock.json',
    reason: 'replaced by bun.lock — never commit two lockfiles for one package.json',
  },
]

/** True when the git tree has uncommitted changes, so a bad migration could not be reverted. */
function hasUncommittedChanges(): boolean {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString()
    return status.trim().length > 0
  } catch {
    // Not a git repository at all. Treat as dirty: without git there is no undo.
    return true
  }
}

function reportLine(symbol: string, color: string, message: string): void {
  process.stdout.write(`  ${color}${symbol}${RESET} ${message}\n`)
}

const shouldWrite = process.argv.includes('--write')
const allowDirtyTree = process.argv.includes('--allow-dirty')

process.stdout.write(`\n${BOLD}Migrate to Bun${RESET} ${DIM}— ${shouldWrite ? 'APPLYING' : 'preview only'}${RESET}\n\n`)

if (shouldWrite && !allowDirtyTree && hasUncommittedChanges()) {
  process.stderr.write(
    `${RED}Refusing to write: the git tree has uncommitted changes.${RESET}\n` +
      `Commit or stash first so this migration can be reverted with \`git checkout .\`.\n` +
      `Override with --allow-dirty if you have another way back.\n`,
  )
  process.exit(EXIT_FAILURE)
}

let changedFileCount = 0
let missingFileCount = 0

for (const edit of PLANNED_EDITS) {
  const absolutePath = resolve(REPO_ROOT, edit.relativePath)
  if (!existsSync(absolutePath)) {
    reportLine('?', YELLOW, `${edit.relativePath} ${DIM}— not found, skipped${RESET}`)
    missingFileCount += 1
    continue
  }
  const originalContent = readFileSync(absolutePath, 'utf8')
  const migratedContent = edit.transform(originalContent)
  if (migratedContent === originalContent) {
    reportLine('=', DIM, `${edit.relativePath} ${DIM}— already migrated${RESET}`)
    continue
  }
  changedFileCount += 1
  reportLine('~', GREEN, `${edit.relativePath} ${DIM}— ${edit.reason}${RESET}`)
  if (shouldWrite) {
    writeFileSync(absolutePath, migratedContent)
  }
}

for (const deletion of PLANNED_DELETIONS) {
  const absolutePath = resolve(REPO_ROOT, deletion.relativePath)
  if (!existsSync(absolutePath)) {
    reportLine('=', DIM, `${deletion.relativePath} ${DIM}— already absent${RESET}`)
    continue
  }
  changedFileCount += 1
  reportLine('-', GREEN, `${deletion.relativePath} ${DIM}— ${deletion.reason}${RESET}`)
  if (shouldWrite) {
    rmSync(absolutePath)
  }
}

process.stdout.write(`\n${changedFileCount} file(s) ${shouldWrite ? 'changed' : 'would change'}`)
process.stdout.write(missingFileCount > 0 ? `, ${missingFileCount} skipped\n` : '\n')

if (shouldWrite) {
  process.stdout.write(
    `\n${BOLD}Next:${RESET}\n` +
      `  1. rm -rf node_modules && bun install\n` +
      `  2. bun run check:all        ${DIM}# must be green${RESET}\n` +
      `  3. bun run coverage         ${DIM}# Vitest still produces COVERAGE.md${RESET}\n` +
      `  4. Commit bun.lock; confirm package-lock.json is gone.\n` +
      `  5. Delete this script and scripts/scaffold-monorepo.ts — adoption tooling, not project code.\n`,
  )
} else {
  process.stdout.write(`\n${DIM}Re-run with --write to apply.${RESET}\n`)
}
