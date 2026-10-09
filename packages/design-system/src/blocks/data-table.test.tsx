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

  it("lays the grid out FIXED so the declared widths hold instead of content-sized auto layout", () => {
    const { container } = renderTable();
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.className).toContain("table-fixed");
  });

  it("gives an ALL-ABSOLUTE grid a min-width equal to the sum of its declared widths, so a wider-than-frame table scrolls instead of squeezing (#2357)", () => {
    const { container } = renderTable({
      record: {
        header: "Направление",
        width: "16rem",
        title: (row) => row.title,
        label: (row) => `Открыть «${row.title}»`,
      },
      columns: [
        { ...COLUMNS[0]!, width: "12rem" },
        { ...COLUMNS[1]!, width: "8rem" },
      ],
    });
    const table = container.querySelector("table");
    expect(table?.style.minWidth).toBe("36rem");
  });

  it("sums MIXED absolute units through calc() for the min-width", () => {
    const { container } = renderTable({
      record: {
        header: "Направление",
        width: "16rem",
        title: (row) => row.title,
        label: (row) => `Открыть «${row.title}»`,
      },
    });
    // jsdom re-orders calc() terms when it serialises; the sum is what matters.
    const minWidth = container.querySelector("table")?.style.minWidth ?? "";
    expect(minWidth).toMatch(/^calc\(/);
    for (const term of ["16rem", "220px", "120px"]) {
      expect(minWidth).toContain(term);
    }
  });

  it("keeps a header on ONE line in an all-absolute grid (whitespace-nowrap)", () => {
    const { container } = renderTable({
      record: {
        header: "Направление",
        width: "16rem",
        title: (row) => row.title,
        label: (row) => `Открыть «${row.title}»`,
      },
    });
    const headers = container.querySelectorAll("thead th");
    expect(headers.length).toBe(3);
    headers.forEach((th) =>
      expect(th.className).toContain("whitespace-nowrap"),
    );
  });

  it("leaves the PERCENT contract unchanged: no min-width, headers may wrap", () => {
    const { container } = renderTable();
    const table = container.querySelector("table");
    expect(table?.style.minWidth).toBe("");
    container
      .querySelectorAll("thead th")
      .forEach((th) => expect(th.className).not.toContain("whitespace-nowrap"));
  });

  it("treats a column with no declared width (it absorbs the remainder) as NOT all-absolute", () => {
    const { container } = renderTable({
      record: {
        header: "Направление",
        title: (row) => row.title,
        label: (row) => `Открыть «${row.title}»`,
      },
    });
    expect(container.querySelector("table")?.style.minWidth).toBe("");
  });

  it("keeps the full value reachable on a truncated cell (title attribute)", () => {
    const { container } = renderTable();
    const truncated = container.querySelector('td[title="Диагностика"]');
    expect(truncated).not.toBeNull();
    expect(truncated?.className).toContain("truncate");
  });

  it("wraps the desktop record title in full without a line clamp", () => {
    const { container } = renderTable({
      rowHref: (row) => `/directions/${row.id}`,
    });
    const desktopTitle = container.querySelector(
      ".md\\:block tbody td:first-child > span:first-child",
    );
    expect(desktopTitle).not.toBeNull();
    expect(desktopTitle?.className).not.toContain("line-clamp");
    expect(desktopTitle?.className).not.toContain("truncate");
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

  it("gives the clickable desktop row and mobile card distinct hover and pressed states", () => {
    const { container } = renderTable({ onRowClick: vi.fn() });
    const row = container.querySelector('tr[data-clickable="true"]');
    const card = container.querySelector('div[data-clickable="true"]');
    expect(row).not.toBeNull();
    expect(card).not.toBeNull();
    expect(row?.className).toContain("cursor-pointer");
    expect(row?.className).toContain("hover:bg-tint");
    expect(row?.className).toContain("has-[:active]:bg-tint-pressed");
    expect(card?.className).toContain("hover:bg-tint");
    expect(card?.className).toContain("has-[:active]:bg-tint-pressed");
  });

  it("raises muted context to foreground during dark-theme press", () => {
    const { container } = renderTable({
      rowHref: (row) => `/directions/${row.id}`,
    });
    for (const context of container.querySelectorAll(
      '[data-clickable="true"] span.mt-1.text-muted-foreground',
    )) {
      expect(context.className).toContain(
        "group-has-[:active]/row:text-foreground",
      );
    }
  });

  /**
   * Owner, 2026-08-27: «Заголовок в таблице не нужно подчёркивать при наведении —
   * покраски строки и поинтера достаточно, иначе только лишний визуальный шум
   * появляется». The row tint + `cursor-pointer` ARE the affordance, so the record
   * title deviates from the Link hover-underline contract — scoped to table rows.
   */
  it("never underlines the record title on hover (owner rule, #1578)", () => {
    renderTable({ rowHref: (row) => `/directions/${row.id}` });
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).not.toContain("underline");
    }
    cleanup();
    renderTable({ onRowClick: vi.fn() });
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).not.toContain("underline");
    }
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
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
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
    expect(within(table).getByText("Направлений пока нет")).toBeInTheDocument();
    expect(table.querySelector('[data-variant="no-records"]')).not.toBeNull();

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

/**
 * 044 EARS-22 — the opt-in server-sort header (owner Stage-A pick S1, #2316
 * issuecomment-6077817101). The block owns the affordance and the ARIA; the order
 * itself is the server's, so the harness asserts on what the header announces and
 * what it asks for — never on reordered rows.
 */
describe("<DataTable> sortable columns (044 EARS-22)", () => {
  const SORTABLE: DataTableColumn<Row>[] = [
    { ...COLUMNS[0]!, sortKey: "parent" },
    { ...COLUMNS[1]!, sortKey: "count" },
  ];

  function headerCell(name: string): HTMLElement {
    const button = screen.getByRole("button", { name });
    const cell = button.closest("th");
    if (!cell) throw new Error(`no <th> around «${name}»`);
    return cell;
  }

  it("044 EARS-22: announces the active column through aria-sort and every other sortable header as none", () => {
    renderTable({
      columns: SORTABLE,
      sort: { key: "count", direction: "desc" },
      onSortChange: () => {},
    });
    expect(headerCell("Материалов")).toHaveAttribute("aria-sort", "descending");
    expect(headerCell("Родительское направление")).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  it("044 EARS-22: the active header carries no resting background fill — only its title and arrow mark it (S1, not S2)", () => {
    renderTable({
      columns: SORTABLE,
      sort: { key: "count", direction: "asc" },
      onSortChange: () => {},
    });
    const button = screen.getByRole("button", { name: "Материалов" });
    const cell = headerCell("Материалов");
    // A `bg-*` utility without a state variant paints the cell at rest; a
    // `hover:`/`focus-visible:` tint exists only while hovered or focused.
    const restingFills = (element: HTMLElement) =>
      element.className.split(/\s+/).filter((token) => /^bg-/.test(token));
    expect(restingFills(cell)).toEqual([]);
    expect(restingFills(button)).toEqual([]);
    expect(cell).not.toHaveAttribute("style");
    expect(
      button.querySelector('[data-sort-icon="asc"]')?.getAttribute("class"),
    ).toContain("text-primary-action");
  });

  it("044 EARS-22: the first click on a header asks for ascending, a click on the active ascending header reverses it", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const { rerender } = renderTable({
      columns: SORTABLE,
      sort: { key: "count", direction: "asc" },
      onSortChange,
    });
    await user.click(
      screen.getByRole("button", { name: "Родительское направление" }),
    );
    expect(onSortChange).toHaveBeenLastCalledWith({
      key: "parent",
      direction: "asc",
    });
    await user.click(screen.getByRole("button", { name: "Материалов" }));
    expect(onSortChange).toHaveBeenLastCalledWith({
      key: "count",
      direction: "desc",
    });
    rerender(
      <DataTable<Row>
        caption="Направления"
        record={{
          header: "Направление",
          title: (row) => row.title,
          label: (row) => `Открыть «${row.title}»`,
        }}
        columns={SORTABLE}
        rows={ROWS}
        getRowKey={(row) => row.id}
        emptyNoRecords={{ title: "Направлений пока нет" }}
        emptyNoResults={{ title: "Ничего не найдено" }}
        sort={{ key: "count", direction: "desc" }}
        onSortChange={onSortChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Материалов" }));
    expect(onSortChange).toHaveBeenLastCalledWith({
      key: "count",
      direction: "asc",
    });
  });

  it("044 EARS-22: the header button is keyboard-operable", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderTable({
      columns: SORTABLE,
      sort: { key: "count", direction: "asc" },
      onSortChange,
    });
    screen.getByRole("button", { name: "Родительское направление" }).focus();
    await user.keyboard("{Enter}");
    expect(onSortChange).toHaveBeenLastCalledWith({
      key: "parent",
      direction: "asc",
    });
  });

  it("044 EARS-22: a column without a sortKey keeps a plain header — no button, no aria-sort", () => {
    renderTable({
      columns: [SORTABLE[0]!, COLUMNS[1]!],
      sort: { key: "parent", direction: "asc" },
      onSortChange: () => {},
    });
    expect(screen.queryByRole("button", { name: "Материалов" })).toBeNull();
    const plain = screen
      .getAllByRole("columnheader")
      .find((cell) => cell.textContent === "Материалов");
    expect(plain).toBeDefined();
    expect(plain).not.toHaveAttribute("aria-sort");
  });

  it("044 EARS-22: a table with no sort props renders exactly the plain headers it always did", () => {
    renderTable();
    expect(
      screen
        .getAllByRole("columnheader")
        .map((cell) => cell.hasAttribute("aria-sort")),
    ).toEqual([false, false, false]);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("044 EARS-22: below md the card list carries a «Сортировка» select over every sortable column and both directions", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderTable({
      columns: SORTABLE,
      sort: { key: "count", direction: "desc" },
      onSortChange,
      sortSelect: {
        label: "Сортировка",
        optionLabel: (column, direction) =>
          `${column.header} — ${direction === "asc" ? "по возрастанию" : "по убыванию"}`,
      },
    });
    const select = screen.getByRole("combobox", { name: "Сортировка" });
    expect(select).toHaveValue("count:desc");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Родительское направление — по возрастанию",
      "Родительское направление — по убыванию",
      "Материалов — по возрастанию",
      "Материалов — по убыванию",
    ]);
    await user.selectOptions(select, "parent:asc");
    expect(onSortChange).toHaveBeenLastCalledWith({
      key: "parent",
      direction: "asc",
    });
  });

  /** The desktop grid's body cells of one column (record = 0, then `columns`). */
  function bodyCells(columnIndex: number): HTMLElement[] {
    const table = first(screen.getAllByRole("table"));
    return within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => {
        const cell = row.querySelectorAll("td")[columnIndex];
        if (!(cell instanceof HTMLElement)) throw new Error("no body cell");
        return cell;
      });
  }
  const fills = (element: HTMLElement) =>
    element.className.split(/\s+/).filter((token) => /^bg-/.test(token));

  it("044 EARS-22: the active column's body cells are shaded with the `table-sorted` surface at rest — no other column, never the header (S1)", () => {
    renderTable({
      columns: SORTABLE,
      sort: { key: "count", direction: "desc" },
      onSortChange: () => {},
    });
    for (const cell of bodyCells(2)) {
      expect(fills(cell)).toEqual(["bg-table-sorted"]);
    }
    for (const cell of [...bodyCells(0), ...bodyCells(1)]) {
      expect(fills(cell)).toEqual([]);
    }
    expect(fills(headerCell("Материалов"))).toEqual([]);
  });

  it("044 EARS-22: the shade follows the active column", () => {
    renderTable({
      columns: SORTABLE,
      sort: { key: "parent", direction: "asc" },
      onSortChange: () => {},
    });
    for (const cell of bodyCells(1)) {
      expect(fills(cell)).toEqual(["bg-table-sorted"]);
    }
    for (const cell of bodyCells(2)) expect(fills(cell)).toEqual([]);
  });

  it("044 EARS-22: a shaded cell of a clickable row yields to the row's hover and pressed tint", () => {
    renderTable({
      columns: SORTABLE,
      sort: { key: "count", direction: "asc" },
      onSortChange: () => {},
      onRowClick: () => {},
    });
    const cell = first(bodyCells(2));
    expect(cell.className).toContain("group-hover/row:bg-tint");
    expect(cell.className).toContain("group-has-[:active]/row:bg-tint-pressed");
    expect(cell.className).toContain("group-focus-within/row:bg-tint");
  });

  it("044 EARS-22: a table with no sort props shades no body cell", () => {
    renderTable({ columns: SORTABLE });
    for (const index of [0, 1, 2]) {
      for (const cell of bodyCells(index)) expect(fills(cell)).toEqual([]);
    }
  });

  it("044 EARS-22: a header detail is a second, smaller line inside the same sort button, which reads «header · detail»", () => {
    renderTable({
      columns: [
        SORTABLE[0]!,
        { ...SORTABLE[1]!, headerDetail: "день 23.04" },
      ],
      sort: { key: "count", direction: "asc" },
      onSortChange: () => {},
    });
    const button = screen.getByRole("button", {
      name: "Материалов · день 23.04",
    });
    const detail = within(button).getByText("день 23.04");
    expect(detail.className).toContain("normal-case");
    expect(detail.className).toContain("text-xs");
    expect(within(button).getByText("Материалов").parentElement).toBe(
      detail.parentElement,
    );
    expect(detail.parentElement?.className).toContain("flex-col");
    expect(button.closest("th")).toHaveAttribute("aria-sort", "ascending");
  });

  it("044 EARS-22: a sort button follows its column's alignment", () => {
    renderTable({
      columns: SORTABLE,
      sort: { key: "parent", direction: "asc" },
      onSortChange: () => {},
    });
    const end = screen.getByRole("button", { name: "Материалов" });
    expect(end.className).toContain("justify-end");
    expect(end.className).toContain("text-right");
    const start = screen.getByRole("button", {
      name: "Родительское направление",
    });
    expect(start.className).toContain("justify-start");
    expect(start.className).toContain("text-left");
  });
});
