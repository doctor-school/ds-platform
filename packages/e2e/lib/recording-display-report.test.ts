import { describe, expect, it } from "vitest";
import { assertRecordingAttachmentReport } from "./recording-attachment-report.js";
import {
  displayReportFixture,
  type displayFixture,
} from "./recording-display.fixture.js";

const assertDisplay = (value: unknown) =>
  assertRecordingAttachmentReport(value, "display");
function changed(
  index: number,
  change: (r: ReturnType<typeof displayFixture>) => void,
) {
  const value = displayReportFixture();
  const rule = value.suites[0]!.suites[0]!;
  const spec =
    index < 4 ? rule.suites[0]!.specs[index]! : rule.specs[index - 4]!;
  const attachment = spec.tests[0]!.results[0]!.attachments[0]!;
  const receipt = JSON.parse(
    Buffer.from(attachment.body, "base64").toString("utf8"),
  );
  change(receipt.display);
  attachment.body = Buffer.from(JSON.stringify(receipt)).toString("base64");
  return value;
}
describe("014 display original report acceptance", () => {
  it("accepts exactly four projection Examples, one single-cut and one hidden original with real-shaped browser receipts", () => {
    expect(() => assertDisplay(displayReportFixture())).not.toThrow();
  });
  it("rejects a wrong Example, draft substitute, API-only player, wrong source or unexpanded secondary", () => {
    for (const change of [
      (r: ReturnType<typeof displayFixture>) => {
        r.example = 2;
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.rows[0]!.status = "draft";
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.browser.profileStatus = 401;
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.browser.primarySrc = null;
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.browser.primarySrc = r.browser.secondarySrc;
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.browser.secondaryInitiallyOpen = true;
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.browser.secondaryFramesBefore = 1;
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.browser.secondaryFramesAfter = 0;
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.playback.body.secondary = null;
      },
    ])
      expect(() => assertDisplay(changed(0, change))).toThrow();
  });
  it("requires a positive main on single-cut and a true preparing plaque with no player for none", () => {
    expect(() =>
      assertDisplay(
        changed(4, (r) => {
          r.browser.frameCount = 0;
        }),
      ),
    ).toThrow();
    expect(() =>
      assertDisplay(
        changed(4, (r) => {
          r.browser.mainDetails = 1;
        }),
      ),
    ).toThrow();
    expect(() =>
      assertDisplay(
        changed(3, (r) => {
          r.browser.plaque = false;
        }),
      ),
    ).toThrow();
    expect(() =>
      assertDisplay(
        changed(3, (r) => {
          r.browser.frameCount = 1;
        }),
      ),
    ).toThrow();
  });
  it("requires actual hide protocol, retained published rows, notice, no controls/sources and positive public plus account list/count evidence", () => {
    for (const change of [
      (r: ReturnType<typeof displayFixture>) => {
        r.hidden!.answer.request.path = "/wrong";
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.hidden!.recordingAfter = [];
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.hidden!.browser.notice = false;
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.hidden!.browser.participationControls = 1;
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.hidden!.browser.sourceLeak = true;
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.hidden!.beforeLists[1]!.body = [];
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.hidden!.beforeLists.pop();
      },
      (r: ReturnType<typeof displayFixture>) => {
        r.hidden!.afterLists[1]!.body = r.hidden!.beforeLists[1]!.body;
      },
    ])
      expect(() => assertDisplay(changed(5, change))).toThrow();
  });
  it("rejects a moved outline, missing or repeated case, skip and unexecuted Background", () => {
    const moved = displayReportFixture();
    moved.suites[0]!.suites[0]!.suites[0]!.title = "Other outline";
    const missing = displayReportFixture();
    missing.suites[0]!.suites[0]!.specs.pop();
    const repeated = displayReportFixture();
    repeated.suites[0]!.suites[0]!.specs.push(
      repeated.suites[0]!.suites[0]!.specs[0]!,
    );
    const skipped = displayReportFixture();
    skipped.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!.status =
      "skipped";
    const noReceipt = displayReportFixture();
    noReceipt.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments =
      [];
    for (const value of [moved, missing, repeated, skipped, noReceipt])
      expect(() => assertDisplay(value)).toThrow();
  });
});
