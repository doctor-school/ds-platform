/**
 * Raised when a file under the documents directory is not a well-formed legal
 * document. The loader never skips such a file silently: an unreadable or
 * malformed document is a publishing defect that must fail the build/test run,
 * not a row that quietly disappears from the surface (028 EARS-12).
 */
export class LegalContentError extends Error {
  /** Absolute path of the offending file. */
  readonly file: string;

  constructor(file: string, message: string, options?: { cause?: unknown }) {
    super(`${file}: ${message}`, options);
    this.name = "LegalContentError";
    this.file = file;
  }
}
