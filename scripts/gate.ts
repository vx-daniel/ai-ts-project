#!/usr/bin/env node
/**
 * The single repo-wide gate. One ordered list of checks; `check:all` delegates
 * here, and both the pre-commit hook and CI invoke `check:all` — so one list is
 * the single source of what "green" means everywhere. Add a check here and every
 * caller inherits it.
 *
 * Ordering is cheap-first: a fast Biome failure surfaces before the slower
 * typecheck and test gates run.
 *
 * The checks:
 *   1. biome     — lint + format + import-organize (check-only, no writes). This
 *                  also enforces the discipline rules Biome can express, e.g.
 *                  `noTsIgnore` is set to error in biome.json, so a banned
 *                  suppression directive fails the gate rather than merely warning.
 *   2. typecheck — `tsc --noEmit` over the package.
 *   3. test      — `vitest run`.
 *
 * ADDING A GATE. This is the extension point a project adopting the blueprint is
 * expected to use: append an entry to GATES and every caller (the pre-commit hook,
 * CI, a developer running `npm run check:all`) inherits it with no other edit. Put
 * expensive behavioural checks LAST so the cheap ones fail fast — e.g. a build, an
 * IaC synth, a container smoke test, a schema-compatibility check.
 *
 * Runtime is node — `check:all` runs `node scripts/gate.ts`, and Node strips the
 * TypeScript types at load. Each gate shells out through `npm run <script>`, so a
 * command's definition lives in exactly one place: package.json.
 */
import { spawnSync } from 'node:child_process'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

/** One child-process gate: a display name, a one-line description, and its argv. */
interface Gate {
  readonly name: string
  readonly describe: string
  /** argv — `command[0]` is the binary, the rest are its arguments. */
  readonly command: readonly string[]
}

const GATES: readonly Gate[] = [
  {
    name: 'biome',
    describe: 'lint + format + import-organize (check-only)',
    command: ['npm', 'run', 'lint'],
  },
  {
    name: 'typecheck',
    describe: 'tsc --noEmit',
    command: ['npm', 'run', 'typecheck'],
  },
  {
    name: 'test',
    describe: 'vitest run',
    command: ['npm', 'run', 'test'],
  },
]

/**
 * Runs one gate to completion, inheriting stdio so the underlying tool's colored
 * output and progress reach the terminal unchanged. Returns the child's exit code
 * (non-zero = failure); a child killed by a signal (status null) counts as failure.
 */
function runGate(gate: Gate): number {
  process.stdout.write(`\n${BOLD}▶ ${gate.name}${RESET} ${DIM}— ${gate.describe}${RESET}\n`)
  const [binary, ...args] = gate.command
  const result = spawnSync(binary, args, { stdio: 'inherit' })
  if (result.error) {
    process.stderr.write(`${RED}gate "${gate.name}" failed to spawn: ${result.error.message}${RESET}\n`)
    return 1
  }
  return result.status ?? 1
}

let failedGate: string | null = null
for (const gate of GATES) {
  if (runGate(gate) !== 0) {
    failedGate = gate.name
    break
  }
}

if (failedGate) {
  process.stdout.write(`\n${RED}✗ gate "${failedGate}" failed.${RESET}\n`)
  process.exit(1)
}

process.stdout.write(`\n${GREEN}✓ All gates passed.${RESET}\n`)
