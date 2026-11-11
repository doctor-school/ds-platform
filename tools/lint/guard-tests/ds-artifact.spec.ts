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
  buildArtifact,
  bundleWithHeader,
  previewHtml,
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
  },
  duration: { fast: { $type: "duration", $value: "150ms" } },
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
  },
};
const dark = {
  color: {
    $type: "color",
    background: { $value: "{color.neutral.900}" },
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
    expect(colour("color-elevation").value).toBe("{color-blue-700}");
  });

  it("lengths resolve to literals; calc/clamp and unsupported families are listed", () => {
    expect(tokens.spacing.tokens).toContainEqual({
      name: "space-inset",
      value: "1rem",
      usage: "Card padding.",
    });
    expect(tokens.radius.tokens.map((t: { name: string }) => t.name)).toEqual([
      "radius-base",
      "radius-control",
      "button-radius",
    ]);
    expect(unplaced.map((u: { name: string }) => u.name)).toEqual(
      expect.arrayContaining(["space-gutter", "duration-fast"]),
    );
  });

  it("a shadow that references a colour variable gets its light literal", () => {
    expect(tokens.shadow.tokens[0]).toMatchObject({
      name: "shadow-md",
      value: "4px 4px 0 #114d9e",
    });
  });

  it("type: families from font stacks, text.* composites as styles", () => {
    expect(tokens.type.families.sans).toBe("Inter, ui-sans-serif");
    expect(tokens.type.groups[0].styles[0]).toEqual({
      name: "body",
      fontSize: "1rem",
      lineHeight: 1.5,
      fontWeight: 400,
    });
  });

  it("every name is unique and matches the page's grammar", () => {
    const names = ["color", "spacing", "radius", "shadow"].flatMap((f) =>
      tokens[f].tokens.map((t: { name: string }) => t.name),
    );
    expect(new Set(names).size).toBe(names.length);
    for (const n of names)
      expect(n).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
  });

  it("tokens.css: line 1 is the generated header; :root light, .dark dark", () => {
    const css = tokensCss(tokens, "Doctor.School Design System");
    expect(css.split("\n")[0]).toBe(
      TOKENS_CSS_HEADER("Doctor.School Design System"),
    );
    expect(css).toContain("--color-background: var(--color-white);");
    expect(css).toMatch(
      /\.dark \{\n {2}--color-background: var\(--color-neutral-900\);/,
    );
  });
});

const CONVERTER_HTML = [
  '<!-- @dsCard group="primitives" -->',
  "<!doctype html>",
  '<html><head><meta charset="utf-8">',
  '  <link rel="stylesheet" href="../../../styles.css">',
  '  <link rel="stylesheet" href="../../../_ds_bundle.css">',
  "</head><body>",
  '  <script src="../../../_vendor/react.js"></script>',
  '  <script src="../../../_vendor/react-dom.js"></script>',
  '  <script src="../../../_ds_bundle.js"></script>',
  '  <script src="../../../_preview/Button.js"></script>',
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
    expect(html).toContain('src="../../components/bundle.js"');
    expect(html).toContain('href="../../components/bundle.css"');
    expect(html).toContain('src="../../components/lib/react.js"');
    expect(html).toContain("<script>\nvar __dsPreview={};\n</script>");
    expect(html).not.toContain("../../../");
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
    writeFileSync(join(from, "_ds_bundle.css"), ".x{}\n");
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
    expect(existsSync(join(out, "REMOVALS.txt"))).toBe(true);
    expect(result.components).toEqual(["Button"]);
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
  });
});
