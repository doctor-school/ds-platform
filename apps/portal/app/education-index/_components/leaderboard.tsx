"use client";

import { useState, type CSSProperties } from "react";

import { Card } from "@ds/design-system/card";

import {
  organizations,
  rankDelta,
  type Organization,
} from "@/lib/education-index-demo/fixtures";

import { Emblem } from "./emblem";
import styles from "./education-index.module.css";
import { formatPercent, formatThousands, plural } from "./format";

/**
 * 045 EARS-3…6 — the week-4 leaderboard of the public demo page (canvas
 * `academy-index-demo.dc.html` «лидерборд» l.61, «таблица-рейтинг» l.91,
 * «строка раскрыта · два подбалла» l.120, «390 · лидерборд полосами» l.139).
 *
 * Fork defaults А (owner decision): no podium above the table, money = amount
 * AND share, and every row discloses its two sub-scores. The open state is local
 * and independent per row; Ортелла Биотех starts open (EARS-6, canvas l.534).
 * Desktop and the ≤900px «полосами» list read the same state, so a row opened
 * on one layout is open on the other.
 *
 * Bespoke — temporary demo: the DS DataTable block has no expandable row and the
 * design system has no bar/scale primitive; deleted with 032/035 (EARS-14).
 */

const INITIALLY_OPEN: Readonly<Record<string, boolean>> = {
  "Ортелла Биотех": true,
};

function barStyle(percent: number): CSSProperties {
  return { "--bar-value": `${percent}%` } as CSSProperties;
}

function deltaText(delta: number): string {
  if (delta > 0) return `▲${delta}`;
  if (delta < 0) return `▼${-delta}`;
  return "—";
}

function deltaClass(delta: number): string {
  if (delta > 0) return styles.deltaUp;
  if (delta < 0) return styles.deltaDown;
  return styles.deltaFlat;
}

/** Money fork А: the amount AND the share of all investment. */
function investmentText(o: Organization): string {
  return `${formatThousands(o.investmentRub)} ₽ · ${formatPercent(o.investmentShare)}`;
}

function mobileLine(o: Organization): string {
  return [
    investmentText(o),
    `${formatThousands(o.doctors)} ${plural(o.doctors, "врач", "врача", "врачей")}`,
    `${o.lessons} ${plural(o.lessons, "урок", "урока", "уроков")}`,
    `${o.events} ${plural(o.events, "мероприятие", "мероприятия", "мероприятий")}`,
  ].join(" · ");
}

function rankClass(rank: number): string {
  return rank <= 3 ? `${styles.rank} ${styles.rankTop}` : styles.rank;
}

/** EARS-6 — the two sub-scores the index is composed of, plus the explanation. */
function SubScores({
  o,
  id,
  className,
}: {
  o: Organization;
  id: string;
  className: string;
}) {
  return (
    <div id={id} className={className}>
      <div>
        <div className={styles.subHead}>
          <span>Инвестиции в образование</span>
          <span className={styles.subValue}>
            {formatPercent(o.investmentShare)} всех инвестиций
          </span>
        </div>
        <div data-testid="sub-bar" className={styles.subTrack}>
          <span
            className={`${styles.bar} ${styles.barAction}`}
            style={barStyle(o.investmentShare)}
          />
        </div>
      </div>
      <div>
        <div className={styles.subHead}>
          <span>Внимание врачей</span>
          <span className={styles.subValue}>
            {formatPercent(o.attentionShare)} всего внимания
          </span>
        </div>
        <div data-testid="sub-bar" className={styles.subTrack}>
          <span className={styles.bar} style={barStyle(o.attentionShare)} />
        </div>
      </div>
      <div className={styles.explain}>
        Индекс {o.index}: среднее двух долей, пересчитанное к лидеру недели
      </div>
    </div>
  );
}

export function Leaderboard() {
  const [open, setOpen] = useState<Record<string, boolean>>(INITIALLY_OPEN);
  const toggle = (name: string) =>
    setOpen((prev) => ({ ...prev, [name]: !prev[name] }));

  return (
    <>
      <div className={styles.onlyDesktop}>
        <Card data-testid="leaderboard-table">
          <div className={styles.table}>
            <div className={`${styles.tableGrid} ${styles.tableHead}`}>
              <span className={styles.headCap}>№</span>
              <span />
              <span className={styles.headCap}>Организация</span>
              <span className={styles.headCap}>Индекс</span>
              <span className={`${styles.headCap} ${styles.end}`}>Δ мест</span>
              <span className={`${styles.headCap} ${styles.end}`}>
                Инвестиции
              </span>
              <span className={`${styles.headCap} ${styles.end}`}>Врачей</span>
              <span className={`${styles.headCap} ${styles.end}`}>Уроков</span>
              <span className={`${styles.headCap} ${styles.end}`}>
                Мероприятий
              </span>
              <span />
            </div>
            {organizations.map((o) => (
              <DesktopRow
                key={o.name}
                o={o}
                open={Boolean(open[o.name])}
                onToggle={() => toggle(o.name)}
              />
            ))}
          </div>
        </Card>
      </div>
      <div className={`${styles.list} ${styles.onlyMobile}`}>
        {organizations.map((o) => (
          <MobileRow
            key={o.name}
            o={o}
            open={Boolean(open[o.name])}
            onToggle={() => toggle(o.name)}
          />
        ))}
      </div>
    </>
  );
}

interface RowProps {
  o: Organization;
  open: boolean;
  onToggle: () => void;
}

function DesktopRow({ o, open, onToggle }: RowProps) {
  const detailId = `education-index-row-${o.rank}`;
  const delta = rankDelta(o.name);
  return (
    <div
      className={open ? `${styles.entry} ${styles.entryOpen}` : styles.entry}
    >
      <button
        type="button"
        className={`${styles.rowButton} ${styles.tableGrid}`}
        aria-expanded={open}
        aria-controls={detailId}
        title={open ? "Свернуть" : "Из чего сложился индекс"}
        onClick={onToggle}
      >
        <span className={rankClass(o.rank)}>{o.rank}</span>
        <Emblem emblem={o.emblem} size="lg" />
        <span className={styles.orgName}>Партнёр · {o.name}</span>
        <span className={styles.indexCell}>
          <span className={styles.indexValue}>{o.index}</span>
          <span className={styles.indexTrack}>
            <span
              className={styles.bar}
              style={barStyle(Math.max(o.index, 2))}
            />
          </span>
        </span>
        <span className={`${styles.num} ${deltaClass(delta)}`}>
          {deltaText(delta)}
        </span>
        <span className={`${styles.num} ${styles.numInk}`}>
          {investmentText(o)}
        </span>
        <span className={styles.num}>{formatThousands(o.doctors)}</span>
        <span className={styles.num}>{o.lessons}</span>
        <span className={styles.num}>{o.events}</span>
        <span aria-hidden="true" className={styles.chevron}>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open ? (
        <SubScores o={o} id={detailId} className={styles.detail} />
      ) : null}
    </div>
  );
}

function MobileRow({ o, open, onToggle }: RowProps) {
  const detailId = `education-index-list-${o.rank}`;
  const delta = rankDelta(o.name);
  return (
    <div
      className={
        open ? `${styles.listEntry} ${styles.entryOpen}` : styles.listEntry
      }
    >
      <button
        type="button"
        className={`${styles.rowButton} ${styles.listButton}`}
        aria-expanded={open}
        aria-controls={detailId}
        title={open ? "Свернуть" : "Из чего сложился индекс"}
        onClick={onToggle}
      >
        <span className={rankClass(o.rank)}>{o.rank}</span>
        <Emblem emblem={o.emblem} size="md" />
        <span className={styles.listMain}>
          <span className={styles.orgName}>Партнёр · {o.name}</span>
          <span className={styles.listLine}>{mobileLine(o)}</span>
        </span>
        <span className={styles.listScore}>
          <span className={styles.indexValue}>{o.index}</span>
          <span className={deltaClass(delta)}>{deltaText(delta)}</span>
        </span>
      </button>
      {open ? (
        <SubScores o={o} id={detailId} className={styles.listDetail} />
      ) : null}
    </div>
  );
}
