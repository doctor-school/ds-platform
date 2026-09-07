import {
  ParticipationCtaSchema,
  parseDoctorEventReturnTarget,
} from "@ds/schemas";
import { describe, expect, it } from "vitest";

import {
  type ParticipationFacts,
  type ParticipationRoutes,
  resolveParticipationCta,
} from "./participation-cta.resolver.js";

/**
 * 020 EARS-1 (#1764) — the ONE participation-CTA policy, exercised at unit
 * speed. The resolver is a pure function of (lifecycle × registration × format
 * × seats) and a host route table, so every branch of LD-2/LD-5 is provable
 * here without a database, a clock or a host. The e2e siblings then prove only
 * that both live routes actually run THIS policy.
 */

/** The Academy host's routes — the shape `events.public.controller.ts` passes. */
const ACADEMY: ParticipationRoutes = {
  eventPath: (slug) => `/webinars/${slug}`,
  registrationEntry: "/register",
  roomPath: (slug) => `/webinars/${slug}/room`,
};

/**
 * The DOCTOR host's routes — the shape `doctor-events.public.controller.ts`
 * passes (`DOCTOR_ROUTES`). The same policy, a different route table: that is
 * the whole of the two-storefront claim, so the fixture mirrors the controller
 * rather than paraphrasing it.
 */
const DOCTOR: ParticipationRoutes = {
  eventPath: (slug) => `/events/${encodeURIComponent(slug)}`,
  registrationEntry: "/register",
  roomPath: (slug) => `/events/${encodeURIComponent(slug)}/room`,
};

/** A host that has not mounted a room route yet (the doctor storefront today). */
const NO_ROOM: ParticipationRoutes = { ...ACADEMY, roomPath: null };

function facts(over: Partial<ParticipationFacts> = {}): ParticipationFacts {
  return {
    slug: "kardio-2026",
    state: "published",
    format: "online",
    seatsLeft: null,
    registered: false,
    ...over,
  };
}

describe("resolveParticipationCta (020 EARS-1)", () => {
  it("020 EARS-1.1: an unregistered viewer on an upcoming event is offered registration carrying the page as returnTo", () => {
    const cta = resolveParticipationCta(facts(), ACADEMY);

    expect(cta.action).toBe("register");
    expect(cta.label).toBe("Участвовать");
    expect(cta.href).toBe("/register?returnTo=%2Fwebinars%2Fkardio-2026");
    expect(cta.reason).toBeNull();
  });

  it("020 EARS-1.2: a registered viewer on an upcoming event sees the registered state with no target", () => {
    const cta = resolveParticipationCta(facts({ registered: true }), ACADEMY);

    expect(cta.action).toBe("registered");
    expect(cta.label).toBe("Вы записаны");
    expect(cta.href).toBeNull();
  });

  it("020 EARS-1.3: a registered viewer on a live event is sent to the room", () => {
    const cta = resolveParticipationCta(
      facts({ state: "live", registered: true }),
      ACADEMY,
    );

    expect(cta.action).toBe("enter-room");
    expect(cta.label).toBe("Войти в эфир");
    expect(cta.href).toBe("/webinars/kardio-2026/room");
  });

  it("020 EARS-1.4: a hybrid event whose offline seats are exhausted switches the doctor to the online half", () => {
    const cta = resolveParticipationCta(
      facts({ format: "hybrid", seatsLeft: 0 }),
      ACADEMY,
    );

    expect(cta.action).toBe("switch-to-online");
    expect(cta.label).toBe("Участвовать онлайн");
    expect(cta.href).toBe("/register?returnTo=%2Fwebinars%2Fkardio-2026");
    expect(cta.reason).toBe("Очные места закончились — участвовать можно онлайн");
  });

  it("020 EARS-1.5: a pure offline event whose seats are exhausted says so in words with no target and no waiting list", () => {
    const cta = resolveParticipationCta(
      facts({ format: "offline", seatsLeft: 0 }),
      ACADEMY,
    );

    expect(cta.action).toBe("sold-out");
    expect(cta.label).toBe("Мест нет");
    expect(cta.href).toBeNull();
    expect(cta.reason).toBe("Очные места закончились, лист ожидания не ведётся");
  });

  it("020 EARS-1.6: a finished event offers no participation affordance at all", () => {
    const cta = resolveParticipationCta(facts({ state: "ended" }), ACADEMY);

    expect(cta.action).toBe("unavailable");
    expect(cta.href).toBeNull();
    expect(cta.reason).toBe("Событие завершилось");
  });

  it("020 EARS-1.7: a hidden event is unavailable for its own stated reason, not the ended one", () => {
    const cta = resolveParticipationCta(facts({ state: "hidden" }), ACADEMY);

    expect(cta.action).toBe("unavailable");
    expect(cta.reason).toBe(
      "Мероприятие скрыто — участие в нём больше не предлагается",
    );
  });

  it("020 EARS-1.8: a registration held on a finished event does not resurrect a CTA", () => {
    const cta = resolveParticipationCta(
      facts({ state: "ended", registered: true }),
      ACADEMY,
    );

    expect(cta.action).toBe("unavailable");
  });

  it("020 EARS-1.9: seats bind only where there is a room — an online event with seats_left = 0 still registers", () => {
    const cta = resolveParticipationCta(
      facts({ format: "online", seatsLeft: 0 }),
      ACADEMY,
    );

    expect(cta.action).toBe("register");
  });

  it("020 EARS-1.10: an offline event with seats remaining registers rather than selling out", () => {
    const cta = resolveParticipationCta(
      facts({ format: "offline", seatsLeft: 3 }),
      ACADEMY,
    );

    expect(cta.action).toBe("register");
  });

  it("020 EARS-1.11: an unregistered viewer on a live event is offered registration, never room entry", () => {
    const cta = resolveParticipationCta(facts({ state: "live" }), ACADEMY);

    expect(cta.action).toBe("register");
  });

  it("020 EARS-1.12: a host with no room route yields enter-room with an absent link, never a dead one", () => {
    const cta = resolveParticipationCta(
      facts({ state: "live", registered: true }),
      NO_ROOM,
    );

    expect(cta.action).toBe("enter-room");
    expect(cta.href).toBeNull();
  });

  it("020 EARS-1.13: the resolved CTA satisfies the portable ParticipationCta contract in every branch", () => {
    const cases: ParticipationFacts[] = [
      facts(),
      facts({ registered: true }),
      facts({ state: "live", registered: true }),
      facts({ format: "hybrid", seatsLeft: 0 }),
      facts({ format: "offline", seatsLeft: 0 }),
      facts({ state: "ended" }),
    ];

    const actions = cases.map(
      (f) => ParticipationCtaSchema.parse(resolveParticipationCta(f, ACADEMY)).action,
    );

    expect(actions).toEqual([
      "register",
      "registered",
      "enter-room",
      "switch-to-online",
      "sold-out",
      "unavailable",
    ]);
  });

  it("020 EARS-5: a guest on the doctor host is routed into 021 on the doctor host carrying this page as returnTo", () => {
    // The clause is about WHICH door and WHICH target. The door is this host's
    // own `/register` — never the academy's — and the target is this host's own
    // event path, percent-escaped, so the doctor comes back to exactly the page
    // they pressed the button on.
    const cta = resolveParticipationCta(facts(), DOCTOR);

    expect(cta.action).toBe("register");
    expect(cta.label).toBe("Участвовать");
    expect(cta.href).toBe("/register?returnTo=%2Fevents%2Fkardio-2026");
    expect(cta.reason).toBeNull();
    // The identity row: the same guest, the same policy, a different host — the
    // ACTION is a fact of the event, only the carried target differs.
    expect(resolveParticipationCta(facts(), ACADEMY).action).toBe(cta.action);
  });

  it("020 EARS-5.2: the carried target round-trips through the shared return-target parser, so 021 reads the event back out of it", () => {
    const cta = resolveParticipationCta(facts(), DOCTOR);
    const returnTo = new URL(
      cta.href ?? "",
      "https://doctor.school",
    ).searchParams.get("returnTo");

    // The contract between 020 and 021 is the VALUE, never a host string: what
    // the resolver writes is exactly what `@ds/schemas` parses back, so the
    // door can name the event it is returning the doctor to.
    expect(returnTo).toBe("/events/kardio-2026");
    expect(parseDoctorEventReturnTarget(returnTo ?? "")).toEqual({
      eventSlug: "kardio-2026",
      returnTo: "/events/kardio-2026",
    });
  });
});
