import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts', 'src/**/*.spec.ts'],
    globals: false,
    globalSetup: ['./test/setup/migrate.ts'],
    // The e2e suites boot DatabaseModule and write/read/delete rows against a
    // single shared Postgres (the dev-stand locally, the `api-e2e` service
    // container on CI). Running files in parallel processes contends on that one
    // database (transaction locks, pool pressure) and makes write-heavy suites
    // like auth (003 F1) flaky even with per-test-unique identifiers. Serialize
    // file execution — the suites are small and fast — so the shared DB sees one
    // file at a time. Pure-unit `*.spec.ts` are unaffected by the slowdown.
    fileParallelism: false,
  },
});
