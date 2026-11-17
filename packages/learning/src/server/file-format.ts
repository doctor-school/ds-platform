// 024 EARS-13 — the format label of a download step's file, as the path
// kicker names it («Материал для скачивания · PDF · 1,2 МБ»): the uploaded
// media's content type when it is a known document type, else the file name's
// extension, else the content type's subtype — upper-cased.

const BY_CONTENT_TYPE: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/zip": "ZIP",
  "text/plain": "TXT",
  "text/csv": "CSV",
};

/** The label, or null when neither the content type nor the file name names one. */
export function fileFormatLabel(
  contentType: string | null | undefined,
  fileName: string | null | undefined,
): string | null {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  const known = BY_CONTENT_TYPE[type];
  if (known) return known;
  const ext = /\.([a-z0-9]{1,8})$/i.exec((fileName ?? "").trim())?.[1];
  if (ext) return ext.toUpperCase();
  const subtype = /^[a-z]+\/([a-z0-9]{1,8})$/.exec(type)?.[1];
  return subtype ? subtype.toUpperCase() : null;
}
