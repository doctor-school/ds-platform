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
        // Frontmatter fields mirrored from the G9.1 sweep. Keystatic
        // rejects unknown keys on load, so every key present in the
        // `.md` files must be declared here.
        description: fields.text({ label: 'Description', multiline: true }),
        lang: fields.select({
          label: 'Language',
          options: [
            { label: 'English', value: 'en' },
            { label: 'Russian', value: 'ru' },
          ],
          defaultValue: 'en',
        }),
        // `fields.markdoc` defaults to `.mdoc` extension, so we
        // override it to `md` to match the actual ADR files.
        // Markdoc is more permissive than MDX about raw `<` characters
        // (literal `<300ms`, `<1%` patterns are pervasive in the ADRs).
        content: fields.markdoc({ label: 'Content', extension: 'md' }),
      },
    }),
    glossary: collection({
      label: 'Glossary terms',
      slugField: 'title',
      path: 'content/product/glossary/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Term' } }),
        description: fields.text({ label: 'Description', multiline: true }),
        lang: fields.select({
          label: 'Language',
          options: [
            { label: 'English', value: 'en' },
            { label: 'Russian', value: 'ru' },
          ],
          defaultValue: 'en',
        }),
        content: fields.markdoc({ label: 'Definition', extension: 'md' }),
      },
    }),
  },
  singletons: {
    vision: singleton({
      label: 'Product vision',
      path: 'content/product/vision',
      format: { contentField: 'content' },
      schema: {
        content: fields.markdoc({ label: 'Vision', extension: 'md' }),
      },
    }),
  },
});
