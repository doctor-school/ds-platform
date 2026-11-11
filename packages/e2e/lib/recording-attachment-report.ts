import {
  backfillTitles,
  assertBackfillReceipt,
  type BackfillReceipt,
} from "./recording-backfill.js";
import {
  assertLegacyReceipt,
  assertBoundaryReceipt,
  boundaryCases,
  boundaryOutlines,
  noDeleteTitle,
  type BoundaryReceipt,
  legacyTitles,
  type LegacyReceipt,
} from "./legacy-transition.js";
import { assertOperationalReport } from "../api-probes/operational-report.js";

export const recordingAttachmentTitles = [
  "Example #1",
  "Example #2",
  "A second recording of the same kind is refused, not silently accepted",
  "Retiring a recording frees its kind slot without losing history",
] as const;

export const recordingLifecycleTitles = [
  "Publication is a separate act from attachment",
  "Example #1",
  "Example #2",
  "Example #3",
  "Example #4",
  "Every committed recording mutation is audited",
] as const;
const attachmentOutline =
  "An operator attaches a recording of an explicit kind";
const lifecycleOutline =
  "A recording is publishable only while the event is ended";
const rule = "Recording lifecycle, playback and remaining archive contracts";
const feature =
  "A finished broadcast keeps its value as a recording, and the archive is browsable";

export function assertRecordingAttachmentReport(
  value: unknown,
  scope: "full" | "new" | "boundaries" = "full",
) {
  assertOperationalReport(
    value,
    scope === "new"
      ? [...backfillTitles]
      : scope === "boundaries"
        ? boundaryCases.map((c) => c.title)
        : [
            ...backfillTitles,
            ...recordingAttachmentTitles,
            ...recordingLifecycleTitles,
            ...legacyTitles,
            ...boundaryCases.map((c) => c.title),
          ],
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
  const identities: string[] = [];
  function visit(suite: Suite, parents: string[] = []) {
    const ancestry = [...parents, suite.title ?? ""];
    for (const spec of suite.specs ?? []) {
      if (!ancestry.includes(feature) || !ancestry.includes(rule))
        throw new Error("Source feature/rule identity mismatch");
      const outline = spec.title.startsWith("Example #")
        ? suite.title
        : undefined;
      if (
        outline &&
        outline !== attachmentOutline &&
        outline !== lifecycleOutline &&
        !boundaryOutlines.includes(outline as (typeof boundaryOutlines)[number])
      )
        throw new Error("Outline identity mismatch");
      if (
        JSON.stringify(ancestry.slice(outline ? -3 : -2)) !==
        JSON.stringify(outline ? [feature, rule, outline] : [feature, rule])
      )
        throw new Error("Source feature/rule/scenario identity mismatch");
      const identity = `${outline ?? rule}/${spec.title}`;
      if (identities.includes(identity))
        throw new Error("Duplicate original identity");
      identities.push(identity);
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
        backfill?: BackfillReceipt;
        boundary?: BoundaryReceipt;
        sourceHost: string;
        legacy?: LegacyReceipt;
        caseKind?: string;
        caseState?: string;
        backgrounds: { clause: string; evidence: unknown[] }[];
      };
      if (
        backfillTitles.includes(spec.title as (typeof backfillTitles)[number])
      )
        assertBackfillReceipt(receipt.backfill!, spec.title);
      if (legacyTitles.includes(spec.title as (typeof legacyTitles)[number]))
        assertLegacyReceipt(receipt.legacy!, spec.title);
      if (
        spec.title === noDeleteTitle ||
        boundaryOutlines.includes(outline as (typeof boundaryOutlines)[number])
      )
        assertBoundaryReceipt(receipt.boundary!, outline ?? "", spec.title);
      const clauses = [
        "ended-only",
        "hidden-exclusion",
        "mutation-protocol",
        "retention",
        "derived-display",
        "approved-composition",
      ];
      if (
        outline === attachmentOutline &&
        receipt.caseKind !== (spec.title === "Example #1" ? "raw" : "edited")
      )
        throw new Error("Outline kind identity mismatch");
      if (
        outline === lifecycleOutline &&
        receipt.caseState !==
          ["draft", "published", "live", "hidden"][
            Number(spec.title.slice(-1)) - 1
          ]
      )
        throw new Error("Outline state identity mismatch");
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
    suite.suites?.forEach((child) => visit(child, ancestry));
  }
  (value as { suites: Suite[] }).suites.forEach((suite) => visit(suite));
  const expected = [
    ...(scope === "full"
      ? recordingAttachmentTitles.map(
          (title) =>
            `${title.startsWith("Example #") ? attachmentOutline : rule}/${title}`,
        )
      : []),
    ...(scope === "full" ? recordingLifecycleTitles : []).map(
      (title) =>
        `${title.startsWith("Example #") ? lifecycleOutline : rule}/${title}`,
    ),
    ...(scope === "full"
      ? legacyTitles.map((title) => `${rule}/${title}`)
      : []),
    ...(scope !== "new"
      ? boundaryCases.map((c) => `${c.outline || rule}/${c.title}`)
      : []),
    ...(scope !== "boundaries"
      ? backfillTitles.map((title) => `${rule}/${title}`)
      : []),
  ];
  if (JSON.stringify(identities.sort()) !== JSON.stringify(expected.sort()))
    throw new Error("Source outline/case identity mismatch");
}
