import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { taxonomyErrorKey } from "./taxonomy-errors";

/**
 * Drift guard for the 012 EARS-6 relationship surface (#1288).
 *
 * The panel keys every refusal off the stable `errorCode` and renders
 * `t(resolvedKey)`. Two ways that silently rots, both invisible to typecheck:
 * the mapping returns a key nobody ever added to `ru.json` (next-intl renders the
 * key text at the operator), or a reader keys off `code` instead of `errorCode`
 * (RFC 7807 + §5.3 — the wire field is `errorCode`) and every refusal collapses
 * into the generic fallback. This asserts against the SHIPPED catalogue, so a
 * renamed key fails here rather than on the stand.
 */
const messages = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../messages/ru.json", import.meta.url)),
    "utf8",
  ),
) as Record<string, unknown>;

function lookup(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      messages,
    );
}

/** Every code the event↔project panel can actually meet, and its own sentence. */
const RELATIONSHIP_CODES = [
  "RELATIONSHIP_CONFLICT",
  "INVALID_TRANSITION",
  "LIFECYCLE_IMPACT_STALE",
  "LIFECYCLE_IMPACT_REQUIRED",
  "RESOURCE_NOT_FOUND",
  "PRECONDITION_FAILED",
  "PRECONDITION_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_REQUEST_IN_PROGRESS",
] as const;

describe("taxonomyErrorKey — 012 EARS-6 relationship codes (#1288)", () => {
  it("EARS-22: event-direction duplicate uses the existing actionable RU sentence", () => {
    const key = taxonomyErrorKey(
      { errorCode: "RELATIONSHIP_CONFLICT" },
      "eventTopics.errors.linkFailed",
    );

    expect(key).toBe("eventTopics.errors.duplicatePair");
    expect(typeof lookup(key)).toBe("string");
  });

  it("EARS-22: event-direction impact refusals use the existing reload guidance", () => {
    expect(
      taxonomyErrorKey(
        { errorCode: "LIFECYCLE_IMPACT_STALE" },
        "eventTopics.errors.transitionFailed",
      ),
    ).toBe("eventTopics.errors.impactStale");
    expect(
      taxonomyErrorKey(
        { errorCode: "LIFECYCLE_IMPACT_REQUIRED" },
        "eventTopics.errors.transitionFailed",
      ),
    ).toBe("eventTopics.errors.impactRequired");
  });

  it("EARS-6: every relationship refusal maps to its own existing RU sentence", () => {
    const fallback = "eventProjects.errors.transitionFailed";
    const resolved = new Set<string>();

    for (const errorCode of RELATIONSHIP_CODES) {
      const key = taxonomyErrorKey({ errorCode }, fallback);
      expect(key, `${errorCode} fell back to the generic sentence`).not.toBe(
        fallback,
      );
      expect(typeof lookup(key), `${key} is missing from ru.json`).toBe("string");
      resolved.add(key);
    }

    // Distinct sentences, not one message wearing nine names: «уже есть такая
    // связь» and «данные изменились, проверьте список заново» ask the operator
    // for different next actions.
    //
    // ONE deliberate pair shares a sentence, the shared §5.3 mapping's own
    // ruling: `PRECONDITION_REQUIRED` (no `If-Match` was sent) and
    // `PRECONDITION_FAILED` (the one sent is unusable) are the same fact to an
    // operator — this page is holding a row version the server no longer has —
    // and the only useful next action for both is «обновите страницу».
    expect(resolved.size).toBe(RELATIONSHIP_CODES.length - 1);
    expect(
      taxonomyErrorKey({ errorCode: "PRECONDITION_REQUIRED" }, fallback),
    ).toBe(taxonomyErrorKey({ errorCode: "PRECONDITION_FAILED" }, fallback));
  });

  it("EARS-6: reads `errorCode`, never `code` — a `code` body is the fallback", () => {
    // The guard for the exact mistake that costs a full cycle: the admin problem
    // body has no `code` field at all, so a reader keyed on it sees undefined.
    expect(
      taxonomyErrorKey(
        { code: "RELATIONSHIP_CONFLICT" },
        "eventProjects.errors.linkFailed",
      ),
    ).toBe("eventProjects.errors.linkFailed");
    expect(
      taxonomyErrorKey(
        { errorCode: "RELATIONSHIP_CONFLICT" },
        "eventProjects.errors.linkFailed",
      ),
    ).toBe("eventProjects.errors.duplicatePair");
  });

  it("EARS-6: the impact codes stay scoped to the relationship namespace", () => {
    // An entity CRUD surface has no §3.1 gate, so it must never be pointed at an
    // `impactStale` key its namespace does not own — that would render the raw
    // key text at the operator.
    expect(
      taxonomyErrorKey(
        { errorCode: "LIFECYCLE_IMPACT_STALE" },
        "projects.errors.updateFailed",
      ),
    ).toBe("projects.errors.updateFailed");
  });

  it("EARS-6: every dialog copy key the panel renders exists in ru.json", () => {
    for (const transition of ["retire", "restore"] as const) {
      for (const suffix of ["Title", "Body"] as const) {
        expect(
          typeof lookup(`eventProjects.confirm.${transition}${suffix}`),
        ).toBe("string");
      }
      expect(typeof lookup(`eventProjects.action.${transition}`)).toBe("string");
      expect(typeof lookup(`eventProjects.toast.${transition}d`)).toBe("string");
    }
    for (const status of ["published", "retired", "active"] as const) {
      expect(typeof lookup(`eventProjects.rowStatuses.${status}`)).toBe("string");
    }
    for (const mode of ["event", "project"] as const) {
      expect(typeof lookup(`eventProjects.description.${mode}`)).toBe("string");
      expect(typeof lookup(`eventProjects.empty.${mode}`)).toBe("string");
      expect(typeof lookup(`eventProjects.activeTitle.${mode}`)).toBe("string");
    }
  });
});
