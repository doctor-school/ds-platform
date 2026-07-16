import { describe, expect, it } from "vitest";

// Pure seams of the live-broadcast (эфир) deploy gate (#1000, T2 of #996 —
// release-cycle spec §10.4 item 7). Importing does NOT fire the CLI's fetch —
// the I/O sits behind the same entry-point guard idiom as release-notes.mjs
// (mirrors cut-release.spec.ts). No network in these tests: the listing payload
// (`GET /v1/public/events` → UpcomingBroadcastCard[]) is fabricated.
import {
  PUBLIC_EVENTS_URL,
  evaluateBroadcastProbe,
  findLiveEvent,
  formatVerdict,
} from "../../deploy/live-broadcast-check.mjs";

const card = (over: Record<string, unknown> = {}) => ({
  id: "evt-1",
  slug: "cardio-webinar",
  title: "Кардио-вебинар",
  state: "published",
  ...over,
});

describe("live-broadcast-check — findLiveEvent (pure)", () => {
  it("returns the first item with state 'live'", () => {
    const live = card({ slug: "live-now", state: "live" });
    expect(findLiveEvent([card(), live, card({ slug: "later" })])).toBe(live);
  });

  it("returns undefined when every item is merely published", () => {
    expect(findLiveEvent([card(), card({ slug: "another" })])).toBeUndefined();
  });

  it("returns undefined for an empty listing and for non-array payloads", () => {
    expect(findLiveEvent([])).toBeUndefined();
    expect(findLiveEvent({ items: [card({ state: "live" })] })).toBeUndefined();
    expect(findLiveEvent(null)).toBeUndefined();
  });

  it("ignores malformed items (null / non-object) without throwing", () => {
    expect(findLiveEvent([null, 42, "x", card()])).toBeUndefined();
  });
});

describe("live-broadcast-check — evaluateBroadcastProbe (pure, fail-closed)", () => {
  it("empty listing → clear", () => {
    expect(evaluateBroadcastProbe({ payload: [] })).toEqual({ kind: "clear" });
  });

  it("published-only listing → clear", () => {
    expect(evaluateBroadcastProbe({ payload: [card()] })).toEqual({
      kind: "clear",
    });
  });

  it("a live item → live, labelled slug — title", () => {
    const v = evaluateBroadcastProbe({
      payload: [card(), card({ slug: "live-now", title: "Эфир", state: "live" })],
    });
    expect(v).toEqual({ kind: "live", label: "live-now — Эфир" });
  });

  it("a live item with missing slug/title still yields a label, never throws", () => {
    const v = evaluateBroadcastProbe({ payload: [{ state: "live" }] });
    expect(v.kind).toBe("live");
    expect(v.kind === "live" && v.label).toBe("? — ?");
  });

  it("probe error → unknown (fail-closed), carrying the error", () => {
    expect(evaluateBroadcastProbe({ error: "HTTP 503" })).toEqual({
      kind: "unknown",
      error: "HTTP 503",
    });
  });

  it("non-array payload → unknown (fail-closed), NEVER clear", () => {
    const v = evaluateBroadcastProbe({ payload: { items: [] } });
    expect(v.kind).toBe("unknown");
  });
});

describe("live-broadcast-check — formatVerdict (pure)", () => {
  it("clear → exit 0, CLEAR line", () => {
    const { line, exitCode } = formatVerdict({ kind: "clear" });
    expect(exitCode).toBe(0);
    expect(line).toMatch(/^CLEAR /);
  });

  it("live → exit 1, LIVE line naming the broadcast + the hold", () => {
    const { line, exitCode } = formatVerdict({
      kind: "live",
      label: "live-now — Эфир",
    });
    expect(exitCode).toBe(1);
    expect(line).toMatch(/^LIVE: live-now — Эфир/);
    expect(line).toMatch(/HOLD the deploy/);
  });

  it("unknown → exit 1 (fail-closed), UNKNOWN line carrying the probe error", () => {
    const { line, exitCode } = formatVerdict({
      kind: "unknown",
      error: "fetch failed",
    });
    expect(exitCode).toBe(1);
    expect(line).toMatch(/^UNKNOWN \(probe failed: fetch failed\)/);
    expect(line).toMatch(/HOLD the deploy/);
  });
});

describe("live-broadcast-check — probe target", () => {
  it("probes the prod public events listing (read-only endpoint)", () => {
    expect(PUBLIC_EVENTS_URL).toBe("https://api.doctor.school/v1/public/events");
  });
});
