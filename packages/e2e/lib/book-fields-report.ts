import { assertOperationalReport } from "../api-probes/operational-report.js";
import { publicBookFieldTitles } from "./host-tags.js";
import { recordFormBackgrounds } from "./record-forms-report.js";

export const bookFieldSource =
  "017-doctor-shell-specialties/017-scenarios.feature";
const parents = [
  `.features-gen/book-fields/${bookFieldSource}.spec.js`,
  "A doctor arrives at their own storefront, picks a specialty, and the site becomes theirs",
  "Remaining storefront and operator scenarios",
];
export const bookFieldCases = [
  ...["list", "record", "create form"].map((surface, index) => ({
    title: `Example #${index + 1}`,
    suitePath: [...parents, publicBookFieldTitles[0]],
    source: { file: bookFieldSource, line: 423, row: 431 + index, surface },
  })),
  ...publicBookFieldTitles.slice(1).map((title, index) => ({
    title,
    suitePath: parents,
    source: { file: bookFieldSource, line: index ? 443 : 436 },
  })),
];

export function assertBookFieldsReport(value: unknown) {
  assertOperationalReport(value, bookFieldCases, "doctor");
  type Attachment = { name: string; contentType?: string; body?: string };
  type Suite = {
    title: string;
    specs?: {
      title: string;
      tests: { results: { attachments?: Attachment[] }[] }[];
    }[];
    suites?: Suite[];
  };
  const attachment = (items: Attachment[] | undefined, name: string) => {
    const found = items?.filter((item) => item.name === name);
    if (
      found?.length !== 1 ||
      found[0]!.contentType !== "application/json" ||
      !found[0]!.body
    )
      throw new Error(`Missing actual JSON attachment: ${name}`);
    return JSON.parse(Buffer.from(found[0]!.body, "base64").toString("utf8"));
  };
  function visit(suite: Suite, parents: string[] = []) {
    const path = [...parents, suite.title.replaceAll("\\", "/")];
    for (const spec of suite.specs ?? []) {
      const expected = bookFieldCases.find(
        (item) =>
          JSON.stringify([...item.suitePath, item.title]) ===
          JSON.stringify([...path, spec.title]),
      );
      if (!expected) throw new Error("Unknown canonical case identity");
      const items = spec.tests[0]!.results[0]!.attachments;
      const bg = attachment(items, "public-feed-entry");
      if (
        JSON.stringify(bg.backgrounds) !== JSON.stringify(recordFormBackgrounds)
      )
        throw new Error(
          "All six actual Background groups are required per case",
        );
      const proof = attachment(items, "public-book-fields");
      if (JSON.stringify(proof.source) !== JSON.stringify(expected.source))
        throw new Error("Canonical source-row/surface mismatch");
    }
    suite.suites?.forEach((child) => visit(child, path));
  }
  (value as { suites: Suite[] }).suites.forEach((suite) => visit(suite));
}
