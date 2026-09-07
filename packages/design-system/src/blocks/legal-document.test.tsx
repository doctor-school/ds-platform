import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LegalDocument,
  LegalDocumentList,
  formatEditionLine,
} from "./legal-document";

afterEach(cleanup);

/**
 * 028 EARS-7 / EARS-11 / EARS-14 (#1966) — the shared reading component.
 * Canvas: `design-source/document.dc.html` (tocVariant А). The four data states
 * are host-resolved and all four render inside the SAME shell.
 */
const BODY = [
  "## 1. Общие положения",
  "",
  "Настоящая политика обработки персональных данных составлена в соответствии с требованиями закона.",
  "",
  "## 2. Основные понятия",
  "",
  "1. Первое понятие.",
  "2. Второе понятие.",
  "",
  "| Данные | Срок |",
  "| --- | --- |",
  "| Телефон | 5 лет |",
  "",
].join("\n");

const DOCUMENT = {
  title: "Политика персональных данных и согласия",
  edition: "2026-09-07",
  body: BODY,
};

const OTHERS = [
  {
    slug: "consent-photo-video",
    title: "Согласие на фото- и видеосъёмку",
    href: "/documents/consent-photo-video",
    note: "Как мы используем записи эфиров",
    editionLabel: "редакция от 7 сентября 2026",
    updated: true,
  },
  {
    slug: "user-agreement",
    title: "Пользовательское соглашение",
    href: "/documents/user-agreement",
    editionLabel: "редакция от 20 мая 2026",
  },
];

function renderNormal(props: Record<string, unknown> = {}) {
  return render(
    <LegalDocument
      document={DOCUMENT}
      backHref="/documents"
      others={OTHERS}
      {...props}
    />,
  );
}

describe("<LegalDocument> — normal state (028 EARS-7)", () => {
  it("028 EARS-7: renders the title, the edition line, the body and both ways back to the list", () => {
    renderNormal();

    expect(
      screen.getByRole("heading", { level: 1, name: DOCUMENT.title }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("legal-document-edition")).toHaveTextContent(
      "редакция от 7 сентября 2026",
    );
    expect(
      screen.getByText(/Настоящая политика обработки персональных данных/),
    ).toBeInTheDocument();
    for (const id of ["legal-document-back-top", "legal-document-back-bottom"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("href", "/documents");
    }
  });

  it("028 EARS-7: renders a «Другие документы» row per neighbour, each linking to its own slug", () => {
    renderNormal();

    expect(screen.getByTestId("legal-document-others")).toBeInTheDocument();
    expect(
      screen.getByTestId("legal-document-other-consent-photo-video"),
    ).toHaveAttribute("href", "/documents/consent-photo-video");
    expect(
      screen.getByTestId("legal-document-other-user-agreement"),
    ).toHaveAttribute("href", "/documents/user-agreement");
  });

  it("028 EARS-7: keeps a wide table inside its own scroll container so the page never widens", () => {
    renderNormal();

    const table = screen.getByRole("table");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
  });

  it("028 EARS-7: renders no «Другие документы» section when the host passes no neighbours", () => {
    renderNormal({ others: [] });

    expect(screen.queryByTestId("legal-document-others")).toBeNull();
  });
});

describe("<LegalDocument> — table of contents, вариант А (028 V-2)", () => {
  it("028 V-2: projects ONE heading set into both breakpoint renderings — sticky column at xl, collapsed list below it", () => {
    renderNormal();

    const aside = screen.getByTestId("legal-document-toc-aside");
    const collapsed = screen.getByTestId("legal-document-toc-collapsed");

    // Both are in the tree from the same data; the breakpoint decides which is
    // visible, so no host ever hand-keeps a second copy of the ToC.
    expect(aside.className).toContain("hidden");
    expect(aside.className).toContain("xl:block");
    expect(aside.className).toContain("xl:sticky");
    expect(collapsed.className).toContain("xl:hidden");

    const asideLinks = [...aside.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    const collapsedLinks = [...collapsed.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(asideLinks).toEqual(collapsedLinks);
    expect(asideLinks).toEqual(["#1-общие-положения", "#2-основные-понятия"]);
  });

  it("028 EARS-7: each ToC anchor resolves to a section actually present in the body", () => {
    const { container } = renderNormal();

    for (const link of screen.getByTestId("legal-document-toc-aside").querySelectorAll("a")) {
      const id = link.getAttribute("href")?.slice(1) ?? "";
      expect(container.querySelector(`section[id="${CSS.escape(id)}"]`)).not.toBeNull();
    }
  });

  it("028 EARS-7: omits the table of contents entirely for a short consent text with no headings", () => {
    render(
      <LegalDocument
        document={{
          title: "Согласие",
          edition: "2026-09-07",
          body: "Одна строка согласия.\n",
        }}
        backHref="/documents"
      />,
    );

    expect(screen.queryByTestId("legal-document-toc-aside")).toBeNull();
    expect(screen.queryByTestId("legal-document-toc-collapsed")).toBeNull();
  });
});

describe("<LegalDocument> — «обновлено» chip (028 EARS-11)", () => {
  it("028 EARS-11: shows the chip on a flagged row and on no other row", () => {
    renderNormal();

    const flagged = screen.getByTestId(
      "legal-document-other-consent-photo-video",
    );
    const plain = screen.getByTestId("legal-document-other-user-agreement");

    expect(flagged).toHaveTextContent("обновлено");
    expect(plain).not.toHaveTextContent("обновлено");
  });

  it("028 EARS-11: renders NO numeric version anywhere on the surface", () => {
    renderNormal({ updated: true });

    const surface = screen.getByTestId("legal-document").textContent ?? "";
    // «версия 2», «v2», «редакция 3» — every numeric version wording the surface
    // must never grow. The ISO edition date is the ONLY version marker.
    expect(surface).not.toMatch(/верси[яию]\s*№?\s*\d/i);
    expect(surface).not.toMatch(/\bv\s?\d+(\.\d+)*\b/i);
    expect(surface).not.toMatch(/редакция\s+№?\s*\d+\s*$/i);
  });

  it("028 EARS-11: the document's own header chip is host-fed, absent by default", () => {
    renderNormal();
    expect(screen.queryByTestId("legal-document-header-chip")).toBeNull();

    cleanup();
    renderNormal({ updated: true });
    expect(screen.getByTestId("legal-document-header-chip")).toHaveTextContent(
      "обновлено",
    );
  });
});

describe("<LegalDocument> — data states (028 EARS-7, 028-design dataState)", () => {
  it("028 EARS-7: the loading state announces the wait and shows no document copy", () => {
    render(<LegalDocument state="loading" backHref="/documents" />);

    const shell = screen.getByTestId("legal-document");
    expect(shell).toHaveAttribute("data-state", "loading");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    // The way back survives the wait — the reader is never stranded.
    expect(screen.getByTestId("legal-document-back-top")).toHaveAttribute(
      "href",
      "/documents",
    );
  });

  it("028 EARS-7: the error state renders an alert inside the same shell with a retry the host owns", async () => {
    const onRetry = vi.fn();
    render(
      <LegalDocument state="error" backHref="/documents" onRetry={onRetry} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Не удалось загрузить документ.",
    );
    screen.getByRole("button", { name: "Повторить" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("028 EARS-7: the error state omits the retry button when the host offers no retry", () => {
    render(<LegalDocument state="error" backHref="/documents" />);

    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
  });

  it("028 EARS-7: the not-found state stays inside the shell — never a bare host 404 — and leads back to the list", () => {
    render(<LegalDocument state="not-found" backHref="/documents" />);

    expect(screen.getByTestId("legal-document")).toHaveAttribute(
      "data-state",
      "not-found",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Такого документа нет." }),
    ).toBeInTheDocument();
    // Canvas L107-108 / L139-142: the headline is printed ONCE, in the hero.
    expect(screen.getAllByText("Такого документа нет.")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Все документы платформы →" }),
    ).toHaveAttribute("href", "/documents");
  });

  it("028 EARS-7: a non-normal state never renders a document body, even if one is passed", () => {
    render(
      <LegalDocument state="error" document={DOCUMENT} backHref="/documents" />,
    );

    expect(screen.queryByTestId("legal-document-body")).toBeNull();
  });
});

describe("formatEditionLine (028 EARS-11)", () => {
  it("028 EARS-11: prints the ISO edition as the RU date the canvas shows", () => {
    expect(formatEditionLine("2026-08-12", "редакция от")).toBe(
      "редакция от 12 августа 2026",
    );
  });

  it("028 EARS-11: reads the ISO date as a CALENDAR date, not an instant — the day never shifts by timezone", () => {
    // `new Date("2026-01-01")` is midnight UTC, which is 31 December in any
    // negative offset; parsing by field keeps the day the author wrote.
    expect(formatEditionLine("2026-01-01", "редакция от")).toBe(
      "редакция от 1 января 2026",
    );
  });

  it("028 EARS-11: passes a non-ISO value through rather than printing «Invalid Date»", () => {
    expect(formatEditionLine("скоро", "редакция от")).toBe("скоро");
  });
});

describe("<LegalDocument> — responsive hero (028 EARS-14)", () => {
  /**
   * At 390px the hero H1 must stay INSIDE the poster plate. The first build
   * shipped `text-3xl leading-none` with no wrap affordance, so a long Russian
   * word («персональных») overran the blue band and rendered white on the page
   * surface. The canvas H1 is `clamp(28px,4.2vw,46px)` + `text-wrap:balance`:
   * it steps DOWN on narrow viewports and balances instead of overflowing.
   */
  const RESPONSIVE_HEADING_CLASSES = [
    "text-2xl", // mobile step-down — the canvas clamp floor, not the 1440px size
    "sm:text-4xl", // the wide-viewport size is unchanged
    "text-balance",
    "break-words", // a single long word breaks rather than leaving the plate
    "hyphens-auto",
    "leading-tight", // `leading-none` clips descenders once the H1 wraps
  ];

  it("028 EARS-14: the document hero H1 steps down and wraps inside the plate on a narrow viewport", () => {
    render(
      <LegalDocument state="normal" document={DOCUMENT} backHref="/documents" />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      ...RESPONSIVE_HEADING_CLASSES,
    );
  });

  it("028 EARS-14: the not-found hero H1 carries the same responsive treatment", () => {
    render(<LegalDocument state="not-found" backHref="/documents" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      ...RESPONSIVE_HEADING_CLASSES,
    );
  });
});

/**
 * 028 EARS-3 / EARS-11 (#1967) — the row unit on its own.
 *
 * A host documents INDEX composes this exported list rather than hand-assembling
 * rows: `doctor-docs.dc.html` annotates the row as «юнит „строка-ссылка
 * документа"» taken as-is by the other lists, and the assertion that matters is
 * that the SAME anatomy renders whether it is reached through `<LegalDocument>`
 * or directly.
 */
describe("LegalDocumentList", () => {
  const ROWS = [
    {
      slug: "privacy-policy",
      title: "Политика персональных данных и согласия",
      href: "/documents/privacy-policy",
      editionLabel: "редакция от 7 сентября 2026",
      updated: false,
    },
    {
      slug: "consent-photo-video",
      title: "Согласие на фото и видео",
      href: "/documents/consent-photo-video",
      updated: true,
    },
  ];

  it("028 EARS-3: every row links to its own document URL under a host-chosen testid prefix", () => {
    render(<LegalDocumentList items={ROWS} testIdPrefix="documents-row" />);

    expect(screen.getByTestId("documents-row-privacy-policy")).toHaveAttribute(
      "href",
      "/documents/privacy-policy",
    );
    expect(
      screen.getByTestId("documents-row-consent-photo-video"),
    ).toHaveAttribute("href", "/documents/consent-photo-video");
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("028 EARS-11: the «обновлено» chip follows the host-fed boolean and no version number is rendered", () => {
    render(<LegalDocumentList items={ROWS} testIdPrefix="documents-row" />);

    expect(screen.getAllByText("обновлено")).toHaveLength(1);
    expect(
      screen.getByTestId("documents-row-consent-photo-video"),
    ).toHaveTextContent("обновлено");
    expect(
      screen.getByTestId("documents-row-privacy-policy"),
    ).not.toHaveTextContent("обновлено");
    expect(document.body.textContent).not.toMatch(/v\d|версия/i);
  });

  it("028 EARS-12: an empty list renders no rows at all", () => {
    render(<LegalDocumentList items={[]} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
