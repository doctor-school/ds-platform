interface TestResult {
  status: string;
  retry: number;
}
interface Test {
  status: string;
  results: TestResult[];
}
interface Suite {
  title?: string;
  specs?: { title: string; tests: Test[] }[];
  suites?: Suite[];
}

export function assertOperationalReport(
  value: unknown,
  expected: readonly string[],
) {
  const report = value as { suites?: Suite[]; errors?: unknown[] } | undefined;
  if (
    !report ||
    !Array.isArray(report.suites) ||
    !Array.isArray(report.errors) ||
    report.errors.length
  )
    throw new Error("Missing or failed operational-original report");
  const found: string[] = [];
  function visit(suite: Suite) {
    for (const spec of suite.specs ?? []) {
      found.push(spec.title.replace(/ @host:[a-z-]+$/, ""));
      if (
        spec.tests.length !== 1 ||
        spec.tests.some(
          (test) =>
            test.status !== "expected" ||
            test.results.length !== 1 ||
            test.results[0]!.status !== "passed" ||
            test.results[0]!.retry !== 0,
        )
      )
        throw new Error(
          `Original must pass once with no skip, flake or retry: ${spec.title}`,
        );
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  report.suites.forEach(visit);
  if (
    JSON.stringify([...found].sort()) !== JSON.stringify([...expected].sort())
  )
    throw new Error(
      `Operational original identity mismatch: ${JSON.stringify(found)}`,
    );
}

export const operationalOriginals = {
  api: [
    "Health endpoint reports ok on a running process",
    "Readiness endpoint reports ok when Postgres, pgvector and object storage all respond",
    "Readiness endpoint reports down when object storage refuses the credentials",
    "Readiness endpoint reports down when the pgvector extension is missing",
  ],
  audit: [
    "Deleting a row captures the full old row in the diff",
    "An update that changes nothing leaves no trail row",
    "A trail row cannot be rewritten or removed",
    "A direct SQL write with no audit context still leaves an honest trail row",
    "A new table cannot silently opt out of auditing",
  ],
} as const;
