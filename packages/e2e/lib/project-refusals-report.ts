import { publicProjectRefusalTitles } from "./host-tags.js";
import { assertOperationalReport } from "../api-probes/operational-report.js";

export const projectRefusalBackgrounds = [
  "active output kinds",
  "Фарма Плюс — Инвестор",
  "ЦИТО — Клиническая площадка",
] as const;

export function assertProjectRefusalsReport(value: unknown) {
  assertOperationalReport(value, publicProjectRefusalTitles, "academy");
  type Suite = {
    specs?: {
      tests: {
        results: {
          attachments?: { name: string; body?: string; contentType?: string }[];
        }[];
      }[];
    }[];
    suites?: Suite[];
  };
  function visit(suite: Suite) {
    for (const spec of suite.specs ?? []) {
      const attachments = spec.tests[0]!.results[0]!.attachments?.filter(
        (a) => a.name === "project-refusals",
      );
      if (
        attachments?.length !== 1 ||
        !attachments[0]!.body ||
        attachments[0]!.contentType !== "application/json"
      )
        throw new Error("030 requires its actual Background attachment");
      const actual = JSON.parse(
        Buffer.from(attachments[0]!.body, "base64").toString("utf8"),
      );
      const groups = actual.backgrounds as { group: string; ids: string[] }[];
      if (
        !Array.isArray(groups) ||
        JSON.stringify(groups.map((g) => g.group)) !==
          JSON.stringify(projectRefusalBackgrounds) ||
        groups.some(
          (g, i) =>
            !Array.isArray(g.ids) ||
            g.ids.length !== (i === 0 ? 4 : 2) ||
            g.ids.some((id) => typeof id !== "string" || !id) ||
            new Set(g.ids).size !== g.ids.length,
        )
      )
        throw new Error(
          "030 did not complete all three distinct Background groups with persisted identities",
        );
    }
    suite.suites?.forEach(visit);
  }
  (value as { suites: Suite[] }).suites.forEach(visit);
}
