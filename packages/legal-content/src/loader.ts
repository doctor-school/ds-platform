import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import matter from "gray-matter";

import { LegalContentError } from "./errors.js";
import {
  legalDocumentFrontmatterSchema,
  SLUG_PATTERN,
  type LegalDocumentFrontmatter,
  type LegalDocumentKind,
} from "./frontmatter.js";

export interface LegalDocument {
  readonly slug: string;
  readonly frontmatter: LegalDocumentFrontmatter;
  /** Markdown body with the frontmatter block stripped. */
  readonly body: string;
}

export interface LoaderOptions {
  /** Overrides the published documents directory (tests use fixtures). */
  readonly documentsDir?: string;
}

const DOCUMENT_EXTENSION = ".md";

/**
 * Default documents directory. `../documents` resolves identically from
 * `src/loader.ts` and the emitted `dist/loader.js` — both sit one level below
 * the package root.
 */
const defaultDocumentsDir = (): string =>
  fileURLToPath(new URL("../documents/", import.meta.url));

const resolveDir = (options?: LoaderOptions): string =>
  options?.documentsDir ?? defaultDocumentsDir();

const parseDocument = (file: string, slug: string): LegalDocument => {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (cause) {
    throw new LegalContentError(file, "document could not be read", { cause });
  }

  const parsed = matter(raw);
  const result = legalDocumentFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"} — ${issue.message}`)
      .join("; ");
    throw new LegalContentError(file, `invalid frontmatter: ${detail}`);
  }

  if (result.data.slug !== slug) {
    throw new LegalContentError(
      file,
      `frontmatter slug "${result.data.slug}" does not match the filename slug "${slug}" — the filename is the document's URL (028 EARS-10)`,
    );
  }

  return { slug, frontmatter: result.data, body: parsed.content.trim() };
};

/**
 * Resolves one published document by its `slug`.
 *
 * Returns `undefined` when no such file exists — "not found" is the host's
 * `dataState` concern, and a document the owner has not approved simply has no
 * file (028 EARS-12: no placeholder, no draft state). A malformed file, by
 * contrast, throws {@link LegalContentError}.
 *
 * Synchronous `fs` reads, Node only: consumers are Next.js server components.
 */
export const loadDocument = (
  slug: string,
  options?: LoaderOptions,
): LegalDocument | undefined => {
  // A slug reaches this function straight from a route segment. Anything that
  // is not a plain kebab-case segment (`../`, separators, upper case) is not a
  // document name and must never be joined onto the documents directory.
  if (!SLUG_PATTERN.test(slug)) return undefined;

  const file = join(resolveDir(options), `${slug}${DOCUMENT_EXTENSION}`);
  try {
    if (!statSync(file).isFile()) return undefined;
  } catch {
    return undefined;
  }

  return parseDocument(file, slug);
};

/**
 * Enumerates the published documents, sorted by `slug`, optionally narrowed to
 * one `kind`. Only files actually present in the documents directory are
 * listed — the no-placeholder rule is a filesystem guarantee, not a runtime
 * flag (028 EARS-12). Every `*.md` file present must be valid; a malformed one
 * throws rather than being skipped.
 *
 * Slugs are unique by construction: the filename is the slug, so a directory
 * cannot hold two documents claiming the same one.
 */
export const listDocuments = (
  kind?: LegalDocumentKind,
  options?: LoaderOptions,
): LegalDocument[] => {
  const dir = resolveDir(options);

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.endsWith(DOCUMENT_EXTENSION))
    .map((entry) => {
      const slug = entry.slice(0, -DOCUMENT_EXTENSION.length);
      const file = join(dir, entry);
      if (!SLUG_PATTERN.test(slug)) {
        throw new LegalContentError(
          file,
          `filename "${entry}" is not a kebab-case <slug>.md document name`,
        );
      }
      return parseDocument(file, slug);
    })
    .filter((document) => kind === undefined || document.frontmatter.kind === kind)
    .sort((a, b) => a.slug.localeCompare(b.slug));
};
