import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  TOKENS_CSS_HEADER,
  assertCaps,
  buildArtifact,
  bundleWithHeader,
  previewHtml,
  themedBundleCss,
  tokensCss,
  tokensFromDtcg,
} from "../../design/ds-artifact.mjs";

/**
 * #3955: the design system ships to its Claude artifact in the Design System
 * type's files layout. `tools/design/ds-artifact.mjs` maps the converter's
 * output + the DTCG token source onto `<out>/project/…`.
 */
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "ds-artifact-"));
  dirs.push(dir);
  return dir;
};

const primitive = {
  color: {
    $type: "color",
    white: { $value: "#FFFFFF" },
    blue: { "500": { $value: "#2D84F2" }, "700": { $value: "#114D9E" } },
    neutral: { "900": { $value: "oklch(0.21 0.02 250)" } },
  },
  font: {
    family: {
      sans: { $type: "fontFamily", $value: ["Inter", "ui-sans-serif"] },
    },
    size: { base: { $type: "dimension", $value: "1rem" } },
    weight: { normal: { $type: "fontWeight", $value: 400 } },
    "line-height": { normal: { $type: "number", $value: 1.5 } },
  },
  space: {
    $type: "dimension",
    "4": { $value: "1rem" },
  },
  radius: { base: { $type: "dimension", $value: "0rem" } },
  shadow: {
    md: { $type: "shadow", $value: "4px 4px 0 var(--color-elevation)" },
    flat: { $type: "shadow", $value: "2px 2px 0 #000000" },
  },
  duration: { fast: { $type: "duration", $value: "150ms" } },
  easing: {
    standard: { $type: "cubicBezier", $value: [0.4, 0, 0.2, 1] },
  },
  opacity: { "50": { $type: "number", $value: 0.5 } },
  "z-index": { modal: { $type: "number", $value: 1300 } },
  container: { content: { $type: "dimension", $value: "69rem" } },
  breakpoint: { md: { $type: "dimension", $value: "48rem" } },
  "border-width": { "2": { $type: "dimension", $value: "2px" } },
};
const semantic = {
  color: {
    $type: "color",
    background: { $value: "{color.white}", $description: "Page surface." },
    elevation: { $value: "{color.blue.700}" },
  },
  space: {
    $type: "dimension",
    gutter: { $value: "clamp(1rem, 4vw, 3rem)" },
    inset: { $value: "{space.4}", $description: "Card padding." },
  },
  radius: { control: { $type: "dimension", $value: "{radius.base}" } },
  text: {
    body: {
      "font-size": { $type: "dimension", $value: "{font.size.base}" },
      "line-height": { $type: "number", $value: "{font.line-height.normal}" },
      "font-weight": { $type: "fontWeight", $value: "{font.weight.normal}" },
    },
    fluid: {
      "font-size": { $type: "dimension", $value: "calc(1rem + 1vw)" },
      "line-height": { $type: "number", $value: 1.2 },
    },
    loose: {
      "font-size": { $type: "dimension", $value: "1rem" },
      "line-height": { $type: "dimension", $value: "calc(1em + 4px)" },
    },
  },
};
const dark = {
  color: {
    $type: "color",
    background: { $value: "{color.neutral.900}" },
    elevation: { $value: "{color.white}" },
  },
};
const component = {
  button: { radius: { $type: "dimension", $value: "{radius.control}" } },
};

describe("tokensFromDtcg (#3955)", () => {
  const { tokens, unplaced } = tokensFromDtcg({
    primitive,
    semantic,
    dark,
    component,
  });
  const colour = (name: string) =>
    tokens.color.tokens.find((t: { name: string }) => t.name === name);
  const unplacedNames = unplaced.map((u: { name: string }) => u.name);

  it("light theme first, dark second", () => {
    expect(tokens.color.themes.map((t: { id: string }) => t.id)).toEqual([
      "light",
      "dark",
    ]);
  });

  it("primitive colours keep their value, hex lowercased", () => {
    expect(colour("color-blue-500").value).toBe("#2d84f2");
    expect(colour("color-neutral-900").value).toBe("oklch(0.21 0.02 250)");
  });

  it("a semantic colour is an alias, dark overrides become a themed value", () => {
    expect(colour("color-background")).toEqual({
      name: "color-background",
      value: { light: "{color-white}", dark: "{color-neutral-900}" },
      usage: "Page surface.",
    });
    expect(colour("color-elevation").value).toEqual({
      light: "{color-blue-700}",
      dark: "{color-white}",
    });
  });

  it("lengths resolve to literals; spacing and radius take plain lengths only", () => {
    expect(tokens.spacing.tokens).toContainEqual({
      name: "space-inset",
      value: "1rem",
      usage: "Card padding.",
    });
    expect(
      tokens.spacing.tokens.map((t: { name: string }) => t.name),
    ).not.toContain("space-gutter");
    expect(tokens.radius.tokens.map((t: { name: string }) => t.name)).toEqual([
      "radius-base",
      "radius-control",
      "button-radius",
    ]);
  });

  it("a shadow over a themed colour keeps both themes' literals", () => {
    expect(tokens.shadow.tokens[0]).toMatchObject({
      name: "shadow-md",
      value: { light: "4px 4px 0 #114d9e", dark: "4px 4px 0 #ffffff" },
    });
  });

  it("a shadow with no themed colour stays one plain value", () => {
    expect(
      tokens.shadow.tokens.find(
        (t: { name: string }) => t.name === "shadow-flat",
      ).value,
    ).toBe("2px 2px 0 #000000");
  });

  it("opacity, z-index, size, breakpoint, border-width, fluid lengths and the font scale are families of their own", () => {
    const family = (key: string) =>
      tokens[key].tokens.map((t: { name: string; value: unknown }) => [
        t.name,
        t.value,
      ]);
    expect(family("opacity")).toEqual([["opacity-50", "0.5"]]);
    expect(family("zIndex")).toEqual([["z-index-modal", "1300"]]);
    expect(family("size")).toEqual([["container-content", "69rem"]]);
    expect(family("breakpoint")).toEqual([["breakpoint-md", "48rem"]]);
    expect(family("borderWidth")).toEqual([["border-width-2", "2px"]]);
    expect(family("fluid")).toEqual([
      ["space-gutter", "clamp(1rem, 4vw, 3rem)"],
    ]);
    expect(family("fontScale")).toEqual([
      ["font-weight-normal", "400"],
      ["font-line-height-normal", "1.5"],
    ]);
  });

  it("motion stays unplaced: the page has no motion family", () => {
    expect(unplacedNames).toEqual(
      expect.arrayContaining(["duration-fast", "easing-standard"]),
    );
    for (const placed of ["space-gutter", "opacity-50", "container-content"])
      expect(unplacedNames).not.toContain(placed);
  });

  it("text styles keep the page's grammar: a bad fontSize drops the style, a bad lineHeight drops the property", () => {
    const styles = tokens.type.groups[0].styles;
    expect(styles[0]).toEqual({
      name: "body",
      fontSize: "1rem",
      lineHeight: 1.5,
      fontWeight: 400,
    });
    expect(styles.map((t: { name: string }) => t.name)).not.toContain("fluid");
    expect(styles.find((t: { name: string }) => t.name === "loose")).toEqual({
      name: "loose",
      fontSize: "1rem",
    });
    expect(unplacedNames).toEqual(
      expect.arrayContaining(["text-fluid", "text-loose-line-height"]),
    );
  });

  it("type: families from font stacks", () => {
    expect(tokens.type.families.sans).toBe("Inter, ui-sans-serif");
  });

  it("every name is unique and matches the page's grammar", () => {
    const names = Object.keys(tokens)
      .filter((f) => f !== "type")
      .flatMap((f) => tokens[f].tokens.map((t: { name: string }) => t.name));
    expect(new Set(names).size).toBe(names.length);
    for (const n of names)
      expect(n).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
  });

  it('tokens.css compiles as the page does: the first theme on :root + [data-theme], dark under [data-theme="dark"]', () => {
    const css = tokensCss(tokens, "Doctor.School Design System");
    expect(css.split("\n")[0]).toBe(
      TOKENS_CSS_HEADER("Doctor.School Design System"),
    );
    expect(css).toContain(':root, [data-theme="light"] {');
    expect(css).toContain("--color-background: var(--color-white);");
    expect(css).toMatch(
      /\[data-theme="dark"\] \{\n {2}--color-background: var\(--color-neutral-900\);/,
    );
    expect(css).toMatch(
      /\[data-theme="dark"\] \{[^}]*--shadow-md: 4px 4px 0 #ffffff;/,
    );
    expect(css).toContain("--opacity-50: 0.5;");
    expect(css).toContain("--font-sans: Inter, ui-sans-serif;");
    expect(css).not.toContain(".dark");
  });
});

const CONVERTER_HTML = [
  '<!-- @dsCard group="primitives" -->',
  "<!doctype html>",
  '<html><head><meta charset="utf-8">',
  '  <link rel="stylesheet" href="../../../styles.css">',
  '  <link rel="stylesheet" href="../../../_ds_bundle.css">',
  "</head><body>",
  '  <div id="g"></div>',
  '  <script src="../../../_vendor/react.js"></script>',
  '  <script src="../../../_vendor/react-dom.js"></script>',
  '  <script src="../../../_ds_bundle.js"></script>',
  '  <script src="../../../_preview/Button.js"></script>',
  "  <script>",
  "    var h=React.createElement;",
  "  </script>",
  "</body></html>",
  "",
].join("\n");

describe("bundle + preview shapes (#3955)", () => {
  it("bundle line 1 becomes the format-4 @ds-bundle header", () => {
    const js = bundleWithHeader(
      '/* @ds-bundle: {"namespace":"X","components":[{"name":"A","sourcePath":"p"}]} */\nvar a=1;\n',
      "DsDesignSystem",
      ["A", "B"],
    );
    expect(js.split("\n")[0]).toBe(
      '/* @ds-bundle: {"format":4,"namespace":"DsDesignSystem","components":[{"name":"A"},{"name":"B"}]} */',
    );
    expect(js).toContain("var a=1;");
  });

  it("refuses a bundle carrying a literal </script or <!--", () => {
    expect(() =>
      bundleWithHeader("/* h */\nvar s='</script>';\n", "N", []),
    ).toThrow(/<\/script/);
    expect(() => bundleWithHeader("/* h */\nvar s='<!--';\n", "N", [])).toThrow(
      /<!--/,
    );
  });

  it("preview line 1 is the @dsCard marker", () => {
    const html = previewHtml(CONVERTER_HTML, {
      name: "Button",
      height: 240,
      previewJs: "var __dsPreview={};",
    });
    expect(html.split("\n")[0]).toBe(
      '<!-- @dsCard group="primitives" height=240 -->',
    );
    expect(html).not.toContain("../../../");
  });

  it("a preview is a root element plus ONE script: the frame preloads tokens, bundle.css, the libraries and the bundle", () => {
    const html = previewHtml(CONVERTER_HTML, {
      name: "Button",
      height: 240,
      previewJs: "var __dsPreview={};",
    });
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
    expect(html).not.toMatch(/<link[^>]*rel="stylesheet"/);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).toMatch(
      /<script>\nvar __dsPreview=\{\};\n\s*var h=React\.createElement/,
    );
  });

  it("a card with no authored preview is marked floor", () => {
    const html = previewHtml(
      CONVERTER_HTML.replace(
        '  <script src="../../../_preview/Button.js"></script>\n',
        "",
      ),
      { name: "Button", height: 120, previewJs: null },
    );
    expect(html.split("\n")[0]).toBe(
      '<!-- @dsCard group="primitives" height=120 floor -->',
    );
    expect(html.match(/<script\b/g)).toHaveLength(1);
  });

  it("refuses a preview module carrying a literal </script", () => {
    expect(() =>
      previewHtml(CONVERTER_HTML, {
        name: "Button",
        height: 1,
        previewJs: "var s='</script>';",
      }),
    ).toThrow(/<\/script/);
  });

  it("bundle.css answers the frame's [data-theme] as well as the system's .dark class", () => {
    const css = themedBundleCss(
      [
        ":root { --a: 1; }",
        ".dark {",
        "  --a: 2;",
        "}",
        ".light {",
        "  --a: 1;",
        "}",
        "@layer base {",
        "  .dark {",
        "    color-scheme: dark;",
        "  }",
        "}",
        ".dark\\:block:where(.dark, .dark *) { display: block; }",
      ].join("\n"),
    );
    expect(css).toContain('.dark, [data-theme="dark"] {\n  --a: 2;');
    expect(css).toContain('.light, [data-theme="light"] {');
    expect(css).toContain('  .dark, [data-theme="dark"] {\n    color-scheme');
    expect(css).toContain(
      '.dark\\:block:where(.dark, .dark *, [data-theme="dark"], [data-theme="dark"] *)',
    );
  });

  it("refuses a .dark selector it cannot pair with [data-theme]", () => {
    expect(() => themedBundleCss(".dark > .x { color: red; }")).toThrow(
      /\.dark/,
    );
  });
});

describe("assertCaps (#3955)", () => {
  const ok = {
    "components/bundle.js": 10,
    "components/bundle.css": 10,
    "components/lib/react.js": 10,
    "components/A/preview.html": 10,
    "components/A/README.md": 10,
    "tokens.json": 10,
    "README.md": 10,
  };
  const tokens = {
    color: { themes: [{ id: "light" }], tokens: [] },
    type: { groups: [{ styles: [] }] },
  };

  it("passes a build inside every cap", () => {
    expect(() => assertCaps(ok, tokens)).not.toThrow();
  });

  it.each([
    ["components/bundle.js", 6 * 1024 * 1024],
    ["components/bundle.css", 2 * 1024 * 1024],
    ["components/lib/react.js", 2 * 1024 * 1024],
    ["components/A/preview.html", 256 * 1024],
    ["components/A/README.md", 64 * 1024],
    ["tokens.json", 512 * 1024],
    ["README.md", 200 * 1024],
  ])("refuses %s over %i bytes", (rel, cap) => {
    expect(() => assertCaps({ ...ok, [rel]: cap }, tokens)).not.toThrow();
    expect(() => assertCaps({ ...ok, [rel]: cap + 1 }, tokens)).toThrow(rel);
  });

  it("refuses over 80 type styles, 600 colours, 12 families or 60 tokens in one family", () => {
    const styles = Array.from({ length: 81 }, (_, i) => ({ name: `s${i}` }));
    expect(() =>
      assertCaps(ok, { ...tokens, type: { groups: [{ styles }] } }),
    ).toThrow(/80/);
    const colours = Array.from({ length: 601 }, (_, i) => ({ name: `c${i}` }));
    expect(() =>
      assertCaps(ok, {
        ...tokens,
        color: { themes: [{ id: "light" }], tokens: colours },
      }),
    ).toThrow(/600/);
    const many = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`f${i}`, { tokens: [] }]),
    );
    expect(() => assertCaps(ok, { ...tokens, ...many })).toThrow(/12/);
    expect(() =>
      assertCaps(ok, {
        ...tokens,
        opacity: { tokens: Array.from({ length: 61 }, () => ({})) },
      }),
    ).toThrow(/60/);
  });
});

describe("buildArtifact (#3955)", () => {
  function converterOut(): string {
    const from = tmp();
    const comp = join(from, "components", "primitives", "Button");
    mkdirSync(comp, { recursive: true });
    writeFileSync(
      join(from, "_ds_bundle.js"),
      '/* @ds-bundle: {"namespace":"DsDesignSystem","components":[{"name":"Button"}]} */\nwindow.DsDesignSystem={};\n',
    );
    writeFileSync(join(from, "_ds_bundle.css"), ".dark {\n  --a: 2;\n}\n");
    mkdirSync(join(from, "_vendor"));
    writeFileSync(join(from, "_vendor", "react.js"), "/*react*/\n");
    writeFileSync(join(from, "_vendor", "react-dom.js"), "/*rd*/\n");
    mkdirSync(join(from, "_preview"));
    writeFileSync(join(from, "_preview", "Button.js"), "var __dsPreview={};\n");
    writeFileSync(join(from, "README.md"), "## How to build\n");
    writeFileSync(join(comp, "Button.html"), CONVERTER_HTML);
    writeFileSync(
      join(comp, "Button.prompt.md"),
      "Button from @ds/design-system. Use via `window.DsDesignSystem.Button` (bundle loaded from the root `_ds_bundle.js`).\n",
    );
    writeFileSync(
      join(comp, "Button.d.ts"),
      "export interface ButtonProps {}\n",
    );
    return from;
  }
  const versions = { react: "19.2.0", "react-dom": "19.2.0" };

  it("writes the Design System files layout and the removal list", () => {
    const from = converterOut();
    const out = tmp();
    const result = buildArtifact({
      from,
      out,
      tokenSources: { primitive, semantic, dark, component },
      repo: "doctor-school/ds-platform",
      sha: "abc1234",
      now: new Date("2026-11-11T00:00:00.000Z"),
      index: null,
      libraryVersions: versions,
    });
    const p = (rel: string) => join(out, "project", rel);
    for (const rel of [
      "components/bundle.js",
      "components/bundle.css",
      "components/index.d.ts",
      "components/lib/react.js",
      "components/lib/react-dom.js",
      "components/Button/README.md",
      "components/Button/preview.html",
      "tokens.json",
      "tokens.css",
      "README.md",
      "design-system.json",
    ])
      expect(existsSync(p(rel)), rel).toBe(true);
    const index = JSON.parse(readFileSync(p("design-system.json"), "utf8"));
    expect(index).toMatchObject({
      v: 3,
      layout: "files",
      editing: "code",
      title: "Doctor.School Design System",
      namespace: "DsDesignSystem",
      createdOnFiles: { v: 1, at: "2026-11-11T00:00:00.000Z" },
      lastChange: { via: "GitHub · doctor-school/ds-platform@abc1234" },
    });
    expect(readFileSync(p("components/Button/README.md"), "utf8")).toContain(
      "`components/bundle.js`",
    );
    expect(readFileSync(p("components/bundle.css"), "utf8")).toContain(
      '.dark, [data-theme="dark"] {',
    );
    expect(existsSync(join(out, "REMOVALS.txt"))).toBe(true);
    expect(result.components).toEqual(["Button"]);
  });

  it("the index lists the runtime libraries the frame preloads, in load order", () => {
    const from = converterOut();
    const out = tmp();
    buildArtifact({
      from,
      out,
      tokenSources: { primitive, semantic, dark, component },
      repo: "doctor-school/ds-platform",
      sha: "abc1234",
      libraryVersions: versions,
    });
    const index = JSON.parse(
      readFileSync(join(out, "project", "design-system.json"), "utf8"),
    );
    expect(index.libraries).toEqual([
      {
        name: "react",
        version: "19.2.0",
        global: "React",
        file: "components/lib/react.js",
      },
      {
        name: "react-dom",
        version: "19.2.0",
        global: "ReactDOM",
        file: "components/lib/react-dom.js",
      },
    ]);
  });

  it("a re-sync keeps the live index's keys and marker, drops the migration source", () => {
    const from = converterOut();
    const out = tmp();
    buildArtifact({
      from,
      out,
      tokenSources: { primitive, semantic, dark, component },
      repo: "doctor-school/ds-platform",
      sha: "abc1234",
      now: new Date("2026-11-11T00:00:00.000Z"),
      libraryVersions: versions,
      index: {
        v: 3,
        layout: "files",
        createdOnFiles: { v: 1, at: "2026-10-28T11:52:22.313Z" },
        editing: "off",
        source: { app: "claude-design" },
        groups: ["notes"],
        assetGroups: { notes: { name: "notes", files: {}, order: [] } },
        docs: { readme: "project/README.md", sections: ["project/docs/x.md"] },
        sections: {},
        blobs: {},
        title: "Doctor.School Design System",
        namespace: "DsDesignSystem",
        libraries: [],
      },
    });
    const index = JSON.parse(
      readFileSync(join(out, "project", "design-system.json"), "utf8"),
    );
    expect(index.createdOnFiles.at).toBe("2026-10-28T11:52:22.313Z");
    expect(index.editing).toBe("code");
    expect(index.source).toBeUndefined();
    expect(index.groups).toEqual(["notes"]);
    expect(index.docs.sections).toEqual([]);
    expect(index.libraries).toHaveLength(2);
  });
});
