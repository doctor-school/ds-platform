import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { specialtyFeedPath, type AdjacentArea } from "@ds/schemas";

import { SpecialtyFeedAdjacentSection } from "@/components/specialty-feed-adjacent-block";

/**
 * 018 EARS-8 — the adjacent-areas block renders what its read answers. Static
 * server markup keeps the doctor unit tier on its node environment; the
 * browser tier (`e2e/feed-adjacent.spec.ts`) drives the real page.
 */
const area = (code: string, name: string): AdjacentArea => ({
  specialty: {
    id: `00000000-0000-4000-8000-${code.length.toString().padStart(12, "0")}`,
    code,
    name,
    isOther: false,
  },
  direction: { id: `d-${code}`, slug: `d-${code}`, title: `Направление ${name}` },
  feedHref: specialtyFeedPath(code),
});

const ITEMS = [area("revmatologiya", "Ревматология"), area("khirurgiya", "Хирургия")];
const retry = async () => null;

const render = (read: Parameters<typeof SpecialtyFeedAdjacentSection>[0]["read"]) =>
  renderToStaticMarkup(
    <SpecialtyFeedAdjacentSection
      read={read}
      retry={retry}
      specialtyCode="travmatologiya-i-ortopediya"
    />,
  );

describe("018 EARS-8: the adjacent areas block", () => {
  it("EARS-8: kicker and heading from the canvas, then one chip per entry linking into that specialty's feed, in read order", () => {
    const html = render({ ok: true, value: { items: ITEMS } });
    expect(html).toContain('data-screen-label="d-feed · смежные области"');
    expect(html).toContain("Не только ваша специальность");
    expect(html).toMatch(/<h2[^>]*>Смежные области<\/h2>/);
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
      (match) => [match[1], match[2]],
    );
    expect(links).toEqual([
      ["/feed/revmatologiya", "Ревматология"],
      ["/feed/khirurgiya", "Хирургия"],
    ]);
  });

  it("EARS-8: no lesson counter and no claim that adjacent content enters this feed", () => {
    const html = render({ ok: true, value: { items: ITEMS } });
    expect(html).not.toMatch(/урок/i);
    expect(html).not.toContain("попадают в эту же ленту");
  });

  it("EARS-8: no entries — the block stays in place and says so", () => {
    const html = render({ ok: true, value: { items: [] } });
    expect(html).toMatch(/<h2[^>]*>Смежные области<\/h2>/);
    expect(html).toContain("Для этой специальности смежные области пока не указаны.");
    expect(html).not.toContain("<a ");
  });

  it("EARS-8: a failed read is the block's own error with «Повторить»", () => {
    const html = render({ ok: false });
    expect(html).toMatch(/<h2[^>]*>Смежные области<\/h2>/);
    expect(html).toContain("Не удалось загрузить смежные области");
    expect(html).toContain("Повторить");
    expect(html).not.toContain("<a ");
  });
});
