import { createHash } from "node:crypto";

// 017 — the deterministic `code` → `id` derivation for the closed Минздрав
// specialty book.
//
// The book row's primary key is derived from its own stable identity (`code`)
// instead of `defaultRandom()`, so that two independently built databases —
// notably two builds of the `ds_golden` template (#2063) — agree on
// `specialties_minzdrav.id` and therefore on every `doctor_specialties.
// specialty_id` that references it. A random default would make the golden
// template differ from build to build in exactly those columns.
//
// This derivation is applied ONLY to the INSERT branch of the seed's upsert.
// The `ON CONFLICT (code)` branch never touches `id`: a database that already
// carries the book keeps the ids it handed out, so no live row is ever
// re-identified by deploying this change.

/**
 * Fixed v5 namespace for the specialty book. Frozen forever: changing it would
 * derive different ids for the same codes and re-identify every book row on the
 * next fresh insert.
 */
const SPECIALTY_ID_NAMESPACE = "017c9b5a-1d3e-4b7f-9c2a-6e8d0f3a5b41";

/**
 * RFC-4122 v5 (SHA-1, name-based) UUID.
 *
 * Implemented here rather than pulled in as a dependency: it is fifteen lines
 * of well-specified byte work, and `@ds/db` should not grow a runtime package
 * for it.
 */
function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  if (namespaceBytes.length !== 16) {
    throw new Error(`uuid v5 namespace is not a UUID: ${namespace}`);
  }
  const digest = createHash("sha1")
    .update(namespaceBytes)
    .update(Buffer.from(name, "utf8"))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  // Version 5 in the high nibble of octet 6, RFC-4122 variant in octet 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The `id` a freshly inserted book row is given, derived from its `code`.
 *
 * Deterministic across processes, machines and rebuilds — that is the whole
 * point. Never used to LOOK UP a row: `code` remains the seed's conflict target
 * and the lookup key, because a database seeded before this derivation existed
 * still holds randomly generated ids.
 */
export function specialtyIdFromCode(code: string): string {
  if (code.length === 0) {
    throw new Error("specialty code must not be empty");
  }
  return uuidV5(SPECIALTY_ID_NAMESPACE, code);
}
