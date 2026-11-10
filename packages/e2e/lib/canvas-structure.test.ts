import { describe, expect, it } from "vitest";

import {
  applyAllowlist,
  diffStructures,
  type AllowlistEntry,
  type RegionStructure,
} from "./canvas-structure.js";

describe("canvas-structure · diffStructures", () => {
  const link = (label: string) => ({ kind: "link" as const, label });
  const canvasTree: RegionStructure = {
    bar: [link("Лого"), { kind: "button", label: null }],
    menu: [link("Эфиры"), link("Войти")],
  };

  it("an identical tree has no difference", () => {
    expect(diffStructures(canvasTree, canvasTree)).toEqual([]);
  });

  it("the pre-#3664 header: the auth primary in the bar is a wrong-container difference", () => {
    const app: RegionStructure = {
      bar: [link("Лого"), { kind: "button", label: null }, link("Войти")],
      menu: [link("Эфиры")],
    };
    expect(diffStructures(canvasTree, app)).toEqual([
      "wrong container: link «Войти» — canvas menu, app bar",
    ]);
  });

  it("an item in both containers is extra where the canvas has it only once", () => {
    const canvas: RegionStructure = {
      bar: [link("Лого")],
      menu: [link("Эфиры"), link("Войти")],
    };
    const app: RegionStructure = {
      bar: [link("Лого"), link("Войти")],
      menu: [link("Эфиры"), link("Войти")],
    };
    expect(diffStructures(canvas, app)).toEqual([
      "extra in app (bar): link «Войти»",
    ]);
  });

  it("reports missing, extra and order separately", () => {
    const app: RegionStructure = {
      bar: [{ kind: "button", label: null }, link("Лого"), link("Чужое")],
      menu: [link("Эфиры")],
    };
    expect(diffStructures(canvasTree, app)).toEqual([
      "extra in app (bar): link «Чужое»",
      "order (bar): canvas [link «Лого», button «icon»] · app [button «icon», link «Лого»]",
      "missing in app (menu): link «Войти»",
    ]);
  });
});

describe("canvas-structure · applyAllowlist", () => {
  const entry: AllowlistEntry = {
    canvas: "ds-shell.dc.html",
    props: { host: "academy" },
    delta: "missing",
    item: { kind: "link", label: "Проекты" },
    decision: "the config ships only «Эфиры»",
    source: "spec",
  };
  const tree: RegionStructure = {
    bar: [
      { kind: "link", label: "Эфиры" },
      { kind: "link", label: "Проекты" },
    ],
    menu: [],
  };

  it("drops a decided `missing` item from the canvas side only where its props apply", () => {
    const where = { canvas: "ds-shell.dc.html", props: { host: "academy" } };
    const out = applyAllowlist([entry], where, tree, { bar: [], menu: [] });
    expect(out.canvas.bar).toEqual([{ kind: "link", label: "Эфиры" }]);
    expect(out.stale).toEqual([]);
    const doctor = applyAllowlist(
      [entry],
      { canvas: "ds-shell.dc.html", props: { host: "doctor" } },
      tree,
      { bar: [], menu: [] },
    );
    expect(doctor.canvas.bar).toHaveLength(2);
  });

  it("#3727: an entry removes ONE item — the trailing one — so an unlabelled icon entry spares the logo", () => {
    const avatar: AllowlistEntry = {
      ...entry,
      props: {},
      delta: "extra",
      item: { kind: "link", label: null },
    };
    const app: RegionStructure = {
      bar: [
        { kind: "link", label: null },
        { kind: "link", label: "Эфиры" },
        { kind: "link", label: null },
      ],
      menu: [],
    };
    const out = applyAllowlist(
      [avatar],
      { canvas: "ds-shell.dc.html", props: {} },
      { bar: [], menu: [] },
      app,
    );
    expect(out.app.bar).toEqual([
      { kind: "link", label: null },
      { kind: "link", label: "Эфиры" },
    ]);
    expect(out.stale).toEqual([]);
  });

  it("a `labelPattern` entry removes the one item whose label is the account's data (#3892: the room's initials chip)", () => {
    const chip: AllowlistEntry = {
      canvas: "room.dc.html",
      props: {},
      delta: "extra",
      item: { kind: "link", label: null },
      labelPattern: "\\p{Lu}{1,2}",
      decision: "the signed-in doctor's initials chip (006 EARS-15)",
      source: "test",
    };
    const app: RegionStructure = {
      bar: [
        { kind: "link", label: "Выйти из комнаты" },
        { kind: "link", label: "КП" },
      ],
      menu: [],
    };
    const where = { canvas: "room.dc.html", props: {} };
    const out = applyAllowlist([chip], where, { bar: [], menu: [] }, app);
    expect(out.app.bar).toEqual([{ kind: "link", label: "Выйти из комнаты" }]);
    expect(out.stale).toEqual([]);
    // A full match: a word label is never taken for initials, and an icon is not one.
    const none = applyAllowlist(
      [chip],
      where,
      { bar: [], menu: [] },
      {
        bar: [
          { kind: "link", label: "КПК" },
          { kind: "link", label: null },
        ],
        menu: [],
      },
    );
    expect(none.app.bar).toHaveLength(2);
    expect(none.stale).toEqual([chip]);
  });

  it("an applicable entry that matches nothing is stale", () => {
    const where = { canvas: "ds-shell.dc.html", props: { host: "academy" } };
    const out = applyAllowlist(
      [entry],
      where,
      { bar: [], menu: [] },
      { bar: [], menu: [] },
    );
    expect(out.stale).toEqual([entry]);
  });

  it("#3727: an entry scoped to `regions` applies only there and is never stale elsewhere", () => {
    const scoped: AllowlistEntry = { ...entry, regions: ["header"] };
    const props = { host: "academy" };
    const header = applyAllowlist(
      [scoped],
      { canvas: "ds-shell.dc.html", props, region: "header" },
      tree,
      { bar: [], menu: [] },
    );
    expect(header.canvas.bar).toEqual([{ kind: "link", label: "Эфиры" }]);
    const footer = applyAllowlist(
      [scoped],
      { canvas: "ds-shell.dc.html", props, region: "footer" },
      { bar: [], menu: [] },
      { bar: [], menu: [] },
    );
    expect(footer.stale).toEqual([]);
  });
});
