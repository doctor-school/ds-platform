# @ds/legal-content

Legal document content for feature 028 (legal pages) and the loader both storefronts read it through. Documents are Markdown files with frontmatter — no CMS, no database table, no admin authoring UI (see [`028-design.md`](../../apps/docs/content/specs/features/028-legal-pages/028-design.md), "Content package decision").

Private workspace package. Node only: the loader uses synchronous `fs` reads, so it runs in Next.js server components and Node scripts, never in a client bundle.

## Authoring contract

One file per document, at `documents/<slug>.md`. The filename **is** the document's URL segment (`/documents/<slug>`), so it must equal the frontmatter `slug`.

```markdown
---
slug: consent-marketing
title: Согласие на маркетинговые сообщения
edition: "2026-02-20"
kind: consent
---

Текст документа…
```

| Field     | Rule                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------- |
| `slug`    | kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`), equal to the filename, stable for the document's lifetime |
| `title`   | non-empty                                                                                          |
| `edition` | **quoted** ISO date `"YYYY-MM-DD"`, a real calendar date — rendered as «редакция от <дата>»        |
| `kind`    | `policy` or `consent`                                                                              |

`edition` must be quoted. YAML turns a bare `2026-01-15` into a timestamp and silently rolls an impossible date over (`2026-02-30` becomes 2 March), which would publish a «редакция от» date nobody wrote; the loader rejects the unquoted form with that instruction rather than guessing.

### Publishing a correction (EARS-10)

Bump `edition` in the same file and keep the same `slug`. A new edition is a text change, never a new document — consent copy, the 021 registration form and stored consent references all resolve through that URL, and renaming a `slug` breaks them. The title may change freely; the `slug` may not.

### No drafts, no placeholders (EARS-12)

A document the owner has not approved is simply not a file here. There is no draft flag, no disabled row, no «скоро» body — the guarantee is the filesystem's, not a runtime check somebody has to remember. Adding an in-progress document with stand-in text is a defect, not a stepping stone.

### Review bar

A content change is a PR against this package with the same bar as code: Mode (a) review + green CI. The loader fails loud — a malformed frontmatter, an unreal `edition`, an unknown `kind`, or a filename that disagrees with its `slug` throws `LegalContentError` naming the file and the field, so a bad document breaks the build instead of vanishing from the page.

## API

```ts
import { listDocuments, loadDocument } from "@ds/legal-content";

loadDocument("consent-marketing"); // → { slug, frontmatter, body } | undefined
listDocuments("consent"); // → LegalDocument[], sorted by slug
```

- `loadDocument(slug, options?)` returns `undefined` when no such file exists (and for any slug that is not a plain kebab-case segment — a route parameter never reaches the filesystem unchecked). "Not found" is the host's `dataState` concern.
- `listDocuments(kind?, options?)` enumerates only the files actually present, sorted by `slug`, optionally narrowed to one `kind`.
- `options.documentsDir` overrides the documents directory; tests use it to point at fixtures. Slugs are unique by construction — the filename is the slug, so one directory cannot hold two documents claiming it.

## Host projection note

Next.js standalone builds trace only the files they can see statically. A host app rendering these documents must add this package's `documents/` directory to `outputFileTracingIncludes` (or otherwise ship it) — a host-side concern owned by the route Issues (#1967 Academy, #1968 doctor), not by this package.
