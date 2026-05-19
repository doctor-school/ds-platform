import { defineDocs, defineConfig } from 'fumadocs-mdx/config';

// Single docs collection rooted at apps/docs/content/.
// G8-migrated ADRs live at content/adr/. Other subdirs are scaffold
// (.gitkeep) for future migrations per ADR-0006 §10.
export const docs = defineDocs({
  dir: 'content',
});

export default defineConfig({
  mdxOptions: {
    // ADRs use languages outside Shiki's default bundle
    // (e.g. ```gitignore, ```gitattributes); fall back to plaintext
    // instead of throwing the build. Default/known languages
    // (ts, json, bash, yaml, …) continue to highlight normally.
    rehypeCodeOptions: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultLanguage: 'plaintext',
      fallbackLanguage: 'plaintext',
    },
  },
});
