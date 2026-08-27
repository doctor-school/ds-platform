import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
} from "./data-table";

afterEach(cleanup);

/**
 * `<DataTable>` (#1578). The block is presentation-only, so the harness asserts on
 * the CONTRACT the operator surfaces depend on — the declared column widths, the
 * reachable full value behind a truncated cell, numeric alignment, row-activation
 * semantics, the actions-column rule, and the state routing (loading vs the two
 * distinct empty variants) — never on pixels.
 */

/**
 * First match, narrowed. The block renders the same record twice — the desktop grid
 * and the mobile record card are both in the tree, CSS decides which one shows — so
 * the queries are deliberately `getAll*`; this keeps `noUncheckedIndexedAccess`
 * honest instead of asserting the index away with `!`.
 */
function first<T>(elements: T[]): T {
  const [element] = elements;
  if (!element) throw new Error("expected at least one match, got none");
  return element;
}

type Row = { id: string; title: string; parent: string; count: number };

const ROWS: Row[] = [
  {
    id: "lab-diag",
    title:
      "Клиническая лабораторная диагностика, медицинская генетика и молекулярно-биологические методы исследования",
    parent: "Диагностика",
    count: 12,
  },
  { id: "cardio", title: "Кардиология", parent: "Терапия", count: 48 },
];

const COLUMNS: DataTableColumn<Row>[] = [
  {
    key: "parent",
    header: "Родительское направление",
    width: "220px",
    render: (row) => row.parent,
    fullValue: (row) => row.parent,
  },
  {
    key: "count",
    header: "Материалов",
    width: "120px",
    align: "end",
    render: (row) => row.count,
  },
];

function renderTable(props: Partial<DataTableProps<Row>> = {}) {
  return render(
    <DataTable<Row>
      caption="Направления"
      record={{
        header: "Направление",
        width: "40%",
        title: (row) => row.title,
        context: (row) => `Код: ${row.id}`,
        label: (row) => `Открыть «${row.title}»`,
      }}
      columns={COLUMNS}
      rows={ROWS}
      getRowKey={(row) => row.id}
      emptyNoRecords={{ title: "Направлений пока нет" }}
      emptyNoResults={{ title: "Ничего не найдено" }}
      {...props}
    />,
  );
}

describe("<DataTable>", () => {
  it("applies the DECLARED column widths instead of letting the browser infer them", () => {
    const { container } = renderTable();
    const cols = container.querySelectorAll("colgroup col");
    expect(cols).toHaveLength(3);
    expect(cols[0]).toHaveStyle({ width: "40%" });
    expect(cols[1]).toHaveStyle({ width: "220px" });
    expect(cols[2]).toHaveStyle({ width: "120px" });
  });

  it("keeps the full value reachable on a truncated cell (title attribute)", () => {
    const { container } = renderTable();
    const truncated = container.querySelector('td[title="Диагностика"]');
    expect(truncated).not.toBeNull();
    expect(truncated?.className).toContain("truncate");
  });

  it("aligns a numeric column to the end so figures scan as a column", () => {
    renderTable();
    const header = first(
      screen.getAllByRole("columnheader", { name: "Материалов" }),
    );
    expect(header.className).toContain("text-right");
  });

  it("renders the record title as a real link with an accessible name (row activation)", () => {
    renderTable({ rowHref: (row) => `/directions/${row.id}` });
    const link = first(
      screen.getAllByRole("link", { name: "Открыть «Кардиология»" }),
    );
    expect(link).toHaveAttribute("href", "/directions/cardio");
  });

  it("marks the whole row clickable (cursor + hover) when activation is supplied", () => {
    const { container } = renderTable({ onRowClick: vi.fn() });
    const row = container.querySelector('tr[data-clickable="true"]');
    expect(row).not.toBeNull();
    expect(row?.className).toContain("cursor-pointer");
    expect(row?.className).toContain("hover:bg-tint");
  });

  it("calls onRowClick through the row's own control", async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    await userEvent.click(
      first(screen.getAllByRole("button", { name: "Открыть «Кардиология»" })),
    );
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
  });

  it("renders NO actions column for a single-action list (owner rule, #1578)", () => {
    renderTable({ rowHref: (row) => `/directions/${row.id}` });
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toHaveLength(3);
    expect(headers.join(" ")).not.toContain("Действия");
  });

  it("renders the actions column only when a row genuinely has actions", () => {
    renderTable({
      actions: () => <button type="button">Снять</button>,
      actionsHeader: "Действия",
    });
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  });

  it("draws skeleton rows while loading and NEVER an empty state", () => {
    renderTable({ rows: [], isLoading: true });
    expect(screen.queryByText("Направлений пока нет")).not.toBeInTheDocument();
    expect(screen.queryByText("Ничего не найдено")).not.toBeInTheDocument();
  });

  it("routes the two empty situations to two DISTINCT variants, never one string", () => {
    const { rerender } = renderTable({ rows: [] });
    const table = first(screen.getAllByRole("table"));
    expect(
      within(table).getByText("Направлений пока нет"),
    ).toBeInTheDocument();
    expect(
      table.querySelector('[data-variant="no-records"]'),
    ).not.toBeNull();

    rerender(
      <DataTable<Row>
        caption="Направления"
        record={{
          header: "Направление",
          title: (row) => row.title,
          label: (row) => row.title,
        }}
        columns={COLUMNS}
        rows={[]}
        isFiltered
        getRowKey={(row) => row.id}
        emptyNoRecords={{ title: "Направлений пока нет" }}
        emptyNoResults={{ title: "Ничего не найдено" }}
      />,
    );
    const filtered = first(screen.getAllByRole("table"));
    expect(within(filtered).getByText("Ничего не найдено")).toBeInTheDocument();
    expect(
      filtered.querySelector('[data-variant="no-results"]'),
    ).not.toBeNull();
  });

  it("gives the table an accessible name through its caption", () => {
    renderTable();
    expect(screen.getAllByRole("table")[0]).toHaveAccessibleName("Направления");
  });

  it("renders every column header as a real th[scope=col]", () => {
    const { container } = renderTable();
    container.querySelectorAll("thead th").forEach((th) => {
      expect(th).toHaveAttribute("scope", "col");
    });
  });
});
