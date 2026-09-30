import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { loadDocument } from "@ds/legal-content";
import { CONGRESS_SUBMISSION_CONSENT_DOCUMENT_SLUG } from "@ds/schemas";

import { CONGRESS_SIGN_UP_CONSENT_VERSION_PATTERN } from "./congress-signup.config.js";
import { resolveCongressSubmissionConsentVersion } from "./congress-submission-consent.js";

const emptyDir = mkdtempSync(join(tmpdir(), "no-legal-documents-"));
// The consent document with an edition that is not a calendar date — the
// loader refuses it the way it refuses any malformed legal document.
const malformedDir = mkdtempSync(join(tmpdir(), "malformed-legal-documents-"));
writeFileSync(
  join(malformedDir, `${CONGRESS_SUBMISSION_CONSENT_DOCUMENT_SLUG}.md`),
  [
    "---",
    `slug: ${CONGRESS_SUBMISSION_CONSENT_DOCUMENT_SLUG}`,
    "title: Согласие",
    'edition: "2026-02-31"',
    "kind: consent",
    "---",
    "",
    "Текст.",
    "",
  ].join("\n"),
);
afterAll(() => {
  rmSync(emptyDir, { recursive: true, force: true });
  rmSync(malformedDir, { recursive: true, force: true });
});

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

  it("EARS-16: a malformed consent document is reported like a missing one, never thrown", () => {
    expect(
      resolveCongressSubmissionConsentVersion({ documentsDir: malformedDir }),
    ).toEqual({ ok: false, reason: "consent-document-malformed" });
  });
});
