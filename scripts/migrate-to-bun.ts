/**
 * Convert an EXISTING npm + tsx project to Bun, in place.
 *
 * If you are starting a new project, use `scripts/create-project.ts --package-manager bun` instead —
 * generating with the right package manager beats generating with npm and then undoing it. This
 * script exists for the other case: a project already adopted from the blueprint that wants to
 * switch later.
 *
 *   node --import tsx scripts/migrate-to-bun.ts            # preview (default)
 *   node --import tsx scripts/migrate-to-bun.ts --write    # apply
 *
 * DRY-RUN BY DEFAULT, and it refuses to write to a dirty git tree. Both exist for the same reason:
 * a migration you cannot `git checkout .` out of is one you cannot safely try. Pass --allow-dirty
 * only if you have another way back.
 *
 * It does NOT change the test runner. Vitest stays, because Bun's runner emits only text/lcov
 * coverage while the COVERAGE.md pipeline needs Vitest's json-summary — see docs/bun.md for the
 * measurements behind that call.
 *
 * The transforms live in lib/bun-migration.ts, shared with the generator so the two cannot drift.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BUN_MIGRATION_DELETIONS, BUN_MIGRATION_STEPS } from './lib/bun-migration.js'

const REPO_ROOT = process.cwd()
const EXIT_FAILURE = 1

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

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

for (const step of BUN_MIGRATION_STEPS) {
  const absolutePath = resolve(REPO_ROOT, step.relativePath)
  if (!existsSync(absolutePath)) {
    reportLine('?', YELLOW, `${step.relativePath} ${DIM}— not found, skipped${RESET}`)
    missingFileCount += 1
    continue
  }
  const originalContent = readFileSync(absolutePath, 'utf8')
  const migratedContent = step.transform(originalContent)
  // The transforms are idempotent, so an unchanged result means this file is already on Bun.
  if (migratedContent === originalContent) {
    reportLine('=', DIM, `${step.relativePath} ${DIM}— already migrated${RESET}`)
    continue
  }
  changedFileCount += 1
  reportLine('~', GREEN, `${step.relativePath} ${DIM}— ${step.reason}${RESET}`)
  if (shouldWrite) {
    writeFileSync(absolutePath, migratedContent)
  }
}

for (const deletion of BUN_MIGRATION_DELETIONS) {
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
      `  5. Delete this script — adoption tooling, not project code.\n`,
  )
} else {
  process.stdout.write(`\n${DIM}Re-run with --write to apply.${RESET}\n`)
}
