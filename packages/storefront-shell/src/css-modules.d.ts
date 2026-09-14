/**
 * CSS-module typings.
 *
 * The apps get these from `next-env.d.ts`, which Next.js generates inside each
 * app. This package ships its `src/` directly with no build step and is compiled
 * by the consuming app, so it must declare the shape itself — otherwise
 * `tsc --noEmit` here cannot resolve `./footer.module.css`.
 */
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
