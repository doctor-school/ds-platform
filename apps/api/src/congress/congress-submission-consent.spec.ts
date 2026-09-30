import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { loadDocument } from "@ds/legal-content";
import { CONGRESS_SUBMISSION_CONSENT_DOCUMENT_SLUG } from "@ds/schemas";

import { CONGRESS_SIGN_UP_CONSENT_VERSION_PATTERN } from "./congress-signup.config.js";
import { resolveCongressSubmissionConsentVersion } from "./congress-submission-consent.js";

const emptyDir = mkdtempSync(join(tmpdir(), "no-legal-documents-"));
afterAll(() => rmSync(emptyDir, { recursive: true, force: true }));

describe("046 EARS-16 — the submission consent version", () => {
  it("EARS-16: is the published consent document's edition plus the sha256 of its text", () => {
    const document = loadDocument(CONGRESS_SUBMISSION_CONSENT_DOCUMENT_SLUG);
    expect(document).toBeDefined();
    const digest = createHash("sha256").update(document!.body).digest("hex");

    const resolved = resolveCongressSubmissionConsentVersion();

    expect(resolved).toEqual({
      ok: true,
      version: `${document!.frontmatter.edition}.sha256-${digest}`,
    });
    // The same stamp shape the congress registration consent carries (044 EARS-9).
    if (resolved.ok) {
      expect(resolved.version).toMatch(
        CONGRESS_SIGN_UP_CONSENT_VERSION_PATTERN,
      );
    }
  });

  it("EARS-16: is independent of the congress registration consent setting", () => {
    const before = resolveCongressSubmissionConsentVersion();
    const saved = process.env.CONGRESS_SIGNUP_CONSENT_VERSION;
    process.env.CONGRESS_SIGNUP_CONSENT_VERSION = `2027-01-01.sha256-${"f".repeat(64)}`;
    try {
      expect(resolveCongressSubmissionConsentVersion()).toEqual(before);
    } finally {
      if (saved === undefined)
        delete process.env.CONGRESS_SIGNUP_CONSENT_VERSION;
      else process.env.CONGRESS_SIGNUP_CONSENT_VERSION = saved;
    }
  });

  it("EARS-16: an unpublished consent document is reported, never stamped", () => {
    expect(
      resolveCongressSubmissionConsentVersion({ documentsDir: emptyDir }),
    ).toEqual({ ok: false, reason: "consent-document-missing" });
  });
});
