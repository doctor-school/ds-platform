import { describe, expect, it } from "vitest";
import {
  assertCongressBackgrounds,
  congressOriginals,
  congressBackgrounds,
} from "./congress-originals-report.js";

describe("044 exact-three Background evidence", () => {
  const rows = () =>
    congressOriginals.flatMap((title) =>
      congressBackgrounds.map((clause) =>
        JSON.stringify({
          title,
          clause,
          eventId: "owned-event",
          verified: true,
        }),
      ),
    );
  it("EARS-28: accepts exactly six ordered post-assertion receipts per original", () => {
    expect(() => assertCongressBackgrounds(rows().join("\n"))).not.toThrow();
  });
  it.each([
    "missing",
    "duplicate",
    "unordered",
    "unverified",
    "extra",
    "wrong identity",
  ])("EARS-28: refuses %s Background evidence", (kind) => {
    const entries = rows();
    if (kind === "missing") entries.pop();
    if (kind === "duplicate") entries.push(entries[0]!);
    if (kind === "unordered")
      [entries[0], entries[1]] = [entries[1]!, entries[0]!];
    if (kind === "unverified")
      entries[0] = entries[0]!.replace('"verified":true', '"verified":false');
    if (kind === "extra")
      entries.push(
        JSON.stringify({
          title: "fourth",
          clause: congressBackgrounds[0],
          eventId: "owned-event",
          verified: true,
        }),
      );
    if (kind === "wrong identity")
      entries[1] = entries[1]!.replace("owned-event", "foreign-event");
    expect(() => assertCongressBackgrounds(entries.join("\n"))).toThrow();
  });
});
