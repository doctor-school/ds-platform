import { describe, expect, it } from "vitest";
import type { CongressParticipantCard } from "@ds/schemas";
import {
  consentPurposeKey,
  participantCardFailure,
  participantCardFields,
  participantCardHref,
  participantCardNeighbour,
  pendingCardAnchor,
  queueCardRequest,
  settlePendingCards,
} from "./participant-card";
import { congressRosterUrl } from "@/providers/data-provider";

/**
 * 044 EARS-36 — the pure half of the participant card panel: which fields it
 * shows and how, which record ↑/↓ lands on, the `?registration=` link and the
 * refusal classes of the card read.
 */
const card: CongressParticipantCard = {
  registrationId: "7c0e2d0a-2d7c-4a7f-9c55-0a4f2d9b1a01",
  surname: "Иванова",
  firstName: "Мария",
  patronymic: "Петровна",
  fullName: "Иванова Мария Петровна",
  specialtyName: "Кардиология",
  workplace: "ГКБ №1",
  city: "Химки",
  region: "Московская область",
  phone: "8 (900) 111-22-33",
  email: "ivanova@example.test",
  // 09:00 МСК == 06:00Z.
  registeredAt: "2026-11-20T06:00:00.000Z",
  intakeOrigin: "desk",
  consents: [],
  confirmationMail: { status: null, at: null },
  possibleDuplicate: false,
  attendance: [],
};

describe("044 EARS-36 participant card", () => {
  it("EARS-36: reads the card route of one registration inside the roster's event", () => {
    expect(congressRosterUrl.card("congress-2027", card.registrationId)).toBe(
      `/v1/admin/events/congress-2027/registrations/${card.registrationId}`,
    );
  });

  it("EARS-36: shows every stored field — the phone exactly as typed, the date in МСК", () => {
    const fields = participantCardFields(card);
    expect(Object.keys(fields).sort()).toEqual(
      [
        "city",
        "email",
        "fullName",
        "phone",
        "region",
        "registeredAt",
        "specialtyName",
        "workplace",
      ].sort(),
    );
    expect(fields.phone).toBe("8 (900) 111-22-33");
    expect(fields.workplace).toBe("ГКБ №1");
    expect(fields.region).toBe("Московская область");
    expect(fields.registeredAt).toContain("09:00");
  });

  it("EARS-16/36: a field the registration does not carry renders empty, never a placeholder", () => {
    const fields = participantCardFields({
      ...card,
      specialtyName: null,
      workplace: null,
      city: null,
      region: null,
      phone: null,
      email: null,
    });
    for (const key of [
      "specialtyName",
      "workplace",
      "city",
      "region",
      "phone",
      "email",
    ] as const) {
      expect(fields[key]).toBe("");
    }
  });

  it("EARS-36: the congress consent purpose has a name; an unknown purpose has none", () => {
    expect(consentPurposeKey("congress-personal-data")).toBe(
      "congressPersonalData",
    );
    expect(consentPurposeKey("something-else")).toBeNull();
  });

  it("EARS-36: ↑/↓ walk the rows of the current page and stop at its ends", () => {
    const ids = ["a", "b", "c"];
    expect(participantCardNeighbour(ids, "b", "prev")).toBe("a");
    expect(participantCardNeighbour(ids, "b", "next")).toBe("c");
    expect(participantCardNeighbour(ids, "a", "prev")).toBeNull();
    expect(participantCardNeighbour(ids, "c", "next")).toBeNull();
    // A card opened by link for a row this page does not show has no neighbour.
    expect(participantCardNeighbour(ids, "z", "next")).toBeNull();
  });

  it("EARS-36: the open card is in the address as ?registration=, the rest of the query kept", () => {
    const path = "/events/e1/roster";
    expect(participantCardHref(path, "q=ivanova", "r1")).toBe(
      "/events/e1/roster?q=ivanova&registration=r1",
    );
    expect(participantCardHref(path, "q=ivanova&registration=r1", "r2")).toBe(
      "/events/e1/roster?q=ivanova&registration=r2",
    );
    expect(participantCardHref(path, "q=ivanova&registration=r1", null)).toBe(
      "/events/e1/roster?q=ivanova",
    );
    expect(participantCardHref(path, "registration=r1", null)).toBe(path);
  });

  it("EARS-36/38: a refused card read is told apart — grant gone, another event's record, anything else", () => {
    expect(participantCardFailure(401)).toBe("forbidden");
    expect(participantCardFailure(403)).toBe("forbidden");
    expect(participantCardFailure(404)).toBe("notFound");
    expect(participantCardFailure(500)).toBe("failed");
    expect(participantCardFailure(undefined)).toBe("failed");
  });

  it("EARS-36: a held ↓ walks on from the card it asked for, not from the address that has not caught up yet", () => {
    // Two presses before the address answers: the anchor is the newest request.
    expect(pendingCardAnchor(["b", "c"], "a")).toBe("c");
    // Nothing pending: the address is the card.
    expect(pendingCardAnchor([], "d")).toBe("d");
    // The address catches up one step: that request is settled, the next stays.
    expect(settlePendingCards(["b", "c"], "b")).toEqual(["c"]);
    expect(settlePendingCards(["c"], "c")).toEqual([]);
    // A close is a request too.
    expect(settlePendingCards([null], null)).toEqual([]);
    // The router committed only the newest of a burst: the newest occurrence
    // settles everything before it.
    expect(settlePendingCards(["a", "b", "a"], "a")).toEqual([]);
  });

  it("EARS-36: an address that answers none of the requests wins — the queue is dropped", () => {
    // A link (the desk's «Открыть запись») lands on Z while X is still queued.
    expect(settlePendingCards(["x"], "z")).toEqual([]);
    expect(pendingCardAnchor(settlePendingCards(["x"], "z"), "z")).toBe("z");
  });

  it("EARS-36: a click on the row whose card is already open queues nothing", () => {
    // The address will not change, so the request would never be answered.
    expect(queueCardRequest([], "x", "x")).toEqual([]);
    expect(queueCardRequest(["y"], "x", "x")).toEqual([]);
    expect(queueCardRequest([], "x", "y")).toEqual(["y"]);
    expect(queueCardRequest(["y"], "x", null)).toEqual(["y", null]);
  });
});
