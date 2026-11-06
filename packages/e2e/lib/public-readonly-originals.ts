import type { StorefrontHostId } from "./host-tags.js";
import { assertOperationalReport } from "../api-probes/operational-report.js";

export const publicReadonlyOriginals = [
  {
    host: "academy",
    title: "A mixed week list groups each event under the day it shows",
  },
  { host: "doctor", title: "The feed carries no Academy crossing of its own" },
  {
    host: "doctor",
    title: "The closed Минздрав book is visible but never editable",
  },
] as const;

function patternFor(titles: readonly string[]) {
  const escaped = titles.map((title) =>
    title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`(?:^|\\s)(?:${escaped.join("|")})(?: @[^ ]+)*$`);
}

export const publicReadonlyPattern = patternFor(
  publicReadonlyOriginals.map(({ title }) => title),
);

export function publicReadonlyPatternFor(host: StorefrontHostId) {
  return patternFor(
    publicReadonlyOriginals
      .filter((item) => item.host === host)
      .map(({ title }) => title),
  );
}

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
