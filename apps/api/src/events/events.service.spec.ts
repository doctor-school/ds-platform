import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@ds/db";
import type {
  ObjectStorage,
  PutObjectInput,
  StoredObject,
} from "../storage/index.js";
import type {
  EventsRepository,
  EventWithSpeakers,
} from "./events.repository.js";
import type { SpeakerProjectionService } from "../taxonomy/speaker-projection.service.js";
import type { RecordingsProjectionService } from "../recordings/recordings.projection.js";
import { EventsService, type UploadedPdf } from "./events.service.js";

// 007 EARS-2 — GC-on-supersede (#627). When a program-PDF replacement commits
// the reference swap, the superseded object key is deleted from object storage
// (the bucket's steady state stays exactly the referenced set). The delete is
// BEST-EFFORT and strictly AFTER the durable commit: a failed delete leaves a
// rare, warn-logged orphan but never fails the upload, and a crash before the
// commit never deletes a still-referenced object. The unit harness drives the
// service against an in-memory storage/repo pair so the failure branch (a
// throwing delete) is exercisable — the happy path against the real MinIO lives
// in test/admin/edit-event.e2e-spec.ts.

const OLD_KEY = "events/programs/test-event-1a2b/1000-program.pdf";

function baseEvent(programPdfRef: string | null): Event {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "test-event-1a2b",
    title: "Тестовое мероприятие",
    school: "Кардиология сегодня",
    startsAt: new Date("2026-07-17T16:00:00.000Z"),
    durationMin: 90,
    description: "",
    specialties: ["cardiology"],
    partnerRef: null,
    programPdfRef,
    state: "published",
    liveAt: null,
    // 014 (#1339) — the operator's recording-readiness date; unset here.
    recordingExpectedBy: null,
    // #1278 — the ADR-0003 §3.6 retained-row lifecycle. A fixture event is a
    // live record, so it is `active` with no `deleted_at`.
    recordStatus: "active",
    deletedAt: null,
    // #1593 — the optimistic-concurrency counter; a fresh fixture is at its
    // insert default.
    version: 1,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  };
}

function aggregate(event: Event): EventWithSpeakers {
  return { event, speakers: [], streamConfig: null };
}

/** In-memory storage recording call order; `delete` optionally throws. */
class RecordingStorage implements ObjectStorage {
  readonly ops: string[] = [];
  readonly deleted: string[] = [];
  deleteError: Error | null = null;

  put(input: PutObjectInput): Promise<StoredObject> {
    this.ops.push(`put:${input.key}`);
    return Promise.resolve({ key: input.key, url: `memory://${input.key}` });
  }

  urlFor(key: string): Promise<string> {
    return Promise.resolve(`memory://${key}`);
  }

  exists(): Promise<boolean> {
    return Promise.resolve(true);
  }

  getBytes(): Promise<Buffer | null> {
    return Promise.resolve(null);
  }

  delete(key: string): Promise<void> {
    this.ops.push(`delete:${key}`);
    if (this.deleteError) return Promise.reject(this.deleteError);
    this.deleted.push(key);
    return Promise.resolve();
  }
}

/** A repo stub whose `updateEvent` records the commit point and echoes the patch. */
function repoStub(current: EventWithSpeakers, ops: string[]) {
  return {
    findById: vi.fn(() => Promise.resolve(current)),
    updateEvent: vi.fn(
      (
        _id: string,
        patch: { programPdfRef?: string | null },
      ): Promise<EventWithSpeakers> => {
        ops.push("commit");
        return Promise.resolve(
          aggregate({
            ...current.event,
            programPdfRef:
              patch.programPdfRef !== undefined
                ? patch.programPdfRef
                : current.event.programPdfRef,
          }),
        );
      },
    ),
  };
}

/**
 * The 012 EARS-8 merged speaker resolver as this admin-side unit sees it: the
 * suite drives `update()`, which never reads a public speaker projection, so the
 * double answers an empty projection and records nothing. It is a genuine stub
 * of a real collaborator, not a stand-in for missing behaviour — the merge
 * itself is proven end-to-end in `test/taxonomy/speaker-projection.e2e-spec.ts`.
 */
function speakerProjectionStub(): SpeakerProjectionService {
  return {
    resolve: () => Promise.resolve([]),
    resolveMany: (ids: string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, []]))),
  } as unknown as SpeakerProjectionService;
}

/**
 * The neutral recording answer: nothing published. These unit tests are about
 * the 004 allow-list and the lifecycle rules, not about EARS-3 resolution — the
 * projection's own behaviour is covered by `recordings.projection` and the 014
 * e2e suite.
 */
const PREPARING_PROJECTION = {
  state: "preparing" as const,
  primaryKind: null,
  secondaryKind: null,
  posterUrl: null,
  expectedBy: null,
};

function service(storage: RecordingStorage, repo: unknown): EventsService {
  return new EventsService(
    storage,
    repo as EventsRepository,
    speakerProjectionStub(),
    {
      // Both forms answer from ONE stub value: the real service derives the
      // single-event form from the batch form, so a fake that let them drift
      // would hide exactly the disagreement `toPublicPage` must not have.
      resolveRecordingProjections: (ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, PREPARING_PROJECTION]))),
      resolveRecordingProjection: () => Promise.resolve(PREPARING_PROJECTION),
    } as unknown as RecordingsProjectionService,
  );
}

const replacementPdf: UploadedPdf = {
  filename: "program-v2.pdf",
  contentType: "application/pdf",
  body: Buffer.from("%PDF-1.4\nV2\n%%EOF"),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("007 EARS-2 — superseded program-PDF GC (unit; #627)", () => {
  it("EARS-2: a successful supersede deletes the superseded object key — strictly after the reference swap commits", async () => {
    const storage = new RecordingStorage();
    const repo = repoStub(aggregate(baseEvent(OLD_KEY)), storage.ops);
    const svc = service(storage, repo);

    const detail = await svc.update(
      "11111111-1111-4111-8111-111111111111",
      {},
      replacementPdf,
    );

    // The old key — and only the old key — was deleted.
    expect(storage.deleted).toEqual([OLD_KEY]);
    // …and only AFTER the reference swap durably committed (never before — a
    // crash between delete and commit must not lose a still-referenced object).
    const commitAt = storage.ops.indexOf("commit");
    const deleteAt = storage.ops.indexOf(`delete:${OLD_KEY}`);
    expect(commitAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(commitAt);
    // The new reference is what the detail serves.
    expect(detail?.programPdfRef).not.toBe(OLD_KEY);
    expect(detail?.programPdfRef).toContain("program-v2.pdf");
  });

  it("EARS-2: a failed superseded-object delete is best-effort — the edit still succeeds serving the new file, and the orphan key is warn-logged", async () => {
    const storage = new RecordingStorage();
    storage.deleteError = new Error("minio: connection reset");
    const repo = repoStub(aggregate(baseEvent(OLD_KEY)), storage.ops);
    const svc = service(storage, repo);
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);

    const detail = await svc.update(
      "11111111-1111-4111-8111-111111111111",
      {},
      replacementPdf,
    );

    // The upload is NOT failed by the delete error: the swap stands.
    expect(detail).not.toBeNull();
    expect(detail?.programPdfRef).not.toBe(OLD_KEY);
    expect(detail?.programPdfRef).toContain("program-v2.pdf");
    // The orphan is surfaced as a structured warn carrying the orphan key.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(OLD_KEY);
  });

  it("EARS-2: no storage delete fires when the event had no prior PDF, nor when no replacement rides the request", async () => {
    // No prior PDF: a replacement stores the first key — nothing to GC.
    const noPrior = new RecordingStorage();
    const svcA = service(
      noPrior,
      repoStub(aggregate(baseEvent(null)), noPrior.ops),
    );
    await svcA.update(
      "11111111-1111-4111-8111-111111111111",
      {},
      replacementPdf,
    );
    expect(noPrior.deleted).toEqual([]);
    expect(noPrior.ops.filter((o) => o.startsWith("delete:"))).toEqual([]);

    // No replacement: a field-only edit leaves the stored object untouched.
    const noPdf = new RecordingStorage();
    const svcB = service(
      noPdf,
      repoStub(aggregate(baseEvent(OLD_KEY)), noPdf.ops),
    );
    await svcB.update("11111111-1111-4111-8111-111111111111", {
      title: "Обновлено",
    });
    expect(noPdf.deleted).toEqual([]);
    expect(noPdf.ops.filter((o) => o.startsWith("delete:"))).toEqual([]);
  });
});
