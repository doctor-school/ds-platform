import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listDocuments } = vi.hoisted(() => ({ listDocuments: vi.fn() }));

vi.mock("@ds/legal-content", () => ({ listDocuments }));

import DoctorDocumentsPage from "./page";

const POLICY = {
  slug: "privacy-policy",
  frontmatter: {
    slug: "privacy-policy",
    title: "Политика персональных данных и согласия",
    edition: "2026-09-07",
    kind: "policy" as const,
  },
  body: "## 1. Общие положения\n\nТекст.",
};

/**
 * 028 EARS-1/3/4/5/6 (#1967) — `doctor.school/documents`.
 *
 * The loader is mocked because the ASSERTIONS here are about the projection, not
 * about the content package: which rows the page chooses to show (EARS-3), what
 * it says when the set is empty or unreadable, and the host-owned copy the
 * canvas fixes. `packages/legal-content` proves its own reading in V-1.
 */
describe("028 #1967: the doctor documents index", () => {
  beforeEach(() => {
    listDocuments.mockReset();
    listDocuments.mockReturnValue([POLICY]);
  });

  it("028 EARS-1: the page renders the documents list, the contacts block and the requisites line", () => {
    const html = renderToStaticMarkup(<DoctorDocumentsPage />);

    expect(html).toContain("Документы и контакты");
    expect(html).toContain('data-testid="legal-document-row-privacy-policy"');
    expect(html).toContain('id="contacts"');
    expect(html).toContain('data-testid="documents-requisites"');
  });

  it("028 EARS-1: both section headings carry the canvas heading anatomy — the rule line beside the title", () => {
    const html = renderToStaticMarkup(<DoctorDocumentsPage />);

    // `doctor-docs.dc.html` L64-67 / L155-158: the h2 sits in a baseline flex
    // row at clamp(24px,3.6vw,36px)/800 with a full-width 2px rule nudged onto
    // the baseline — the same unit the storefront catalogue already draws.
    for (const id of ["documents-heading", "contacts-heading"]) {
      const heading = html.match(
        new RegExp(`<h2 id="${id}"[^>]*class="([^"]*)"`),
      );
      expect(heading, `${id} heading`).not.toBeNull();
      expect(heading?.[1]).toContain("text-2xl");
      expect(heading?.[1]).toContain("layout:text-4xl");
      expect(heading?.[1]).toContain("font-extrabold");
    }
    const rules =
      html.match(/border-t-2 border-foreground/g) ?? [];
    expect(rules, "section rule lines").toHaveLength(2);
  });

  it("028 EARS-3: exactly one row is listed, scoped to policy documents, and none of the canvas placeholder rows ship", () => {
    const html = renderToStaticMarkup(<DoctorDocumentsPage />);

    expect(listDocuments).toHaveBeenCalledWith("policy");
    const rows = html.match(/data-testid="legal-document-row-/g) ?? [];
    expect(rows, "documents rows").toHaveLength(1);
    expect(html).toContain("Политика персональных данных и согласия");
    for (const absent of [
      "Пользовательское соглашение",
      "Правила начисления очков",
      "Лицензия",
      "готовится",
      "скоро здесь",
    ]) {
      expect(html, `canvas row that must not ship: ${absent}`).not.toContain(
        absent,
      );
    }
  });

  it("028 EARS-4: the contacts block carries the support mailbox, its caption and only channels with a real URL", () => {
    const html = renderToStaticMarkup(<DoctorDocumentsPage />);

    expect(html).toContain('href="mailto:support@doctor.school"');
    expect(html).toContain("Мы отвечаем в рабочие дни.");
    expect(html).toContain('href="https://t.me/doctorschool"');
    // A `#` chip is a dead affordance: ВКонтакте and YouTube appear the day
    // their real URLs are recorded, never before (owner «hide until content»).
    expect(html).not.toMatch(/href="#"/);
    expect(html).not.toContain("ВКонтакте");
    expect(html).not.toContain("YouTube");
  });

  it("028 EARS-5: one requisites line with the operator's own values and no licence number", () => {
    const html = renderToStaticMarkup(<DoctorDocumentsPage />);

    expect(html).toContain(
      "ООО «Ивекскон» · ИНН 5032225006 · ОГРН 1155032013806 · Москва, ул. Енисейская д.2 с.2, офис 703",
    );
    expect(html).not.toMatch(/Лицензи/i);
  });

  it("028 EARS-6: the list carries no caption and no link to the Academy documents page", () => {
    const html = renderToStaticMarkup(<DoctorDocumentsPage />);

    expect(html).not.toContain(
      "Полный набор документов платформы — на странице документов Академии.",
    );
    expect(html).not.toContain('data-testid="documents-academy-caption"');
    // REQ-24 keeps exactly ONE Academy crossing on this storefront and the
    // footer owns it (owner Stage-B verdict, 2026-09-07): this page contributes
    // none — neither the caption nor the canvas «Клиникам и организациям» card.
    expect(html).not.toContain("academy.doctor.school");
  });

  it("028 #1967: the index carries no «Про согласия» explainer", () => {
    const html = renderToStaticMarkup(<DoctorDocumentsPage />);

    // The canvas `d-docs · согласия` block claimed consents are visible in the
    // cabinet and invited a withdrawal by support ticket. Neither is true of
    // this release, so the owner's Stage-B verdict (2026-09-07) drops the block
    // rather than softening its copy.
    expect(html).not.toContain('data-testid="documents-consents-note"');
    expect(html).not.toContain("Про согласия");
    expect(html).not.toContain('href="/account"');
  });

  it("028 EARS-12: an empty document set renders no rows and no placeholder", () => {
    listDocuments.mockReturnValue([]);

    const html = renderToStaticMarkup(<DoctorDocumentsPage />);

    expect(html).not.toContain('data-testid="legal-document-row-');
    expect(html).not.toContain("готовится");
    // The rest of the page still stands — contacts and requisites are not
    // conditional on a document existing.
    expect(html).toContain('data-testid="documents-requisites"');
  });

  it("028 EARS-1: an unreadable document set degrades to the canvas error state instead of taking the page down", () => {
    listDocuments.mockImplementation(() => {
      throw new Error("malformed document file");
    });

    const html = renderToStaticMarkup(<DoctorDocumentsPage />);

    expect(html).toContain("Не удалось загрузить список документов.");
    expect(html).toContain('data-testid="documents-requisites"');
  });
});
