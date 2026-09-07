/**
 * `?raw` imports (Vite/Vitest). Used by the 028 Markdown-helper test to parse the
 * REAL published policy from `@ds/legal-content` rather than a hand-written
 * fixture — a fixture would let the helper pass while the actual document renders
 * wrong. The raw import keeps that test hermetic: no `fs`, so this browser-targeted
 * package never gains Node types, and no build-order edge onto the Node-only
 * content package.
 */
declare module "*.md?raw" {
  const content: string;
  export default content;
}
