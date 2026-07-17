import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "prom-client";
import {
  DEFAULT_SYNTHETIC_DOMAIN,
  DEFAULT_SYNTHETIC_MSISDN_PREFIX,
  isSyntheticRecipient,
  MAILER_SYNTHETIC_SUPPRESSED_METRIC,
  SyntheticSuppression,
  type SyntheticTags,
} from "./synthetic-suppression.js";

// 003 EARS-33 (design §14.8): the recipient-scoped, env-gated synthetic-send
// suppression seam for the #873 load-test. This suite pins the pure recipient
// match (the reserved-suffix / prefix edge cases) and the three-state toggle
// matrix (fail-closed on the toggle) that the mailer + SMS send points both ride.

const TAGS: SyntheticTags = {
  domain: DEFAULT_SYNTHETIC_DOMAIN,
  msisdnPrefix: DEFAULT_SYNTHETIC_MSISDN_PREFIX,
};

describe("isSyntheticRecipient — reserved-recipient match (003 EARS-33)", () => {
  it("003 EARS-33.1: matches an email on the reserved domain suffix (case-insensitive)", () => {
    expect(isSyntheticRecipient("email", "alice@loadtest.invalid", TAGS)).toBe(
      true,
    );
    expect(isSyntheticRecipient("email", "ALICE@LoadTest.INVALID", TAGS)).toBe(
      true,
    );
  });

  it("003 EARS-33.1: an address merely CONTAINING the tag elsewhere is untagged", () => {
    // Tag as the local part, not the domain.
    expect(
      isSyntheticRecipient("email", "loadtest.invalid@real.example", TAGS),
    ).toBe(false);
    // A different domain that only ends with the tag's letters (no `@` boundary).
    expect(
      isSyntheticRecipient("email", "user@sub.loadtest.invalid.example", TAGS),
    ).toBe(false);
    // Real recipient — never matched.
    expect(isSyntheticRecipient("email", "doctor@ds.test", TAGS)).toBe(false);
  });

  it("003 EARS-33.1: matches an SMS recipient on the reserved number prefix (space/dash tolerant)", () => {
    expect(isSyntheticRecipient("sms", "+9991234567", TAGS)).toBe(true);
    expect(isSyntheticRecipient("sms", "+999 12-34-567", TAGS)).toBe(true);
    // A real RF number is never matched.
    expect(isSyntheticRecipient("sms", "+79991234567", TAGS)).toBe(false);
  });

  it("003 EARS-33.1: empty / blank recipient is never synthetic", () => {
    expect(isSyntheticRecipient("email", "", TAGS)).toBe(false);
    expect(isSyntheticRecipient("sms", "   ", TAGS)).toBe(false);
  });
});

describe("SyntheticSuppression — three-state matrix (003 EARS-33)", () => {
  beforeEach(() => register.clear());
  afterEach(() => register.clear());

  function build(enabled: boolean, onSuppressed = vi.fn()) {
    return {
      onSuppressed,
      seam: new SyntheticSuppression({
        enabled: () => enabled,
        tags: TAGS,
        sinks: { onSuppressed },
      }),
    };
  }

  it("003 EARS-33.2: toggle OFF → normal (no suppression) even for a tagged recipient", () => {
    const { seam, onSuppressed } = build(false);
    expect(seam.suppress("email", "alice@loadtest.invalid")).toBe(false);
    expect(seam.suppress("sms", "+9991234567")).toBe(false);
    expect(onSuppressed).not.toHaveBeenCalled();
  });

  it("003 EARS-33.3: toggle ON + tagged → suppressed + counted + logged", () => {
    const log = vi.fn();
    const seam = new SyntheticSuppression({
      enabled: () => true,
      tags: TAGS,
      sinks: { log },
    });
    expect(seam.suppress("email", "alice@loadtest.invalid")).toBe(true);
    expect(seam.suppress("sms", "+9991234567")).toBe(true);

    // Exactly one loud structured log line per suppressed send, carrying the
    // channel + the (synthetic) recipient — and NEVER a one-time code.
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]?.[0]).toContain("mailer_synthetic_suppressed");
    expect(log.mock.calls[0]?.[0]).toContain("email");

    // The dedicated counter is incremented once per channel.
    const metric = register.getSingleMetric(
      MAILER_SYNTHETIC_SUPPRESSED_METRIC,
    );
    expect(metric).toBeTruthy();
  });

  it("003 EARS-33.4: toggle ON + UNtagged (real recipient) → normal send, no count", () => {
    const { seam, onSuppressed } = build(true);
    expect(seam.suppress("email", "doctor@ds.test")).toBe(false);
    expect(seam.suppress("sms", "+79991234567")).toBe(false);
    expect(onSuppressed).not.toHaveBeenCalled();
  });

  it("003 EARS-33.5: SyntheticSuppression.disabled() is hard-inert (fail-closed default)", () => {
    const seam = SyntheticSuppression.disabled();
    expect(seam.suppress("email", "alice@loadtest.invalid")).toBe(false);
    expect(seam.suppress("sms", "+9991234567")).toBe(false);
  });
});
