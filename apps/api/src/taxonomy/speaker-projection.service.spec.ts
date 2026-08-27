import { describe, expect, it } from "vitest";
import type { ObjectStorage } from "../storage/index.js";
import type {
  ExpertSpeakerProjectionRow,
  LegacySpeakerProjectionRow,
  SpeakerProjectionRepository,
} from "./speaker-projection.repository.js";
import { SpeakerProjectionService } from "./speaker-projection.service.js";

// 012 EARS-8 (#1290) — the unit half of the merged projection.
//
// The e2e suite proves the merge over the real stack, but two terms of the LD-2
// total order are UNREACHABLE from SQL fixtures: both partial unique indexes
// (`event_experts_event_position_active_uniq` and
// `event_speakers_event_position_active_uniq`) make two ACTIVE rows of the same
// source on one position unrepresentable. That is the right database posture and
// it is exactly why the stable-id tie-break exists: imported or manually
// corrupted data can still reach the resolver, and a public list that reshuffles
// between two identical requests is a defect. Here the resolver is handed the
// pair Postgres refuses to store.

const EVENT = "11111111-1111-4111-8111-111111111111";

function legacy(
  id: string,
  position: number,
  name: string,
): LegacySpeakerProjectionRow {
  return { id, eventId: EVENT, position, name, regalia: "к.м.н." };
}

function link(
  linkId: string,
  position: number,
  name: string,
  legacySpeakerId: string | null = null,
): ExpertSpeakerProjectionRow {
  return {
    linkId,
    eventId: EVENT,
    position,
    role: "Спикер",
    legacySpeakerId,
    expertId: `expert-${linkId}`,
    expertSlug: `slug-${linkId}`,
    expertName: name,
    expertCredentials: "д.м.н.",
    photoRef: null,
  };
}

function service(
  rows: {
    legacy?: LegacySpeakerProjectionRow[];
    links?: ExpertSpeakerProjectionRow[];
  } = {},
): SpeakerProjectionService {
  const repo = {
    publicEventIdFor: () => Promise.resolve(EVENT),
    legacySpeakers: () => Promise.resolve(rows.legacy ?? []),
    eligibleExpertLinks: () => Promise.resolve(rows.links ?? []),
  } as unknown as SpeakerProjectionRepository;
  const storage = {
    urlFor: (key: string) => Promise.resolve(`https://cdn.test/${key}`),
  } as unknown as ObjectStorage;
  return new SpeakerProjectionService(repo, storage);
}

describe("012 EARS-8 — the LD-2 total order (unit; #1290)", () => {
  it("EARS-8: two same-source rows on one position are ordered by stable id ASC", async () => {
    const svc = service({
      links: [
        link("ffffffff-0000-4000-8000-000000000001", 0, "Эксперт Ж"),
        link("00000000-0000-4000-8000-000000000001", 0, "Эксперт А"),
      ],
      legacy: [
        legacy("ffffffff-0000-4000-8000-000000000002", 1, "Легаси Ж"),
        legacy("00000000-0000-4000-8000-000000000002", 1, "Легаси А"),
      ],
    });

    const items = await svc.resolve(EVENT);

    expect(items.map((s) => s.name)).toEqual([
      "Эксперт А",
      "Эксперт Ж",
      "Легаси А",
      "Легаси Ж",
    ]);
  });

  it("EARS-8: the order is stable across repeated identical reads", async () => {
    const svc = service({
      links: [link("bbbbbbbb-0000-4000-8000-000000000001", 3, "Эксперт Б")],
      legacy: [
        legacy("aaaaaaaa-0000-4000-8000-000000000001", 3, "Легаси А"),
        legacy("cccccccc-0000-4000-8000-000000000001", 0, "Легаси В"),
      ],
    });

    const first = await svc.resolve(EVENT);
    const second = await svc.resolve(EVENT);

    expect(first.map((s) => s.name)).toEqual([
      "Легаси В",
      "Эксперт Б",
      "Легаси А",
    ]);
    expect(second).toEqual(first);
  });

  it("EARS-8: a published expert missing its display name yields no item and does NOT resurrect the row it supersedes", async () => {
    const corrupted = link(
      "dddddddd-0000-4000-8000-000000000001",
      0,
      // A published expert whose name column is null is corrupted data: the
      // read fails closed rather than publishing a nameless card.
      null as unknown as string,
      "eeeeeeee-0000-4000-8000-000000000001",
    );
    const svc = service({
      links: [corrupted],
      legacy: [legacy("eeeeeeee-0000-4000-8000-000000000001", 0, "Легаси А")],
    });

    expect(await svc.resolve(EVENT)).toEqual([]);
  });

  it("EARS-8: a photo reference is signed at read time; its absence is a present null", async () => {
    const withPhoto = {
      ...link("aaaaaaaa-0000-4000-8000-000000000009", 0, "Эксперт Ф"),
      photoRef: "media/experts/photo.webp",
    };
    const svc = service({
      links: [withPhoto, link("bbbbbbbb-0000-4000-8000-000000000009", 1, "Эксперт Б")],
    });

    const [signed, bare] = await svc.resolve(EVENT);

    expect(signed).toMatchObject({
      source: "expert",
      photoUrl: "https://cdn.test/media/experts/photo.webp",
    });
    expect(bare).toMatchObject({ source: "expert", photoUrl: null });
  });

  it("EARS-8: every requested event id is present in a batched resolve, empty ones included", async () => {
    const svc = service();

    const byEvent = await svc.resolveMany([EVENT, "22222222-2222-4222-8222-222222222222"]);

    expect([...byEvent.keys()]).toEqual([
      EVENT,
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect([...byEvent.values()]).toEqual([[], []]);
  });
});
