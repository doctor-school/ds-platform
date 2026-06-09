import type { ConsentAcceptance } from "@ds/schemas";

/**
 * The consent the portal captures at registration (EARS-20). The BFF enforces a
 * non-empty consent array as a domain rule before it commits the PD-bearing
 * mirror row; the canonical purpose/version pair mirrors the api e2e fixtures
 * (`{ purpose: "tos", version: "2026-01" }`). A full per-purpose consent ledger
 * (ADR-0009) is a separate subsystem — for the v1 auth journey one accepted
 * Terms-of-Service version is the gate.
 */
export const REQUIRED_CONSENT: readonly ConsentAcceptance[] = [
  { purpose: "tos", version: "2026-01" },
];
