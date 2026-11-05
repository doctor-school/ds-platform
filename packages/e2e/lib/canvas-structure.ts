import { readFileSync } from "node:fs";
import { basename } from "node:path";
import vm from "node:vm";

/**
 * #3682 — the CANVAS half of the structural canvas-parity check: read a
 * vendored Claude Design canvas (`design-source/*.dc.html`) as CODE and return
 * the semantic tree of one region, so an e2e can compare it with the same tree
 * read from the rendered app (`./rendered-structure.ts`). Code to code — no
 * reviewer wording, no screenshot.
 *
 * A canvas is an HTML template (`<sc-if value="{{ x }}">`,
 * `<sc-for list="{{ xs }}" as="x">`, `{{ expr }}`) driven by a
 * `class Component extends DCLogic { renderVals() { … } }` script. The DC
 * runtime (`support.js`) is NOT vendored (design-source/README.md), so the
 * script runs here in a Node `vm` sandbox against a minimal `DCLogic` stub:
 * `props` / `state` are VALUES the caller chooses (host, signed-in, width), and
 * the browser globals a canvas reads only inside `try` or `componentDidMount`
 * (`localStorage`, `matchMedia`) are simply absent.
 *
 * The tree is deliberately small: the interactive items (`a`, `button`,
 * `input`, `summary`) in document order, each with its kind and VISIBLE label,
 * split into `bar` (visible with every menu closed) and `menu` (inside a
 * `<details>` panel). An icon- or image-only control (no letter or digit in
 * its visible text) compares by kind alone — its glyph, image alt and
 * tooltip / aria wording are not drawn, so they are not layout.
 */

export type ItemKind = "link" | "button" | "input" | "summary";

export interface StructureItem {
  kind: ItemKind;
  /** Visible label; `null` for an icon-only control. */
  label: string | null;
}

export interface RegionStructure {
  bar: StructureItem[];
  menu: StructureItem[];
}

/** Where the region starts and ends in the expanded template. */
export interface RegionSpec {
  /** The region's name, matched by an allowlist entry's `regions`. */
  name?: string;
  /** The first element of the region: a tag, optionally with one attribute value. */
  start: { tag: string; attr?: [name: string, value: string] };
  /**
   * The region runs over the start element and its following siblings up to
   * (not including) the first comment containing this text; absent, the
   * region is the start element alone.
   */
  untilComment?: string;
}

export interface CanvasInput {
  props?: Record<string, unknown>;
  state?: Record<string, unknown>;
}

/** ds-shell pilot region: the `<header>` plus the mobile search band under it. */
export const DS_SHELL_HEADER_REGION: RegionSpec = {
  name: "header",
  start: { tag: "header" },
  untilComment: "Зона контента экрана",
};

/** #3727 — the ds-shell footer artboard (`ds-shell · футер`), the element alone. */
export const DS_SHELL_FOOTER_REGION: RegionSpec = {
  name: "footer",
  start: { tag: "footer", attr: ["data-screen-label", "ds-shell · футер"] },
};

// ── template parsing ────────────────────────────────────────────────────────

interface ElementNode {
  type: "el";
  tag: string;
  attrs: Record<string, string>;
  children: TemplateNode[];
}
interface TextNode {
  type: "text";
  value: string;
}
interface CommentNode {
  type: "comment";
  value: string;
}
type TemplateNode = ElementNode | TextNode | CommentNode;

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT = new Set(["script", "style"]);

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** A quote-aware tokenizer for the canvas subset of HTML. */
export function parseTemplate(html: string): TemplateNode[] {
  const root: ElementNode = { type: "el", tag: "#root", attrs: {}, children: [] };
  const stack: ElementNode[] = [root];
  const top = () => stack[stack.length - 1]!;
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      const stop = end === -1 ? html.length : end;
      top().children.push({ type: "comment", value: html.slice(i + 4, stop) });
      i = stop + 3;
      continue;
    }
    if (html.startsWith("<!", i)) {
      i = html.indexOf(">", i) + 1 || html.length;
      continue;
    }
    if (html.startsWith("</", i)) {
      const end = html.indexOf(">", i);
      const tag = html.slice(i + 2, end).trim().toLowerCase();
      // Pop to the matching open element; a stray close tag is ignored.
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      i = end + 1;
      continue;
    }
    if (html[i] === "<" && /[a-zA-Z]/.test(html[i + 1] ?? "")) {
      let j = i + 1;
      while (j < html.length && /[^\s/>]/.test(html[j]!)) j++;
      const tag = html.slice(i + 1, j).toLowerCase();
      const attrs: Record<string, string> = {};
      let selfClosing = false;
      for (;;) {
        while (/\s/.test(html[j] ?? "")) j++;
        if (j >= html.length) break;
        if (html[j] === ">") {
          j++;
          break;
        }
        if (html.startsWith("/>", j)) {
          selfClosing = true;
          j += 2;
          break;
        }
        let k = j;
        while (k < html.length && /[^\s=/>]/.test(html[k]!)) k++;
        const name = html.slice(j, k).toLowerCase();
        j = k;
        while (/\s/.test(html[j] ?? "")) j++;
        let value = "";
        if (html[j] === "=") {
          j++;
          while (/\s/.test(html[j] ?? "")) j++;
          const quote = html[j];
          if (quote === '"' || quote === "'") {
            const close = html.indexOf(quote, j + 1);
            value = html.slice(j + 1, close);
            j = close + 1;
          } else {
            let v = j;
            while (v < html.length && /[^\s>]/.test(html[v]!)) v++;
            value = html.slice(j, v);
            j = v;
          }
        }
        if (name) attrs[name] = decodeEntities(value);
        else j++;
      }
      const node: ElementNode = { type: "el", tag, attrs, children: [] };
      top().children.push(node);
      if (RAW_TEXT.has(tag)) {
        const close = html.toLowerCase().indexOf(`</${tag}`, j);
        const stop = close === -1 ? html.length : close;
        node.children.push({ type: "text", value: html.slice(j, stop) });
        i = html.indexOf(">", stop) + 1 || html.length;
        continue;
      }
      if (!selfClosing && !VOID.has(tag)) stack.push(node);
      i = j;
      continue;
    }
    const next = html.indexOf("<", i + 1);
    const stop = next === -1 ? html.length : next;
    top().children.push({ type: "text", value: decodeEntities(html.slice(i, stop)) });
    i = stop;
  }
  return root.children;
}

function findAll(nodes: TemplateNode[], test: (n: ElementNode) => boolean): ElementNode[] {
  const out: ElementNode[] = [];
  const walk = (list: TemplateNode[]) => {
    for (const n of list) {
      if (n.type !== "el") continue;
      if (test(n)) out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// ── logic evaluation ────────────────────────────────────────────────────────

const DC_LOGIC_STUB = `
class DCLogic {
  constructor() { this.props = {}; this.state = {}; }
  setState(update) {
    const next = typeof update === "function" ? update(this.state, this.props) : update;
    this.state = Object.assign({}, this.state, next);
  }
}
`;

/** The canvas's declared props with their `default` values. */
function defaultProps(script: ElementNode): Record<string, unknown> {
  const raw = script.attrs["data-props"];
  if (!raw) return {};
  const declared = JSON.parse(raw) as Record<string, { default?: unknown }>;
  return Object.fromEntries(
    Object.entries(declared).map(([key, spec]) => [key, spec?.default]),
  );
}

function evaluateLogic(
  file: string,
  script: ElementNode,
  input: CanvasInput,
): { vals: Record<string, unknown>; context: vm.Context } {
  const source = script.children.map((c) => (c.type === "text" ? c.value : "")).join("");
  const context = vm.createContext({
    __props: { ...defaultProps(script), ...input.props },
    __state: input.state ?? {},
  });
  try {
    vm.runInContext(
      `${DC_LOGIC_STUB}\n${source}\n;globalThis.__Component = Component;`,
      context,
      { filename: file },
    );
    const vals = vm.runInContext(
      `(() => { const c = new __Component(); c.props = __props;
        c.state = Object.assign({}, c.state, __state);
        return c.renderVals(); })()`,
      context,
    ) as Record<string, unknown>;
    return { vals, context };
  } catch (error) {
    throw new Error(
      `${basename(file)}: renderVals() is not evaluable without the DC runtime — ${String(error)}`,
      { cause: error },
    );
  }
}

// ── template expansion ──────────────────────────────────────────────────────

const ONE_EXPR = /^\s*\{\{([\s\S]+?)\}\}\s*$/;
const ANY_EXPR = /\{\{([\s\S]+?)\}\}/g;

/** Template nodes with every `sc-if` / `sc-for` / `{{ }}` resolved. */
interface ResolvedElement {
  type: "el";
  tag: string;
  attrs: Record<string, unknown>;
  children: ResolvedNode[];
}
type ResolvedNode = ResolvedElement | TextNode | CommentNode;

function makeEvaluator(context: vm.Context, vals: Record<string, unknown>) {
  const cache = new Map<string, (scope: object) => unknown>();
  return (expr: string, scope: Record<string, unknown>): unknown => {
    let fn = cache.get(expr);
    if (!fn) {
      // Sloppy-mode `with` resolves bare names against the render values and
      // the enclosing `sc-for` aliases — exactly the DC template's name lookup.
      fn = vm.runInContext(
        `(function (__s) { with (__s) { return (${expr}); } })`,
        context,
      ) as (scope: object) => unknown;
      cache.set(expr, fn);
    }
    return fn({ ...vals, ...scope });
  };
}

function expand(
  nodes: TemplateNode[],
  evaluate: (expr: string, scope: Record<string, unknown>) => unknown,
  scope: Record<string, unknown>,
): ResolvedNode[] {
  const out: ResolvedNode[] = [];
  const interpolate = (text: string) =>
    text.replace(ANY_EXPR, (_m, expr: string) => {
      const v = evaluate(expr, scope);
      return v == null || v === false ? "" : String(v);
    });
  for (const node of nodes) {
    if (node.type === "comment") {
      out.push(node);
      continue;
    }
    if (node.type === "text") {
      out.push({ type: "text", value: interpolate(node.value) });
      continue;
    }
    if (RAW_TEXT.has(node.tag) || node.tag === "helmet") continue;
    if (node.tag === "sc-if") {
      const cond = ONE_EXPR.exec(node.attrs.value ?? "");
      if (cond && evaluate(cond[1]!, scope)) {
        out.push(...expand(node.children, evaluate, scope));
      }
      continue;
    }
    if (node.tag === "sc-for") {
      const list = ONE_EXPR.exec(node.attrs.list ?? "");
      const items = list ? evaluate(list[1]!, scope) : [];
      const alias = node.attrs.as ?? "item";
      for (const item of Array.isArray(items) ? items : []) {
        out.push(...expand(node.children, evaluate, { ...scope, [alias]: item }));
      }
      continue;
    }
    const attrs: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(node.attrs)) {
      const one = ONE_EXPR.exec(value);
      attrs[name] = one ? evaluate(one[1]!, scope) : interpolate(value);
    }
    out.push({
      type: "el",
      tag: node.tag,
      attrs,
      children: expand(node.children, evaluate, scope),
    });
  }
  return out;
}

// ── region → structure ──────────────────────────────────────────────────────

const KIND: Record<string, ItemKind> = {
  a: "link",
  button: "button",
  input: "input",
  summary: "summary",
};

const HAS_WORD = /[\p{L}\p{N}]/u;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function textOf(node: ResolvedNode): string {
  if (node.type === "text") return node.value;
  if (node.type === "comment") return "";
  return node.children.map(textOf).join("");
}

/**
 * Visible label: the input's placeholder, or text with a letter/digit. A
 * glyph- or image-only control (the ☾ toggle, the ≡ summary, the wordmark
 * link) has none — its alt / title / aria wording is not drawn.
 */
function labelOf(node: ResolvedElement): string | null {
  if (node.tag === "input") return collapse(String(node.attrs.placeholder ?? "")) || null;
  const text = collapse(textOf(node));
  return HAS_WORD.test(text) ? text : null;
}

function collectItems(
  nodes: ResolvedNode[],
  inDetails: boolean,
  file: string,
  out: RegionStructure,
) {
  for (const node of nodes) {
    if (node.type !== "el") continue;
    if (node.tag === "dc-import") {
      throw new Error(
        `${basename(file)}: the region imports <dc-import name="${String(node.attrs.name)}"> — ` +
          "an imported canvas is not expanded by this extractor yet",
      );
    }
    const kind = KIND[node.tag];
    if (kind) {
      const container = inDetails && kind !== "summary" ? "menu" : "bar";
      out[container].push({ kind, label: labelOf(node) });
      continue;
    }
    collectItems(node.children, inDetails || node.tag === "details", file, out);
  }
}

function regionNodes(tree: ResolvedNode[], spec: RegionSpec): ResolvedNode[] | null {
  const matches = (n: ResolvedNode): boolean =>
    n.type === "el" &&
    n.tag === spec.start.tag &&
    (!spec.start.attr || n.attrs[spec.start.attr[0]] === spec.start.attr[1]);
  for (const node of tree) {
    if (node.type !== "el") continue;
    // A depth-first search over the siblings of each level.
    const at = node.children.findIndex(matches);
    if (at !== -1) {
      const { untilComment } = spec;
      if (untilComment === undefined) return [node.children[at]!];
      const region: ResolvedNode[] = [];
      for (const sibling of node.children.slice(at)) {
        if (sibling.type === "comment" && sibling.value.includes(untilComment)) break;
        region.push(sibling);
      }
      return region;
    }
    const inner = regionNodes(node.children, spec);
    if (inner) return inner;
  }
  return null;
}

/**
 * Evaluate a canvas for the given props/state and return the semantic tree of
 * one region.
 */
export function extractCanvasStructure(
  file: string,
  input: CanvasInput = {},
  region: RegionSpec = DS_SHELL_HEADER_REGION,
): RegionStructure {
  const template = parseTemplate(readFileSync(file, "utf8"));
  const [script] = findAll(
    template,
    (n) => n.tag === "script" && n.attrs.type === "text/x-dc",
  );
  if (!script) throw new Error(`${basename(file)}: no <script type="text/x-dc"> logic block`);
  const [xdc] = findAll(template, (n) => n.tag === "x-dc");
  if (!xdc) throw new Error(`${basename(file)}: no <x-dc> template root`);
  const { vals, context } = evaluateLogic(file, script, input);
  const tree = expand(xdc.children, makeEvaluator(context, vals), {});
  const nodes = regionNodes(
    [{ type: "el", tag: "#root", attrs: {}, children: tree }],
    region,
  );
  if (!nodes) throw new Error(`${basename(file)}: region <${region.start.tag}> not found`);
  const out: RegionStructure = { bar: [], menu: [] };
  collectItems(nodes, false, file, out);
  return out;
}

// ── comparison ──────────────────────────────────────────────────────────────

function keyOf(item: StructureItem): string {
  return `${item.kind} «${item.label ?? "icon"}»`;
}

function without(list: string[], key: string): string[] {
  const at = list.indexOf(key);
  return at === -1 ? list : [...list.slice(0, at), ...list.slice(at + 1)];
}

/**
 * Readable differences between the canvas tree and the app tree; empty when
 * they match. Each line names one of: missing, extra, wrong container, order.
 */
export function diffStructures(canvas: RegionStructure, app: RegionStructure): string[] {
  const lines: string[] = [];
  const other = { bar: "menu", menu: "bar" } as const;
  for (const container of ["bar", "menu"] as const) {
    const want = canvas[container].map(keyOf);
    const have = app[container].map(keyOf);
    let unmatchedHave = [...have];
    const common: string[] = [];
    for (const key of want) {
      if (unmatchedHave.includes(key)) {
        unmatchedHave = without(unmatchedHave, key);
        common.push(key);
      } else if (app[other[container]].map(keyOf).includes(key)) {
        lines.push(`wrong container: ${key} — canvas ${container}, app ${other[container]}`);
      } else {
        lines.push(`missing in app (${container}): ${key}`);
      }
    }
    // An occurrence the other container lacks was already reported as «wrong
    // container» from that side; only that many are suppressed here.
    const count = (keys: string[], key: string) => keys.filter((k) => k === key).length;
    const wantOther = canvas[other[container]].map(keyOf);
    const haveOther = app[other[container]].map(keyOf);
    const suppressed = new Map<string, number>();
    for (const key of unmatchedHave) {
      const lacking = Math.max(0, count(wantOther, key) - count(haveOther, key));
      const used = suppressed.get(key) ?? 0;
      if (used < lacking) {
        suppressed.set(key, used + 1);
        continue;
      }
      lines.push(`extra in app (${container}): ${key}`);
    }
    // Order over the items both sides have in this container.
    let pool = [...common];
    const appOrder = have.filter((key) => {
      if (!pool.includes(key)) return false;
      pool = without(pool, key);
      return true;
    });
    if (appOrder.join("|") !== common.join("|")) {
      lines.push(
        `order (${container}): canvas [${common.join(", ")}] · app [${appOrder.join(", ")}]`,
      );
    }
  }
  return lines;
}

export function formatStructure(structure: RegionStructure): string {
  return (["bar", "menu"] as const)
    .map((c) => `${c}: ${structure[c].map(keyOf).join(" · ") || "—"}`)
    .join("\n");
}

// ── allowlist of decided deviations ─────────────────────────────────────────

export interface AllowlistEntry {
  /** Canvas file name, e.g. `ds-shell.dc.html`. */
  canvas: string;
  /** Applies when every listed prop equals the evaluated canvas prop. */
  props: Record<string, unknown>;
  /** Applies only to these regions ({@link RegionSpec.name}); absent = every region. */
  regions?: string[];
  /** `missing`: the canvas draws it, the app decidedly does not. `extra`: the reverse. */
  delta: "missing" | "extra";
  item: StructureItem;
  /** The recorded decision, in one line. */
  decision: string;
  /** Where the decision is recorded (spec path, PR). */
  source: string;
}

function sameItem(a: StructureItem, b: StructureItem): boolean {
  return a.kind === b.kind && a.label === b.label;
}

/**
 * Remove the decided deviations from both trees before {@link diffStructures}.
 * An applicable entry that matches nothing is returned as `stale` — a decision
 * the code no longer needs must leave the allowlist, not linger as cover.
 */
export function applyAllowlist(
  entries: AllowlistEntry[],
  where: { canvas: string; props: Record<string, unknown>; region?: string | undefined },
  canvas: RegionStructure,
  app: RegionStructure,
): { canvas: RegionStructure; app: RegionStructure; stale: AllowlistEntry[] } {
  const next = {
    canvas: { bar: [...canvas.bar], menu: [...canvas.menu] },
    app: { bar: [...app.bar], menu: [...app.menu] },
  };
  const stale: AllowlistEntry[] = [];
  for (const entry of entries) {
    if (entry.canvas !== where.canvas) continue;
    if (!Object.entries(entry.props).every(([k, v]) => where.props[k] === v)) continue;
    if (entry.regions && !(where.region && entry.regions.includes(where.region))) continue;
    const side = entry.delta === "missing" ? next.canvas : next.app;
    let hit = false;
    for (const container of ["bar", "menu"] as const) {
      const before = side[container].length;
      side[container] = side[container].filter((item) => !sameItem(item, entry.item));
      hit ||= side[container].length !== before;
    }
    if (!hit) stale.push(entry);
  }
  return { ...next, stale };
}

// ── #3728: the resolved tree for slot-aware readers (`./canvas-slots.ts`) ──

export type { ResolvedElement, ResolvedNode };

/** Labels and kinds exactly as the header reader takes them. */
export const itemKindOf = (tag: string): ItemKind | undefined => KIND[tag];
export const visibleLabelOf = labelOf;

/**
 * A canvas evaluated for `input` with every `sc-if` / `sc-for` / `{{ }}`
 * resolved — the whole `<x-dc>` template, no region cut and no item reading.
 * `dc-import` / `x-import` nodes stay in the tree with their resolved props.
 */
export function resolveCanvas(file: string, input: CanvasInput = {}): ResolvedNode[] {
  const template = parseTemplate(readFileSync(file, "utf8"));
  const [script] = findAll(
    template,
    (n) => n.tag === "script" && n.attrs.type === "text/x-dc",
  );
  if (!script) throw new Error(`${basename(file)}: no <script type="text/x-dc"> logic block`);
  const [xdc] = findAll(template, (n) => n.tag === "x-dc");
  if (!xdc) throw new Error(`${basename(file)}: no <x-dc> template root`);
  const { vals, context } = evaluateLogic(file, script, input);
  return expand(xdc.children, makeEvaluator(context, vals), {});
}
