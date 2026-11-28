import Image from "next/image";
import NextLink from "next/link";
import { Button } from "@ds/design-system/button";
import { Container } from "@ds/design-system/container";
import { Link } from "@ds/design-system/link";
import { EventsFeed } from "@ds/events-storefront/feed";
import type { PublicProjectCatalog } from "@ds/schemas";

import { ACADEMY_EVENTS_STOREFRONT } from "../lib/events-storefront.host-config";
import {
  expertCountLine,
  partnerCountLine,
  readPublicExpertCount,
  readPublicOrganisationCount,
  readPublicProjects,
  runningProjectCount,
} from "./academy-home-counts";
import { MaterialsFeedSection } from "./materials-feed-section";
import { retryAcademyEventsBlock } from "./webinars/retry-block-action";
import styles from "./academy-home.module.css";

/**
 * Feature 029 — the Academy home (`academy.doctor.school/`), built from the
 * owner-approved canvas `design-source/academy-home.dc.html` at its switch
 * defaults (goal «А»). A server composition of the host-only hero, «Кто мы»
 * and persona entries plus the mounted owner blocks (029 design §1, §5).
 */

/** 029 EARS-7 — the home's nearest-events cap. */
export const ACADEMY_HOME_EVENTS_LIMIT = 3;

/** The 033 «Подать заявку» page (033 EARS-2). */
const APPLY_HREF = "/apply";
/** The 034 «Как это работает» page (034 slice 1). */
const INVESTORS_HREF = "/investors";

const KICKER =
  "text-pill font-extrabold uppercase tracking-eyebrow text-primary-action";

/**
 * The canvas plaque: full-bleed tinted on a phone; from `layout` up the
 * bordered card with the 6px elevation cast (`solidPanel` + `plaque`).
 */
const SOLID_PANEL =
  "-mx-4 bg-tint px-4 py-6 layout:mx-0 layout:border-2 layout:border-border layout:bg-card layout:p-8 layout:shadow-lg";
/** The canvas tinted plaque (`tintPanel` + `plaque`). */
const TINT_PANEL = "-mx-4 bg-tint px-4 py-6 layout:mx-0 layout:p-8";

/** The hero card heading (canvas `h1` style, both cards). */
const HERO_HEADING =
  "text-title-xl font-extrabold leading-display tracking-display layout:text-3xl";
/** The persona block heading. */
const PERSONA_HEADING =
  "text-xl font-extrabold leading-title tracking-display layout:text-2xl";
/** The count line under a hero action. */
const COUNT_LINE =
  "mt-4 text-pill font-extrabold uppercase tracking-micro";

/**
 * 029 EARS-2 / EARS-3 / EARS-5 / EARS-8 — the split hero: «Экспертам» on the
 * white card (light tokens in both themes) and «Партнёрам» on the hero band,
 * each with its action and its count line computed from the platform.
 */
export async function AcademyHero({
  projects,
  experts,
  partners,
}: {
  projects: Promise<PublicProjectCatalog | null>;
  experts: Promise<number | null>;
  partners: Promise<number | null>;
}) {
  // Each read is settled on its own (resolves to `null` on failure, never rejects).
  const [catalog, expertCount, partnerCount] = await Promise.all([
    projects,
    experts,
    partners,
  ]);
  const expertLine = expertCountLine({
    running: runningProjectCount(catalog),
    experts: expertCount,
  });

  return (
    <section
      data-academy-section="hero"
      aria-label="Экспертам и партнёрам"
      className="bg-hero pt-10 pb-12 layout:pt-16 layout:pb-16"
    >
      <Container>
        <p className="mb-7 text-xs font-extrabold uppercase tracking-eyebrow text-hero-muted">
          Академия Doctor.School · закулисье платформы
        </p>
        <div className="grid gap-4 sm:grid-cols-2 layout:gap-7">
          <div data-hero-card="experts" className="shadow-hero-card">
            <div className="light h-full border-2 border-card bg-card p-6 text-foreground layout:p-10">
              <p className={`mb-3 ${KICKER}`}>Экспертам</p>
              <h1 className={`${HERO_HEADING} text-foreground`}>
                Создавайте образование вместе с нами
              </h1>
              <p className="mt-4 text-body-compact leading-relaxed text-muted-foreground">
                Участвуйте в подкасте, создайте курс или школу, выступите на
                конгрессе — с командой производства, как автор или соавтор
                проекта.
              </p>
              <Button asChild size="lg" className="mt-6">
                <NextLink href={APPLY_HREF}>Подать заявку</NextLink>
              </Button>
              {expertLine === null ? null : (
                <p
                  data-testid="academy-expert-count-line"
                  className={`${COUNT_LINE} text-faint`}
                >
                  {expertLine}
                </p>
              )}
            </div>
          </div>
          <div
            data-hero-card="partners"
            className="flex flex-col border-2 border-header-hairline p-6 layout:p-10"
          >
            <p className="mb-3 text-pill font-extrabold uppercase tracking-eyebrow text-hero-muted">
              Партнёрам
            </p>
            <h2 className={`${HERO_HEADING} text-hero-foreground`}>
              Постройте репутацию в экспертной среде
            </h2>
            <p className="mt-4 text-body-compact leading-relaxed text-hero-muted">
              Участвуйте в проектах вместе с экспертами: соавторство
              направлений, события и прямой доступ к профессиональной среде.
            </p>
            <Button
              asChild
              size="lg"
              variant="on-primary"
              className="mt-6 self-start"
            >
              <NextLink href={INVESTORS_HREF}>Как это работает</NextLink>
            </Button>
            <p
              data-testid="academy-partner-count-line"
              className={`${COUNT_LINE} text-hero-muted`}
            >
              {partnerCountLine(partnerCount)}
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}

/** 029 EARS-6 — «Кто мы» with the «Миссия | Эволюционная цель» row (goal «А»). */
function WhoSection() {
  return (
    <section
      data-academy-section="who"
      aria-labelledby="academy-who-heading"
      className="mt-section-sm layout:mt-section"
    >
      <Container>
        <p className={`mb-2.5 ${KICKER}`}>Академия</p>
        <h2
          id="academy-who-heading"
          className="mb-4 text-title-xl font-extrabold leading-display tracking-display text-foreground layout:text-3xl"
        >
          Кто мы
        </h2>
        <p className="max-w-3xl text-pretty text-body-compact leading-reading-list text-muted-foreground layout:text-lead">
          Doctor.School создаёт децентрализованное образование для врачей —
          образование, в развитии которого может участвовать каждый: и эксперт,
          и компания.
        </p>
        <div className="mt-6 flex flex-col gap-4 layout:mt-10 layout:grid layout:grid-cols-2 layout:items-stretch layout:gap-7">
          <div data-who-panel="mission" className={SOLID_PANEL}>
            <p className={`mb-3 ${KICKER}`}>Миссия</p>
            <p className="text-pretty text-base font-semibold leading-prose text-foreground layout:text-lg">
              Создать равную свободную среду для самореализации врачей, где
              талант важнее связей, а качественное образование доступно
              каждому. Сделать медобразование децентрализованным и открытым и
              минимизировать врачебные ошибки.
            </p>
          </div>
          <div
            data-who-panel="goal"
            className={`flex flex-col justify-center ${TINT_PANEL}`}
          >
            <p className={`mb-3 ${KICKER}`}>Эволюционная цель</p>
            <p className="text-balance text-xl font-extrabold leading-title tracking-display text-primary-action layout:text-2xl">
              Создаём децентрализованное медицинское образование
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}

/**
 * 029 EARS-7 — «Ближайшие эфиры»: the shared 019 `EventsFeed` block with the
 * Academy host config, the cap and the Academy events page's block retry; its
 * cards, marks, empty/error/skeleton states and «Все события» are the block's.
 */
function EventsSection() {
  return (
    <section
      id="events"
      data-academy-section="events"
      aria-labelledby="academy-events-heading"
      className="mt-section-sm scroll-mt-24 layout:mt-section"
    >
      <Container>
        <div className="mb-4 border-t-2 border-border pt-4">
          <p className={`mb-2 ${KICKER}`}>Эфиры</p>
          <h3
            id="academy-events-heading"
            className="text-lg font-extrabold tracking-tight text-foreground layout:text-title-xl"
          >
            Ближайшие эфиры
          </h3>
        </div>
        <EventsFeed
          config={ACADEMY_EVENTS_STOREFRONT}
          limit={ACADEMY_HOME_EVENTS_LIMIT}
          retry={retryAcademyEventsBlock}
        />
      </Container>
    </section>
  );
}

/**
 * 029 EARS-8 / EARS-9 — the persona entries: «Экспертам» → `/apply` and
 * «Инвесторам» → `/investors`, side by side on a desktop, stacked on a phone.
 */
function PersonaSection() {
  return (
    <section
      data-academy-section="personas"
      aria-label="Экспертам и инвесторам"
      className="mt-section-sm layout:mt-section"
    >
      <Container>
        <div className="flex flex-col gap-4 layout:grid layout:grid-cols-2 layout:items-stretch layout:gap-7">
          <div
            id="experts"
            data-persona="experts"
            className={`flex scroll-mt-24 flex-col ${SOLID_PANEL}`}
          >
            <p className={`mb-3 ${KICKER}`}>Экспертам</p>
            <h3 className={`${PERSONA_HEADING} text-foreground`}>
              Ваше имя — в проектах Академии
            </h3>
            <p className="mt-3 flex-1 text-body-compact leading-relaxed text-muted-foreground">
              Участвуйте в подкасте, создайте курс или школу, выступите на
              конгрессе. К проекту эксперт присоединяется как автор или
              соавтор — с командой производства.
            </p>
            <Button asChild size="lg" className="mt-6 self-start">
              <NextLink href={APPLY_HREF}>
                Подать заявку на участие в проекте
              </NextLink>
            </Button>
          </div>
          <div
            id="investors"
            data-persona="investors"
            className="-mx-4 flex scroll-mt-24 flex-col bg-primary-surface px-4 py-6 layout:mx-0 layout:border-2 layout:border-border layout:p-8 layout:shadow-panel"
          >
            <p className="mb-3 text-pill font-extrabold uppercase tracking-eyebrow text-primary-surface-soft">
              Инвесторам
            </p>
            <h3 className={`${PERSONA_HEADING} text-primary-surface-foreground`}>
              Внимание врачей для вашего бренда — этично и прозрачно
            </h3>
            <p className="mt-3 flex-1 text-body-compact leading-relaxed text-primary-surface-soft">
              Организация участвует в проектах рядом с экспертами: партнёрский
              материал всегда помечен, модель открыта.
            </p>
            <Button
              asChild
              size="lg"
              variant="on-primary"
              className="mt-6 self-start"
            >
              <NextLink href={INVESTORS_HREF}>Как это работает</NextLink>
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}

/**
 * The Academy home's own footer (feature 013): the page-local section index,
 * the brand line and the giant wordmark.
 *
 * #2664 — the page does NOT render it: the root layout's `@footer`
 * parallel-route slot mounts it on `/` only, AFTER the layout's `<main>`, so it
 * is the page's top-level `contentinfo` landmark (inside `<main>` a `<footer>`
 * is no landmark). Every other route's slot renders nothing; the shared
 * storefront footer stands down on `/` (`academyShellConfig`).
 *
 * The index names only sections the 029 home mounts; «Проекты» → `#projects`
 * returns with the 030 projects block, which carries that id (#3506).
 */
export function AcademyHomeFooter() {
  return (
    <footer>
      <Container className="flex flex-wrap items-center justify-between gap-5 border-t-2 border-border py-8">
        <Image
          src="/brand/logo.svg"
          alt="Doctor.School"
          width={500}
          height={164}
          className={`${styles.footerLogoColor} h-6 w-auto`}
        />
        <Image
          src="/brand/logo-white.svg"
          alt=""
          aria-hidden="true"
          width={500}
          height={164}
          className={`${styles.footerLogoWhite} h-6 w-auto`}
        />
        <nav
          aria-label="Навигация в подвале"
          className="flex flex-wrap gap-5 text-caption"
        >
          <Link href="#events">Эфиры</Link>
          <Link href="#experts">Эксперты</Link>
          <Link href="#investors">Партнёрство</Link>
        </nav>
        <p className="text-caption font-semibold text-faint">
          Врачи учат врачей · 2026
        </p>
      </Container>
      <div aria-hidden="true" className="overflow-hidden pt-4 layout:pt-9">
        <p
          data-testid="academy-footer-wordmark"
          className="origin-bottom translate-y-2 scale-95 select-none whitespace-nowrap text-center text-6xl font-extrabold leading-none tracking-tighter text-hairline layout:translate-y-4 layout:scale-150 layout:text-9xl"
        >
          Doctor.School
        </p>
      </div>
    </footer>
  );
}

/**
 * 029 EARS-1 — the home in its order: hero, «Кто мы», «Что мы делаем» (030
 * EARS-12), «Ближайшие эфиры», «Новости, блог и видео», persona entries.
 *
 * The 030 catalog read is started ONCE here and shared: the hero counts its
 * `running` items, and the 030 EARS-12 «Что мы делаем» block (#3506) mounts
 * between `WhoSection` and `EventsSection` over the same `projects` promise.
 */
export function AcademyHomeView() {
  const projects = readPublicProjects();
  return (
    <div lang="ru" className="min-h-screen bg-background text-foreground">
      <div
        data-testid="academy-home-sections"
        className="pb-section-sm layout:pb-section"
      >
        <AcademyHero
          projects={projects}
          experts={readPublicExpertCount()}
          partners={readPublicOrganisationCount()}
        />
        <WhoSection />
        <EventsSection />
        <MaterialsFeedSection />
        <PersonaSection />
      </div>
    </div>
  );
}
