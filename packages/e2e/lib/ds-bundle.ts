import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build, type Plugin } from "esbuild";

/**
 * #3798 — the DS bundle a DS-bundle canvas loads
 * (`<script src="_ds/<project>/_ds_bundle.js">`, then
 * `<x-import component-from-global-scope="DsDesignSystem.<Name>">`), built
 * from THIS repo's `@ds/design-system` for the runtime canvas loader
 * (`./canvas-runtime.ts`). Claude Design's own bundle is the same package
 * (`@ds/design-system`, both entries on one browser global — the published
 * `_ds/…/README.md`, `.design-sync/prepare.mjs`), so the canvas renders the
 * components the app ships, built here offline from the workspace sources.
 *
 * Shape (as the Claude Design converter emits it): one IIFE assigning
 * `window.DsDesignSystem`; `react` / `react-dom` / `react-is` / `scheduler`
 * are the page's `window.React` / `window.ReactDOM` (the 18.3.1 UMDs the
 * runtime loaded) — a second React copy would break hooks.
 *
 * The bundle's stylesheet (`_ds_bundle.css`) is not built: the structure read
 * compares controls (kind + label, card shapes), never styling, and the
 * loader answers it with a 404.
 *
 * Needs `@ds/schemas` built (`dist/`), which every e2e job that builds an app
 * already does (`turbo run build --filter=@ds/<app>`).
 */

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const DESIGN_SYSTEM = resolve(REPO, "packages/design-system");

export const DS_BUNDLE_GLOBAL = "DsDesignSystem";

/** A published DS bundle path a canvas loads, e.g. `_ds/<project>/_ds_bundle.js`. */
export const DS_BUNDLE_PATH = /^_ds\/[^/]+\/_ds_bundle\.js$/;

const REACT_SHIMS: Record<string, string> = {
  // Automatic-runtime jsx/jsxs → createElement: `key` is the 3rd argument,
  // lifted into the config; jsxs children are a static array, spread.
  react: `var R=window.React;
function np(p,k){var o={};for(var x in p)if(x!=="children")o[x]=p[x];if(k!==void 0)o.key=k;return o}
function jsx(t,p,k){var c=p&&p.children;return c===void 0?R.createElement(t,np(p,k)):R.createElement(t,np(p,k),c)}
function jsxs(t,p,k){return R.createElement.apply(R,[t,np(p,k)].concat(p.children))}
module.exports=R;module.exports.jsx=jsx;module.exports.jsxs=jsxs;
module.exports.jsxDEV=function(t,p,k,s){return(s?jsxs:jsx)(t,p,k)};module.exports.Fragment=R.Fragment;`,
  "react-dom": `var D=window.ReactDOM,n=function(){};
module.exports=Object.assign({preload:n,preinit:n,preconnect:n,prefetchDNS:n,preloadModule:n,preinitModule:n},D);`,
  "react-is": `var R=window.React;
var FWD=Symbol.for("react.forward_ref"),MEMO=Symbol.for("react.memo");
function tt(o){return o!=null&&typeof o==="object"?(R.isValidElement(o)?(o.type&&o.type.$$typeof)||o.type:o.$$typeof):undefined}
exports.typeOf=tt;exports.isElement=R.isValidElement;exports.isFragment=function(o){return R.isValidElement(o)&&o.type===R.Fragment};
exports.isForwardRef=function(o){return tt(o)===FWD};exports.isMemo=function(o){return tt(o)===MEMO};
exports.ForwardRef=FWD;exports.Memo=MEMO;exports.Fragment=R.Fragment;`,
  scheduler: `throw new Error("the DS bundle imports scheduler directly: react-dom leaked into @ds/design-system");`,
};

const SHIMMED = /^(react|react-dom|react-is|scheduler)(\/.*)?$/;

const pageReact: Plugin = {
  name: "page-react",
  setup(b) {
    b.onResolve({ filter: SHIMMED }, (args) => ({
      path: SHIMMED.exec(args.path)![1]!,
      namespace: "page-react",
    }));
    b.onLoad({ filter: /.*/, namespace: "page-react" }, (args) => ({
      contents: REACT_SHIMS[args.path]!,
      loader: "js",
    }));
  },
};

/** Build the DS bundle (an IIFE assigning `window.DsDesignSystem`). */
export async function buildDsBundle(): Promise<string> {
  const result = await build({
    stdin: {
      contents:
        'export * from "./src/index.ts";\nexport * from "./src/blocks/index.ts";\n',
      resolveDir: DESIGN_SYSTEM,
      sourcefile: "ds-bundle-entry.ts",
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: DS_BUNDLE_GLOBAL,
    footer: { js: `window.${DS_BUNDLE_GLOBAL}=${DS_BUNDLE_GLOBAL};` },
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    plugins: [pageReact],
    loader: {
      ".svg": "dataurl",
      ".png": "dataurl",
      ".woff": "dataurl",
      ".woff2": "dataurl",
      ".css": "empty",
    },
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": '"http://design-source.invalid/"',
    },
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}

let cached: Promise<string> | undefined;

/** The DS bundle, built once per process. */
export function dsBundle(): Promise<string> {
  cached ??= buildDsBundle().catch((error: unknown) => {
    cached = undefined;
    throw error;
  });
  return cached;
}
