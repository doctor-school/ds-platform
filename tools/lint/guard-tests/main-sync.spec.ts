import { describe, expect, it } from "vitest";

import {
  STALE_BANNER,
  evaluateMainSync,
  mainSyncMessage,
  shouldRefuseTriage,
  type MainSyncProbe,
} from "../../main-sync";

/**
 * Unit cover for the shared `main-sync` seam (#630). The driver: the lead ran
 * `pnpm backlog:triage` in a tree whose local `main` was BEHIND `origin/main`
 * (the just-merged #624 wasn't in the local tool code), so takeability was
 * classified against stale logic (the #418 stale-main-read pattern). The remedy
 * is a deterministic fetch + behind-check that REFUSES (triage) / warns loudly
 * (bootstrap), and degrades to a banner — never a crash — when the fetch fails.
 *
 * The `git` I/O (`probeMainSync`) is a subprocess seam; the classifier
 * (`evaluateMainSync`) and the message/gate formatters are pure and tested here.
 */

const probe = (over: Partial<MainSyncProbe> = {}): MainSyncProbe => ({
  fetchOk: true,
  behindCount: 0,
  ...over,
});

describe("main-sync evaluateMainSync()", () => {
  it("fetch OK + behindCount 0 → in-sync", () => {
    expect(evaluateMainSync(probe({ behindCount: 0 })).kind).toBe("in-sync");
  });

  it("fetch OK + behindCount > 0 → behind (carries the count)", () => {
    const s = evaluateMainSync(probe({ behindCount: 3 }));
    expect(s.kind).toBe("behind");
    expect(s.kind === "behind" && s.behindCount).toBe(3);
  });

  it("fetch failed → fetch-failed, regardless of a stale behindCount", () => {
    const s = evaluateMainSync(
      probe({ fetchOk: false, fetchError: "no network", behindCount: 5 }),
    );
    expect(s.kind).toBe("fetch-failed");
  });

  it("fetch OK but behindCount uncomputable (no local main) → unknown", () => {
    const s = evaluateMainSync(
      probe({ behindCount: null, behindError: "unknown revision main" }),
    );
    expect(s.kind).toBe("unknown");
  });
});

describe("main-sync mainSyncMessage()", () => {
  it("behind → a message naming the behind count (bootstrap WARN copy)", () => {
    const msg = mainSyncMessage(evaluateMainSync(probe({ behindCount: 2 })));
    expect(msg).toContain("2");
    expect(msg).toMatch(/behind/i);
    expect(msg).toContain("origin/main");
  });

  it("fetch-failed → the explicit stale banner (offline tolerance)", () => {
    const msg = mainSyncMessage(
      evaluateMainSync(probe({ fetchOk: false, fetchError: "offline" })),
    );
    expect(msg).toContain(STALE_BANNER);
  });

  it("unknown → a stale banner (never crashes, proceeds)", () => {
    const msg = mainSyncMessage(
      evaluateMainSync(probe({ behindCount: null, behindError: "no main" })),
    );
    expect(msg).toMatch(/stale/i);
  });

  it("in-sync → no message", () => {
    expect(mainSyncMessage(evaluateMainSync(probe({ behindCount: 0 })))).toBe(
      null,
    );
  });
});

describe("main-sync shouldRefuseTriage()", () => {
  it("REFUSES only when local main is behind", () => {
    expect(shouldRefuseTriage(evaluateMainSync(probe({ behindCount: 4 })))).toBe(
      true,
    );
  });

  it("does NOT refuse when in-sync", () => {
    expect(
      shouldRefuseTriage(evaluateMainSync(probe({ behindCount: 0 }))),
    ).toBe(false);
  });

  it("does NOT refuse on fetch failure (banner + proceed, not a hard stop)", () => {
    expect(
      shouldRefuseTriage(
        evaluateMainSync(probe({ fetchOk: false, fetchError: "offline" })),
      ),
    ).toBe(false);
  });

  it("does NOT refuse on unknown (proceed with a banner)", () => {
    expect(
      shouldRefuseTriage(evaluateMainSync(probe({ behindCount: null }))),
    ).toBe(false);
  });
});
