import { ScaleCounters } from "@/components/scale-counters";

/**
 * 017 EARS-2 — the storefront home hero (canvas `design-source/doctor-home.dc.html`,
 * the «Герой» block).
 *
 * Every string below is transcribed VERBATIM from that canvas — the kicker, the
 * headline, the free-for-the-doctor sub-line and the evolutionary goal. The goal
 * in particular carries no gloss and no «готовится» marker beside it: EARS-2
 * names it as verbatim copy, and a marker would turn a stated intent into a
 * roadmap promise on a production surface.
 *
 * What is NOT here is as much of the contract as what is: the interface never
 * states who finances a doctor's learning, and no price in roubles, cart,
 * subscription or payment affordance appears on any 017 surface (EARS-2). The
 * sub-line says learning is free and stops there.
 *
 * The band is the navy `hero` role — the same value as the header band, so the
 * chrome and the hero read as one continuous blue (tokens.css `--color-hero`),
 * with `hero-muted` for the canvas's light-blue secondary text. Tokens only; the
 * canvas hex values (#114D9E / #D3E8FD) are exactly these roles.
 */
export function StorefrontHero() {
  return (
    <section
      data-testid="storefront-hero"
      className="bg-hero px-4 py-12 text-hero-foreground layout:px-12 layout:py-20"
    >
      <div className="mx-auto w-full max-w-container-content">
        <p className="mb-5 text-xs font-extrabold uppercase tracking-widest text-hero-muted">
          Медицинская образовательная платформа
        </p>

        {/*
          The page's single non-empty `h1` (the shell layout owns none — it wraps
          many routes and must not carry their heading).
        */}
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-balance layout:text-6xl">
          Doctor.School — бесплатное образование для врачей
        </h1>

        <p className="mt-6 max-w-prose text-base font-medium leading-relaxed text-hero-muted layout:text-lg">
          Выберите специальность — получите школы, курсы, уроки и события своей и
          смежных областей. Обучение бесплатно.
        </p>

        <ScaleCounters />

        <p
          data-testid="hero-goal"
          className="mt-9 inline-block border-2 border-header-hairline px-5 py-3.5 text-sm font-extrabold"
        >
          Создаём бесплатное децентрализованное медицинское образование
        </p>
      </div>
    </section>
  );
}
