import { describe, expect, it } from "vitest";

import {
  AdminApplicationKindOptionSchema,
  AdminApplicationListPageSchema,
  AdminApplicationListQuerySchema,
  AdminApplicationNoteCreateSchema,
  AdminApplicationStatusMoveSchema,
  APPLICATION_NOTE_MAX,
} from "./index.js";

describe("033 admin «Заявки» contract", () => {
  it("EARS-13: the list query takes a kind, a status and an opaque cursor, bounds the limit and refuses anything else", () => {
    expect(AdminApplicationListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(
      AdminApplicationListQuerySchema.parse({
        kind: "author",
        status: "in_review",
        cursor: "abc",
        limit: "5",
      }),
    ).toEqual({ kind: "author", status: "in_review", cursor: "abc", limit: 5 });
    for (const bad of [
      { kind: "unknown" },
      { status: "archived" },
      { limit: "0" },
      { limit: "51" },
      { cursor: "" },
      { other: "x" },
    ])
      expect(AdminApplicationListQuerySchema.safeParse(bad).success).toBe(
        false,
      );
  });

  it("EARS-13: a page carries the kinds the «Вид» filter offers, each with its label", () => {
    const page = { items: [], nextCursor: null };
    expect(AdminApplicationListPageSchema.safeParse(page).success).toBe(false);
    expect(
      AdminApplicationListPageSchema.parse({
        ...page,
        kinds: [{ kind: "author", label: "Автор", filterLabel: "Автор" }],
      }).kinds,
    ).toEqual([{ kind: "author", label: "Автор", filterLabel: "Автор" }]);
  });

  it("034 EARS-10: a «Вид» option carries the filter text beside the row label — «Инвесторы» for the «Инвестор» kind", () => {
    expect(
      AdminApplicationKindOptionSchema.parse({
        kind: "investor",
        label: "Инвестор",
        filterLabel: "Инвесторы",
      }),
    ).toEqual({
      kind: "investor",
      label: "Инвестор",
      filterLabel: "Инвесторы",
    });
    expect(
      AdminApplicationKindOptionSchema.safeParse({
        kind: "investor",
        label: "Инвестор",
      }).success,
    ).toBe(false);
  });

  it("EARS-15: the status move requires the outcome exactly when closing and never admits `expired`", () => {
    const ok = (b: unknown) =>
      AdminApplicationStatusMoveSchema.safeParse(b).success;
    expect(ok({ status: "in_review" })).toBe(true);
    expect(ok({ status: "closed", outcome: "accepted" })).toBe(true);
    expect(ok({ status: "closed", outcome: "declined" })).toBe(true);
    expect(ok({ status: "closed" })).toBe(false);
    expect(ok({ status: "in_review", outcome: "accepted" })).toBe(false);
    expect(ok({ status: "closed", outcome: "expired" })).toBe(false);
    expect(ok({ status: "new" })).toBe(false);
  });

  it("EARS-16: a note is trimmed and bounded 1–2000", () => {
    expect(AdminApplicationNoteCreateSchema.parse({ body: "  да  " })).toEqual({
      body: "да",
    });
    expect(
      AdminApplicationNoteCreateSchema.safeParse({ body: "   " }).success,
    ).toBe(false);
    expect(
      AdminApplicationNoteCreateSchema.safeParse({
        body: "я".repeat(APPLICATION_NOTE_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      AdminApplicationNoteCreateSchema.safeParse({
        body: "я".repeat(APPLICATION_NOTE_MAX),
      }).success,
    ).toBe(true);
  });
});
