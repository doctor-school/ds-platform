import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DataTable } from "./data-table";
import { Table, TableBody, TableCell, TableRow } from "./table";

/**
 * `Table` scroll wrapper (#2357). The wrapper is `overflow-x-auto`, so when the grid
 * is wider than its container the only way to reach the clipped columns is to
 * scroll the wrapper. A view-only table has no focusable child, so the wrapper
 * itself must become a keyboard tab stop (axe `scrollable-region-focusable`) — a
 * named `region` — and ONLY while it actually overflows, so a table that fits gains
 * no stray tab stop.
 *
 * jsdom has no layout, so the geometry is set on the element prototype: the
 * `scrollWidth > clientWidth` read is the contract under test, not pixels.
 */

const originalScrollWidth = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollWidth",
);
const originalClientWidth = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "clientWidth",
);

function setGeometry(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(Element.prototype, "scrollWidth", {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(Element.prototype, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
}

afterEach(() => {
  cleanup();
  if (originalScrollWidth) {
    Object.defineProperty(Element.prototype, "scrollWidth", originalScrollWidth);
  }
  if (originalClientWidth) {
    Object.defineProperty(Element.prototype, "clientWidth", originalClientWidth);
  }
});

function renderRawTable(label?: string) {
  return render(
    <Table regionLabel={label}>
      <TableBody>
        <TableRow>
          <TableCell>Кардиология</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe("<Table> scroll wrapper", () => {
  it("scrollable region is focusable with an accessible name when the grid overflows", () => {
    setGeometry(1328, 1228);
    renderRawTable("Участники мероприятия");
    const region = screen.getByRole("region", { name: "Участники мероприятия" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("focus-visible:shadow-focus");
  });

  it("falls back to a default accessible name when the consumer passes none", () => {
    setGeometry(1328, 1228);
    renderRawTable();
    const region = screen.getByRole("region", { name: "Таблица" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("adds no tab stop and no region to a table that fits its container", () => {
    setGeometry(1000, 1228);
    const { container } = renderRawTable("Участники мероприятия");
    expect(screen.queryByRole("region")).toBeNull();
    expect(container.querySelector("[tabindex]")).toBeNull();
  });

  it("names the DataTable scroll region after the table caption", () => {
    setGeometry(1328, 1228);
    render(
      <DataTable<{ id: string }>
        caption="Эксперты"
        record={{
          header: "Эксперт",
          title: (row) => row.id,
          label: (row) => row.id,
        }}
        columns={[]}
        rows={[{ id: "a" }]}
        getRowKey={(row) => row.id}
        emptyNoRecords={{ title: "Нет" }}
        emptyNoResults={{ title: "Нет" }}
      />,
    );
    const region = screen.getByRole("region", { name: "Эксперты" });
    expect(region).toHaveAttribute("tabindex", "0");
  });
});
