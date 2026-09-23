import type { CSSProperties } from "react";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Badge } from "@ds/design-system/badge";
import { Button } from "@ds/design-system/button";
import { Card } from "@ds/design-system/card";
import { Link } from "@ds/design-system/link";

import {
  CURRENT_WEEK,
  cabinet,
  organizationByName,
  rankDelta,
} from "@/lib/education-index-demo/fixtures";

import { AudienceTable } from "../_components/audience-table";
import { DemoPlaque } from "../_components/demo-plaque";
import { DemoUnavailable } from "../_components/demo-unavailable";
import styles from "../_components/education-index.module.css";
import { Emblem } from "../_components/emblem";
import { formatThousands } from "../_components/format";
import { SectionHead } from "../_components/section-head";

/**
 * 045 — the partner-cabinet demo page (EARS-8…13), built from the vendored
 * canvas `design-source/academy-index-demo.dc.html` `screen=кабинет` with the
 * owner's fork default awareness = А (two bars per topic). Every number comes
 * from the static fixture module; nothing here reads or writes data, the three
 * further-data controls render disabled (EARS-10) and search engines are told
 * not to index the page (EARS-13). The portal shell comes from the root layout.
 *
 * TEMPORARY: deleted with the whole `app/education-index` tree in the release
 * that ships 032 and 035 (EARS-14).
 */

export const metadata: Metadata = {
  title: "Кабинет партнёра (демо) — Образовательный индекс Doctor.School",
  description:
    "Демонстрация кабинета партнёра Образовательного индекса Doctor.School: отчётность по образовательным проектам.",
  robots: { index: false, follow: false },
};

const OWN = organizationByName(cabinet.organization);
const OWN_PLACE = OWN.rank;
const OWN_DELTA = rankDelta(OWN.name);
const PEAK_WEEK = Math.max(...cabinet.weeklyAttention);
const ATTENTION_TOTAL = cabinet.weeklyAttention.reduce((a, b) => a + b, 0);

function vars(values: Record<string, string>): CSSProperties {
  return values as CSSProperties;
}

/** EARS-8 — plan/fact progress scale inside the poster. */
function PlanFact() {
  const { planPercent, termPercent, planPoints, factPoints } = cabinet.planFact;
  return (
    <div data-testid="plan-fact" className={styles.planFact}>
      <div className={styles.planFactHead}>
        <span className={styles.planFactTitle}>
          В графике: {planPercent}% плана к {termPercent}% срока
        </span>
        <span className={styles.planFactNums}>
          план {formatThousands(planPoints)} очков внимания · факт{" "}
          {formatThousands(factPoints)}
        </span>
      </div>
      <div className={styles.planTrack}>
        <span
          data-testid="plan-fact-bar"
          className={styles.planFill}
          style={vars({ "--bar-value": `${planPercent}%` })}
        />
        <span
          aria-hidden="true"
          className={styles.planMark}
          style={vars({ "--bar-value": `${termPercent}%` })}
        />
      </div>
      <div className={styles.planMarkRow}>
        <span
          className={styles.planMarkLabel}
          style={vars({ "--bar-value": `${termPercent}%` })}
        >
          {termPercent}% срока
        </span>
      </div>
    </div>
  );
}

function Poster() {
  return (
    <div className={styles.poster}>
      <div className={styles.inner}>
        <nav aria-label="Навигационная цепочка" className={styles.crumbs}>
          <Link asChild tone="on-primary" variant="inline">
            <NextLink href="/">Академия</NextLink>
          </Link>
          <span aria-hidden="true" className={styles.crumbSep}>
            /
          </span>
          <Link asChild tone="on-primary" variant="inline">
            <NextLink href="/education-index">Образовательный индекс</NextLink>
          </Link>
          <span aria-hidden="true" className={styles.crumbSep}>
            /
          </span>
          <span>Кабинет партнёра</span>
        </nav>
        <div className={styles.posterTop}>
          <div className={styles.eyebrow}>
            Отчётность партнёра · неделя {CURRENT_WEEK}
          </div>
          <span className={styles.stamp}>рабочее место</span>
        </div>
        <div className={styles.cabTitle}>
          <span className={`${styles.posterEmblem} ${styles.onlyDesktop}`}>
            <Emblem emblem={OWN.emblem} size="poster" />
          </span>
          <span className={`${styles.posterEmblem} ${styles.onlyMobile}`}>
            <Emblem emblem={OWN.emblem} size="posterSm" />
          </span>
          <h1 className={`${styles.h1} ${styles.h1Cab}`}>
            Кабинет партнёра · {OWN.name}
          </h1>
        </div>
        <p className={styles.lede}>
          Отчётность по образовательным проектам на doctor.school
        </p>
        <PlanFact />
      </div>
    </div>
  );
}

function KpiTiles() {
  return (
    <section aria-label="Итоги проектов" className={styles.kpis}>
      {cabinet.kpis.map((k) => (
        <Card key={k.caption} data-testid="kpi-tile">
          <div className={styles.plate}>
            <div className={styles.plateValue}>{k.value}</div>
            <div className={styles.plateCaption}>{k.caption}</div>
          </div>
        </Card>
      ))}
    </section>
  );
}

/** EARS-8 — awareness before/after, fork awareness = А (two bars per topic). */
function Awareness() {
  const { aware, total } = cabinet.awarePool;
  return (
    <section data-testid="awareness" className={styles.section}>
      <SectionHead tight title="Осведомлённость до и после" />
      <p className={styles.hint}>
        Доля врачей, оценивших знания по теме на 8+ из 10 — до и после урока
      </p>
      <div className={styles.frame}>
        {cabinet.awareness.map((a) => (
          <div key={a.topic} data-testid="awareness-row" className={styles.awRow}>
            <div className={styles.awTopic}>{a.topic}</div>
            <div className={styles.awBars}>
              <div className={styles.awLine}>
                <span className={styles.awLabel}>до</span>
                <span className={styles.awTrack}>
                  <span
                    data-testid="awareness-bar"
                    className={`${styles.bar} ${styles.barFaint}`}
                    style={vars({ "--bar-value": `${a.before}%` })}
                  />
                </span>
                <span className={styles.awValue}>{a.before}%</span>
              </div>
              <div className={styles.awLine}>
                <span className={`${styles.awLabel} ${styles.awLabelAfter}`}>
                  после
                </span>
                <span className={styles.awTrack}>
                  <span
                    data-testid="awareness-bar"
                    className={styles.bar}
                    style={vars({ "--bar-value": `${a.after}%` })}
                  />
                </span>
                <span className={`${styles.awValue} ${styles.numInk}`}>
                  {a.after}%
                </span>
              </div>
            </div>
            <span className={styles.awGain}>+{a.after - a.before} п.п.</span>
          </div>
        ))}
        <div className={styles.awPool}>
          <span className={styles.awPoolTitle}>
            Пул осведомлённых врачей: {aware} из {formatThousands(total)}
          </span>
          <span className={styles.awPoolTrack}>
            <span
              className={`${styles.bar} ${styles.barSuccess}`}
              style={vars({
                "--bar-value": `${((aware / total) * 100).toFixed(1)}%`,
              })}
            />
          </span>
          <span className={styles.awPoolNote}>
            самооценка врача до и после урока
          </span>
        </div>
      </div>
    </section>
  );
}

/** EARS-8 — the 7-step engagement funnel, fixed order. */
function Funnel() {
  const entry = cabinet.funnel[0].doctors;
  return (
    <section className={styles.section}>
      <SectionHead tight title="Глубина вовлечения" />
      <p className={styles.hint}>
        Сколько врачей дошли до каждого шага образовательного пути · конверсия —
        из предыдущего шага
      </p>
      <ol className={styles.frameFlat}>
        {cabinet.funnel.map((f, i) => {
          const prev = i === 0 ? null : cabinet.funnel[i - 1].doctors;
          return (
            <li key={f.step} data-testid="funnel-step" className={styles.fnRow}>
              <span className={styles.fnN}>{i + 1}</span>
              <span data-testid="funnel-step-name" className={styles.fnStep}>
                {f.step}
              </span>
              <span className={styles.fnTrack}>
                <span
                  data-testid="funnel-bar"
                  className={
                    i === 0 ? `${styles.bar} ${styles.barAction}` : styles.bar
                  }
                  style={vars({
                    "--bar-value": `${Math.max((f.doctors / entry) * 100, 1.5)}%`,
                  })}
                />
              </span>
              <span className={styles.fnCount}>{formatThousands(f.doctors)}</span>
              <span className={styles.fnConv}>
                {prev === null
                  ? "вход в путь"
                  : `${Math.round((f.doctors / prev) * 100)}% из предыдущего`}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** EARS-8 — attention points per week, weeks 1–4 (current week highlighted). */
function WeeklyAttention() {
  return (
    <section className={styles.section}>
      <div data-testid="weekly-attention" className={styles.attnCard}>
        <div className={styles.attnHead}>
          <h2 className={styles.attnTitle}>Очки внимания по неделям</h2>
          <span className={styles.attnTotal}>
            итого {formatThousands(ATTENTION_TOTAL)}
          </span>
        </div>
        <div className={`${styles.dynBars} ${styles.attnBars}`}>
          {cabinet.weeklyAttention.map((v, i) => (
            <div key={i} data-testid="attention-bar" className={styles.dynCol}>
              <span className={styles.dynValue}>{formatThousands(v)}</span>
              <span
                aria-hidden="true"
                className={
                  i === CURRENT_WEEK - 1
                    ? `${styles.dynBar} ${styles.dynBarNow}`
                    : styles.dynBar
                }
                style={vars({
                  "--bar-value": `${Math.round((v / PEAK_WEEK) * 78)}%`,
                })}
              />
            </div>
          ))}
        </div>
        <div className={styles.weeks}>
          {cabinet.weeklyAttention.map((_, i) => (
            <span key={i} className={styles.week}>
              нед. {i + 1}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** EARS-9/10 — the project audience: summary, 5 fixture rows, disabled controls. */
function Audience() {
  const total = formatThousands(cabinet.audienceTotal);
  return (
    <section data-testid="audience" className={styles.section}>
      <SectionHead tight title={`Аудитория ваших проектов · ${total} врачей`} />
      <div className={styles.audNote}>
        <Badge variant="label">Контактные данные не передаются</Badge>
      </div>
      <div className={styles.audSummary}>
        {cabinet.audienceSummary.map((group) => (
          <div key={group.title} className={styles.audGroup}>
            <h3 className={styles.audGroupTitle}>{group.title}</h3>
            <ul className={styles.audChips}>
              {group.items.map((item) => (
                <li key={item.label} className={styles.audChip}>
                  {item.label} <b className={styles.audChipValue}>{item.percent}%</b>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className={styles.audTable}>
        <AudienceTable />
      </div>
      <p className={styles.audCaption}>
        показано {cabinet.audience.length} из {total} · полный список — в
        выгрузке для отчётности
      </p>
      <div className={styles.demoControls}>
        <DemoUnavailable id="audience-more" label="Показать ещё" />
        <DemoUnavailable id="audience-export" label="Выгрузить для отчётности" />
      </div>
    </section>
  );
}

/** EARS-8/10 — research requests (one submitted) + the «your place» teaser. */
function ResearchAndPlace() {
  return (
    <section className={`${styles.section} ${styles.twoUp}`}>
      <div data-testid="research-request" className={styles.research}>
        <SectionHead tight title="Опросы и исследования" />
        {cabinet.researchRequests.map((request) => (
          <div
            key={request}
            data-testid="research-request-item"
            className={styles.researchItem}
          >
            <div className={styles.researchTitle}>{request}</div>
            <div className={styles.researchStatus}>
              ✓ Заявка отправлена · команда Академии свяжется с вами
            </div>
          </div>
        ))}
        <div className={styles.demoControls}>
          <DemoUnavailable id="research-request" label="Запросить исследование" />
        </div>
      </div>
      <div className={styles.place}>
        <h2 className={styles.placeTitle}>Ваше место в индексе</h2>
        <div className={styles.placeLine}>
          <span className={styles.placeValue}>{OWN_PLACE}-е</span>
          <span className={styles.placeMeta}>
            <Badge variant="success">▲{OWN_DELTA} за неделю</Badge>
            <span>индекс {OWN.index}</span>
          </span>
        </div>
        <div className={styles.placeCta}>
          <Button asChild>
            <NextLink href="/education-index">
              Открыть образовательный индекс →
            </NextLink>
          </Button>
        </div>
      </div>
    </section>
  );
}

export default function PartnerDemoPage() {
  return (
    <>
      <DemoPlaque>
        Демонстрационные данные · так будет выглядеть кабинет партнёра
      </DemoPlaque>
      <Poster />
      <main className={styles.main}>
        <div className={styles.inner}>
          <KpiTiles />
          <Awareness />
          <Funnel />
          <WeeklyAttention />
          <Audience />
          <ResearchAndPlace />
        </div>
      </main>
    </>
  );
}
