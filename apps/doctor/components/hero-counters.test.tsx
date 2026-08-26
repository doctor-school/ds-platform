import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroCounters } from "@/components/hero-counters";
import { StorefrontHero } from "@/components/storefront-hero";

/**
 * 017 EARS-2 — the four `dataState` renders of 017-design §6 row «Hero +
 * statistics», asserted at the level they are defined: what reaches the markup.
 *
 * Static server markup (not jsdom) keeps the doctor app's unit tier on its node
 * environment, exactly as `storefront-header.test.tsx` does; the browser tier
 * (`e2e/home-hero.spec.ts`) drives the same four states through a real fetch.
 */
const COMPUTED_AT = "2026-08-26T09:00:00.000Z";

describe("017 EARS-2: hero copy is the canvas copy", () => {
  it("017 EARS-2.1: the hero renders kicker, headline, free sub-line and the goal VERBATIM", () => {
    const html = renderToStaticMarkup(<StorefrontHero />);

    expect(html).toContain("Медицинская образовательная платформа");
    expect(html).toContain(
      "Doctor.School — бесплатное образование для врачей",
    );
    expect(html).toContain("Обучение бесплатно.");
    expect(html).toContain(
      "Создаём бесплатное децентрализованное медицинское образование",
    );
    // Verbatim means verbatim: no gloss appended to the goal and no readiness
    // marker beside it (EARS-2).
    expect(html).not.toMatch(/готовится|скоро|в разработке/i);
  });

  it("017 EARS-2.2: nothing commercial and no financing statement appears in the hero", () => {
    const html = renderToStaticMarkup(<StorefrontHero />);

    expect(html).not.toMatch(
      /₽|руб\.|рублей|корзин|подписк|оплат|тариф|спонсор|финансир|за счёт/i,
    );
  });
});

describe("017 EARS-2.M: the counters over design §6 row 1", () => {
  it("017 EARS-2.M1: обычно — four counters render from the one computed read, exposing computedAt", () => {
    const html = renderToStaticMarkup(
      <HeroCounters
        state={{
          kind: "ready",
          statistics: {
            doctors: 12400,
            specialties: 118,
            lessons: 340,
            eventsPerYear: 86,
            computedAt: COMPUTED_AT,
          },
        }}
      />,
    );

    expect(html).toContain(`data-computed-at="${COMPUTED_AT}"`);
    for (const label of [
      "врачей уже с нами",
      "специальностей",
      "уроков",
      "событий за год",
    ]) {
      expect(html).toContain(label);
    }
    // ru-RU grouping — the canvas renders «12 400» with a non-breaking space.
    expect(html).toMatch(/12\s400/);
    expect(html).toContain("118");
  });

  it("017 EARS-2.M2: загрузка — skeleton cells with no label and no number", () => {
    const html = renderToStaticMarkup(<HeroCounters state={{ kind: "loading" }} />);

    expect(html).toContain('data-state="loading"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("врачей уже с нами");
    expect(html).not.toMatch(/>\s*0\s*</);
  });

  it("017 EARS-2.M3: пусто — a counter with no source is OMITTED, never zeroed, and its neighbours render", () => {
    const html = renderToStaticMarkup(
      <HeroCounters
        state={{
          kind: "ready",
          statistics: {
            doctors: 12400,
            specialties: 118,
            eventsPerYear: 86,
            computedAt: COMPUTED_AT,
          },
        }}
      />,
    );

    // `lessons` has no source on the platform today — it must vanish, label and
    // all, rather than paint a placeholder zero.
    expect(html).not.toContain("уроков");
    expect(html).not.toContain('data-testid="hero-counter-lessons"');
    expect(html).toContain("врачей уже с нами");
    expect(html).toContain("событий за год");
  });

  it("017 EARS-2.M6: the band renders exactly N cells for N counters and reserves no fixed tracks", () => {
    const html = renderToStaticMarkup(
      <HeroCounters
        state={{
          kind: "ready",
          statistics: {
            doctors: 12400,
            specialties: 118,
            eventsPerYear: 86,
            computedAt: COMPUTED_AT,
          },
        }}
      />,
    );

    // Three counters ⇒ three cells. A FIXED four-track grid would keep the
    // fourth track, and the container's hairline background would paint it as a
    // pale empty tile beside «событий за год» on every production view — the
    // canvas collapses it (`auto-fit`), and so must this.
    expect(html.match(/data-testid="hero-counter-/g)).toHaveLength(3);
    expect(html).not.toMatch(/grid-cols-\d/);
    expect(html).toContain("flex-wrap");
  });

  it("017 EARS-2.M7: each cell is a definition TERM followed by its definition", () => {
    const html = renderToStaticMarkup(
      <HeroCounters
        state={{
          kind: "ready",
          statistics: { doctors: 12400, computedAt: COMPUTED_AT },
        }}
      />,
    );

    // Source order is `dt` → `dd` (what axe's `definition-list` rule reads);
    // the canvas's numeral-above-caption order is a `flex-col-reverse` concern.
    expect(html.indexOf("<dt")).toBeGreaterThan(-1);
    expect(html.indexOf("<dt")).toBeLessThan(html.indexOf("<dd"));
    expect(html).toContain("flex-col-reverse");
  });

  it("017 EARS-2.M4: a real measured zero RENDERS — absence and zero are different states", () => {
    const html = renderToStaticMarkup(
      <HeroCounters
        state={{
          kind: "ready",
          statistics: { lessons: 0, computedAt: COMPUTED_AT },
        }}
      />,
    );

    expect(html).toContain("уроков");
    expect(html).toMatch(/>0</);
  });

  it("017 EARS-2.M5: ошибка — counters omitted entirely, and the hero copy is untouched", () => {
    expect(renderToStaticMarkup(<HeroCounters state={{ kind: "error" }} />)).toBe(
      "",
    );
    // Every counter absent is the same surface: no empty labelled frame.
    expect(
      renderToStaticMarkup(
        <HeroCounters
          state={{ kind: "ready", statistics: { computedAt: COMPUTED_AT } }}
        />,
      ),
    ).toBe("");
  });
});
