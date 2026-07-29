import { defineConfig } from 'vitest/config'

// The coverage floor the gate enforces. All four metrics share one number deliberately: a split
// floor (e.g. lines 85 / branches 60) is where coverage theatre hides — a suite can hit a high line
// number while leaving most decision paths unexercised. Raise this as the project matures; the
// ratchet only turns one way (see .claude/rules/broken-windows.md).
const COVERAGE_FLOOR_PERCENT = 85

export default defineConfig({
  // Resolves the `paths` aliases from tsconfig.json rather than restating them here — without it an
  // aliased import typechecks but fails to resolve at test time. This is Vite's NATIVE support; the
  // `vite-tsconfig-paths` plugin does the same job and is the answer most search results still give,
  // but it is redundant here and Vitest logs a notice telling you to remove it.
  resolve: { tsconfigPaths: true },
  test: {
    // Colocated (`src/**/*.test.ts`) and separate (`test/**`) layouts both work. Pick one per
    // project and delete the other glob rather than leaving both conventions live.
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',

      // `json-summary` is REQUIRED, not cosmetic: scripts/coverage-to-markdown.ts reads
      // coverage/coverage-summary.json to build COVERAGE.md. Dropping it breaks `npm run coverage`
      // and the coverage-main.yml workflow. `html` backs `npm run coverage:open`.
      reporter: ['text', 'html', 'json-summary'],

      // `include` measures every matching source file, NOT just the ones a test happened to import.
      // That distinction is the whole point: a module with zero tests must appear in the report at
      // 0% rather than being absent, which is the most common way a coverage floor gets silently
      // defeated. (Vitest ≤2 needed `all: true` for this; the option was removed in Vitest 3+ and is
      // a type error here — setting `include` is now sufficient. Verified by adding an untested
      // src/ file and watching the floor fail.)
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/types.ts'],

      thresholds: {
        lines: COVERAGE_FLOOR_PERCENT,
        branches: COVERAGE_FLOOR_PERCENT,
        functions: COVERAGE_FLOOR_PERCENT,
        statements: COVERAGE_FLOOR_PERCENT,
      },
    },
  },
})
