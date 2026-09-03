import { describe, expect, it } from "vitest";
import { EventFormSchema, type EventFormFields } from "./form-schemas";

/**
 * 014 EARS-24 (#1741) — the «Это архивный эфир» branch of the ONE create/edit
 * event form. The checkbox does not open a second form; it turns the recording
 * block from decorative into required, which is a validation fact and therefore
 * asserted here rather than in the browser.
 */
const VALID_RUTUBE_CODE = "0123456789abcdef0123456789abcdef";

function fields(over: Partial<EventFormFields> = {}): EventFormFields {
  return {
    title: "Эфир до платформы",
    school: "Кардиошкола",
    startsAtMsk: "2024-05-01T10:00",
    durationMin: 60,
    description: "",
    partnerRef: "",
    speakers: [],
    specialtiesText: "",
    legacy: false,
    recording: {
      kind: "edited",
      provider: "rutube",
      embedRef: "",
      posterRef: "",
      durationSecText: "",
    },
    ...over,
  };
}

describe("EventFormSchema — legacy эфир", () => {
  it("014 EARS-24.1: legacy requires a recording embedRef of the provider's shape", () => {
    const empty = EventFormSchema.safeParse(fields({ legacy: true }));
    expect(empty.success).toBe(false);
    expect(
      empty.success
        ? []
        : empty.error.issues.map((issue) => issue.path.join(".")),
    ).toContain("recording.embedRef");

    // A reference of the WRONG provider shape is refused with the SSOT's own
    // per-provider tag — the same refinement the attach dialog runs, never a
    // re-typed rule.
    const malformed = EventFormSchema.safeParse(
      fields({
        legacy: true,
        recording: {
          kind: "edited",
          provider: "rutube",
          embedRef: "ччсапп",
          posterRef: "",
          durationSecText: "",
        },
      }),
    );
    expect(malformed.success).toBe(false);

    const ok = EventFormSchema.safeParse(
      fields({
        legacy: true,
        // No «Школа / серия»: an эфир that predates the platform routinely
        // predates the series taxonomy, and the SSOT legacy body defaults it
        // to "" — so the form must not demand what the API does not.
        school: "",
        recording: {
          kind: "edited",
          provider: "rutube",
          embedRef: VALID_RUTUBE_CODE,
          posterRef: "",
          durationSecText: "",
        },
      }),
    );
    expect(ok.success).toBe(true);
  });

  it("014 EARS-24.2: platform ignores recording fields", () => {
    // Unchecked is today's behaviour byte-for-byte: an untouched recording block
    // is not a validation error, because a platform event carries no recording
    // at creation time at all.
    expect(EventFormSchema.safeParse(fields()).success).toBe(true);
    expect(
      EventFormSchema.safeParse(
        fields({
          recording: {
            kind: "edited",
            provider: "rutube",
            embedRef: "ччсапп",
            posterRef: "",
            durationSecText: "",
          },
        }),
      ).success,
    ).toBe(true);
  });
});
