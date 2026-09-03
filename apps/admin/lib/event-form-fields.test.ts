import { describe, expect, it } from "vitest";
import type { EventAdminDetail } from "@ds/schemas";
import {
  FORM_SAVED_RESET_OPTIONS,
  FORM_SYNC_RESET_OPTIONS,
  eventFormFields,
  streamConfigFields,
} from "./event-form-fields";

/**
 * #1593 owner Stage-B finding (2026-09-01) — 007 EARS-2 / EARS-3 form fields as a
 * PROJECTION of the server aggregate, not a mount-time snapshot.
 *
 * The stale-refusal copy promises «Данные на этой странице уже обновлены до
 * актуального состояния». Before this, only the badge and the action bar honoured
 * that promise: the edit form and the stream form were seeded once through
 * `defaultValues` and then never followed the refetched detail, so the sentence
 * was false about every field the operator could see. Making it true means the
 * forms re-derive from each refetched detail — and, because an operator may be
 * mid-edit when someone else's write lands, they re-derive WITHOUT discarding
 * what that operator has typed ({@link FORM_SYNC_RESET_OPTIONS}).
 */
const detail = {
  id: "11111111-1111-4111-8111-111111111111",
  version: 7,
  title: "Кардиология сегодня",
  school: "Кардиология",
  startsAt: "2026-09-10T07:00:00.000Z",
  durationMin: 90,
  description: "Описание",
  partnerRef: "partner-1",
  speakers: [{ name: "Докладчик", regalia: "д.м.н." }],
  specialties: ["cardiology", "therapy"],
  streamConfig: { provider: "rutube", embedRef: "abc123" },
} as unknown as EventAdminDetail;

describe("007 EARS-2/EARS-3 form fields projection (#1593)", () => {
  it("EARS-2: the edit fields are derived from the detail — title, school, МСК wall clock, duration, description, partner and the comma-joined specialties", () => {
    const fields = eventFormFields(detail);
    expect(fields.title).toBe("Кардиология сегодня");
    expect(fields.school).toBe("Кардиология");
    // 07:00Z is 10:00 МСК (UTC+3), rendered as the raw `datetime-local` value.
    expect(fields.startsAtMsk).toBe("2026-09-10T10:00");
    expect(fields.durationMin).toBe(90);
    expect(fields.description).toBe("Описание");
    expect(fields.partnerRef).toBe("partner-1");
    expect(fields.specialtiesText).toBe("cardiology, therapy");
  });

  it("EARS-2: speakers are COPIED, so a refetched projection can never alias the rows the form is editing", () => {
    const fields = eventFormFields(detail);
    expect(fields.speakers).toEqual([{ name: "Докладчик", regalia: "д.м.н." }]);
    expect(fields.speakers[0]).not.toBe(detail.speakers[0]);
  });

  it("EARS-2: with no detail (the create surface) the projection is the empty authoring form, never undefined fields", () => {
    const fields = eventFormFields(undefined);
    expect(fields).toEqual({
      title: "",
      school: "",
      startsAtMsk: "",
      durationMin: 60,
      description: "",
      partnerRef: "",
      speakers: [],
      specialtiesText: "",
      legacy: false,
      recording: { kind: "edited", provider: "rutube", embedRef: "" },
    });
  });

  it("014 EARS-24: a legacy detail projects `legacy: true`, a platform detail `false`", () => {
    expect(eventFormFields({ ...detail, origin: "legacy" }).legacy).toBe(true);
    expect(eventFormFields({ ...detail, origin: "platform" }).legacy).toBe(
      false,
    );
  });

  it("EARS-3: the stream fields are derived from the detail's configured provider and reference", () => {
    expect(streamConfigFields(detail)).toEqual({
      provider: "rutube",
      embedRef: "abc123",
    });
  });

  it("EARS-3: an unconfigured stream projects the first enum provider and an empty reference", () => {
    expect(
      streamConfigFields({ ...detail, streamConfig: null } as EventAdminDetail),
    ).toEqual({ provider: "rutube", embedRef: "" });
  });

  it("EARS-2: the shared sync options keep the operator's own edits — a server refetch updates untouched fields ONLY", () => {
    expect(FORM_SYNC_RESET_OPTIONS).toEqual({ keepDirtyValues: true });
  });

  it("EARS-2: a landed save re-baselines the form CLEAN — otherwise every field the operator ever touched stays dirty for the life of the page and a colleague's later change to it is silently dropped by the very option meant to keep the page current", () => {
    expect(FORM_SAVED_RESET_OPTIONS).toEqual({ keepDirtyValues: false });
    expect(FORM_SAVED_RESET_OPTIONS.keepDirtyValues).not.toBe(
      FORM_SYNC_RESET_OPTIONS.keepDirtyValues,
    );
  });
});
