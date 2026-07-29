/**
 * Pure text transforms that convert an npm + tsx project to Bun.
 *
 * NO I/O here — every export is a pure `string -> string`. Two callers share them:
 *   • scripts/create-project.ts   generating a new Bun project from the blueprint
 *   • scripts/migrate-to-bun.ts   converting an existing project in place
 *
 * Keeping them pure is what lets the same logic serve both without either one importing the
 * other's file-walking or CLI behaviour. Every transform must also be IDEMPOTENT: running it twice
 * produces the same result as running it once, so a half-finished migration can be re-run safely.
 */

/** Minimum Bun version recorded in the generated `engines` field. */
export const BUN_MINIMUM_VERSION = '>=1.3'

/** The GitHub Action that replaces `actions/setup-node`. */
export const BUN_SETUP_ACTION = 'oven-sh/setup-bun@v2'

/** The subset of package.json this module touches. */
interface PackageJsonShape {
  scripts?: Record<string, string>
  devDependencies?: Record<string, string>
  engines?: Record<string, string>
}

/**
 * Rewrite package.json scripts, drop tsx, and repoint `engines` at Bun.
 *
 * Parses rather than regexes: removing a dependency key and rewriting every script value are
 * structural edits, and a regex over raw JSON would also match the same substrings in unrelated
 * fields.
 */
export function migratePackageJsonToBun(content: string): string {
  const packageJson = JSON.parse(content) as PackageJsonShape

  if (packageJson.scripts !== undefined) {
    for (const [scriptName, command] of Object.entries(packageJson.scripts)) {
      // `node --import tsx <file>` becomes plain `bun <file>` — Bun needs no loader for TypeScript.
      packageJson.scripts[scriptName] = command.replaceAll('node --import tsx ', 'bun ')
    }
  }

  // tsx exists solely to give Node TypeScript execution and tsconfig path resolution. Bun has both
  // natively, so keeping it would leave an unused dependency — exactly what this blueprint removes.
  if (packageJson.devDependencies !== undefined) {
    delete packageJson.devDependencies.tsx
  }

  // `engines.node` no longer describes the requirement once the toolchain is Bun.
  packageJson.engines = { bun: BUN_MINIMUM_VERSION }

  return `${JSON.stringify(packageJson, null, 2)}\n`
}

/**
 * Flip the lockfile block so Bun's lockfile is the committed one.
 *
 * Exactly one lockfile stays committed. Two lockfiles for one package.json resolve independently
 * and drift silently, which is the failure the original .gitignore comment describes.
 */
export function migrateGitignoreToBun(content: string): string {
  const npmFirstIgnoreBlock = 'bun.lock\nbun.lockb\npnpm-lock.yaml\nyarn.lock'
  const bunFirstIgnoreBlock = 'package-lock.json\npnpm-lock.yaml\nyarn.lock'
  return content
    .replace(
      'This blueprint is npm-first, so package-lock.json is COMMITTED',
      'This project is Bun-first, so bun.lock is COMMITTED',
    )
    .replace(npmFirstIgnoreBlock, bunFirstIgnoreBlock)
}

/** The pre-commit hook shells out to the package manager by name. */
export function migratePreCommitHookToBun(content: string): string {
  return content.replaceAll('npm run check:all', 'bun run check:all')
}

/**
 * Swap a GitHub Actions workflow from Node to Bun.
 *
 * The `setup-node` block carries `node-version` and `cache` inputs that `setup-bun` does not
 * accept, so the whole `with:` block is dropped rather than translated — passing an unknown input
 * to an action is a hard failure, not a warning.
 */
export function migrateWorkflowToBun(content: string): string {
  return content
    .replace(/ {6}- uses: actions\/setup-node@v4\n {8}with:\n(?: {10}.*\n)+/g, `      - uses: ${BUN_SETUP_ACTION}\n`)
    .replaceAll('run: npm ci', 'run: bun install --frozen-lockfile')
    .replaceAll('npm run ', 'bun run ')
    .replaceAll('node --import tsx ', 'bun ')
}

/** One file the Bun migration rewrites: where it lives, why, and how. */
export interface BunMigrationStep {
  readonly relativePath: string
  readonly reason: string
  readonly transform: (content: string) => string
}

/** Every file the Bun migration touches, in the order it reports them. */
export const BUN_MIGRATION_STEPS: readonly BunMigrationStep[] = [
  {
    relativePath: 'package.json',
    reason: 'scripts run through bun; tsx dropped; engines now bun',
    transform: migratePackageJsonToBun,
  },
  {
    relativePath: '.gitignore',
    reason: 'commit bun.lock, ignore package-lock.json',
    transform: migrateGitignoreToBun,
  },
  {
    relativePath: '.githooks/pre-commit',
    reason: 'hook invokes bun',
    transform: migratePreCommitHookToBun,
  },
  {
    relativePath: '.github/workflows/ci.yml',
    reason: 'setup-bun, bun install --frozen-lockfile',
    transform: migrateWorkflowToBun,
  },
  {
    relativePath: '.github/workflows/coverage-main.yml',
    reason: 'setup-bun, bun install, bun-run coverage script',
    transform: migrateWorkflowToBun,
  },
]

/** Files that are deleted rather than rewritten, because Bun supplies its own replacement. */
export const BUN_MIGRATION_DELETIONS: readonly { relativePath: string; reason: string }[] = [
  {
    relativePath: 'package-lock.json',
    reason: 'replaced by bun.lock — never commit two lockfiles for one package.json',
  },
]
