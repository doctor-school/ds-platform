import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as WebinarCardModule from "@ds/design-system/webinar-card";

/**
 * #3728 — server-render one `@ds/design-system` component to static HTML for
 * the canvas-structure check (`feed-canvas-structure.spec.ts`): a canvas
 * mounts `DsDesignSystem.<Name>` from the DS bundle, which is not vendored.
 * Run in its own Node process (`tsx`), because the Playwright worker
 * transforms `.tsx` JSX into its component-testing element objects, which
 * `react-dom/server` cannot render.
 *
 * argv: <Name> <props as JSON> → stdout: the markup.
 */
const COMPONENTS = { ...WebinarCardModule } as unknown as Record<string, ComponentType<object>>;

const [name = "", json = "{}"] = process.argv.slice(2);
const component = COMPONENTS[name];
if (!component) {
  process.stderr.write(`no @ds/design-system component ${name} for the canvas\n`);
  process.exit(2);
}
process.stdout.write(renderToStaticMarkup(createElement(component, JSON.parse(json) as object)));
