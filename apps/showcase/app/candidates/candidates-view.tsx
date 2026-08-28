"use client";

import { DataTable, type DataTableColumn } from "@ds/design-system/blocks";

import {
  CandidateAdoptedBoard,
  type CandidateAdoptedGroup,
  type SeamOption,
} from "../_components/candidate-adopted";
import styles from "./row-press-candidates.module.css";

type DirectionRow = {
  id: string;
  title: string;
  parent: string;
  code: string;
  status: string;
};

const ROW: DirectionRow = {
  id: "cardiology",
  title: "Кардиология",
  parent: "Терапевтические направления",
  code: "31.08.36",
  status: "Опубликовано",
};

const COLUMNS: DataTableColumn<DirectionRow>[] = [
  {
    key: "code",
    header: "Код",
    width: "25%",
    render: (row) => row.code,
    fullValue: (row) => row.code,
  },
  {
    key: "status",
    header: "Статус",
    width: "30%",
    render: (row) => row.status,
    fullValue: (row) => row.status,
  },
];

const RECORD = {
  header: "Направление",
  width: "45%",
  title: (row: DirectionRow) => row.title,
  context: (row: DirectionRow) => row.parent,
  label: (row: DirectionRow) => `Открыть направление «${row.title}»`,
};

type SpecimenState = "rest" | "hover" | "pressed";
type SpecimenSurface = "desktop" | "mobile";

const STATE_LABEL: Record<SpecimenState, string> = {
  rest: "Обычное",
  hover: "Наведение",
  pressed: "Нажатие",
};

function DirectionTable({ caption }: { caption: string }) {
  return (
    <DataTable
      caption={caption}
      record={RECORD}
      columns={COLUMNS}
      rows={[ROW]}
      getRowKey={(row) => row.id}
      rowHref={() => "#row-press-adopted"}
      emptyNoRecords={{ title: "Направлений пока нет" }}
      emptyNoResults={{ title: "Ничего не найдено" }}
    />
  );
}

function StateSpecimen({
  surface,
  state,
}: {
  surface: SpecimenSurface;
  state: SpecimenState;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {STATE_LABEL[state]}
      </span>
      <div
        data-row-press-surface={surface}
        data-row-press-state={state}
        className={
          surface === "desktop" ? styles.forceDesktop : styles.forceMobile
        }
      >
        <DirectionTable caption={`adopted · ${surface} · ${state}`} />
      </div>
    </div>
  );
}

function AdoptedPreview() {
  return (
    <div
      data-option-id="opt1"
      data-decision="adopted"
      className={`${styles.option} grid gap-5 md:grid-cols-2`}
    >
      <p className="text-xs leading-relaxed text-muted-foreground md:col-span-2">
        Основа: официальный shadcn/ui Table · MIT · новых зависимостей: 0.
        Семантический токен строки <code>tint-pressed</code>: blue.200 в light и
        blue.700 в dark. Без новой границы, сдвига или повторного focus ring.
      </p>

      {(["desktop", "mobile"] as const).map((surface) => (
        <div
          key={surface}
          data-row-press-artifact={`adopted-${surface}`}
          className="flex flex-col gap-2"
        >
          <h3 className="text-sm font-semibold text-foreground">
            {surface === "desktop"
              ? "Десктопная таблица"
              : "Мобильная карточка"}
          </h3>
          {(["rest", "hover", "pressed"] as const).map((state) => (
            <StateSpecimen key={state} surface={surface} state={state} />
          ))}
        </div>
      ))}

      <div className="flex flex-col gap-2 md:col-span-2">
        <h3 className="text-sm font-semibold text-foreground">Живое нажатие</h3>
        <p className="text-xs text-muted-foreground">
          Зажмите строку или карточку: это реальный <code>:active</code>, а не
          нарисованное состояние.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {(["desktop", "mobile"] as const).map((surface) => (
            <div
              key={surface}
              data-row-press-live={surface}
              className={
                surface === "desktop" ? styles.forceDesktop : styles.forceMobile
              }
            >
              <DirectionTable caption={`adopted · ${surface} · live`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const SOURCES = [
  {
    label: "Material 3 — interaction states",
    href: "https://m3.material.io/foundations/interaction/states/overview",
  },
  {
    label: "Carbon — Data table usage",
    href: "https://carbondesignsystem.com/components/data-table/usage/",
  },
  {
    label: "shadcn/ui — Data Table",
    href: "https://ui.shadcn.com/docs/components/data-table",
  },
] as const;

const ADOPTED: SeamOption = {
  id: "opt1",
  label: "Вариант 1 — мягкий шаг",
  summary:
    "Принято владельцем: pressed на один шаг сильнее hover, одинаково для таблицы и мобильной карточки.",
  sources: SOURCES,
  render: () => <AdoptedPreview />,
};

const ROW_PRESS_GROUP: CandidateAdoptedGroup = {
  elementClass: "DataTable · clickable row · pressed state · #1578",
  question: "Принятое состояние нажатия строки",
  notes:
    "Stage A завершён: вариант 1 выбран владельцем в Issue #1578. Rest остаётся card, hover — tint, pressed — tint-pressed; в dark приглушённый контекст поднимается до foreground для AA.",
  adopted: ADOPTED,
  candidates: [],
};

export function CandidatesView() {
  return (
    <div
      data-testid="row-press-stage-a-group"
      className={`${styles.group} flex flex-col gap-2`}
    >
      <CandidateAdoptedBoard group={ROW_PRESS_GROUP} />
    </div>
  );
}
