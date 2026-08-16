import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  open,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  ACADEMY_CONSENT_PURPOSE,
  ACADEMY_CONSENT_TEXT,
  ACADEMY_CONSENT_VERSION_TAG,
  ACADEMY_PRIVACY_POLICY_URL,
  type AcademyPartnershipSubmission,
} from "./academy-partnership-schema";

export const ACADEMY_CONSENT = Object.freeze({
  purpose: ACADEMY_CONSENT_PURPOSE,
  versionTag: ACADEMY_CONSENT_VERSION_TAG,
  text: ACADEMY_CONSENT_TEXT,
  textSha256: createHash("sha256").update(ACADEMY_CONSENT_TEXT).digest("hex"),
  policyUrl: ACADEMY_PRIVACY_POLICY_URL,
});

export interface AcademyPartnershipRecord {
  id: string;
  acceptedAt: string;
  idempotencyKey: string;
  name: string;
  companyOrClinic?: string;
  contact: string;
  role: AcademyPartnershipSubmission["role"];
  consent: typeof ACADEMY_CONSENT & {
    accepted: true;
    acceptedAt: string;
  };
}

function filesystemCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function isRecordForSubmission(
  value: unknown,
  submission: AcademyPartnershipSubmission,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const consent = record.consent;
  if (typeof consent !== "object" || consent === null) return false;
  const consentRecord = consent as Record<string, unknown>;

  return (
    record.id === submission.idempotencyKey &&
    record.idempotencyKey === submission.idempotencyKey &&
    record.name === submission.name &&
    (record.companyOrClinic ?? "") === submission.companyOrClinic &&
    record.contact === submission.contact &&
    record.role === submission.role &&
    consentRecord.purpose === ACADEMY_CONSENT.purpose &&
    consentRecord.versionTag === ACADEMY_CONSENT.versionTag &&
    consentRecord.text === ACADEMY_CONSENT.text &&
    consentRecord.textSha256 === ACADEMY_CONSENT.textSha256 &&
    consentRecord.policyUrl === ACADEMY_CONSENT.policyUrl &&
    consentRecord.accepted === true
  );
}

async function assertMatchingIdempotentRetry(
  finalPath: string,
  submission: AcademyPartnershipSubmission,
): Promise<void> {
  let existing: unknown;
  try {
    existing = JSON.parse(await readFile(finalPath, "utf8")) as unknown;
  } catch {
    throw new Error("Academy submission idempotency payload mismatch");
  }
  if (!isRecordForSubmission(existing, submission)) {
    throw new Error("Academy submission idempotency payload mismatch");
  }
}

async function assertPrivateDirectory(directory: string): Promise<string> {
  if (!isAbsolute(directory)) {
    throw new Error("Academy submissions directory must be absolute");
  }

  const resolved = resolve(directory);
  const [entry, canonical, metadata] = await Promise.all([
    lstat(resolved),
    realpath(resolved),
    stat(resolved),
  ]);
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    canonical !== resolved
  ) {
    throw new Error("Academy submissions directory is unsafe");
  }
  if (process.platform !== "win32" && (metadata.mode & 0o777) !== 0o700) {
    throw new Error("Academy submissions directory must have mode 0700");
  }
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    metadata.uid !== process.getuid()
  ) {
    throw new Error(
      "Academy submissions directory must be owned by the runtime user",
    );
  }
  return resolved;
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function configuredAcademySubmissionsDirectory(): string {
  const directory = process.env.ACADEMY_SUBMISSIONS_DIR?.trim();
  if (!directory) {
    throw new Error("ACADEMY_SUBMISSIONS_DIR is required");
  }
  return directory;
}

/**
 * Writes a complete, fsynced staging file and atomically hard-links it into its
 * exclusive UUID destination. A retry with the same idempotency key observes the
 * existing destination and succeeds without creating another JSON record.
 */
export async function saveAcademyPartnershipSubmission(
  submission: AcademyPartnershipSubmission,
  configuredDirectory = configuredAcademySubmissionsDirectory(),
): Promise<{ id: string }> {
  const directory = await assertPrivateDirectory(configuredDirectory);
  const id = submission.idempotencyKey;
  const finalPath = join(directory, `${id}.json`);
  const stagingPath = join(directory, `.${id}.${randomUUID()}.tmp`);
  const acceptedAt = new Date().toISOString();
  const record: AcademyPartnershipRecord = {
    id,
    acceptedAt,
    idempotencyKey: submission.idempotencyKey,
    name: submission.name,
    ...(submission.companyOrClinic
      ? { companyOrClinic: submission.companyOrClinic }
      : {}),
    contact: submission.contact,
    role: submission.role,
    consent: {
      ...ACADEMY_CONSENT,
      accepted: true,
      acceptedAt,
    },
  };

  let stagingCreated = false;
  try {
    const handle = await open(stagingPath, "wx", 0o600);
    stagingCreated = true;
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(stagingPath, finalPath);
    } catch (error) {
      if (filesystemCode(error) !== "EEXIST") throw error;
      await assertMatchingIdempotentRetry(finalPath, submission);
      return { id };
    }
    await syncDirectory(directory);
    return { id };
  } finally {
    if (stagingCreated) {
      await rm(stagingPath, { force: true });
    }
  }
}
