import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listDocuments, loadDocument, notFound } = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  loadDocument: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@ds/legal-content", () => ({ listDocuments, loadDocument }));
vi.mock("next/navigation", () => ({ notFound }));

import DoctorDocumentPage, { generateMetadata } from "./page";
import DocumentNotFound from "./not-found";

const doc = (slug: string, title: string, kind: "policy" | "consent") => ({
  slug,
  frontmatter: { slug, title, edition: "2026-09-07", kind },
  body: `## Раздел\n\nТекст документа ${slug}.`,
});

const POLICY = doc(
  "privacy-policy",
  "Политика персональных данных и согласия",
  "policy",
);
const CONSENT = doc("consent-photo-video", "Согласие на фото и видео", "consent");

/**
 * 028 EARS-7/EARS-10/EARS-12 (#1967) — `doctor.school/documents/:slug`.
 *
 * What belongs to THIS route, and is therefore what these tests assert, is the
 * resolution: which document, which neighbours, and which of the block four data
 * states a given loader answer maps to. How the document then LOOKS is the
 * shared block own contract, proven in `packages/design-system` (V-2).
 */
describe("028 #1967: the doctor document route", () => {
  beforeEach(() => {
    loadDocument.mockReset();
    listDocuments.mockReset();
    notFound.mockClear();
    loadDocument.mockReturnValue(POLICY);
    listDocuments.mockReturnValue([CONSENT, POLICY]);
  });

  it("028 EARS-7: the document renders with its title, edition and a back link to the documents list", async () => {
    const html = renderToStaticMarkup(
      await DoctorDocumentPage({ params: Promise.resolve({ slug: "privacy-policy" }) }),
    );

    expect(loadDocument).toHaveBeenCalledWith("privacy-policy");
    expect(html).toContain("Политика персональных данных и согласия");
    expect(html).toContain("редакция от 7 сентября 2026");
    expect(html).toContain('href="/documents"');
    expect(html).toContain('data-state="normal"');
  });

  it("028 EARS-7: «Другие документы» lists every OTHER published document and never the one being read", async () => {
    const html = renderToStaticMarkup(
      await DoctorDocumentPage({ params: Promise.resolve({ slug: "privacy-policy" }) }),
    );

    expect(html).toContain(
      'data-testid="legal-document-row-consent-photo-video"',
    );
    expect(html).not.toContain(
      'data-testid="legal-document-row-privacy-policy"',
    );
    expect(html).toContain('href="/documents/consent-photo-video"');
  });

  it("028 EARS-12: a slug with no document on disk raises the route 404 rather than rendering an empty page", async () => {
    loadDocument.mockReturnValue(undefined);

    await expect(
      DoctorDocumentPage({ params: Promise.resolve({ slug: "no-such-doc" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("028 EARS-12: that 404 is served INSIDE the shared shell, with the way back to the documents list", () => {
    const html = renderToStaticMarkup(<DocumentNotFound />);

    expect(html).toContain('data-state="not-found"');
    expect(html).toContain("Такого документа нет.");
    expect(html).toContain('href="/documents"');
  });

  it("028 EARS-7: a document file that cannot be read renders the error state, not a bare host 500", async () => {
    loadDocument.mockImplementation(() => {
      throw new Error("invalid frontmatter");
    });

    const html = renderToStaticMarkup(
      await DoctorDocumentPage({ params: Promise.resolve({ slug: "privacy-policy" }) }),
    );

    expect(notFound).not.toHaveBeenCalled();
    expect(html).toContain('data-state="error"');
    expect(html).toContain('href="/documents"');
  });

  it("028 EARS-10: the page title comes from the document, and a missing slug still titles the 404", async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "privacy-policy" }) }),
    ).resolves.toMatchObject({
      title: "Политика персональных данных и согласия — Doctor.School",
    });

    loadDocument.mockReturnValue(undefined);
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "no-such-doc" }) }),
    ).resolves.toMatchObject({ title: "Документ не найден — Doctor.School" });
  });
});
