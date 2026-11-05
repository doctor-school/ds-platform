import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DS_SHELL_FOOTER_REGION,
  applyAllowlist,
  diffStructures,
  extractCanvasStructure,
  formatStructure,
  parseTemplate,
  type AllowlistEntry,
  type RegionStructure,
} from "./canvas-structure.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const DS_SHELL = join(REPO, "design-source/ds-shell.dc.html");

/** A one-off canvas file with the given template and logic. */
function canvas(template: string, logic: string, props = "{}"): string {
  const dir = mkdtempSync(join(tmpdir(), "canvas-structure-"));
  const file = join(dir, "fixture.dc.html");
  writeFileSync(
    file,
    `<x-dc>${template}</x-dc><script type="text/x-dc" data-dc-script data-props="${props
      .replace(/"/g, "&quot;")}">class Component extends DCLogic { ${logic} }</script>`,
  );
  return file;
}

const REGION = { start: { tag: "header" }, untilComment: "end" };

describe("canvas-structure · parseTemplate", () => {
  it("keeps quoted `>` inside attributes and treats void elements as leaves", () => {
    const [div] = parseTemplate('<div title="a > b"><img alt="x"><span>t</span></div>');
    expect(div).toMatchObject({ type: "el", tag: "div", attrs: { title: "a > b" } });
    expect(div?.type === "el" && div.children.map((c) => c.type === "el" && c.tag)).toEqual([
      "img",
      "span",
    ]);
  });
});

describe("canvas-structure · extractCanvasStructure", () => {
  it("expands sc-if / sc-for / {{ }} against renderVals(), splits bar from a <details> menu, and reads an image-only link by kind", () => {
    const file = canvas(
      `<header>
         <a href="#"><img alt="{{ logo }}"></a>
         <sc-if value="{{ wide }}"><input placeholder="Поиск"></sc-if>
         <sc-for list="{{ nav }}" as="n"><a>{{ n.label }}</a></sc-for>
         <button title="Тема">☾</button>
         <details><summary>≡</summary><nav><sc-for list="{{ nav }}" as="n"><a>{{ n.label }}</a></sc-for><a>{{ primary }}</a></nav></details>
       </header>
       <sc-if value="{{ band }}"><div><input placeholder="Поиск внизу"></div></sc-if>
       <!-- end -->
       <footer><a>not in the region</a></footer>`,
      `state = { band: false };
       renderVals() { const p = this.props, s = this.state;
         return { logo: 'DS', wide: !p.mobile, band: s.band,
           nav: [{ label: 'Эфиры' }, { label: 'Проекты' }], primary: 'Войти' }; }`,
      JSON.stringify({ mobile: { default: true } }),
    );
    const tree = extractCanvasStructure(file, { state: { band: true } }, REGION);
    expect(tree).toEqual({
      bar: [
        { kind: "link", label: null },
        { kind: "link", label: "Эфиры" },
        { kind: "link", label: "Проекты" },
        { kind: "button", label: null },
        { kind: "summary", label: null },
        { kind: "input", label: "Поиск внизу" },
      ],
      menu: [
        { kind: "link", label: "Эфиры" },
        { kind: "link", label: "Проекты" },
        { kind: "link", label: "Войти" },
      ],
    });
    // A prop overrides its declared default.
    expect(extractCanvasStructure(file, { props: { mobile: false } }, REGION).bar[1]).toEqual({
      kind: "input",
      label: "Поиск",
    });
  });

  it("names the canvas when renderVals() needs the DC runtime", () => {
    const file = canvas("<header></header>", "renderVals() { return window.DsDesignSystem; }");
    expect(() => extractCanvasStructure(file, {}, REGION)).toThrow(
      /fixture\.dc\.html: renderVals\(\) is not evaluable/,
    );
  });

  it("ds-shell · doctor · guest · 390: the auth primary is the LAST item of the ≡ menu, not the bar", () => {
    const tree = extractCanvasStructure(DS_SHELL, {
      props: { host: "doctor", loggedIn: false, mobile: true },
    });
    expect(formatStructure(tree)).toBe(
      [
        "bar: link «icon» · button «icon» · summary «icon» · input «Поиск по урокам, школам и событиям»",
        "menu: link «Эфиры» · link «Войти / Регистрация»",
      ].join("\n"),
    );
  });

  it("ds-shell · academy · guest · 1440: no search, four nav links, theme, primary in the bar", () => {
    const tree = extractCanvasStructure(DS_SHELL, {
      props: { host: "academy", loggedIn: false, mobile: false },
    });
    expect(formatStructure(tree)).toBe(
      [
        "bar: link «icon» · link «Эфиры» · link «Проекты» · link «Эксперты» · link «Партнёры» · button «icon» · link «Войти / Регистрация»",
        "menu: —",
      ].join("\n"),
    );
  });
});

describe("canvas-structure · #3727 footer region and signed-in header", () => {
  it("a region with no `untilComment` is the start element alone — its following siblings are not read", () => {
    const file = canvas(
      '<div><footer data-screen-label="f"><a href="#">Внутри</a></footer><a href="#">Снаружи</a></div>',
      "renderVals() { return {}; }",
    );
    const tree = extractCanvasStructure(file, {}, { start: { tag: "footer", attr: ["data-screen-label", "f"] } });
    expect(formatStructure(tree)).toBe("bar: link «Внутри»\nmenu: —");
  });

  it("ds-shell · doctor · guest · footer: «Разделы», the three documents, then the single crossing — the logo image and the aria-hidden wordmark are not items", () => {
    const tree = extractCanvasStructure(
      DS_SHELL,
      { props: { host: "doctor", loggedIn: false, mobile: true } },
      DS_SHELL_FOOTER_REGION,
    );
    expect(formatStructure(tree)).toBe(
      [
        "bar: link «Эфиры» · link «Пользовательское соглашение» · link «Политика обработки персональных данных» · link «Контакты» · link «Academy.Doctor.School ↗»",
        "menu: —",
      ].join("\n"),
    );
  });

  it("ds-shell · academy · guest · footer: the four-link «Разделы» and the crossing to Doctor.School", () => {
    const tree = extractCanvasStructure(
      DS_SHELL,
      { props: { host: "academy", loggedIn: false, mobile: false } },
      DS_SHELL_FOOTER_REGION,
    );
    expect(formatStructure(tree)).toBe(
      [
        "bar: link «Эфиры» · link «Проекты» · link «Эксперты» · link «Партнёры» · link «Пользовательское соглашение» · link «Политика обработки персональных данных» · link «Контакты» · link «Doctor.School ↗»",
        "menu: —",
      ].join("\n"),
    );
  });

  it("ds-shell · doctor · signed-in · 1440: the points plate and «Личный кабинет» replace the guest primary", () => {
    const tree = extractCanvasStructure(DS_SHELL, {
      props: { host: "doctor", loggedIn: true, mobile: false },
    });
    expect(formatStructure(tree)).toBe(
      [
        "bar: link «icon» · input «Поиск по урокам, школам и событиям» · link «Эфиры» · link «120 Pul·340 Bre·1 250 Con» · button «icon» · link «Личный кабинет»",
        "menu: —",
      ].join("\n"),
    );
  });

  it("ds-shell · academy · signed-in · 390: «Мои события» then «Личный кабинет» close the ≡ menu", () => {
    const tree = extractCanvasStructure(DS_SHELL, {
      props: { host: "academy", loggedIn: true, mobile: true },
    });
    expect(formatStructure(tree)).toBe(
      [
        "bar: link «icon» · button «icon» · summary «icon»",
        "menu: link «Эфиры» · link «Проекты» · link «Эксперты» · link «Партнёры» · link «Мои события» · link «Личный кабинет»",
      ].join("\n"),
    );
  });

  it("RED: a footer with the documents column after the crossing, and a second crossing, is reported", () => {
    const want = extractCanvasStructure(
      DS_SHELL,
      { props: { host: "doctor", loggedIn: false, mobile: false } },
      DS_SHELL_FOOTER_REGION,
    );
    const link = (label: string) => ({ kind: "link" as const, label });
    const broken: RegionStructure = {
      bar: [
        link("Эфиры"),
        link("Academy.Doctor.School ↗"),
        link("Пользовательское соглашение"),
        link("Политика обработки персональных данных"),
        link("Контакты"),
        link("Academy.Doctor.School ↗"),
      ],
      menu: [],
    };
    expect(diffStructures(want, broken)).toEqual([
      "extra in app (bar): link «Academy.Doctor.School ↗»",
      "order (bar): canvas [link «Эфиры», link «Пользовательское соглашение», link «Политика обработки персональных данных», link «Контакты», link «Academy.Doctor.School ↗»] · app [link «Эфиры», link «Academy.Doctor.School ↗», link «Пользовательское соглашение», link «Политика обработки персональных данных», link «Контакты»]",
    ]);
  });

  it("RED: a signed-in header still drawing the guest primary is reported both ways", () => {
    const want = extractCanvasStructure(DS_SHELL, {
      props: { host: "academy", loggedIn: true, mobile: false },
    });
    const broken: RegionStructure = {
      bar: want.bar.map((item) =>
        item.label === "Личный кабинет" ? { kind: "link", label: "Войти / Регистрация" } : item,
      ),
      menu: [],
    };
    expect(diffStructures(want, broken)).toEqual([
      "missing in app (bar): link «Личный кабинет»",
      "extra in app (bar): link «Войти / Регистрация»",
    ]);
  });
});

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
    expect(diffStructures(canvas, app)).toEqual(["extra in app (bar): link «Войти»"]);
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
    bar: [{ kind: "link", label: "Эфиры" }, { kind: "link", label: "Проекты" }],
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
    const avatar: AllowlistEntry = { ...entry, props: {}, delta: "extra", item: { kind: "link", label: null } };
    const app: RegionStructure = {
      bar: [{ kind: "link", label: null }, { kind: "link", label: "Эфиры" }, { kind: "link", label: null }],
      menu: [],
    };
    const out = applyAllowlist([avatar], { canvas: "ds-shell.dc.html", props: {} }, { bar: [], menu: [] }, app);
    expect(out.app.bar).toEqual([{ kind: "link", label: null }, { kind: "link", label: "Эфиры" }]);
    expect(out.stale).toEqual([]);
  });

  it("an applicable entry that matches nothing is stale", () => {
    const where = { canvas: "ds-shell.dc.html", props: { host: "academy" } };
    const out = applyAllowlist([entry], where, { bar: [], menu: [] }, { bar: [], menu: [] });
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
