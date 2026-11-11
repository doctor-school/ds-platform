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
  copyFileSync,
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
/** The type's bundle cap (SKILL.md: `components/bundle.js` ≤ 6 MB). */
const BUNDLE_MAX = 6 * 1024 * 1024;
const MARKER = ".ds-artifact";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const LENGTH_RE = /^-?\d*\.?\d+(?:px|rem|em|%)?$/;
const REF_RE = /^\{([^}]+)\}$/;

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

  const color = [];
  const spacing = [];
  const radius = [];
  const shadow = [];
  const families = {};
  const textStyles = new Map();
  const scale = [];
  const usage = (leaf) =>
    leaf.description ?? `${leaf.file} ${leaf.path.join(".")}.`;

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
      else skip(name, size, "font size is not a plain length (calc/clamp)");
      continue;
    }
    if (head === "font") {
      skip(
        name,
        literal(leaf.value),
        "standalone scale step; the page takes these only inside a text style",
      );
      continue;
    }
    if (head === "text") {
      const style = leaf.path.slice(1, -1).join("-");
      const prop = leaf.path.at(-1);
      const entry = textStyles.get(style) ?? { name: style };
      const value = literal(leaf.value);
      if (prop === "font-size") entry.fontSize = value;
      else if (prop === "line-height") entry.lineHeight = value;
      else if (prop === "font-weight") entry.fontWeight = value;
      else
        skip(
          name,
          value,
          "text-style property outside fontSize/lineHeight/fontWeight",
        );
      textStyles.set(style, entry);
      continue;
    }
    if (leaf.type === "shadow") {
      const value = String(literal(leaf.value)).replace(
        /var\(--([A-Za-z0-9-]+)\)/g,
        (whole, ref) => lightColor.get(ref) ?? whole,
      );
      if (value.includes("var("))
        skip(name, leaf.value, "shadow references an unknown variable");
      else
        shadow.push({
          name,
          value,
          usage: /var\(/.test(String(leaf.value))
            ? `${usage(leaf)} Source: ${leaf.value} (light-theme literal).`
            : usage(leaf),
        });
      continue;
    }
    const isRadius = head === "radius" || leaf.path.at(-1) === "radius";
    const isSpace = head === "space";
    if (leaf.type === "dimension" && (isRadius || isSpace)) {
      const value = literal(leaf.value);
      if (!LENGTH_RE.test(String(value))) {
        skip(
          name,
          value,
          "length is not a plain px/rem/em/% value (calc/clamp)",
        );
        continue;
      }
      (isRadius ? radius : spacing).push({ name, value, usage: usage(leaf) });
      continue;
    }
    skip(
      name,
      literal(leaf.value),
      head === "duration" || head === "easing" || head === "motion"
        ? "motion tokens have no family on the page"
        : `no family for ${head} in the saved format reference`,
    );
  }
  for (const [name, leaf] of darkByName)
    if (!byPath.has(leaf.path.join(".")))
      skip(
        `${name} (dark)`,
        leaf.value,
        "dark override of a role the light layer does not define",
      );

  const groups = [
    { name: "Text", family: "sans", styles: [...textStyles.values()] },
  ];
  if (scale.length)
    groups.push({ name: "Scale", family: "sans", styles: scale });
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
    },
    unplaced,
  };
}

/** `tokens.css` from `tokens.json`: `:root` = the first theme, `.dark` = the dark one (the DS's own theme class). */
export function tokensCss(tokens, title) {
  const css = (v) =>
    typeof v === "string" ? v.replace(/^\{(.+)\}$/, "var(--$1)") : String(v);
  const rootLines = [];
  const darkLines = [];
  for (const t of tokens.color.tokens) {
    const value = typeof t.value === "object" ? t.value : { light: t.value };
    rootLines.push(`  --${t.name}: ${css(value.light)};`);
    if (value.dark !== undefined)
      darkLines.push(`  --${t.name}: ${css(value.dark)};`);
  }
  for (const [key, stack] of Object.entries(tokens.type.families))
    rootLines.push(`  --font-family-${key}: ${stack};`);
  for (const family of ["spacing", "radius", "shadow"])
    for (const t of tokens[family].tokens)
      rootLines.push(`  --${t.name}: ${css(t.value)};`);
  return [
    TOKENS_CSS_HEADER(title),
    "",
    ":root {",
    ...rootLines,
    "}",
    "",
    ".dark {",
    ...darkLines,
    "}",
    "",
  ].join("\n");
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

/** Converter path → artifact path, for the carried preview documents. */
function rewritePreviewPaths(html) {
  return html
    .replace(
      /\s*<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/styles\.css">/g,
      "",
    )
    .replaceAll(
      'href="../../../_ds_bundle.css"',
      'href="../../components/bundle.css"',
    )
    .replaceAll('src="../../../_vendor/', 'src="../../components/lib/')
    .replaceAll(
      'src="../../../_ds_bundle.js"',
      'src="../../components/bundle.js"',
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
 * marker with the measured height, the per-component preview module inlined
 * (one document, no file the format reference does not place).
 */
export function previewHtml(converterHtml, { name, height, previewJs }) {
  const [first, ...rest] = converterHtml.split("\n");
  const group = first.match(/group="([^"]+)"/)?.[1];
  if (!group)
    throw new Error(`${name}: converter preview has no @dsCard group`);
  let body = rewritePreviewPaths(rest.join("\n"));
  const tag = `<script src="../../../_preview/${name}.js"></script>`;
  if (previewJs !== null) {
    forbidHtmlBreakers(previewJs, `_preview/${name}.js`);
    if (!body.includes(tag))
      throw new Error(`${name}: preview module tag not found`);
    body = body.replace(tag, () => `<script>\n${previewJs}\n</script>`);
  }
  if (body.includes("../../../"))
    throw new Error(`${name}: preview keeps a converter-layout path`);
  return `<!-- @dsCard group="${group}" height=${height} -->\n${body}`;
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
    "- `components/bundle.css` — the compiled stylesheet: tokens, the Inter import and every utility the system and its previews use.",
    "- `components/lib/react.js`, `components/lib/react-dom.js` — React 19 for the previews (`react-dom` is merged into `react.js`).",
    "- `components/index.d.ts` — the props of every component; `components/<Name>/README.md` — its guide and examples.",
    "- `tokens.json` / `tokens.css` — the token source `packages/design-system/tokens/*.json`, exact values.",
    "",
    "## Not synced",
    "",
    "- Fonts: Inter is hosted (Google Fonts), no file. Tactic Sans Extended, Century Gothic and Montserrat are reserved brand faces no product surface loads; they appear only in the font stacks.",
    "- Components: built from the package's own build (the Built route). SmartCaptcha and BotProtectionField show a floor card — the invisible captcha renders nothing without its remote script.",
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

function indexFor(live, { now, repo, sha, present }) {
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
    libraries: kept.libraries ?? [],
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
  if (Buffer.byteLength(bundle) > BUNDLE_MAX)
    throw new Error(
      `components/bundle.js is ${Buffer.byteLength(bundle)} bytes, over the 6 MB cap`,
    );
  write("components/bundle.js", bundle);
  copyFileSync(
    join(from, "_ds_bundle.css"),
    join(project, "components", "bundle.css"),
  );
  for (const lib of ["react.js", "react-dom.js"])
    copyFileSync(
      join(from, "_vendor", lib),
      join(project, "components", "lib", lib),
    );

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
    `${JSON.stringify(indexFor(index, { now, repo, sha, present }), null, 2)}\n`,
  );
  writeFileSync(join(out, "REMOVALS.txt"), removals(from), "utf8");

  const files = walkFiles(project);
  const bytes = files.reduce(
    (sum, rel) => sum + statSync(join(project, rel)).size,
    0,
  );
  return { components: names, unplaced, files: files.length, bytes };
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
  const result = buildArtifact({
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
