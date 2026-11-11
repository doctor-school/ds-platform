#!/usr/bin/env node
// DS Platform — @ds/design-system → its Claude artifact (Design System type,
// files layout), #3955.
//
//   pnpm design:artifact --from ds-bundle --out <dir> [--index <live index>]
//
// Input: the design-sync converter's output (`.design-sync/NOTES.md` → build
// sequence) and the DTCG token source `packages/design-system/tokens/*.json`.
// Output: `<out>/project/…` — the system's files at their artifact paths — and
// `<out>/REMOVALS.txt`, the superseded paths of the migrated layout (a list for
// the lead, never an action). Nothing here publishes: the lead sends the folder
// with the Artifact tool (`root` = <out>, ≤255 paths per call, the index last).
//
// The converter's bundle, stylesheet, previews and guides are carried, not
// re-authored: only their paths change to the artifact layout. `--index` is the
// live `project/design-system.json` the lead read right before the build; its
// keys and marker are kept (the type's revising rule), `editing` becomes
// `code` and the migration `source` entry is dropped.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const TITLE = "Doctor.School Design System";
export const NAMESPACE = "DsDesignSystem";
export const TOKENS_DIR_REL = "packages/design-system/tokens";
export const TOKENS_CSS_HEADER = (title) =>
  `/* ${title} — generated from tokens.json */`;
const KB = 1024;
const MB = 1024 * KB;
/** The Design System type's per-file caps (`format.md` file table). */
const FILE_CAPS = [
  [/^components\/bundle\.js$/, 6 * MB],
  [/^components\/bundle\.css$/, 2 * MB],
  [/^components\/lib\/[^/]+\.js$/, 2 * MB],
  [/^components\/[^/]+\/preview\.html$/, 256 * KB],
  [/^components\/[^/]+\/README\.md$/, 64 * KB],
  [/^tokens\.json$/, 512 * KB],
  [/^README\.md$/, 200 * KB],
];
const MARKER = ".ds-artifact";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const LENGTH_RE = /^-?\d*\.?\d+(?:px|rem|em|%)?$/;
const REF_RE = /^\{([^}]+)\}$/;
/**
 * The runtime libraries the frame loads, in order, before `bundle.js`. The
 * converter merges react-dom into `react.js` (both globals); `react-dom.js` is
 * its marker file and stays listed so the pair the bundle reads is explicit.
 */
const LIBRARIES = [
  { name: "react", global: "React", file: "components/lib/react.js" },
  {
    name: "react-dom",
    global: "ReactDOM",
    file: "components/lib/react-dom.js",
  },
];
/** Further token families (`format.md`: any other `{tokens:[…]}` key), in section order. */
const OTHER_FAMILIES = [
  "fluid",
  "size",
  "breakpoint",
  "borderWidth",
  "opacity",
  "zIndex",
  "fontScale",
];
const FAMILY_BY_HEAD = {
  opacity: "opacity",
  "z-index": "zIndex",
  container: "size",
  breakpoint: "breakpoint",
  "border-width": "borderWidth",
};
const MOTION_HEADS = new Set(["duration", "easing", "motion"]);
const TEXT_STYLE_FIELDS = {
  "font-size": "fontSize",
  "line-height": "lineHeight",
  "font-weight": "fontWeight",
  "letter-spacing": "letterSpacing",
};
const TEXT_STYLE_VALID = {
  lineHeight: (v) =>
    LENGTH_RE.test(String(v)) && (typeof v !== "number" || v < 10),
  fontWeight: (v) => Number.isFinite(Number(v)) && v >= 1 && v <= 1000,
  letterSpacing: (v) => LENGTH_RE.test(String(v)),
};
/** A further family's value: a single plain CSS value (`format.md` grammar). */
function isPlainCssValue(text) {
  if (!/^[A-Za-z0-9 #%(),./+_-]{1,200}$/.test(text)) return false;
  if (/\b(?:url|var)\(/i.test(text)) return false;
  let depth = 0;
  for (const ch of text) {
    depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    if (depth < 0) return false;
  }
  return depth === 0;
}

const toPosix = (path) => path.split(sep).join("/");

function forbidHtmlBreakers(text, label) {
  for (const needle of ["</script", "<!--"])
    if (text.includes(needle))
      throw new Error(`${label} carries a literal ${needle}`);
}

// ---------------------------------------------------------------- tokens ---

/** Flatten a DTCG tree: `{ path, value, type, description }` leaves, `$type` inherited. */
function leaves(tree, file) {
  const out = [];
  const walk = (node, path, type, groupDescription) => {
    if (node == null || typeof node !== "object") return;
    const nodeType = node.$type ?? type;
    if (Object.prototype.hasOwnProperty.call(node, "$value")) {
      out.push({
        path,
        value: node.$value,
        type: nodeType,
        description: node.$description ?? groupDescription,
        file,
      });
      return;
    }
    const description = node.$description ?? groupDescription;
    for (const [key, child] of Object.entries(node))
      if (!key.startsWith("$"))
        walk(child, [...path, key], nodeType, description);
  };
  walk(tree, [], undefined, undefined);
  return out;
}

const cssName = (path) => path.join("-");

function fontStack(value) {
  return Array.isArray(value)
    ? value.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(", ")
    : String(value);
}

/**
 * DTCG source → the Design System `tokens.json` list shape. Exact values only:
 * a value the page cannot read (calc/clamp, `ch`, motion, a family the saved
 * format reference does not name) is returned in `unplaced` with its reason.
 */
export function tokensFromDtcg({ primitive, semantic, dark, component }) {
  const light = [
    ...leaves(primitive, "primitive.json"),
    ...leaves(semantic, "semantic.json"),
    ...leaves(component, "component.json"),
  ];
  const byPath = new Map(light.map((leaf) => [leaf.path.join("."), leaf]));
  const darkByName = new Map(
    leaves(dark, "semantic.dark.json").map((leaf) => [
      cssName(leaf.path),
      leaf,
    ]),
  );
  const unplaced = [];
  const skip = (name, value, reason) =>
    unplaced.push({
      name,
      value: typeof value === "string" ? value : JSON.stringify(value),
      reason,
    });

  /** Follow `{a.b}` references to the literal leaf. */
  const literal = (value, seen = new Set()) => {
    const m = typeof value === "string" ? value.match(REF_RE) : null;
    if (!m) return value;
    if (seen.has(m[1])) throw new Error(`token reference cycle at {${m[1]}}`);
    seen.add(m[1]);
    const target = byPath.get(m[1]);
    if (!target) throw new Error(`dangling token reference {${m[1]}}`);
    return literal(target.value, seen);
  };

  const colorLiteral = (value) => {
    if (typeof value !== "string") return null;
    const v = value.trim();
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toLowerCase();
    if (/^(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\([^()]*\)$/i.test(v))
      return v;
    return null;
  };
  /** A colour value: an alias of an existing colour token, else a readable literal. */
  const colorValue = (value) => {
    const m = typeof value === "string" ? value.match(REF_RE) : null;
    if (m) {
      const target = byPath.get(m[1]);
      return target && target.type === "color"
        ? `{${cssName(m[1].split("."))}}`
        : null;
    }
    return colorLiteral(value);
  };
  // Shadows name colour roles of any layer: resolve every light colour first.
  const lightColor = new Map(
    light
      .filter((leaf) => leaf.type === "color")
      .map((leaf) => [cssName(leaf.path), colorLiteral(literal(leaf.value))])
      .filter(([, value]) => value !== null),
  );

  // The dark theme repoints only colour roles; a role it omits keeps its light value.
  const darkColor = new Map(lightColor);
  for (const [name, leaf] of darkByName) {
    const value = colorLiteral(literal(leaf.value));
    if (value !== null) darkColor.set(name, value);
  }
  const withColors = (value, colors) =>
    String(value).replace(
      /var\(--([A-Za-z0-9-]+)\)/g,
      (whole, ref) => colors.get(ref) ?? whole,
    );

  const color = [];
  const spacing = [];
  const radius = [];
  const shadow = [];
  const other = Object.fromEntries(OTHER_FAMILIES.map((key) => [key, []]));
  const families = {};
  const textStyles = new Map();
  const scale = [];
  const usage = (leaf) =>
    leaf.description ?? `${leaf.file} ${leaf.path.join(".")}.`;
  /** A single plain CSS value into one of the further families, else unplaced. */
  const placeOther = (family, name, leaf, value) => {
    const text = String(value);
    if (!isPlainCssValue(text)) {
      skip(name, value, "not a plain single CSS value the page can show");
      return;
    }
    other[family].push({ name, value: text, usage: usage(leaf) });
  };

  for (const leaf of light) {
    const name = cssName(leaf.path);
    if (!NAME_RE.test(name)) {
      skip(name, leaf.value, "name outside the page's token-name grammar");
      continue;
    }
    if (leaf.type === "color") {
      const value = colorValue(leaf.value);
      if (value === null) {
        skip(name, leaf.value, "colour value the page cannot read");
        continue;
      }
      const darkLeaf = darkByName.get(name);
      const darkValue = darkLeaf ? colorValue(darkLeaf.value) : null;
      if (darkLeaf && darkValue === null)
        skip(
          `${name} (dark)`,
          darkLeaf.value,
          "dark colour value the page cannot read",
        );
      color.push({
        name,
        value: darkValue === null ? value : { light: value, dark: darkValue },
        usage: usage(leaf),
      });
      continue;
    }
    const [head] = leaf.path;
    if (head === "font" && leaf.path[1] === "family") {
      families[leaf.path.slice(2).join("-")] = fontStack(leaf.value);
      continue;
    }
    if (head === "font" && leaf.path[1] === "size") {
      const size = literal(leaf.value);
      if (LENGTH_RE.test(String(size)))
        scale.push({ name: leaf.path.slice(2).join("-"), fontSize: size });
      else placeOther("fluid", name, leaf, size);
      continue;
    }
    if (head === "font") {
      // A standalone weight / line height / letter spacing step: the
      // Typography view reads these only inside a style, so the scale itself
      // is a further family.
      placeOther("fontScale", name, leaf, literal(leaf.value));
      continue;
    }
    if (head === "text") {
      const style = leaf.path.slice(1, -1).join("-");
      const prop = leaf.path.at(-1);
      const entry = textStyles.get(style) ?? { style: { name: style } };
      textStyles.set(style, entry);
      const value = literal(leaf.value);
      const field = TEXT_STYLE_FIELDS[prop];
      if (!field) {
        skip(name, value, "text-style property the page has no field for");
        continue;
      }
      if (field === "fontSize") entry.fontSizeLeaf = { name, value };
      else if (!TEXT_STYLE_VALID[field](value))
        skip(name, value, `${field} outside the page's grammar`);
      else entry.style[field] = value;
      continue;
    }
    if (leaf.type === "shadow") {
      const source = String(literal(leaf.value));
      const lightValue = withColors(source, lightColor);
      const darkValue = withColors(source, darkColor);
      if (lightValue.includes("var(") || darkValue.includes("var("))
        skip(name, leaf.value, "shadow references an unknown variable");
      else
        shadow.push({
          name,
          value:
            lightValue === darkValue
              ? lightValue
              : { light: lightValue, dark: darkValue },
          usage: /var\(/.test(source)
            ? `${usage(leaf)} Source: ${source} (per-theme literals).`
            : usage(leaf),
        });
      continue;
    }
    const isRadius = head === "radius" || leaf.path.at(-1) === "radius";
    const isSpace = head === "space";
    if (leaf.type === "dimension" && (isRadius || isSpace)) {
      const value = literal(leaf.value);
      if (!LENGTH_RE.test(String(value))) {
        // Spacing and radius take lengths only; a fluid clamp()/calc() is a
        // plain CSS value of the further family.
        placeOther("fluid", name, leaf, value);
        continue;
      }
      (isRadius ? radius : spacing).push({ name, value, usage: usage(leaf) });
      continue;
    }
    if (MOTION_HEADS.has(head)) {
      skip(
        name,
        literal(leaf.value),
        "motion tokens have no family on the page",
      );
      continue;
    }
    const family =
      FAMILY_BY_HEAD[head] ?? (leaf.type === "dimension" ? "size" : null);
    if (family) placeOther(family, name, leaf, literal(leaf.value));
    else skip(name, literal(leaf.value), `no page family for ${head} tokens`);
  }
  const styles = [];
  for (const { style, fontSizeLeaf } of textStyles.values()) {
    if (!fontSizeLeaf || !LENGTH_RE.test(String(fontSizeLeaf.value))) {
      // The page drops a style whose fontSize it cannot read.
      skip(
        `text-${style.name}`,
        JSON.stringify({ ...style, fontSize: fontSizeLeaf?.value }),
        "text style without a plain-length fontSize (calc/clamp)",
      );
      continue;
    }
    const { name: styleName, ...rest } = style;
    styles.push({ name: styleName, fontSize: fontSizeLeaf.value, ...rest });
  }
  for (const [name, leaf] of darkByName)
    if (!byPath.has(leaf.path.join(".")))
      skip(
        `${name} (dark)`,
        leaf.value,
        "dark override of a role the light layer does not define",
      );

  const groups = [{ name: "Text", family: "sans", styles }];
  if (scale.length)
    groups.push({ name: "Scale", family: "sans", styles: scale });
  const further = Object.fromEntries(
    OTHER_FAMILIES.filter((key) => other[key].length).map((key) => [
      key,
      { tokens: other[key] },
    ]),
  );
  return {
    tokens: {
      color: {
        themes: [
          { id: "light", name: "Light" },
          { id: "dark", name: "Dark" },
        ],
        tokens: color,
      },
      type: { fonts: [], families, groups },
      spacing: { tokens: spacing },
      radius: { tokens: radius },
      shadow: { tokens: shadow },
      ...further,
    },
    unplaced,
  };
}

/**
 * `tokens.css` from `tokens.json`, compiled the way the page compiles it
 * (`format.md` → tokens.css as compiled): the first theme's colours and
 * shadows on `:root, [data-theme="<first>"]`, a `[data-theme="<id>"]` block
 * per further theme (overrides + aliases re-declared), then one `:root` with
 * every other family and `--font-<key>`.
 */
export function tokensCss(tokens, title) {
  const css = (v) => String(v).replace(/^\{(.+)\}$/, "var(--$1)");
  const [first, ...rest] = tokens.color.themes.map((t) => t.id);
  const themed = [...tokens.color.tokens, ...tokens.shadow.tokens];
  const valueIn = (t, theme) =>
    typeof t.value === "object" ? t.value[theme] : undefined;
  const firstLines = themed.map(
    (t) =>
      `  --${t.name}: ${css(typeof t.value === "object" ? t.value[first] : t.value)};`,
  );
  const themeBlocks = rest.flatMap((theme) => [
    "",
    `[data-theme="${theme}"] {`,
    ...themed
      .filter(
        (t) =>
          valueIn(t, theme) !== undefined ||
          (typeof t.value === "string" && REF_RE.test(t.value)),
      )
      .map((t) => `  --${t.name}: ${css(valueIn(t, theme) ?? t.value)};`),
    "}",
  ]);
  const rootLines = [];
  for (const [family, value] of Object.entries(tokens))
    if (!["color", "type", "shadow"].includes(family))
      for (const t of value.tokens)
        rootLines.push(`  --${t.name}: ${css(t.value)};`);
  for (const [key, stack] of Object.entries(tokens.type.families))
    rootLines.push(`  --font-${key}: ${stack};`);
  return [
    TOKENS_CSS_HEADER(title),
    "",
    `:root, [data-theme="${first}"] {`,
    ...firstLines,
    "}",
    ...themeBlocks,
    "",
    ":root {",
    ...rootLines,
    "}",
    "",
  ].join("\n");
}

/**
 * The system's own dark switch is the `.dark` class; the artifact frame sets
 * `<html data-theme="…">`. Every theme selector of the compiled stylesheet is
 * paired with its `[data-theme]` twin so a dark preview renders dark. A `.dark`
 * selector of any other shape is refused: it would stay light in the frame.
 */
export function themedBundleCss(css) {
  const standalone = css.match(/(?<![\w\\-])\.dark(?![\w\\-])/g)?.length ?? 0;
  let paired = 0;
  const out = css
    .replace(/(^|\n)([ \t]*)\.(dark|light) \{/g, (_m, start, indent, theme) => {
      if (theme === "dark") paired += 1;
      return `${start}${indent}.${theme}, [data-theme="${theme}"] {`;
    })
    .replaceAll(":where(.dark, .dark *)", () => {
      paired += 2;
      return ':where(.dark, .dark *, [data-theme="dark"], [data-theme="dark"] *)';
    });
  if (paired !== standalone)
    throw new Error(
      `components/bundle.css has ${standalone - paired} .dark selector(s) with no [data-theme="dark"] twin`,
    );
  return out;
}

/**
 * The Design System type's caps (`format.md`): file sizes by path (stored
 * bytes) and the token grammar's counts. A build over any cap is refused, not
 * trimmed.
 */
export function assertCaps(sizes, tokens) {
  const fail = (what) => {
    throw new Error(`over the Design System cap: ${what}`);
  };
  for (const [rel, bytes] of Object.entries(sizes)) {
    const cap = FILE_CAPS.find(([re]) => re.test(rel))?.[1];
    if (cap !== undefined && bytes > cap)
      fail(`${rel} is ${bytes} bytes, cap ${cap}`);
  }
  const dts = Object.entries(sizes)
    .filter(([rel]) => rel.endsWith(".d.ts"))
    .reduce((sum, [, bytes]) => sum + bytes, 0);
  if (dts > 1.5 * MB) fail(`types are ${dts} bytes, cap 1.5 MB`);
  const families = Object.keys(tokens);
  if (families.length > 12) fail(`${families.length} token families, cap 12`);
  if (tokens.color.themes.length > 8)
    fail(`${tokens.color.themes.length} themes, cap 8`);
  if (tokens.color.tokens.length > 600)
    fail(`${tokens.color.tokens.length} colours, cap 600`);
  const styles = tokens.type.groups.reduce((n, g) => n + g.styles.length, 0);
  if (tokens.type.groups.length > 12)
    fail(`${tokens.type.groups.length} type groups, cap 12`);
  if (styles > 80) fail(`${styles} type styles, cap 80`);
  for (const family of families.filter((f) => f !== "color" && f !== "type"))
    if (tokens[family].tokens.length > 60)
      fail(`${tokens[family].tokens.length} ${family} tokens, cap 60`);
}

// ------------------------------------------------------- bundle / preview ---

/** Replace line 1 with the type's format-4 `@ds-bundle` header. */
export function bundleWithHeader(js, namespace, names) {
  const body = js.slice(js.indexOf("\n") + 1);
  forbidHtmlBreakers(body, "components/bundle.js");
  const header = `/* @ds-bundle: ${JSON.stringify({
    format: 4,
    namespace,
    components: names.map((name) => ({ name })),
  })} */`;
  return `${header}\n${body}`;
}

/**
 * The converter's preview document → the type's preview contract: the frame
 * preloads tokens.css, bundle.css, the libraries and bundle.js, so the
 * document's own stylesheet links and library/bundle script tags go (a preview
 * that links bundle.js or a library breaks the preload).
 */
function rewritePreviewPaths(html) {
  return html
    .replace(
      /\n?[ \t]*<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/(?:styles\.css|_ds_bundle\.css)">/g,
      "",
    )
    .replace(
      /\n?[ \t]*<script src="\.\.\/\.\.\/\.\.\/(?:_vendor\/[^"]+|_ds_bundle\.js)"><\/script>/g,
      "",
    )
    .replace(
      /<code>(\w+)\.d\.ts<\/code>/g,
      "<code>components/index.d.ts</code>",
    )
    .replace(
      /<code>(\w+)\.prompt\.md<\/code>/g,
      "<code>components/$1/README.md</code>",
    );
}

/**
 * The converter's preview document at its artifact path: line 1 the `@dsCard`
 * marker with the measured height (`floor` when no preview is authored), and
 * ONE inline script — the per-component preview module followed by the mount
 * code, reading the preloaded `window.React` / `ReactDOM` / the namespace.
 */
export function previewHtml(converterHtml, { name, height, previewJs }) {
  const [first, ...rest] = converterHtml.split("\n");
  const group = first.match(/group="([^"]+)"/)?.[1];
  if (!group)
    throw new Error(`${name}: converter preview has no @dsCard group`);
  let body = rewritePreviewPaths(rest.join("\n"));
  const tag = new RegExp(
    `\\n?[ \\t]*<script src="\\.\\./\\.\\./\\.\\./_preview/${name}\\.js"></script>`,
  );
  if (previewJs !== null && !tag.test(body))
    throw new Error(`${name}: preview module tag not found`);
  body = body.replace(tag, "");
  if (/<script[^>]*\ssrc=|<link[^>]*rel="stylesheet"/.test(body))
    throw new Error(`${name}: preview loads a file the frame preloads`);
  const scripts = body.match(/<script\b/g)?.length ?? 0;
  if (scripts !== 1)
    throw new Error(
      `${name}: preview has ${scripts} scripts, the frame takes one`,
    );
  if (previewJs !== null) {
    forbidHtmlBreakers(previewJs, `_preview/${name}.js`);
    body = body.replace("<script>", () => `<script>\n${previewJs}`);
  }
  if (body.includes("../../../"))
    throw new Error(`${name}: preview keeps a converter-layout path`);
  const floor = previewJs === null ? " floor" : "";
  return `<!-- @dsCard group="${group}" height=${height}${floor} -->\n${body}`;
}

/** Converter guide → component README (the bundle path only). */
function guide(text) {
  return text.replace(
    "(bundle loaded from the root `_ds_bundle.js`)",
    "(bundle: `components/bundle.js`)",
  );
}

// ----------------------------------------------------------------- build ---

function walkFiles(dir, base = dir) {
  const out = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(toPosix(relative(base, full)));
  }
  return out;
}

function converterComponents(from) {
  const out = [];
  const root = join(from, "components");
  for (const group of readdirSync(root).sort())
    for (const name of readdirSync(join(root, group)).sort())
      out.push({ name, group, dir: join(root, group, name) });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function measuredHeights(from) {
  const path = join(from, ".render-check.json");
  if (!existsSync(path)) return new Map();
  return new Map(
    JSON.parse(readFileSync(path, "utf8"))
      .filter((r) => Number.isFinite(r.maxHeight) && r.maxHeight > 0)
      .map((r) => [r.name, Math.ceil(r.maxHeight)]),
  );
}

/** The capture frame height of the converter (`.design-sync/NOTES.md`), used when no render check measured the card. */
const CAPTURE_FRAME_HEIGHT = 700;

function readme({ conventions, components, unplaced, repo, sha }) {
  return [
    `# ${TITLE}`,
    "",
    `The design system of the Doctor.School platform: \`@ds/design-system\` from \`${repo}\` at \`${sha}\`, bundled as one browser global \`window.${NAMESPACE}\` (${components.length} components, the real library code). Synced from code: change it in the repository and re-run the build.`,
    "",
    conventions.trim(),
    "",
    "## Files",
    "",
    "- `components/bundle.js` — every component on `window.DsDesignSystem` (React 19, read from `window.React` / `window.ReactDOM`).",
    '- `components/bundle.css` — the compiled stylesheet: tokens, the Inter import and every utility the system and its previews use. The system switches theme with the `.dark` class; every theme selector also answers `[data-theme="dark"]` / `[data-theme="light"]`, the attribute this page sets.',
    "- `components/lib/react.js`, `components/lib/react-dom.js` — React 19, listed in the index `libraries` and loaded before the bundle (`react-dom` is merged into `react.js`, which defines both `window.React` and `window.ReactDOM`).",
    "- `components/index.d.ts` — the props of every component; `components/<Name>/README.md` — its guide and examples.",
    "- `tokens.json` / `tokens.css` — the token source `packages/design-system/tokens/*.json`, exact values.",
    "",
    "## Not synced",
    "",
    "- Fonts: Inter is hosted (Google Fonts), no file. Tactic Sans Extended, Century Gothic and Montserrat are reserved brand faces no product surface loads; they appear only in the font stacks.",
    "- Components: built from the package's own build (the Built route). SmartCaptcha and BotProtectionField show a floor card — the invisible captcha renders nothing without its remote script.",
    "- Motion: durations and easings have no family on this page; they stay in the token source.",
    `- Tokens not placed (${unplaced.length}): ${unplaced.map((u) => `\`${u.name}\``).join(", ")}.`,
    "",
  ].join("\n");
}

function removals(from) {
  const carried = walkFiles(from)
    .filter((rel) => !rel.split("/").some((seg) => seg.startsWith(".")))
    .filter((rel) => !rel.startsWith("_screenshots/") && rel !== "README.md")
    .map((rel) => `project/${rel}`)
    .sort();
  return [
    "# Paths of the migrated layout that the files layout supersedes (#3955).",
    "# A list for the lead, never an action: reconcile with a `scope: files`",
    "# listing of the artifact before removing anything.",
    "#",
    "# Patterns:",
    "project/_ds_bundle.js",
    "project/_ds_bundle.css",
    "project/_preview/**",
    "project/_vendor/**",
    "project/components/{blocks,primitives,fields,general}/**",
    "project/docs/**",
    "project/migration-map.json",
    "project/styles.css",
    "project/_ds_manifest.json",
    "#",
    "# This build's converter output at those paths:",
    ...carried,
    "",
  ].join("\n");
}

function indexFor(live, { now, repo, sha, present, libraries }) {
  const base = live ?? {
    v: 3,
    layout: "files",
    createdOnFiles: { v: 1, at: now.toISOString() },
    sections: {},
    groups: [],
    assetGroups: {},
    blobs: {},
    docs: { readme: "project/README.md", sections: [] },
  };
  const kept = { ...base };
  delete kept.source;
  const docs = kept.docs ?? { readme: "project/README.md", sections: [] };
  return {
    ...kept,
    title: TITLE,
    namespace: NAMESPACE,
    libraries,
    editing: "code",
    docs: {
      ...docs,
      sections: (docs.sections ?? []).filter((path) => present.has(path)),
    },
    lastChange: {
      by: "Claude",
      at: now.toISOString(),
      via: `GitHub · ${repo}@${sha}`,
      note: `Re-synced from code at ${sha}: bundle, previews, guides, types and tokens in the files layout.`,
    },
  };
}

/**
 * Converter output (`from`) + DTCG sources → `<out>/project/…` and
 * `<out>/REMOVALS.txt`. Returns `{ components, unplaced, files, bytes }`.
 */
export function buildArtifact({
  from,
  out,
  tokenSources,
  repo,
  sha,
  now = new Date(),
  index = null,
  conventions = null,
  libraryVersions,
}) {
  const project = join(out, "project");
  if (existsSync(project) && !existsSync(join(out, MARKER)))
    throw new Error(
      `${project} exists and is not an earlier ds-artifact build — point --out at an empty folder`,
    );
  rmSync(project, { recursive: true, force: true });
  mkdirSync(join(project, "components", "lib"), { recursive: true });
  writeFileSync(join(out, MARKER), "");
  const write = (rel, text) => {
    mkdirSync(dirname(join(project, rel)), { recursive: true });
    writeFileSync(join(project, rel), text, "utf8");
  };

  const components = converterComponents(from);
  const names = components.map((c) => c.name);
  const bundle = bundleWithHeader(
    readFileSync(join(from, "_ds_bundle.js"), "utf8"),
    NAMESPACE,
    names,
  );
  write("components/bundle.js", bundle);
  write(
    "components/bundle.css",
    themedBundleCss(readFileSync(join(from, "_ds_bundle.css"), "utf8")),
  );
  const libraries = LIBRARIES.map(({ name, global, file }) => {
    const version = libraryVersions?.[name];
    if (!version) throw new Error(`no version given for the ${name} library`);
    const js = readFileSync(join(from, "_vendor", `${name}.js`), "utf8");
    forbidHtmlBreakers(js, file);
    write(file, js);
    return { name, version, global, file };
  });

  const heights = measuredHeights(from);
  const imports = new Set();
  const declarations = [];
  for (const { name, group, dir } of components) {
    const previewPath = join(from, "_preview", `${name}.js`);
    write(
      `components/${name}/preview.html`,
      previewHtml(readFileSync(join(dir, `${name}.html`), "utf8"), {
        name,
        height: heights.get(name) ?? CAPTURE_FRAME_HEIGHT,
        previewJs: existsSync(previewPath)
          ? readFileSync(previewPath, "utf8")
          : null,
      }),
    );
    write(
      `components/${name}/README.md`,
      guide(readFileSync(join(dir, `${name}.prompt.md`), "utf8")),
    );
    const dts = readFileSync(join(dir, `${name}.d.ts`), "utf8").split("\n");
    for (const line of dts.filter((l) => /^import /.test(l))) imports.add(line);
    declarations.push(
      `// ${name} (${group})`,
      ...dts.filter((l) => !/^import /.test(l)),
    );
  }
  write("components/index.d.ts", [...imports, "", ...declarations].join("\n"));

  const { tokens, unplaced } = tokensFromDtcg(tokenSources);
  const tokensJson = {
    name: TITLE,
    version: 1,
    meta: {
      source: "github",
      repo,
      ref: `main@${sha}`,
      package: "packages/design-system",
      paths: {
        tokens: [
          `${TOKENS_DIR_REL}/primitive.json`,
          `${TOKENS_DIR_REL}/semantic.json`,
          `${TOKENS_DIR_REL}/semantic.dark.json`,
          `${TOKENS_DIR_REL}/component.json`,
        ],
      },
      synced: now.toISOString().slice(0, 10),
    },
    ...tokens,
  };
  write("tokens.json", `${JSON.stringify(tokensJson, null, 2)}\n`);
  write("tokens.css", tokensCss(tokens, TITLE));
  const conventionsText =
    conventions ??
    (existsSync(join(from, "README.md"))
      ? readFileSync(join(from, "README.md"), "utf8").split(
          "\n# DsDesignSystem",
        )[0]
      : "");
  write(
    "README.md",
    readme({ conventions: conventionsText, components, unplaced, repo, sha }),
  );

  const present = new Set(walkFiles(project).map((rel) => `project/${rel}`));
  write(
    "design-system.json",
    `${JSON.stringify(indexFor(index, { now, repo, sha, present, libraries }), null, 2)}\n`,
  );
  writeFileSync(join(out, "REMOVALS.txt"), removals(from), "utf8");

  const files = walkFiles(project);
  const sizes = Object.fromEntries(
    files.map((rel) => [rel, statSync(join(project, rel)).size]),
  );
  assertCaps(sizes, tokens);
  const bytes = Object.values(sizes).reduce((sum, n) => sum + n, 0);
  const floors = components
    .filter(({ name }) => !existsSync(join(from, "_preview", `${name}.js`)))
    .map(({ name }) => name);
  return { components: names, unplaced, files: files.length, bytes, floors };
}

// ------------------------------------------------------------------- CLI ---

function main(argv) {
  const opt = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const from = opt("--from");
  const out = opt("--out");
  if (!from || !out) {
    process.stderr.write(
      "usage: pnpm design:artifact --from <converter out> --out <dir> [--index <live design-system.json>]\n",
    );
    process.exit(2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const remote = git("remote", "get-url", "origin").match(
    /github\.com[/:]([^/]+\/[^/.]+)/,
  )?.[1];
  if (!remote) throw new Error("origin is not a GitHub remote");
  const readJson = (rel) =>
    JSON.parse(readFileSync(join(root, TOKENS_DIR_REL, rel), "utf8"));
  const indexPath = opt("--index");
  const pkgVersion = (name) =>
    JSON.parse(
      readFileSync(
        join(root, "packages/design-system/node_modules", name, "package.json"),
        "utf8",
      ),
    ).version;
  const result = buildArtifact({
    libraryVersions: {
      react: pkgVersion("react"),
      "react-dom": pkgVersion("react-dom"),
    },
    from: resolve(from),
    out: resolve(out),
    repo: remote,
    sha: git("rev-parse", "--short=7", "HEAD"),
    index: indexPath ? JSON.parse(readFileSync(indexPath, "utf8")) : null,
    conventions: readFileSync(
      join(root, ".design-sync", "conventions.md"),
      "utf8",
    ),
    tokenSources: {
      primitive: readJson("primitive.json"),
      semantic: readJson("semantic.json"),
      dark: readJson("semantic.dark.json"),
      component: readJson("component.json"),
    },
  });
  process.stdout.write(
    `[design:artifact] ${result.files} files, ${result.bytes} bytes, ${result.components.length} components → ${join(resolve(out), "project")}\n`,
  );
  process.stdout.write(
    `[design:artifact] floor cards (${result.floors.length}): ${result.floors.join(", ") || "none"}\n`,
  );
  for (const u of result.unplaced)
    process.stdout.write(
      `[design:artifact] not placed: ${u.name} = ${u.value} — ${u.reason}\n`,
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[design:artifact] ${error.message}\n`);
    process.exit(1);
  }
}
