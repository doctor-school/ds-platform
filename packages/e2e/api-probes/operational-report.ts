interface TestResult {
  status: string;
  retry: number;
}
interface Test {
  status: string;
  projectName?: string;
  projectId?: string;
  results: TestResult[];
}
interface Suite {
  title?: string;
  specs?: { title: string; tests: Test[] }[];
  suites?: Suite[];
}

export interface OperationalCase {
  title: string;
  suitePath: readonly string[];
}

export function assertOperationalReport(
  value: unknown,
  expected: readonly (string | OperationalCase)[],
  expectedProject?: string,
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
  const strict = expected.some((item) => typeof item !== "string");
  const key = (item: string | OperationalCase) =>
    typeof item === "string"
      ? item
      : JSON.stringify([...item.suitePath, item.title]);
  function visit(suite: Suite, parents: string[] = []) {
    const path = suite.title
      ? [...parents, suite.title.replaceAll("\\", "/")]
      : parents;
    for (const spec of suite.specs ?? []) {
      const title = spec.title.replace(
        expectedProject
          ? new RegExp(` @host:${expectedProject}$`)
          : / @host:[a-z-]+$/,
        "",
      );
      found.push(strict ? JSON.stringify([...path, title]) : title);
      if (
        expectedProject &&
        spec.tests.some(
          (test) =>
            test.projectName !== expectedProject ||
            test.projectId !== expectedProject,
        )
      )
        throw new Error(
          `Original must belong to ${expectedProject} project: ${spec.title}`,
        );
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
    for (const child of suite.suites ?? []) visit(child, path);
  }
  report.suites.forEach((suite) => visit(suite));
  if (
    JSON.stringify([...found].sort()) !==
    JSON.stringify(expected.map(key).sort())
  )
    throw new Error(
      `Operational original identity mismatch: ${JSON.stringify(found)}`,
    );
}

export const operationalOriginals = {
  feedEntry: [
    "A choice opens the chosen specialty's feed",
    "«Моя лента» opens the remembered specialty's feed",
    "«Моя лента» with nothing chosen opens the home specialty catalog, never an empty feed",
  ],
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
  materials: [
    "A material without a body cannot be published",
    "A column without an expert is refused",
    "Pasted images and tables are stripped by the editor",
    "The administrator previews an unsaved material",
    "A stale edit is refused",
    "The administrator finds materials by kind",
  ],
} as const;
