import { publicReadonlyOriginals } from "./host-tags.js";
import { assertOperationalReport } from "../api-probes/operational-report.js";

export function assertPublicReadonlyReport(value: unknown) {
  assertOperationalReport(
    value,
    publicReadonlyOriginals.map(({ title }) => title),
  );
  type Suite = {
    specs?: {
      title: string;
      tests: { projectName?: string; projectId?: string }[];
    }[];
    suites?: Suite[];
  };
  const hosts = new Map<string, string>(
    publicReadonlyOriginals.map(({ title, host }) => [title, host]),
  );
  function visit(suite: Suite) {
    for (const spec of suite.specs ?? []) {
      const host = hosts.get(spec.title.replace(/ @host:[a-z-]+$/, ""));
      if (
        !host ||
        spec.tests.some(
          (test) => test.projectName !== host || test.projectId !== host,
        )
      )
        throw new Error(
          `Read-only original has the wrong canonical host: ${spec.title}`,
        );
    }
    suite.suites?.forEach(visit);
  }
  (value as { suites: Suite[] }).suites.forEach(visit);
}
