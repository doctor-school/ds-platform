import { describe, expect, it } from "vitest";
import type { MyEventsTab, RecordingProjection } from "@ds/schemas";
import { ACADEMY_ROUTES, DOCTOR_ROUTES } from "../events/host-routes.js";
import type { RecordingsProjectionService } from "../recordings/index.js";
import type {
  MyEventRow,
  RegistrationRepository,
} from "./registration.repository.js";
import { RegistrationService } from "./registration.service.js";

// 005 EARS-6 / 014 EARS-9 — the «Мои события» read resolves, per row, the room
// href of the CALLING host (wave-2 entry gate §4.2 `MyEventItem`, §4.3 D8): the
// host is the controller, which passes its route table in, as D5 does for the
// live block. The rule is the participation policy's `enter-room` branch — a
// registered caller (every row of this read is registered) on a `live` event —
// and every other row carries `null`. Each row also carries its event's
// participation format, the input the viewer-zone time rule reads (gate row 26).
//
// The describe title OPENS with `005 EARS-6 ` — the ears-test-lint scope prefix.

const ROWS: Record<MyEventsTab, MyEventRow[]> = {
  upcoming: [
    {
      eventId: "00000000-0000-4000-8000-000000000001",
      slug: "live-one",
      title: "Идёт сейчас",
      school: "Школа A",
      startsAt: "2026-10-07T09:00:00.000Z",
      state: "live",
      participationFormat: "online",
    },
    {
      eventId: "00000000-0000-4000-8000-000000000002",
      slug: "soon-two",
      title: "Скоро",
      school: "Школа B",
      startsAt: "2026-10-08T09:00:00.000Z",
      state: "published",
      participationFormat: "offline",
    },
  ],
  recordings: [
    {
      eventId: "00000000-0000-4000-8000-000000000003",
      slug: "done-three",
      title: "Завершено",
      school: "Школа C",
      startsAt: "2026-10-01T09:00:00.000Z",
      state: "ended",
      participationFormat: "hybrid",
    },
  ],
};

function service(): RegistrationService {
  const repo = {
    findUserIdBySub: async () => "user-1",
    findMyEvents: async (_userId: string, tab: MyEventsTab) => ROWS[tab],
    countMyEvents: async () => ({ upcoming: 2, recordings: 1 }),
  } as unknown as RegistrationRepository;
  const preparing = { state: "preparing" } as unknown as RecordingProjection;
  const recordings = {
    resolveRecordingProjections: async (ids: string[]) =>
      new Map(ids.map((id) => [id, preparing])),
  } as unknown as RecordingsProjectionService;
  return new RegistrationService(repo, recordings);
}

describe("005 EARS-6 my events — the calling host's room href", () => {
  it("EARS-6: a registered live MyEventItem carries the host's room href; any other row carries null", async () => {
    const academy = await service().myEvents("sub", "upcoming", ACADEMY_ROUTES);
    expect(academy.data.map((row) => row.roomHref)).toEqual([
      "/webinars/live-one/room",
      null,
    ]);

    const doctor = await service().myEvents("sub", "upcoming", DOCTOR_ROUTES);
    expect(doctor.data.map((row) => row.roomHref)).toEqual([
      "/events/live-one/room",
      null,
    ]);

    const past = await service().myEvents("sub", "recordings", DOCTOR_ROUTES);
    expect(past.data.map((row) => row.roomHref)).toEqual([null]);
  });

  it("EARS-6: each MyEventItem carries its event's participation format", async () => {
    const upcoming = await service().myEvents(
      "sub",
      "upcoming",
      ACADEMY_ROUTES,
    );
    expect(upcoming.data.map((row) => row.participationFormat)).toEqual([
      "online",
      "offline",
    ]);
    const past = await service().myEvents("sub", "recordings", ACADEMY_ROUTES);
    expect(past.data.map((row) => row.participationFormat)).toEqual(["hybrid"]);
  });
});
