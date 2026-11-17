import { describe, expect, it } from "vitest";
import { fileFormatLabel } from "./file-format.js";

describe("024 EARS-13 — a download step's file format label", () => {
  it("EARS-13: names a known document content type, then the file extension, then the subtype", () => {
    expect(fileFormatLabel("application/pdf", "memo.bin")).toBe("PDF");
    expect(fileFormatLabel("application/pdf; charset=binary", null)).toBe("PDF");
    expect(
      fileFormatLabel("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx"),
    ).toBe("DOCX");
    expect(fileFormatLabel("application/octet-stream", "Схема.pptx")).toBe("PPTX");
    expect(fileFormatLabel("image/png", "")).toBe("PNG");
    expect(fileFormatLabel(null, "no-extension")).toBeNull();
    expect(fileFormatLabel("application/vnd.something-long", "x")).toBeNull();
  });
});
