import type { Project } from "@ds/db";
import { describe, expect, it, vi } from "vitest";
import type { ObjectStorage } from "../storage/index.js";
import type {
  IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import type { MediaCleanupService } from "./media/media-cleanup.service.js";
import type { StillImageNormalizer } from "./media/still-image-normalizer.js";
import type { ProjectExpertsRepository } from "./project-experts.repository.js";
import { ProjectsService } from "./projects.service.js";
import type { ProjectsRepository } from "./projects.repository.js";
import { TaxonomyError } from "./taxonomy.errors.js";

// 012 EARS-5 (#1287) — the unit half of the publish lock order.
//
// §3.2 fixes the order as «every affected expert, ascending stable id → the
// project», so `publishCommand` discovers the curator set OPTIMISTICALLY, locks
// exactly those experts, locks the project, and re-runs the discovery under both
// locks. The 412 leg of that re-check is UNREACHABLE from the e2e suite: the
// two reads happen inside one transaction that already holds the row locks, so
// no SQL fixture can make the second read disagree with the first without
// locking an expert AFTER the project — which is the deadlock the order exists
// to prevent. The seam that CAN be driven deterministically is the service
// against a stubbed repository, which is what this file does: the second
// discovery is scripted to return a different set, and the assertion is that the
// command refuses with 412 and mutates nothing.

const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const CURATOR_A = "10000000-0000-4000-8000-00000000000a";
const CURATOR_B = "10000000-0000-4000-8000-00000000000b";

const LEASE: IdempotencyLease = {
  key: "6f1d0a2e-0000-4000-8000-000000000001",
  actorId: null,
  method: "POST",
  route: "/v1/admin/projects/:id/publish",
  fingerprint: "fp",
  leaseEpoch: 1,
  leaseOwner: "owner",
};

/** A publishable draft: complete fields, version 3, never published before. */
function draftProject(): Project {
  return {
    id: PROJECT_ID,
    slug: "a-project",
    title: "A project",
    description: "A complete description.",
    status: "draft",
    version: 3,
    firstPublishedAt: null,
    deletedAt: null,
  } as unknown as Project;
}

/**
 * A `ProjectsService` whose two repositories answer from scripts. `discoveries`
 * is consumed in call order, so the first entry is the optimistic step-1 read
 * and the second is the post-lock step-4 re-check.
 */
function serviceWith(discoveries: string[][]) {
  const transitionVersioned = vi.fn();
  const relations = {
    activeCuratorExpertIds: vi
      .fn()
      .mockImplementation(() => Promise.resolve(discoveries.shift() ?? [])),
    lockExperts: vi.fn().mockResolvedValue([]),
  } as unknown as ProjectExpertsRepository;
  const repo = {
    findById: vi.fn().mockResolvedValue(draftProject()),
    lockById: vi.fn().mockResolvedValue(draftProject()),
    transaction: vi
      .fn()
      .mockImplementation((run: (tx: unknown) => Promise<unknown>) =>
        run({} as unknown),
      ),
    transitionVersioned,
  } as unknown as ProjectsRepository;
  const service = new ProjectsService(
    repo,
    {} as unknown as StillImageNormalizer,
    {} as unknown as IdempotencyService,
    {} as unknown as MediaCleanupService,
    {} as unknown as ObjectStorage,
    relations,
  );
  return { service, repo, relations, transitionVersioned };
}

describe("012 EARS-5 — project publish, the post-lock curator re-check", () => {
  it("012 EARS-5.5: when the curator set changes between the optimistic discovery and the locked re-check, the system shall answer 412 PRECONDITION_FAILED and write nothing", async () => {
    const { service, transitionVersioned } = serviceWith([
      [CURATOR_A],
      [CURATOR_B],
    ]);

    const refusal = await service
      .publish({ id: PROJECT_ID, expectedVersion: 3, lease: LEASE })
      .then(
        () => {
          throw new Error(
            "publish resolved — a curator set that moved under the locks must refuse",
          );
        },
        (err: unknown) => err,
      );

    expect(refusal).toBeInstanceOf(TaxonomyError);
    const error = refusal as TaxonomyError;
    expect(error.errorCode).toBe("PRECONDITION_FAILED");
    expect(error.getStatus()).toBe(412);
    expect(error.detail).toContain("curator changed");
    // The refusal is what the client retries against, so it must carry the
    // lease: an exact retry replays the STORED 412 rather than re-racing.
    expect(error.replayLease).toBe(LEASE);
    // Zero domain side effects (§EARS-17): the transition never ran.
    expect(transitionVersioned).not.toHaveBeenCalled();
  });

  it("012 EARS-5.5: when the curator set changes only in ORDER, the system shall still refuse — the re-check compares the sequence the lock order was taken in, not a bag", async () => {
    const { service, transitionVersioned } = serviceWith([
      [CURATOR_A, CURATOR_B],
      [CURATOR_B, CURATOR_A],
    ]);

    await expect(
      service.publish({ id: PROJECT_ID, expectedVersion: 3, lease: LEASE }),
    ).rejects.toMatchObject({ errorCode: "PRECONDITION_FAILED" });
    expect(transitionVersioned).not.toHaveBeenCalled();
  });

  it("012 EARS-5.5: when the locked re-check agrees with the optimistic discovery, the system shall pass the race gate and reach the completeness rules", async () => {
    // The negative control: without it, the two cases above would also pass
    // against a command that refused unconditionally. The publish still fails —
    // the stubbed curator is not an eligible one — but it fails LATER, on the
    // §2.3 invariant, which proves the 412 gate let an unchanged set through.
    const { service, transitionVersioned } = serviceWith([
      [CURATOR_A],
      [CURATOR_A],
    ]);

    await expect(
      service.publish({ id: PROJECT_ID, expectedVersion: 3, lease: LEASE }),
    ).rejects.toMatchObject({
      errorCode: "PUBLISHED_PROJECT_REQUIRES_CURATOR",
    });
    expect(transitionVersioned).not.toHaveBeenCalled();
  });
});
