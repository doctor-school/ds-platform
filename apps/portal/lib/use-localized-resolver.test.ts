import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { OtpVerifySchema, SetDisplayNameRequestSchema } from "@ds/schemas";

import {
  LoginIdentifierFormSchema,
  ResetIdentifierFormSchema,
  ResetCompleteFormSchema,
  otpIdentifierFormSchema,
  registerFormSchema,
} from "./identifier-validation";
import { translateIssue, type ZodIssueLike } from "./use-localized-resolver";

/**
 * Drift guard for the localized zod→RHF resolver (#188, option (c)).
 *
 * The resolver keeps `@ds/schemas` locale-neutral and localizes in the portal by
 * zod issue *code/shape*. The residual decision-debt was that a brand-new
 * validation rule could degrade silently to the generic `fallback` instead of a
 * precise message. This test drives EVERY validation rule of EVERY
 * portal-consumed resolver schema through the real `translateIssue` and asserts a
 * precise catalog key — never `fallback`. A new rule that this map does not handle
 * lands on `fallback` and fails here, so the drift cannot ship silently.
 *
 * The translator is the identity function, so assertions read the `errors.validation.*`
 * KEY (`passwordComplexity`, `email`, …), independent of the RU copy.
 *
 * SCOPE NOTE (#1722, D18a): from the room extraction the `SetDisplayNameRequestSchema`
 * cases below no longer guard the ROOM's display-name prompt. That prompt moved to
 * the host-agnostic `packages/room/src/ui/display-name-prompt.tsx`, which maps zod
 * issues through the copy its host injects (`RoomValidationCopy`) rather than through
 * this resolver, and its own drift guard is
 * `packages/room/src/ui/display-name-prompt.test.tsx`. The cases stay here because the
 * schema is still portal-consumed elsewhere and because they pin the SHARED
 * issue-code→key mapping both surfaces mirror — but a room-only regression is caught
 * there, not here.
 */
const key = (k: string) => k;

/** First issue whose path ends at `field` (or the first issue if none match). */
function issueFor(
  schema: z.ZodType<unknown, never>,
  input: unknown,
  field?: string,
): ZodIssueLike {
  const result = schema.safeParse(input as never);
  if (result.success) {
    throw new Error("fixture expected a validation failure but parse succeeded");
  }
  const issues = result.error.issues as unknown as ZodIssueLike[];
  if (field) {
    const hit = issues.find((i) => i.path?.[i.path.length - 1] === field);
    if (hit) return hit;
  }
  return issues[0];
}

// One row per validation rule reachable through the resolver. Adding a rule to a
// portal-consumed schema (or a `@ds/schemas`/field fragment it composes) means
// adding a row here; if the resolver has no precise mapping the expected key
// cannot be `fallback`, so the omission surfaces immediately.
const cases: {
  rule: string;
  schema: z.ZodType<unknown, never>;
  input: unknown;
  field?: string;
  expected: string;
}[] = [
  {
    rule: "identifier union (email-or-phone) — malformed",
    schema: LoginIdentifierFormSchema as unknown as z.ZodType<unknown, never>,
    input: { identifier: "99545545445", password: "Aa1!aaaa", captchaToken: "" },
    field: "identifier",
    expected: "identifierRequired",
  },
  {
    rule: "password too short (min 8)",
    schema: LoginIdentifierFormSchema as unknown as z.ZodType<unknown, never>,
    input: { identifier: "a@b.co", password: "short" },
    field: "password",
    expected: "passwordTooShort",
  },
  {
    rule: "password too long (max 256)",
    schema: LoginIdentifierFormSchema as unknown as z.ZodType<unknown, never>,
    input: { identifier: "a@b.co", password: "A1!".padEnd(300, "a") },
    field: "password",
    expected: "passwordTooLong",
  },
  {
    rule: "reset identifier union — malformed",
    schema: ResetIdentifierFormSchema as unknown as z.ZodType<unknown, never>,
    input: { identifier: "12345" },
    field: "identifier",
    expected: "identifierRequired",
  },
  {
    rule: "otp email channel — invalid email",
    schema: otpIdentifierFormSchema("email") as unknown as z.ZodType<unknown, never>,
    input: { identifier: "notanemail", channel: "email" },
    field: "identifier",
    expected: "email",
  },
  {
    rule: "otp sms channel — invalid E.164 phone",
    schema: otpIdentifierFormSchema("sms") as unknown as z.ZodType<unknown, never>,
    input: { identifier: "12345", channel: "sms" },
    field: "identifier",
    expected: "phone",
  },
  {
    rule: "register — invalid email",
    schema: registerFormSchema() as unknown as z.ZodType<unknown, never>,
    input: { email: "bad", password: "Aa1!aaaa", consent: [] },
    field: "email",
    expected: "email",
  },
  {
    // 003 EARS-36: the creation policy is LENGTH ONLY — a class-free password of
    // 8+ chars is valid, so the only reachable creation-password rule is the
    // length floor. (The superseded four-class fixture asserted the opposite.)
    rule: "register — new password below the length floor (<8)",
    schema: registerFormSchema() as unknown as z.ZodType<unknown, never>,
    input: { email: "a@b.co", password: "weak", consent: [] },
    field: "password",
    expected: "passwordTooShort",
  },
  {
    rule: "otp verify — empty code (min 1)",
    schema: OtpVerifySchema as unknown as z.ZodType<unknown, never>,
    input: { identifier: "a@b.co", code: "", channel: "email" },
    field: "code",
    expected: "codeRequired",
  },
  {
    rule: "otp verify — empty identifier (min 1)",
    schema: OtpVerifySchema as unknown as z.ZodType<unknown, never>,
    input: { identifier: "", code: "123456", channel: "email" },
    field: "identifier",
    expected: "identifierRequired",
  },
  {
    rule: "reset-complete — weak new password (too short)",
    schema: ResetCompleteFormSchema as unknown as z.ZodType<unknown, never>,
    input: { identifier: "a@b.co", code: "123456", newPassword: "weak" },
    field: "newPassword",
    expected: "passwordTooShort",
  },
  {
    rule: "missing required field → invalid_type",
    schema: OtpVerifySchema as unknown as z.ZodType<unknown, never>,
    input: {},
    field: "identifier",
    expected: "required",
  },
  {
    // "   " trims to empty → too_small (min 1) on the displayName field (006 EARS-14).
    rule: "display name empty (min 1)",
    schema: SetDisplayNameRequestSchema as unknown as z.ZodType<unknown, never>,
    input: { displayName: "   " },
    field: "displayName",
    expected: "displayNameRequired",
  },
  {
    rule: "display name too long (max 100)",
    schema: SetDisplayNameRequestSchema as unknown as z.ZodType<unknown, never>,
    input: { displayName: "и".repeat(101) },
    field: "displayName",
    expected: "displayNameTooLong",
  },
];

describe("useLocalizedResolver — translateIssue mapping (drift guard #188)", () => {
  for (const c of cases) {
    it(`maps "${c.rule}" → "${c.expected}" (never fallback)`, () => {
      const issue = issueFor(c.schema, c.input, c.field);
      const resolved = translateIssue(issue, key);
      expect(resolved).toBe(c.expected);
      expect(resolved).not.toBe("fallback");
    });
  }

  it("no reachable rule of a portal-consumed schema degrades to the generic fallback", () => {
    const fellThrough = cases
      .map((c) => ({
        rule: c.rule,
        resolved: translateIssue(issueFor(c.schema, c.input, c.field), key),
      }))
      .filter((r) => r.resolved === "fallback");
    expect(fellThrough).toEqual([]);
  });
});
