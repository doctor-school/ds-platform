import { describe, expect, it } from "vitest";
import {
  isSafeSameOriginReturnTarget,
  parseSameOriginReturnTarget,
  parseReturnTarget,
  MAX_RETURN_TARGET_LENGTH,
} from "@ds/schemas";

// 014 EARS-6 — the PLATFORM-WIDE return-to-origin guard.
//
// The owner's rule (2026-08-17) is broader than any one feature: «Если что-то
// скрыто под логином, то после реги/логина всегда возвращаем юзера на ту
// страницу, где он пытался потребить контент.» 014 design §6 implements it ONCE,
// as a portal-auth mechanism, and 014 is its first consumer.
//
// This unit pins the SERVER-SIDE (framework-agnostic, `@ds/schemas`) half of that
// mechanism: what a safe same-origin return target IS, and — the load-bearing
// half — what is REJECTED rather than followed. The mechanism must never become
// an open redirect, so the accept side is deliberately narrow and every hostile
// shape the design names (absolute URL, protocol-relative `//host`, a
// backslash-escaped variant, a path escaping the app) is proven to yield `null`,
// which lands the visitor on the surface default instead.
//
// The narrow 005 `parseReturnTarget` (the `/webinars/<slug>` registration-intent)
// is NOT replaced: it stays the guard for the intent that also fires
// `RegisterForEvent`. This generic guard is the platform-wide superset used for
// every other gated surface, and the last clause below pins that relationship so
// the two can never drift into two competing redirect policies.
//
// The describe title OPENS with `014 EARS-6 ` — the ears-test-lint feature scope
// prefix (a mid-title parenthesis does not scope).
describe("014 EARS-6 platform-wide return-to-origin guard", () => {
  it("EARS-6.1: the system shall accept a same-origin relative path as the return target", () => {
    for (const safe of [
      "/webinars/ahilles-042",
      "/webinars/ahilles-042/room",
      "/webinars",
      "/account/events",
      "/projects/cardio-school",
      "/experts/ivanov-i-i",
      "/", // the bare root is a legitimate same-origin page
      "/webinars/%D0%BA%D0%B0%D1%80%D0%B4%D0%B8%D0%BE", // percent-encoded UTF-8 segment
    ]) {
      expect(
        parseSameOriginReturnTarget(safe),
        `must accept: ${safe}`,
      ).not.toBeNull();
      expect(isSafeSameOriginReturnTarget(safe)).toBe(true);
    }
  });

  it("EARS-6.2: the accepted target shall be the canonical relative path, never a hardcoded origin", () => {
    const target = parseSameOriginReturnTarget("/webinars/cardio-2026");
    expect(target).toBe("/webinars/cardio-2026");
    expect(target!.startsWith("/")).toBe(true);
    expect(target!).not.toMatch(/^https?:/i);
    expect(target!).not.toMatch(/^\/\//);
  });

  it("EARS-6.3: a non-same-origin or absolute target shall be rejected rather than followed", () => {
    for (const evil of [
      "https://example.invalid/", // the scenarios' first Example
      "//example.invalid/", // the scenarios' second Example (protocol-relative)
      "\\\\example.invalid\\", // the scenarios' third Example (backslash)
      "http://evil.example/webinars/x",
      "HtTpS://evil.example", // case games on the scheme
      "javascript:alert(1)", // scheme with no leading slash
      "data:text/html,<script>", // data URI
      "//evil.example/webinars/x", // protocol-relative under a look-alike path
      "/\\evil.example", // backslash bypass (browsers may read `/\` as `//`)
      "/webinars/\\..\\account", // backslash traversal
      "/\t/evil.example", // control character smuggling a `//`
      "webinars/x", // not absolute — resolves against the current directory
      "", // empty
      "   ", // whitespace only
    ]) {
      expect(
        parseSameOriginReturnTarget(evil),
        `must reject: ${evil}`,
      ).toBeNull();
      expect(isSafeSameOriginReturnTarget(evil)).toBe(false);
    }
  });

  it("EARS-6.4: a target escaping the app shall be rejected rather than followed", () => {
    for (const evil of [
      "/../etc/passwd",
      "/webinars/../../evil",
      "/webinars/./x",
      "/webinars/%2e%2e/account", // encoded traversal
      "/webinars//evil.example", // an empty inner segment re-forms `//`
      "/webinars/%2f%2fevil.example", // encoded `//`
    ]) {
      expect(
        parseSameOriginReturnTarget(evil),
        `must reject: ${evil}`,
      ).toBeNull();
    }
  });

  it("EARS-6.5: a non-string, an over-long value and a malformed escape shall be rejected", () => {
    for (const evil of [
      null,
      undefined,
      42,
      {},
      ["/webinars/x"],
      `/${"a".repeat(MAX_RETURN_TARGET_LENGTH)}`,
      "/webinars/%E0%A4%A", // malformed percent-escape
    ]) {
      expect(parseSameOriginReturnTarget(evil)).toBeNull();
    }
  });

  it("EARS-6.6: the canonical target shall carry no query or fragment, so one return target can never chain into another redirect", () => {
    // The return target is a PAGE, not page state. Dropping the query and the
    // fragment removes the redirect-chaining vector outright: a landed-on page can
    // never be handed an attacker-authored `?next=`/`?returnTo=` to follow on.
    expect(parseSameOriginReturnTarget("/webinars/x?next=//evil.example")).toBe(
      "/webinars/x",
    );
    expect(parseSameOriginReturnTarget("/webinars/x#//evil.example")).toBe(
      "/webinars/x",
    );
    expect(parseSameOriginReturnTarget("/webinars?tab=past&page=2")).toBe(
      "/webinars",
    );
  });

  it("EARS-6.7: the platform guard shall accept every target the narrow 005 registration-intent guard accepts", () => {
    // One redirect policy, not two: whatever the narrow intent guard admits is by
    // construction a safe same-origin path, so the platform-wide guard must admit
    // it too. A divergence here would mean the platform mechanism could drop a
    // target the intent mechanism follows (or worse, the reverse).
    for (const slug of ["ahilles-042", "cardio-2026", "x_1"]) {
      const intent = parseReturnTarget(`/webinars/${slug}`);
      expect(intent).not.toBeNull();
      expect(parseSameOriginReturnTarget(intent!.returnTo)).toBe(
        intent!.returnTo,
      );
    }
  });
});
