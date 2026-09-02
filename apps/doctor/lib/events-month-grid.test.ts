import { describe, expect, it } from "vitest";

import { doctorEventsDayHref } from "@/lib/events-month-grid";

/**
 * 019 EARS-4 (#1519) — the day href's horizon widening against the READ the
 * feed actually performs.
 *
 * `to` is an EXCLUSIVE upper bound end to end: `DoctorEventsService.feed()`
 * turns it into `<to>T00:00:00+03:00` and the repository selects
 * `lt(events.startsAt, toInstant)`. So a day href that widens to `to: date`
 * asks for a window that stops the instant the selected day BEGINS — the day
 * the reader clicked is the one day the read then excludes. The widened bound
 * must therefore be the day AFTER the selection, and the widening must trigger
 * as soon as the selection reaches `horizon.to` rather than only past it.
 */
describe("doctorEventsDayHref", () => {
  const HORIZON = { from: "2026-09-01", to: "2026-09-15" };
  const params = (href: string) =>
    new URL(href, "http://127.0.0.1").searchParams;

  it("EARS-4.5: a day inside the served horizon leaves the horizon alone", () => {
    const query = params(
      doctorEventsDayHref({ format: "webinar" }, "2026-09-04", HORIZON),
    );

    expect(query.get("day")).toBe("2026-09-04");
    expect(query.get("month")).toBe("2026-09");
    expect(query.get("to")).toBeNull();
    expect(query.get("from")).toBeNull();
    expect(query.get("format")).toBe("webinar");
  });

  it("EARS-4.5: the day AT the exclusive bound widens — that day is not served yet", () => {
    const query = params(doctorEventsDayHref({}, "2026-09-15", HORIZON));

    expect(query.get("day")).toBe("2026-09-15");
    expect(query.get("from")).toBe("2026-09-01");
    expect(query.get("to")).toBe("2026-09-16");
  });

  it("EARS-4.5: a day past the horizon widens to the day AFTER it, so the day itself is inside the read", () => {
    const query = params(doctorEventsDayHref({}, "2026-09-20", HORIZON));

    expect(query.get("day")).toBe("2026-09-20");
    expect(query.get("from")).toBe("2026-09-01");
    // Exclusive bound: `to=2026-09-20` would serve up to 19 сентября and drop
    // the selected day entirely.
    expect(query.get("to")).toBe("2026-09-21");
  });

  it("EARS-4.5: widening at a month boundary rolls the bound into the next month", () => {
    const query = params(
      doctorEventsDayHref({}, "2026-09-30", { from: "2026-09-01", to: "2026-09-29" }),
    );

    expect(query.get("to")).toBe("2026-10-01");
    expect(query.get("month")).toBe("2026-09");
  });

  it("EARS-4.5: with no horizon known the href never invents one", () => {
    const query = params(doctorEventsDayHref({}, "2026-09-20"));

    expect(query.get("to")).toBeNull();
    expect(query.get("from")).toBeNull();
  });
});
