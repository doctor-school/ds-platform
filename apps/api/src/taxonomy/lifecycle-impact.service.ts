import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  LIFECYCLE_IMPACT_TOKEN_TTL_MS,
  type LifecycleImpactRowKind,
  type TaxonomyLifecycleTransition,
} from "@ds/schemas";
import { loadEnv } from "../config/env.schema.js";
import { TaxonomyError } from "./taxonomy.errors.js";

// 012-design §3.1 — the lifecycle-impact preview envelope, implemented ONCE for
// every 012 resource that has a retire/restore pair. `event_projects` (EARS-6,
// #1288) is the first adopter; #1295 / #1296 consume this same service rather
// than re-deriving the token format.
//
// The service owns exactly the two mechanical halves §3.1 names — the canonical
// FINGERPRINT of the discovered set and the signed ENVELOPE binding it to one
// transition and one target version — and nothing about any particular
// resource: WHAT belongs in the set is a per-resource question its own service
// answers, and generalizing that here ahead of the second adopter would be
// speculation, not sharing.
//
// The token is deliberately opaque to the client: it carries no readable row
// content, only a digest, so a caller that cannot see a hidden relation still
// cannot learn of it by decoding the envelope it was handed (§3.1: rows the
// caller may not see are counted by the fingerprint, never listed).

/**
 * Fixed, deterministic signing secret used ONLY under the test runtime
 * (VITEST), so the DB-gated e2e suites run without provisioning a secret. Never
 * reached in a non-test runtime — the service fails closed there instead
 * (mirrors `TEST_FALLBACK_PEPPER` in `auth/session/auth-audit.ledger.ts`).
 */
const TEST_FALLBACK_SECRET = "test-only-insecure-lifecycle-impact-secret";

/**
 * ASCII US / RS. The fingerprint input is a flat string, so its field and row
 * boundaries must be characters that cannot occur inside a part — every part is
 * a UUID, an integer or a closed-enum member — otherwise two different sets
 * could render to one identical string and the digest would stop distinguishing
 * them.
 */
const UNIT_SEPARATOR = String.fromCharCode(0x1f);
const RECORD_SEPARATOR = String.fromCharCode(0x1e);

/**
 * One row of the canonical fingerprint input (§3.1): «sorted tuples of
 * table/kind, stable id, monotonic version where present, lifecycle state and
 * the exact event-public-eligibility inputs».
 *
 * `eligibility` is the string rendering of the inputs that decide whether the
 * row is currently publicly visible — for an event its record status and
 * lifecycle state, for a project its status. It is part of the tuple because a
 * relation whose OPPOSITE endpoint silently became public between preview and
 * confirmation changes what the confirmed transition would expose, even though
 * the relation row itself did not move.
 */
export interface LifecycleImpactTuple {
  kind: string;
  id: string;
  version: number | null;
  state: string;
  eligibility: string;
}

/** What an envelope binds. Every field is re-derived and re-checked on confirm. */
export interface LifecycleImpactBinding {
  transition: TaxonomyLifecycleTransition;
  targetKind: LifecycleImpactRowKind;
  targetId: string;
  targetVersion: number;
  fingerprint: string;
}

/** The signed payload, in its compact on-the-wire field names. */
interface EnvelopePayload {
  t: TaxonomyLifecycleTransition;
  k: LifecycleImpactRowKind;
  i: string;
  v: number;
  f: string;
  /** Issued-at, epoch ms. */
  iat: number;
  /** Expiry, epoch ms — `iat + LIFECYCLE_IMPACT_TOKEN_TTL_MS` (§3.1: 15 min). */
  exp: number;
}

@Injectable()
export class LifecycleImpactService {
  private readonly secret = resolveSigningSecret();

  /**
   * The canonical fingerprint of a discovered set. Sorting is done HERE, not by
   * the caller: two callers that discover the same rows in different orders
   * must produce the same digest, or the confirmation would refuse a set that
   * did not actually change.
   */
  fingerprint(tuples: readonly LifecycleImpactTuple[]): string {
    const canonical = tuples
      .map((t) =>
        [t.kind, t.id, t.version === null ? "-" : String(t.version), t.state, t.eligibility]
          // The unit separator cannot occur in any of the parts (ids are UUIDs,
          // states and kinds are closed enums), so no part can impersonate a
          // boundary and two different sets cannot collide into one string.
          .join(UNIT_SEPARATOR),
      )
      .sort()
      .join(RECORD_SEPARATOR);
    return createHash("sha256").update(canonical, "utf8").digest("hex");
  }

  /** Issue the opaque envelope a preview response carries (§3.1). */
  issue(binding: LifecycleImpactBinding, now = Date.now()): string {
    const payload: EnvelopePayload = {
      t: binding.transition,
      k: binding.targetKind,
      i: binding.targetId,
      v: binding.targetVersion,
      f: binding.fingerprint,
      iat: now,
      exp: now + LIFECYCLE_IMPACT_TOKEN_TTL_MS,
    };
    const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
    return `${body}.${this.sign(body)}`;
  }

  /**
   * Verify a presented envelope against the binding recomputed at confirmation
   * time. Every failure mode §3.1 lists — tampered, expired, wrong transition,
   * wrong target, changed fingerprint — is the SAME 412 `LIFECYCLE_IMPACT_STALE`
   * with no distinguishing detail: telling a caller which half went stale would
   * turn the token into an oracle over rows it may not see, and the remedy is
   * identical in every case (reload the preview).
   */
  verify(
    token: string,
    expected: LifecycleImpactBinding,
    now = Date.now(),
  ): void {
    const [body, signature] = token.split(".");
    if (!body || !signature || !this.signatureMatches(body, signature)) {
      throw stale();
    }
    let payload: EnvelopePayload;
    try {
      payload = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      ) as EnvelopePayload;
    } catch {
      throw stale();
    }
    if (
      typeof payload.exp !== "number" ||
      payload.exp <= now ||
      payload.t !== expected.transition ||
      payload.k !== expected.targetKind ||
      payload.i !== expected.targetId ||
      payload.v !== expected.targetVersion ||
      payload.f !== expected.fingerprint
    ) {
      throw stale();
    }
  }

  /**
   * The §3.1 presence check: a confirmation with NO envelope is 428
   * `LIFECYCLE_IMPACT_REQUIRED` — a distinct answer from 412, because the
   * client never previewed at all and there is nothing stale about it.
   */
  requireToken(raw: unknown): string {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TaxonomyError(
        "LIFECYCLE_IMPACT_REQUIRED",
        "confirm the transition with the Lifecycle-Impact-Token from its preview",
      );
    }
    return value.trim();
  }

  private sign(body: string): string {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }

  /** Constant-time comparison — a signature check must not leak by timing. */
  private signatureMatches(body: string, presented: string): boolean {
    const expected = Buffer.from(this.sign(body), "utf8");
    const actual = Buffer.from(presented, "utf8");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
}

function stale(): TaxonomyError {
  return new TaxonomyError(
    "LIFECYCLE_IMPACT_STALE",
    "the previewed impact no longer describes this transition; reload the preview and confirm again",
  );
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/**
 * Resolve the signing secret once at construction: the configured value, the
 * fixed test secret under VITEST, otherwise THROW. A non-test runtime with no
 * secret must not boot into a state where the impact gate signs with something
 * guessable — that would be the safeguard's absence wearing its shape.
 */
function resolveSigningSecret(): string {
  const configured = loadEnv().LIFECYCLE_IMPACT_TOKEN_SECRET;
  if (configured && configured.length > 0) return configured;
  if (process.env.VITEST) return TEST_FALLBACK_SECRET;
  throw new Error(
    "LIFECYCLE_IMPACT_TOKEN_SECRET is required: the lifecycle-impact confirmation gate cannot sign its envelope without one",
  );
}
