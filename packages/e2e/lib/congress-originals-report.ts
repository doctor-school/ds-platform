import { assertOperationalReport } from "../api-probes/operational-report.js";

export const congressOriginals = [
  "Failure branch — the submission arrives before registration opens",
  "Failure branch — the submission arrives after registration closes",
  "The name answers are cleaned up before anything stores them",
] as const;
export const congressBackgrounds = [
  "published-offline",
  "same-origin-proxy",
  "trusted-egress",
  "public-bot-rate",
  "inside-window",
  "published-consent",
] as const;
export function assertCongressReport(report: unknown): void {
  assertOperationalReport(report, congressOriginals, "admin");
}
export function assertCongressBackgrounds(log: string): void {
  const rows = log
    .split(/\r?\n/)
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          title: string;
          clause: string;
          eventId: string;
          verified: boolean;
        },
    );
  if (rows.length !== 18)
    throw new Error("Expected exactly 18 Congress Background receipts");
  for (const [i, title] of congressOriginals.entries()) {
    const group = rows.slice(i * 6, i * 6 + 6);
    if (
      group.some(
        (row, j) =>
          row.title.replace(/ @host:admin$/, "") !== title ||
          row.clause !== congressBackgrounds[j] ||
          row.verified !== true ||
          !row.eventId ||
          row.eventId !== group[0]!.eventId,
      )
    )
      throw new Error(
        "Missing, wrong, duplicate or unordered Congress Background receipt",
      );
  }
}
