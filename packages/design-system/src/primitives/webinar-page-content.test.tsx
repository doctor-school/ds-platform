import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WebinarPageContent } from "./webinar-page-content";

afterEach(cleanup);

/**
 * Neo-brutalist event-page content set (004 EARS-2, source
 * `design-source/webinar-page.dc.html`). The two-column body of the public event
 * page — the complete decision set from the `PublicEventPage` projection laid out
 * to the canvas: the «О чём эфир» description, the downloadable program PDF, the
 * sponsor plate (backing partners), and the speaker cards. Off-scale canvas
 * geometry (the `1fr 380px` desktop split, the 64px speaker avatar) lives here in
 * the design-system SoT — `apps/*` lint-blocks arbitrary Tailwind values.
 * All user-facing copy is injected (EARS-13); the page passes it from the 003
 * message catalog. jsdom pins the content contract + the token/geometry contract.
 */

const COPY = {
  aboutLabel: "О чём эфир",
  programLabel: "Программа",
  programDownloadLabel: "Скачать программу (PDF)",
  speakersLabel: "Спикеры",
  sponsorEyebrow: "При поддержке",
  sponsorNote:
    "Спонсор оплачивает эфир и не влияет на программу. Содержание определяют спикеры и школа.",
};

const BASE = {
  ...COPY,
  description:
    "Разбираем три реальных случая пластики ахиллова сухожилия — от выбора техники до реабилитационного протокола.",
  speakers: [
    { name: "Анна Соколова", credentials: "Травматолог-ортопед, к.м.н." },
    { name: "Михаил Верещагин", credentials: "Хирург, профессор" },
  ],
  partners: [{ label: "Acme Pharma" }],
  programPdfUrl: "https://cdn.example.test/program-042.pdf",
};

describe("WebinarPageContent — content set (EARS-2)", () => {
  it("EARS-2: renders the description under the «О чём эфир» section header", () => {
    render(<WebinarPageContent {...BASE} />);
    expect(screen.getByText(COPY.aboutLabel)).toBeInTheDocument();
    expect(screen.getByText(BASE.description)).toBeInTheDocument();
  });

  it("EARS-2: renders every speaker with name + credentials under «Спикеры»", () => {
    render(<WebinarPageContent {...BASE} />);
    expect(screen.getByText(COPY.speakersLabel)).toBeInTheDocument();
    expect(screen.getByText("Анна Соколова")).toBeInTheDocument();
    expect(screen.getByText("Травматолог-ортопед, к.м.н.")).toBeInTheDocument();
    expect(screen.getByText("Михаил Верещагин")).toBeInTheDocument();
    expect(screen.getByText("Хирург, профессор")).toBeInTheDocument();
  });

  it("EARS-2: renders the backing partner label under «При поддержке»", () => {
    render(<WebinarPageContent {...BASE} />);
    expect(screen.getByText(COPY.sponsorEyebrow)).toBeInTheDocument();
    expect(screen.getByText("Acme Pharma")).toBeInTheDocument();
    expect(screen.getByText(COPY.sponsorNote)).toBeInTheDocument();
  });

  it("EARS-2: exposes the program PDF as a download link when the event carries one", () => {
    render(<WebinarPageContent {...BASE} />);
    const link = screen.getByRole("link", { name: COPY.programDownloadLabel });
    expect(link).toHaveAttribute("href", BASE.programPdfUrl);
    // #864: the PDF must open in a NEW tab, never navigate the event page away.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(screen.getByText(COPY.programLabel)).toBeInTheDocument();
  });

  it("EARS-2: omits the program affordance entirely when programPdfUrl is absent (no broken/empty link)", () => {
    const { programPdfUrl: _omitted, ...noPdf } = BASE;
    render(<WebinarPageContent {...noPdf} />);
    // The program download is the only link in the content set; absent ⇒ no link.
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(COPY.programLabel)).toBeNull();
    // The rest of the decision set still renders.
    expect(screen.getByText(BASE.description)).toBeInTheDocument();
    expect(screen.getByText("Анна Соколова")).toBeInTheDocument();
  });

  it("EARS-2: omits the sponsor plate when there are no backing partners", () => {
    render(<WebinarPageContent {...BASE} partners={[]} />);
    expect(screen.queryByText(COPY.sponsorEyebrow)).toBeNull();
    // The description + speakers still render.
    expect(screen.getByText(BASE.description)).toBeInTheDocument();
    expect(screen.getByText("Михаил Верещагин")).toBeInTheDocument();
  });
});

describe("WebinarPageContent — geometry + tokens (EARS-14)", () => {
  it("EARS-14: the desktop body is the 1fr / 380px two-column canvas grid", () => {
    const { container } = render(<WebinarPageContent {...BASE} />);
    const root = container.firstElementChild as HTMLElement;
    // Two columns only at the layout (>900px) breakpoint; stacked below it.
    expect(root.className).toContain("layout:grid");
    expect(root.className).toContain("layout:grid-cols-[1fr_380px]");
  });

  it("EARS-14: a speaker card is a bordered, raised surface card (2px border, 4px soft cast)", () => {
    render(<WebinarPageContent {...BASE} />);
    const card = screen.getByText("Анна Соколова").closest("div[class*='border-2']");
    expect(card).not.toBeNull();
    expect(card!.className).toContain("bg-card");
    // The canvas speaker cards use the soft 4px recede-cast (shadow-ghost token),
    // distinct from the status card's strong 6px cast.
    expect(card!.className).toContain("shadow-ghost");
  });

  it("EARS-14: the speaker avatar is the 64px tint square with the name initials", () => {
    render(<WebinarPageContent {...BASE} />);
    const avatar = screen.getByText("АС");
    expect(avatar.className).toContain("bg-tint");
    expect(avatar.className).toContain("text-tint-foreground");
    // 64px square = size-16 token.
    expect(avatar.className).toContain("size-16");
  });

  it("EARS-14: the program link paints the card-safe AA token, never text-primary", () => {
    render(<WebinarPageContent {...BASE} />);
    const link = screen.getByRole("link", { name: COPY.programDownloadLabel });
    // blue.700 card-safe token (#270 precedent) — NOT text-primary (blue.500,
    // fails AA on the card surface).
    expect(link.className).toContain("text-primary-action");
    expect(link.className).not.toContain("text-primary ");
  });
});
