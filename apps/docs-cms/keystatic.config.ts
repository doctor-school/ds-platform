import { config, fields, collection, singleton } from '@keystatic/core';

/**
 * Keystatic config — Phase A local-storage CMS for the DS Platform docs.
 *
 * Storage: `local` (file-system). Editor writes straight to
 * `apps/docs/content/...`, the same tree Fumadocs reads.
 * GitHub-storage / OAuth deferred to a later ops sweep
 * (ADR-0006 §3).
 *
 * Collections / singletons land per ADR-0006 §10:
 *   - adrs       → apps/docs/content/adr/
 *   - glossary   → apps/docs/content/product/glossary/
 *   - vision     → apps/docs/content/product/vision.md
 *
 * `apps/docs/content/product/glossary/` and `vision.md` are scaffold
 * placeholders today; populated in later content-migration groups.
 */
export default config({
  storage: {
    kind: 'local',
  },
  collections: {
    adrs: collection({
      label: 'ADRs',
      slugField: 'title',
      path: 'content/adr/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        // ADRs are CommonMark/MDX-compatible with `.md` extension.
        // `fields.markdoc` defaults to `.mdoc`, so it would match 0 files.
        content: fields.mdx({ label: 'Content', extension: 'md' }),
      },
    }),
    glossary: collection({
      label: 'Glossary terms',
      slugField: 'title',
      path: 'content/product/glossary/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Term' } }),
        content: fields.mdx({ label: 'Definition', extension: 'md' }),
      },
    }),
  },
  singletons: {
    vision: singleton({
      label: 'Product vision',
      path: 'content/product/vision',
      format: { contentField: 'content' },
      schema: {
        content: fields.mdx({ label: 'Vision', extension: 'md' }),
      },
    }),
  },
});
