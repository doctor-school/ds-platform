import { describe, expect, it } from "vitest";
import type { EventFormValues } from "@/components/event-form";
import { eventCreateVars } from "./event-create-vars";

/**
 * 007 EARS-1 / EARS-12 (#2913) — the create form's values → multipart
 * `POST /v1/admin/events` variables. The option «Скрыть число записавшихся»
 * rides the ordinary create, default off.
 */
const base: EventFormValues = {
  title: "Эфир",
  school: "Кардиошкола",
  startsAtMsk: "2026-11-03T10:00",
  durationMin: 60,
  description: "Описание",
  specialties: ["cardiology"],
  partnerRef: null,
  programPdf: null,
  legacy: false,
  recording: null,
  kindId: "22222222-2222-4222-8222-222222222222",
  participationFormat: "online",
  audience: "doctors",
  projectId: null,
  hideSignUpCount: false,
};

describe("eventCreateVars", () => {
  it("007 EARS-12: an untouched create sends the option off", () => {
    expect(eventCreateVars(base).hideSignUpCount).toBe(false);
  });

  it("007 EARS-12: a create with the option ticked sends it on", () => {
    expect(
      eventCreateVars({ ...base, hideSignUpCount: true }).hideSignUpCount,
    ).toBe(true);
  });

  it("007 EARS-1: every authored field is carried through, and never the project link", () => {
    const vars = eventCreateVars(base);
    expect(vars).toEqual({
      title: "Эфир",
      school: "Кардиошкола",
      startsAtMsk: "2026-11-03T10:00",
      durationMin: 60,
      description: "Описание",
      specialties: ["cardiology"],
      partnerRef: null,
      programPdf: null,
      kindId: "22222222-2222-4222-8222-222222222222",
      participationFormat: "online",
      audience: "doctors",
      hideSignUpCount: false,
    });
    expect("projectId" in vars).toBe(false);
  });
});
