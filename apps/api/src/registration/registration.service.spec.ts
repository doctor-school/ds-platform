import { describe, expect, it, vi } from "vitest";
import type { EventParticipationFormat } from "@ds/schemas";
import type { RecordingsProjectionService } from "../recordings/index.js";
import type {
  EventForRegistration,
  RegistrationRepository,
} from "./registration.repository.js";
import {
  EventNotRegistrableError,
  EventSoldOutError,
  RegistrationEventNotFoundError,
  RegistrationService,
} from "./registration.service.js";

// 020 EARS-9 (+ LD-5, F-020-3 Б) — `RegisterForEvent` decides «мест нет» through
// the ONE participation policy the event page's CTA reads, so the automatic
// guest-through-auth POST can never register a doctor on a pure offline event
// whose seats are gone (#2467). ADR-0003 design §3.6 rule 3 — a retired event resolves to no
// event at all (#2466): the repository read is the active projection, and the
// service maps its absence to the not-found refusal.
//
// The describe titles OPEN with the spec id — the ears-test-lint scope prefix.

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const EVENT_ID = "00000000-0000-4000-8000-0000000000bb";
const REGISTERED_AT = new Date("2026-10-01T10:00:00.000Z");

function service(event: EventForRegistration | null, registered = false) {
  const repo = {
    findUserIdBySub: vi.fn().mockResolvedValue(USER_ID),
    findEventForRegistration: vi.fn().mockResolvedValue(event),
    findRegisteredAt: vi
      .fn()
      .mockResolvedValue(registered ? REGISTERED_AT : null),
    upsertRegistration: vi
      .fn()
      .mockResolvedValue({ created: true, registeredAt: REGISTERED_AT }),
  };
  const svc = new RegistrationService(
    repo as unknown as RegistrationRepository,
    {} as RecordingsProjectionService,
  );
  return { svc, repo };
}

function event(
  format: EventParticipationFormat,
  seatsLeft: number | null,
): EventForRegistration {
  return { id: EVENT_ID, state: "published", format, seatsLeft };
}

describe("020 EARS-9 RegisterForEvent applies the participation seat policy", () => {
  it("020 EARS-9: a pure offline event whose seats are exhausted refuses the registration and writes no row", async () => {
    const { svc, repo } = service(event("offline", 0));
    await expect(svc.register("sold-out", "sub")).rejects.toBeInstanceOf(
      EventSoldOutError,
    );
    expect(repo.upsertRegistration).not.toHaveBeenCalled();
  });

  it("020 EARS-9: a hybrid event with no offline seats left still registers the doctor (online half)", async () => {
    const { svc, repo } = service(event("hybrid", 0));
    await expect(svc.register("hybrid", "sub")).resolves.toEqual({
      registered: true,
      registeredAt: REGISTERED_AT.toISOString(),
    });
    expect(repo.upsertRegistration).toHaveBeenCalledWith(
      USER_ID,
      EVENT_ID,
      "sub",
    );
  });

  it("020 EARS-9: an offline event with seats remaining or no seat limit registers", async () => {
    for (const seatsLeft of [3, null]) {
      const { svc, repo } = service(event("offline", seatsLeft));
      await expect(svc.register("offline", "sub")).resolves.toMatchObject({
        registered: true,
      });
      expect(repo.upsertRegistration).toHaveBeenCalledTimes(1);
    }
  });

  it("020 EARS-9: an online event with a stray seats_left = 0 never sells out", async () => {
    const { svc, repo } = service(event("online", 0));
    await expect(svc.register("online", "sub")).resolves.toMatchObject({
      registered: true,
    });
    expect(repo.upsertRegistration).toHaveBeenCalledTimes(1);
  });

  it("020 EARS-9: an already-registered doctor's repeat on a sold-out offline event stays the idempotent registered answer", async () => {
    const { svc, repo } = service(event("offline", 0), true);
    await expect(svc.register("sold-out", "sub")).resolves.toEqual({
      registered: true,
      registeredAt: REGISTERED_AT.toISOString(),
    });
    expect(repo.upsertRegistration).not.toHaveBeenCalled();
  });

  it("020 EARS-9: the lifecycle refusal still precedes the seat refusal on a finished sold-out event", async () => {
    const { svc } = service({ ...event("offline", 0), state: "ended" });
    await expect(svc.register("ended", "sub")).rejects.toBeInstanceOf(
      EventNotRegistrableError,
    );
  });
});

describe("ADR-0003 §3.6 rule 3 RegisterForEvent on a retired event", () => {
  it("ADR-0003 §3.6 rule 3: an event absent from the active projection is the not-found refusal and writes no row", async () => {
    const { svc, repo } = service(null);
    await expect(svc.register("retired", "sub")).rejects.toBeInstanceOf(
      RegistrationEventNotFoundError,
    );
    expect(repo.upsertRegistration).not.toHaveBeenCalled();
  });
});
