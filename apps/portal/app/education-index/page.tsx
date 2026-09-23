import type { CSSProperties } from "react";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Badge } from "@ds/design-system/badge";
import { Button } from "@ds/design-system/button";
import { Card } from "@ds/design-system/card";
import { Link } from "@ds/design-system/link";

import {
  CURRENT_WEEK,
  INDEX_LAUNCH,
  TOP5_TAIL_SHARE,
  heroPlates,
  news,
  organizationByName,
  organizations,
  weeklySeries,
} from "@/lib/education-index-demo/fixtures";

import { DemoPlaque } from "./_components/demo-plaque";
import { Emblem } from "./_components/emblem";
import styles from "./_components/education-index.module.css";
import { Leaderboard } from "./_components/leaderboard";

/**
 * 045 — the public education-index demo page (EARS-1…7, 11, 13), built from the
 * vendored canvas `design-source/academy-index-demo.dc.html` `screen=публичный`
 * with the owner's fork defaults А (no podium, amount + share, two sub-bars).
 * Every number comes from the static fixture module; the page issues no api, DB
 * or telemetry call, and search engines are told not to index it (EARS-13).
 * The portal shell (header, footer) comes from the root layout.
 *
 * TEMPORARY: deleted with the whole `app/education-index` tree in the release
 * that ships 032 and 035 (EARS-14).
 */

export const metadata: Metadata = {
  title: "Образовательный индекс (демо) — Академия Doctor.School",
  description:
    "Демонстрация Образовательного индекса Doctor.School: кто и сколько вкладывает в образование врачей.",
  robots: { index: false, follow: false },
};

/** The three organisations the dynamics chart follows (EARS-7): places 1–3. */
const DYNAMICS = organizations.slice(0, 3);
const WEEKS = [1, 2, 3, 4] as const;

function vars(values: Record<string, string>): CSSProperties {
  return values as CSSProperties;
}

function SectionHead({
  title,
  tight = false,
}: {
  title: string;
  tight?: boolean;
}) {
  return (
    <div
      className={
        tight
          ? `${styles.sectionHead} ${styles.sectionHeadTight}`
          : styles.sectionHead
      }
    >
      <h2 className={styles.sectionTitle}>{title}</h2>
      <span aria-hidden="true" className={styles.sectionRule} />
    </div>
  );
}

function Poster() {
  return (
    <div className={styles.poster}>
      <div className={styles.inner}>
        <nav aria-label="Навигационная цепочка" className={styles.crumbs}>
          <Link asChild tone="on-primary">
            <NextLink href="/">Академия</NextLink>
          </Link>
          <span aria-hidden="true" className={styles.crumbSep}>
            /
          </span>
          <span>Образовательный индекс</span>
        </nav>
        <div className={styles.posterTop}>
          <div className={styles.eyebrow}>
            Кто и сколько вкладывает в образование врачей
          </div>
          <span className={styles.stamp}>открытый рейтинг</span>
        </div>
        <div className={styles.posterBottom}>
          <div className={styles.posterTitle}>
            <h1 className={styles.h1}>Образовательный индекс Doctor.School</h1>
            <p className={styles.lede}>
              Индекс — среднее доли инвестиций в образование врачей и доли
              внимания врачей к урокам и событиям партнёра; лидер недели = 100
            </p>
          </div>
          <div className={styles.launch}>
            запущен {INDEX_LAUNCH}
            <span className={styles.launchNow}>
              срез: неделя {CURRENT_WEEK}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroPlates() {
  return (
    <section aria-label="Индекс в цифрах" className={styles.plates}>
      {heroPlates.map((p) => (
        <Card key={p.caption}>
          <div className={styles.plate}>
            <div className={styles.plateValue}>{p.value}</div>
            <div className={styles.plateCaption}>{p.caption}</div>
            <div className={styles.plateNote}>{p.note}</div>
          </div>
        </Card>
      ))}
    </section>
  );
}

function TopFiveShares() {
  const top5 = organizations.slice(0, 5);
  return (
    <section className={styles.section}>
      <Card>
        <div className={styles.cardPad}>
          <h2 className={styles.plateTitle}>
            Топ-5 партнёров дают 80% инвестиций
          </h2>
          <div className={styles.plateSub}>
            Доли в 13,6 млн ₽, инвестированных в образование врачей
          </div>
          <div className={styles.shares}>
            {top5.map((o) => (
              <div
                key={o.name}
                title={`${o.name} — ${o.investmentShare}%`}
                className={`${styles.shareSeg} ${o.emblem.ink === "light" ? styles.inkLight : styles.inkDark}`}
                style={vars({
                  "--bar-value": `${o.investmentShare}%`,
                  "--seg-plate": o.emblem.plate,
                })}
              >
                <span className={styles.segEmblem}>
                  <Emblem emblem={o.emblem} size="xs" />
                </span>
                <span
                  className={
                    o.investmentShare < 11 ? styles.segPctMinor : undefined
                  }
                >
                  {o.investmentShare}%
                </span>
              </div>
            ))}
            <div
              title={`остальные 7 партнёров — ${TOP5_TAIL_SHARE}%`}
              className={`${styles.shareSeg} ${styles.shareTail}`}
              style={vars({ "--bar-value": `${TOP5_TAIL_SHARE}%` })}
            >
              <span className={styles.segLabelLong}>
                остальные 7 — {TOP5_TAIL_SHARE}%
              </span>
              <span className={styles.segLabelShort}>{TOP5_TAIL_SHARE}%</span>
            </div>
          </div>
          <div className={styles.legend}>
            {top5.map((o) => (
              <span key={o.name} className={styles.legendItem}>
                <span
                  aria-hidden="true"
                  className={styles.legendDot}
                  style={vars({ "--seg-plate": o.emblem.plate })}
                />
                {o.name} {o.investmentShare}%
              </span>
            ))}
            <span className={styles.legendItem}>
              <span
                aria-hidden="true"
                className={`${styles.legendDot} ${styles.legendDotTail}`}
              />
              остальные 7 партнёров — {TOP5_TAIL_SHARE}%
            </span>
          </div>
        </div>
      </Card>
    </section>
  );
}

/** EARS-7 — four weekly bars per top-3 organisation from the launch week. */
function IndexDynamics() {
  return (
    <section data-testid="index-dynamics" className={styles.section}>
      <SectionHead title="Динамика индекса" />
      <div className={styles.threeUp}>
        {DYNAMICS.map((o) => (
          <div
            key={o.name}
            data-testid="dynamics-card"
            className={styles.dynCard}
          >
            <div className={styles.orgLine}>
              <Emblem emblem={o.emblem} size="sm" />
              <span>{o.name}</span>
            </div>
            <div className={styles.dynBars}>
              {WEEKS.map((week) => {
                const value = weeklySeries[o.name]?.[week] ?? 0;
                return (
                  <div
                    key={week}
                    data-testid="dynamics-bar"
                    className={styles.dynCol}
                  >
                    <span className={styles.dynValue}>{value}</span>
                    <span
                      aria-hidden="true"
                      className={
                        week === CURRENT_WEEK
                          ? `${styles.dynBar} ${styles.dynBarNow}`
                          : styles.dynBar
                      }
                      style={vars({
                        "--bar-value": `${Math.round(value * 0.78)}%`,
                      })}
                    />
                  </div>
                );
              })}
            </div>
            <div className={styles.weeks}>
              {WEEKS.map((week) => (
                <span key={week} className={styles.week}>
                  нед. {week}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className={styles.caption}>
        Точка отсчёта — запуск индекса {INDEX_LAUNCH}; неделя 1 — первый срез,
        раньше индекс не считался
      </p>
    </section>
  );
}

function IndexNews() {
  return (
    <section className={styles.section}>
      <SectionHead title="Новости индекса" />
      <div className={styles.threeUp}>
        {news.map((item) => (
          <article key={item.title} className={styles.newsCard}>
            <div className={styles.newsTop}>
              <Emblem
                emblem={organizationByName(item.organization).emblem}
                size="md"
              />
              <Badge variant="label">неделя {CURRENT_WEEK}</Badge>
            </div>
            <h3 className={styles.newsTitle}>{item.title}</h3>
          </article>
        ))}
      </div>
    </section>
  );
}

function BecomePartner() {
  return (
    <section className={`${styles.section} ${styles.ctaWrap}`}>
      <div className={styles.cta}>
        <div className={styles.ctaText}>
          <h2 className={styles.ctaTitle}>Хотите на этот лидерборд?</h2>
          <p className={styles.ctaBody}>
            Организации инвестируют в образовательные проекты Академии и
            попадают в открытый индекс. Как это устроено и с чего начать — на
            странице для партнёров.
          </p>
        </div>
        <Button asChild>
          <NextLink href="/#partner-form">
            Стать партнёром — как это работает
          </NextLink>
        </Button>
      </div>
    </section>
  );
}

export default function EducationIndexPage() {
  return (
    <>
      <DemoPlaque>
        Демонстрационные данные · так будет выглядеть Образовательный индекс
      </DemoPlaque>
      <Poster />
      <main className={styles.main}>
        <div className={styles.inner}>
          <HeroPlates />
          <section className={styles.section}>
            <SectionHead tight title={`Рейтинг · неделя ${CURRENT_WEEK}`} />
            <p className={styles.hint}>
              12 партнёров · нажмите на строку, чтобы увидеть, из чего сложился
              индекс
            </p>
            <Leaderboard />
          </section>
          <TopFiveShares />
          <IndexDynamics />
          <IndexNews />
          <BecomePartner />
        </div>
      </main>
    </>
  );
}
