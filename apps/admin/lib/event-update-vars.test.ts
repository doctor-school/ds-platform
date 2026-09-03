import { describe, expect, it } from "vitest";
import type { EventFormValues } from "@/components/event-form";
import { eventUpdateVars } from "./event-update-vars";

/**
 * 014 EARS-24/25 (#1741) Mode-a rework — an архивный эфир authored with an EMPTY
 * «Школа / серия» must stay editable.
 *
 * `LegacyBroadcastCreateBody.school` is `.max(200).default("")`, so a legacy эфир
 * legitimately carries no school; `UpdateEventRequest.school` is `.min(1).optional()`,
 * so the update either carries a non-empty school or omits the key. The edit page
 * used to send `school: ""` unconditionally, which the api refused with a 400 the
 * operator could only read as the generic «Не удалось сохранить изменения.» — an
 * эфир that could be created and never saved again. The rule is the client's to
 * apply because the server contract is the right one: absent ≠ blank.
 */
const base: EventFormValues = {
  title: "Эфир",
  school: "",
  startsAtMsk: "2026-09-03T10:00",
  durationMin: 60,
  description: "",
  speakers: [],
  specialties: [],
  partnerRef: null,
  programPdf: null,
  legacy: false,
  recording: null,
};

describe("eventUpdateVars", () => {
  it("EARS-25.1: a legacy эфир with an empty school omits the key entirely", () => {
    const vars = eventUpdateVars(base, { legacy: true });
    expect("school" in vars).toBe(false);
    expect(vars.school).toBeUndefined();
  });

  it("EARS-25.2: a legacy эфир whose school is only whitespace omits the key too", () => {
    const vars = eventUpdateVars({ ...base, school: "   " }, { legacy: true });
    expect("school" in vars).toBe(false);
  });

  it("EARS-25.3: a legacy эфир with a school still sends it, verbatim", () => {
    const vars = eventUpdateVars(
      { ...base, school: "Кардиошкола" },
      { legacy: true },
    );
    expect(vars.school).toBe("Кардиошкола");
  });

  it("EARS-25.4: a platform event keeps the required rule — the empty value is sent and the api refuses it", () => {
    const vars = eventUpdateVars(base, { legacy: false });
    expect("school" in vars).toBe(true);
    expect(vars.school).toBe("");
  });

  it("EARS-25.5: every other authored field is carried through unchanged", () => {
    const values: EventFormValues = {
      ...base,
      school: "Кардиошкола",
      description: "Описание",
      speakers: [{ name: "Иванов", regalia: "Кардиолог" }],
      specialties: ["cardiology"],
      partnerRef: "ACME",
    };
    expect(eventUpdateVars(values, { legacy: false })).toEqual({
      title: "Эфир",
      school: "Кардиошкола",
      startsAtMsk: "2026-09-03T10:00",
      durationMin: 60,
      description: "Описание",
      speakers: [{ name: "Иванов", regalia: "Кардиолог" }],
      specialties: ["cardiology"],
      partnerRef: "ACME",
      programPdf: null,
    });
  });
});
