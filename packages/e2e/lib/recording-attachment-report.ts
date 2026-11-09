import { assertOperationalReport } from "../api-probes/operational-report.js";

export const recordingAttachmentTitles = [
  "Example #1",
  "Example #2",
  "A second recording of the same kind is refused, not silently accepted",
  "Retiring a recording frees its kind slot without losing history",
] as const;

export function assertRecordingAttachmentReport(value: unknown) {
  assertOperationalReport(
    value,
    recordingAttachmentTitles,
    "recording-attachment",
  );
  type Suite = {
    title?: string;
    specs?: {
      title: string;
      tests: {
        results: {
          attachments?: { name: string; contentType: string; body?: string }[];
        }[];
      }[];
    }[];
    suites?: Suite[];
  };
  function visit(suite: Suite) {
    for (const spec of suite.specs ?? []) {
      if (
        spec.title.startsWith("Example #") &&
        suite.title !== "An operator attaches a recording of an explicit kind"
      )
        throw new Error("Outline identity mismatch");
      const attachments = spec.tests[0]!.results[0]!.attachments?.filter(
        (a) => a.name === "recording-attachment",
      );
      if (
        attachments?.length !== 1 ||
        attachments[0]!.contentType !== "application/json" ||
        !attachments[0]!.body
      )
        throw new Error("Missing actual Background receipt");
      const receipt = JSON.parse(
        Buffer.from(attachments[0]!.body!, "base64").toString("utf8"),
      ) as {
        sourceHost: string;
        caseKind?: string;
        backgrounds: { clause: string; evidence: unknown[] }[];
      };
      const clauses = [
        "ended-only",
        "hidden-exclusion",
        "mutation-protocol",
        "retention",
        "derived-display",
        "approved-composition",
      ];
      if (
        spec.title.startsWith("Example #") &&
        receipt.caseKind !== (spec.title === "Example #1" ? "raw" : "edited")
      )
        throw new Error("Outline kind identity mismatch");
      if (
        receipt.sourceHost !== "academy" ||
        receipt.backgrounds?.length !== 6 ||
        clauses.some(
          (clause, index) =>
            receipt.backgrounds[index]?.clause !== clause ||
            !Array.isArray(receipt.backgrounds[index]?.evidence) ||
            !receipt.backgrounds[index]!.evidence.length,
        )
      )
        throw new Error("Incomplete Background groups or source host");
    }
    suite.suites?.forEach(visit);
  }
  (value as { suites: Suite[] }).suites.forEach(visit);
}
