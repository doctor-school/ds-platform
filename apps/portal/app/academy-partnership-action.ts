"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

import {
  ACADEMY_PARTNERSHIP_WRITE_ERROR,
  AcademyPartnershipSubmissionSchema,
  type AcademyPartnershipActionResult,
  type AcademyPartnershipSubmission,
} from "@/lib/academy-partnership-schema";
import { saveAcademyPartnershipSubmission } from "@/lib/academy-partnership-store";

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;
const MAX_RATE_BUCKETS = 10_000;
const attemptBuckets = new Map<
  string,
  { startedAt: number; idempotencyKeys: Set<string> }
>();

async function allowTransientAttempt(idempotencyKey: string): Promise<boolean> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for");
  const address =
    forwarded
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1) ??
    requestHeaders.get("x-real-ip")?.trim() ??
    "unattributed";
  const bucketKey = createHash("sha256").update(address).digest("hex");
  const idempotencyHash = createHash("sha256")
    .update(idempotencyKey)
    .digest("hex");
  const now = Date.now();
  for (const [key, bucket] of attemptBuckets) {
    if (now - bucket.startedAt >= RATE_WINDOW_MS) attemptBuckets.delete(key);
  }

  const bucket = attemptBuckets.get(bucketKey);
  if (!bucket) {
    if (attemptBuckets.size >= MAX_RATE_BUCKETS) return false;
    attemptBuckets.set(bucketKey, {
      startedAt: now,
      idempotencyKeys: new Set([idempotencyHash]),
    });
    return true;
  }
  // Exact retries remain idempotent and do not consume another unique attempt.
  if (bucket.idempotencyKeys.has(idempotencyHash)) return true;
  if (bucket.idempotencyKeys.size >= RATE_LIMIT) return false;
  bucket.idempotencyKeys.add(idempotencyHash);
  return true;
}

export async function submitAcademyPartnership(
  input: unknown,
): Promise<AcademyPartnershipActionResult> {
  const parsed = AcademyPartnershipSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<
      Record<keyof AcademyPartnershipSubmission, string>
    > = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in fieldErrors)) {
        fieldErrors[field as keyof AcademyPartnershipSubmission] =
          issue.message;
      }
    }
    return { status: "invalid", fieldErrors };
  }

  if (!(await allowTransientAttempt(parsed.data.idempotencyKey))) {
    return { status: "error", message: ACADEMY_PARTNERSHIP_WRITE_ERROR };
  }

  try {
    await saveAcademyPartnershipSubmission(parsed.data);
    return { status: "success" };
  } catch {
    console.error("[academy-partnership] persistence_failed");
    return { status: "error", message: ACADEMY_PARTNERSHIP_WRITE_ERROR };
  }
}
