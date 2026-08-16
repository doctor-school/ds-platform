import Image from "next/image";
import { Button } from "@ds/design-system/button";
import { Card } from "@ds/design-system/card";
import { Container } from "@ds/design-system/container";
import { Link } from "@ds/design-system/link";
import { WebinarCard } from "@ds/design-system/webinar-card";

import {
  CREATED_VALUES,
  CURRENT_PROBLEMS,
  EXPERTS,
  FEATURED_PROJECTS,
  PARTICIPATION_FORMATS,
  PARTNER_VALUES,
  PROJECTS,
  WHAT_CARDS,
} from "./fixtures";
import { LeadDemoFields } from "./lead-demo-fields";
import { ThemeToggle } from "./theme-toggle";
import styles from "./academy-home.module.css";

function SectionIntro({
  eyebrow,
  title,
  linkLabel,
  href,
}: {
  eyebrow: string;
  title: string;
  linkLabel?: string;
  href?: string;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-controls">
      <div>
        <p className="mb-2 text-eyebrow font-extrabold uppercase tracking-micro text-primary-action">
          {eyebrow}
        </p>
        <h2 className="text-2xl font-extrabold leading-none tracking-tight layout:text-3xl">
          {title}
        </h2>
      </div>
      {linkLabel && href ? (
        <Link href={href} variant="inline" className="whitespace-nowrap">
          {linkLabel} →
        </Link>
      ) : null}
    </div>
  );
}

function AcademyHeader() {
  return (
    <header id="top" className="bg-header text-header-foreground">
      <Container className="flex min-h-19 items-center justify-between gap-controls py-4">
        <Link
          href="#top"
          aria-label="Doctor.School — наверх"
          className="shrink-0 text-header-foreground active:text-header-foreground"
        >
          <Image
            src="/brand/logo-white.svg"
            alt="Doctor.School"
            width={500}
            height={164}
            priority
            className="h-7 w-auto"
          />
        </Link>

        <div className="flex items-center gap-controls">
          <nav
            aria-label="Основная навигация"
            className="hidden items-center gap-7 text-sm layout:flex"
          >
            {[
              ["Эфиры", "#events"],
              ["Проекты", "#projects"],
              ["Эксперты", "#experts"],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="text-hero-muted hover:text-header-foreground active:text-header-foreground"
              >
                {label}
              </Link>
            ))}
          </nav>
          <ThemeToggle />
          <Button
            type="button"
            variant="outline"
            disabled
            className="hidden layout:inline-flex"
          >
            Войти
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled
            aria-label="Меню пока недоступно в демо"
            className="layout:hidden"
          >
            <span aria-hidden="true" className="text-xl">
              ≡
            </span>
          </Button>
        </div>
      </Container>
    </header>
  );
}

function AcademyHero() {
  return (
    <section className="bg-hero py-12 text-hero-foreground layout:py-20">
      <Container>
        <p className="mb-7 text-xs font-extrabold uppercase tracking-micro text-hero-muted">
          Doctor.School · Врачи учат врачей
        </p>
        <div className="flex flex-col border-2 border-header-hairline p-6 layout:p-10">
          <p className="mb-3 text-eyebrow font-extrabold uppercase tracking-micro text-hero-muted">
            Партнёрам
          </p>
          <h1 className="text-2xl font-extrabold leading-none tracking-tight layout:text-3xl">
            Создаем будущее медицинского образования вместе
          </h1>
          <p className="mt-4 max-w-3xl text-body-compact leading-relaxed text-hero-muted">
            Академия Doctor School объединяет экспертов, индустрию и
            образовательные инициативы для совместного создания новых
            специальностей, школ и стандартов медицины.
          </p>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="mt-6 self-start"
          >
            <a href="#partner-form">Стать партнёром</a>
          </Button>
          <p className="mt-5 text-eyebrow font-extrabold uppercase tracking-micro text-hero-muted">
            14 партнёров · прозрачная модель
          </p>
        </div>
      </Container>
    </section>
  );
}

function EventsSection() {
  return (
    <section
      id="events"
      data-academy-section="events"
      className="scroll-mt-24 pt-16 layout:pt-24"
    >
      <Container>
        <SectionIntro
          eyebrow="Эфиры"
          title="Ближайшие и последние эфиры"
          linkLabel="Все эфиры"
          href="#events"
        />
        <div className="-mx-4 space-y-stack-sm border-t-2 border-border layout:mx-0 layout:space-y-stack layout:border-0">
          {FEATURED_PROJECTS.map((project) => (
            <div
              key={project.href}
              data-webinar-state={project.state}
              className={project.state === "past" ? "opacity-95" : undefined}
            >
              <WebinarCard
                href={project.href}
                time={project.time}
                tzLabel="МСК"
                dateLabel={project.dateLabel}
                school={project.school}
                title={project.title}
                speakers={project.speakers}
              />
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

function WhatSection() {
  return (
    <section data-academy-section="what" className="pt-16 layout:pt-24">
      <Container>
        <SectionIntro eyebrow="Платформа" title="Что такое Doctor.School" />
        <div
          data-testid="academy-platform-intro"
          className="mb-8 max-w-3xl space-y-4 text-body-compact leading-relaxed text-muted-foreground"
        >
          <p>
            Академия представляет собой масштабную идеологию, в центре которой
            — врач и пациент. Участие в проектах Академии — это возможность для
            корпораций реализовать важнейшую социальную миссию.
          </p>
          <p>
            Инвестируя во врачей и открытую базу знаний, партнеры напрямую
            повышают свой корпоративный ESG-рейтинг и укрепляют безупречную
            репутацию среди медицинского сообщества.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 layout:grid-cols-4">
          {WHAT_CARDS.map(([number, title, copy]) => (
            <Card key={number} className="p-6">
              <p className="mb-3 text-eyebrow font-extrabold tracking-micro text-primary-action">
                {number}
              </p>
              <h3 className="mb-2 text-lg font-extrabold tracking-heading">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {copy}
              </p>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}

function WhySection() {
  return (
    <section data-academy-section="why" className="pt-16 layout:pt-24">
      <Container>
        <SectionIntro
          eyebrow="Зачем"
          title="Медицинскому образованию нужна другая среда"
        />
        <div className="grid gap-6 layout:grid-cols-2">
          <div className="border-2 border-dashed border-muted-2 p-6 layout:p-8">
            <h3 className="mb-5 text-eyebrow font-extrabold uppercase tracking-micro text-faint">
              Сейчас
            </h3>
            <ul className="space-y-3.5 text-body-compact leading-relaxed text-muted-foreground">
              {CURRENT_PROBLEMS.map((item) => (
                <li key={item} className="flex gap-controls">
                  <span
                    aria-hidden="true"
                    className="font-extrabold text-faint"
                  >
                    ✕
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <Card className="p-6 layout:p-8">
            <h3 className="mb-5 text-eyebrow font-extrabold uppercase tracking-micro text-primary-action">
              Мы создаём
            </h3>
            <ul className="space-y-3.5 text-body-compact font-semibold leading-relaxed">
              {CREATED_VALUES.map((item) => (
                <li key={item} className="flex gap-controls">
                  <span
                    aria-hidden="true"
                    className="font-extrabold text-success-text"
                  >
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Container>
    </section>
  );
}

function ProjectsSection() {
  return (
    <section
      id="projects"
      data-academy-section="projects"
      className="scroll-mt-24 pt-16 layout:pt-24"
    >
      <Container>
        <SectionIntro
          eyebrow="Проекты"
          title="Что мы создаём"
          linkLabel="Все проекты"
          href="#projects"
        />
        <p className="mb-8 max-w-2xl text-body-compact leading-relaxed text-muted-foreground">
          Не один продукт, а среда: школы по специальностям, сообщества,
          дискуссии, длинные программы и стандарты качества контента.
        </p>
        <div className="grid gap-3.5 sm:grid-cols-2 layout:grid-cols-5">
          {PROJECTS.map(([title, metric, copy]) => (
            <div key={title} className="bg-tint p-5 text-tint-foreground">
              <h3 className="text-lg font-extrabold tracking-heading">
                {title}
              </h3>
              {metric ? (
                <p className="my-2 text-xs font-extrabold uppercase tracking-wide text-primary-action">
                  {metric}
                </p>
              ) : null}
              <p className="text-caption leading-relaxed text-foreground">
                {copy}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

function ExpertCard({ expert }: { expert: (typeof EXPERTS)[number] }) {
  return (
    <Card
      data-testid="academy-expert-card"
      className="flex h-full flex-col overflow-hidden"
    >
      <div className="relative flex aspect-4/3 items-center justify-center overflow-hidden border-b-2 border-border bg-tint">
        <Image
          src={expert.photo}
          alt={expert.fullName}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover"
        />
      </div>
      <div
        data-testid="academy-expert-copy"
        className="flex flex-1 flex-col gap-2 p-5 text-card-foreground"
      >
        <h3
          lang="ru"
          className="text-lg font-extrabold leading-tight tracking-heading"
        >
          {expert.fullName}
        </h3>
        {expert.signature.map((paragraph) => (
          <p
            key={paragraph}
            className="text-caption font-normal leading-relaxed text-muted-foreground"
          >
            {paragraph}
          </p>
        ))}
      </div>
    </Card>
  );
}

function ExpertsSection() {
  return (
    <section
      id="experts"
      data-academy-section="experts"
      className="scroll-mt-24 pt-16 layout:pt-24"
    >
      <Container>
        <SectionIntro
          eyebrow="Люди"
          title="Объединение лидеров и экспертов"
        />
        <p className="mb-8 max-w-2xl text-body-compact leading-relaxed text-muted-foreground">
          Площадка объединяет фаундеров, приглашенных экспертов и лидеров
          мнений.
        </p>
        <Card
          data-testid="academy-expert-project"
          className="grid overflow-hidden layout:grid-cols-2"
        >
          <div className="border-b-2 border-hairline p-6 layout:border-r-2 layout:border-b-0 layout:p-8">
            <p className="mb-3 text-eyebrow font-extrabold uppercase tracking-micro text-primary-action">
              Проект
            </p>
            <h3 className="text-xl font-extrabold tracking-heading">
              Кто стоит за брендом
            </h3>
            <p className="my-4 text-sm leading-relaxed text-muted-foreground">
              Серия откровенных разговоров с лидерами рынка о будущем
              медицинского образования. Участие в проекте дает экспертам
              возможность публично транслировать свои ценности, давать живую
              обратную связь и выстраивать прочную нейронную связь с брендом и
              аудиторией.
            </p>
          </div>
          <div
            data-testid="academy-project-list"
            className="flex flex-col justify-center"
          >
            {FEATURED_PROJECTS.map((project) => (
              <div
                key={project.href}
                className="border-b border-hairline last:border-b-0"
              >
                <Link
                  href={project.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <span className="flex items-center gap-4 p-5">
                    <span className="grid size-10 shrink-0 place-items-center bg-primary-action text-primary-foreground">
                      <span aria-hidden="true">▶</span>
                    </span>
                    <span className="min-w-0 text-card-foreground">
                      <span className="block text-body-compact font-bold leading-snug">
                        {project.title}
                      </span>
                      <span className="mt-1 block text-xs text-faint">
                        {project.meta}
                      </span>
                    </span>
                  </span>
                </Link>
              </div>
            ))}
          </div>
        </Card>
        <div
          data-testid="academy-expert-grid"
          className="mt-9 grid gap-5 sm:grid-cols-2 layout:grid-cols-3"
        >
          {EXPERTS.map((expert) => (
            <ExpertCard key={expert.fullName} expert={expert} />
          ))}
        </div>
      </Container>
    </section>
  );
}

function PartnerValueSection() {
  return (
    <section
      id="partners"
      data-academy-section="partner-value"
      className="mt-16 scroll-mt-24 bg-primary-surface py-12 text-primary-surface-foreground layout:mt-24 layout:py-20"
    >
      <Container>
        <p className="mb-2 text-eyebrow font-extrabold uppercase tracking-micro text-primary-surface-muted">
          Партнёрам
        </p>
        <h2 className="mb-8 text-2xl font-extrabold leading-none tracking-tight layout:text-3xl">
          Что получает партнёр
        </h2>
        <div className="grid gap-5 sm:grid-cols-2 layout:grid-cols-4">
          {PARTNER_VALUES.map(([title, copy]) => (
            <div
              key={title}
              className="bg-primary-surface-foreground p-6 text-header-chip-foreground shadow-lg"
            >
              <h3 className="mb-2 text-lg font-extrabold tracking-heading">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-header-chip-foreground">
                {copy}
              </p>
            </div>
          ))}
        </div>
        <Button
          asChild
          size="lg"
          variant="outline"
          className="mt-8"
        >
          <a href="#partner-form">Обсудить партнёрство</a>
        </Button>
      </Container>
    </section>
  );
}

function FormatsSection() {
  return (
    <section data-academy-section="formats" className="pt-16 layout:pt-24">
      <Container>
        <SectionIntro eyebrow="Форматы" title="Как присоединиться" />
        <div className="grid gap-3.5 sm:grid-cols-2 layout:grid-cols-5">
          {PARTICIPATION_FORMATS.map(([title, copy]) => (
            <Card key={title} className="flex flex-col gap-2.5 p-5 shadow-none">
              <h3 className="text-base font-extrabold tracking-heading">
                {title}
              </h3>
              <p className="flex-1 text-caption leading-relaxed text-muted-foreground">
                {copy}
              </p>
              <span className="text-caption">
                <Link href="#partner-form" variant="inline">
                  Обсудить →
                </Link>
              </span>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}

function LeadDemoSection() {
  return (
    <section
      id="partner-form"
      data-academy-section="lead-demo"
      className="mt-16 scroll-mt-24 bg-primary-surface py-12 text-primary-surface-foreground layout:mt-24 layout:py-20"
    >
      <Container className="grid items-start gap-9 layout:grid-cols-2 layout:gap-14">
        <div>
          <p className="mb-3 text-eyebrow font-extrabold uppercase tracking-micro text-primary-surface-muted">
            Партнёрство
          </p>
          <h2 className="text-2xl font-extrabold leading-none tracking-tight layout:text-3xl">
            Обсудим партнёрство?
          </h2>
          <p className="mt-5 max-w-lg text-body-compact leading-relaxed text-primary-surface-muted">
            Расскажите о себе — вернёмся с ответом в течение двух рабочих дней.
            Без рассылок и «прогревов»: один разговор по делу.
          </p>
          <p className="mt-5 text-sm text-primary-surface-muted">
            Или напишите напрямую:{" "}
            <Link
              href="mailto:partner@doctor.school"
              variant="inline"
              className="text-primary-surface-foreground"
            >
              partner@doctor.school
            </Link>{" "}
            ·{" "}
            <Link
              href="https://t.me/doctorschool"
              variant="inline"
              className="text-primary-surface-foreground"
            >
              t.me/doctorschool
            </Link>
          </p>
        </div>

        <LeadDemoFields />
      </Container>
    </section>
  );
}

function AcademyFooter() {
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
          <Link href="#projects">Проекты</Link>
          <Link href="#experts">Эксперты</Link>
          <Link href="#partner-form">Партнёрство</Link>
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

export function AcademyHomeView() {
  return (
    <div lang="ru" className="min-h-screen bg-background text-foreground">
      <AcademyHeader />
      <main>
        <AcademyHero />
        <WhatSection />
        <ExpertsSection />
        <EventsSection />
        <WhySection />
        <ProjectsSection />
        <PartnerValueSection />
        <FormatsSection />
        <LeadDemoSection />
      </main>
      <AcademyFooter />
    </div>
  );
}
