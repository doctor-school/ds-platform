import { publicRecordFormTitles } from "./host-tags.js";
import { assertOperationalReport } from "../api-probes/operational-report.js";

export const recordFormBackgrounds = [
  "storefront and shared design system",
  "closed Ministry book plus Other",
  "managed links and adjacency",
  "anonymous readable home",
  "no financing or commerce",
  "vendored composition and shell provenance",
] as const;

export function assertRecordFormsReport(value: unknown) {
  assertOperationalReport(value, publicRecordFormTitles, "doctor");
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
        (attachment) => attachment.name === "public-feed-entry",
      );
      if (
        attachments?.length !== 1 ||
        !attachments[0]!.body ||
        attachments[0]!.contentType !== "application/json"
      )
        throw new Error(
          "Record original needs its actual Background attachment",
        );
      const actual = JSON.parse(
        Buffer.from(attachments[0]!.body, "base64").toString("utf8"),
      );
      if (
        JSON.stringify(actual.backgrounds) !==
        JSON.stringify(recordFormBackgrounds)
      )
        throw new Error(
          "Record original did not complete all six distinct Background groups",
        );
    }
    suite.suites?.forEach(visit);
  }
  (value as { suites: Suite[] }).suites.forEach(visit);
}
