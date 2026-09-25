import { describe, expect, it } from 'vitest';

import {
  MARKETING_COMMUNICATIONS_VERSION,
  MEDICAL_WORKER_DECLARATION_VERSION,
  PARTNER_DATA_SHARING_VERSION,
} from './doctor-register.service.js';

/**
 * 021 EARS-7 / ADR-0009 — the version a consent row carries names the WORDING
 * the doctor read, and the server stamps it.
 *
 * #2027 moved the doctor door onto the shared `@ds/auth-flow` copy: the
 * partner-data and marketing rows are re-worded to the canvas on this head, so
 * a row stamped with the previous version would claim text no visitor ever saw.
 * The medical-worker declaration is untouched — its label, help line and unmet
 * reason are byte-identical to the wording it was first recorded under — so
 * restamping it would be the same lie in the other direction.
 *
 * The rows themselves are written and read back against real Postgres in
 * `test/storefront/doctor-register-consents.e2e-spec.ts`, which takes these
 * constants symbolically; what is pinned HERE is which wording each names.
 */
describe('021 EARS-7: the server-stamped consent wording versions', () => {
  it('021 EARS-7.4: the re-worded access condition and opt-in name the #2027 canvas wording', () => {
    expect(PARTNER_DATA_SHARING_VERSION).toBe('2026-09-22');
    expect(MARKETING_COMMUNICATIONS_VERSION).toBe('2026-09-22');
  });

  it('021 EARS-7.5: the unchanged declaration keeps its own earlier version', () => {
    expect(MEDICAL_WORKER_DECLARATION_VERSION).toBe('2026-09');
    // The three wordings version INDEPENDENTLY (that is why they are three
    // constants): re-wording two of them may never restamp the third.
    expect(MEDICAL_WORKER_DECLARATION_VERSION).not.toBe(
      PARTNER_DATA_SHARING_VERSION,
    );
  });
});
