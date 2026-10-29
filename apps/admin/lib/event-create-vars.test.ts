import { describe, expect, it } from "vitest";
import type { EventFormValues } from "@/components/event-form";
import { eventCreateVars } from "./event-create-vars";

/**
 * 007 EARS-1 / EARS-12 (#2913) — the create form's values → multipart
 * `POST /v1/admin/events` variables. The option «Скрыть число записавшихся»
 * rides the ordinary create; the form starts it ticked (#3479).
 */
const base: EventFormValues = {
  title: "Эфир",
  school: "Кардиошкола",
  startsAtMsk: "2026-11-03T10:00",
  durationMin: 60,
  description: "Описание",
  specialties: ["cardiology"],
  partnerRef: null,
  venue: "Москва, ГК «Милан»",
  programPdf: null,
  legacy: false,
  recording: null,
  kindId: "22222222-2222-4222-8222-222222222222",
  participationFormat: "online",
  audience: "doctors",
  projectId: null,
  hideSignUpCount: true,
  showPresenceCount: false,
};

describe("eventCreateVars", () => {
  it("007 EARS-12: an untouched create sends the option on", () => {
    expect(eventCreateVars(base).hideSignUpCount).toBe(true);
  });

  it("007 EARS-12: a create with the option unticked sends it off", () => {
    expect(
      eventCreateVars({ ...base, hideSignUpCount: false }).hideSignUpCount,
    ).toBe(false);
  });

  it("007 EARS-13: an untouched create sends «Показывать зрителям число участников» off", () => {
    expect(eventCreateVars(base).showPresenceCount).toBe(false);
  });

  it("007 EARS-13: a create with «Показывать зрителям число участников» ticked sends it on", () => {
    expect(
      eventCreateVars({ ...base, showPresenceCount: true }).showPresenceCount,
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
      venue: "Москва, ГК «Милан»",
      programPdf: null,
      kindId: "22222222-2222-4222-8222-222222222222",
      participationFormat: "online",
      audience: "doctors",
      hideSignUpCount: true,
      showPresenceCount: false,
    });
    expect("projectId" in vars).toBe(false);
  });
});
