import type { Expert } from "@ds/db";
import { describe, expect, it, vi } from "vitest";
import type { ObjectStorage } from "../storage/index.js";
import type {
  ExpertEventSlot,
  ExpertsRepository,
} from "./experts.repository.js";
import { ExpertsService } from "./experts.service.js";
import type {
  IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import type { MediaCleanupService } from "./media/media-cleanup.service.js";
import type { StillImageNormalizer } from "./media/still-image-normalizer.js";
import { TaxonomyError } from "./taxonomy.errors.js";

// 012 EARS-5 (#1287) — the unit half of the expert publish lock order.
//
// Same shape as the project one, over the expert's own affected set: the command
// discovers the ACTIVE event slots optimistically, locks those events ascending,
// locks the expert, and re-runs the discovery under the locks. The mismatch leg
// is unreachable from e2e — both reads run inside one transaction already
// holding the locks — so the seam under test is the service against a scripted
// repository. A link added, retired or re-positioned since step 1 means the
// publish was decided against a projection the operator never saw, and the
// contract for that is a 412 with no domain write.

const EXPERT_ID = "30000000-0000-4000-8000-000000000001";
const EVENT_ID = "40000000-0000-4000-8000-000000000001";

const LEASE: IdempotencyLease = {
  key: "6f1d0a2e-0000-4000-8000-000000000002",
  actorId: null,
  method: "POST",
  route: "/v1/admin/experts/:id/publish",
  fingerprint: "fp",
  leaseEpoch: 1,
  leaseOwner: "owner",
};

function slot(overrides: Partial<ExpertEventSlot> = {}): ExpertEventSlot {
  return {
    linkId: "50000000-0000-4000-8000-000000000001",
    eventId: EVENT_ID,
    position: 0,
    ...overrides,
  };
}

/** A publishable draft: every EARS-5 field present, version 7, never published. */
function draftExpert(): Expert {
  return {
    id: EXPERT_ID,
    slug: "an-expert",
    familyName: "Иванов",
    givenName: "Иван",
    patronymic: null,
    professionalRole: "Кардиолог",
    credentials: "к.м.н.",
    affiliation: "НМИЦ",
    bio: "Биография.",
    status: "draft",
    version: 7,
    firstPublishedAt: null,
    contentRemovedAt: null,
    deletedAt: null,
  } as unknown as Expert;
}

/**
 * An `ExpertsService` whose repository answers from a script. `discoveries` is
 * consumed in call order: entry one is the optimistic step-1 read, entry two the
 * post-lock step-4 re-check.
 */
function serviceWith(discoveries: ExpertEventSlot[][]) {
  const transitionVersioned = vi.fn();
  const repo = {
    findById: vi.fn().mockResolvedValue(draftExpert()),
    lockById: vi.fn().mockResolvedValue(draftExpert()),
    lockEvents: vi.fn().mockResolvedValue([]),
    activeEventSlots: vi
      .fn()
      .mockImplementation(() => Promise.resolve(discoveries.shift() ?? [])),
    activeLegacySpeakers: vi.fn().mockResolvedValue([]),
    transaction: vi
      .fn()
      .mockImplementation((run: (tx: unknown) => Promise<unknown>) =>
        run({} as unknown),
      ),
    transitionVersioned,
  } as unknown as ExpertsRepository;
  const service = new ExpertsService(
    repo,
    {} as unknown as StillImageNormalizer,
    {} as unknown as IdempotencyService,
    {} as unknown as MediaCleanupService,
    {} as unknown as ObjectStorage,
  );
  return { service, repo, transitionVersioned };
}

describe("012 EARS-5 — expert publish, the post-lock event-slot re-check", () => {
  it("012 EARS-5.11: when an event link is added between the optimistic discovery and the locked re-check, the system shall answer 412 PRECONDITION_FAILED and write nothing", async () => {
    const { service, transitionVersioned } = serviceWith([
      [slot()],
      [slot(), slot({ linkId: "50000000-0000-4000-8000-000000000002" })],
    ]);

    const refusal = await service
      .publish({ id: EXPERT_ID, expectedVersion: 7, lease: LEASE })
      .then(
        () => {
          throw new Error(
            "publish resolved — an event-slot set that moved under the locks must refuse",
          );
        },
        (err: unknown) => err,
      );

    expect(refusal).toBeInstanceOf(TaxonomyError);
    const error = refusal as TaxonomyError;
    expect(error.errorCode).toBe("PRECONDITION_FAILED");
    expect(error.getStatus()).toBe(412);
    expect(error.detail).toContain("event links changed");
    // The 412 carries the lease, so an exact retry replays the STORED refusal
    // instead of re-racing the same publish (EARS-17).
    expect(error.replayLease).toBe(LEASE);
    expect(transitionVersioned).not.toHaveBeenCalled();
  });

  it("012 EARS-5.11: when the same link is re-positioned between the two reads, the system shall refuse — a moved slot is a changed projection even at an unchanged link count", async () => {
    const { service, transitionVersioned } = serviceWith([
      [slot({ position: 0 })],
      [slot({ position: 1 })],
    ]);

    await expect(
      service.publish({ id: EXPERT_ID, expectedVersion: 7, lease: LEASE }),
    ).rejects.toMatchObject({ errorCode: "PRECONDITION_FAILED" });
    expect(transitionVersioned).not.toHaveBeenCalled();
  });

  it("012 EARS-5.11: when the locked re-check agrees with the optimistic discovery, the system shall pass the race gate and transition the expert", async () => {
    // The negative control for the two cases above: an unchanged slot set must
    // reach the transition, not merely fail differently.
    const { service, transitionVersioned } = serviceWith([[slot()], [slot()]]);
    // A sentinel at the transition, so "the gate let it through" is proven by a
    // distinguishable error rather than by the absence of the 412 — the later
    // `!moved` branch answers 412 too, and the two must not be conflated.
    const sentinel = new Error("reached the transition");
    transitionVersioned.mockRejectedValue(sentinel);

    await expect(
      service.publish({ id: EXPERT_ID, expectedVersion: 7, lease: LEASE }),
    ).rejects.toBe(sentinel);
    expect(transitionVersioned).toHaveBeenCalledTimes(1);
  });
});
