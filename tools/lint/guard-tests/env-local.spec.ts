import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

// Pure + never-throw seams from the local-deploy secret resolver (Issue #950).
// Importing does NOT fire the script's I/O — the module exposes only pure helpers
// plus a never-throw I/O seam guarded behind an entry-point check, the same idiom
// as tools/deploy/release-notes.mjs / deployment-record.mjs. parseDotenv +
// resolveWebhookUrl are pure (no FS/network); loadEnvLocal is exercised against a
// fixture written under os.tmpdir() (platform-agnostic path — CI runs Linux).
import {
  loadEnvLocal,
  parseDotenv,
  resolveWebhookUrl,
} from "../../deploy/env-local.mjs";

describe("env-local — parseDotenv (pure)", () => {
  it("parses simple KEY=VAL lines", () => {
    expect(parseDotenv("A=1\nB=two")).toEqual({ A: "1", B: "two" });
  });

  it("skips blank lines and # comments", () => {
    const text = "\n# a comment\nA=1\n\n  # indented comment\nB=2\n";
    expect(parseDotenv(text)).toEqual({ A: "1", B: "2" });
  });

  it("strips one layer of surrounding matched single/double quotes", () => {
    const text = `A="quoted"\nB='single'\nC=bare`;
    expect(parseDotenv(text)).toEqual({ A: "quoted", B: "single", C: "bare" });
  });

  it("splits on the FIRST = so values may contain = (e.g. URLs, base64)", () => {
    const text = "URL=https://mm.example/hooks/x?a=1&b=2\nPAD=abc==";
    expect(parseDotenv(text)).toEqual({
      URL: "https://mm.example/hooks/x?a=1&b=2",
      PAD: "abc==",
    });
  });

  it("handles CRLF and LF line endings alike", () => {
    expect(parseDotenv("A=1\r\nB=2\n")).toEqual({ A: "1", B: "2" });
  });

  it("skips lines with no = separator", () => {
    expect(parseDotenv("A=1\nNOTAPAIR\nB=2")).toEqual({ A: "1", B: "2" });
  });

  it("returns {} for empty / nullish input", () => {
    expect(parseDotenv("")).toEqual({});
    // @ts-expect-error — defensive: nullish coerces to "" internally.
    expect(parseDotenv(undefined)).toEqual({});
  });
});

describe("env-local — resolveWebhookUrl (pure)", () => {
  const URL_ENV = "https://mm.example/hooks/from-env";
  const URL_LOCAL = "https://mm.example/hooks/from-local";

  it("a process-env value ALWAYS wins over .env.local (CI posture)", () => {
    const chosen = resolveWebhookUrl(
      { MATTERMOST_WEBHOOK_URL: URL_ENV },
      { MATTERMOST_WEBHOOK_URL: URL_LOCAL },
    );
    expect(chosen).toBe(URL_ENV);
  });

  it("falls back to the .env.local map when env is unset", () => {
    const chosen = resolveWebhookUrl(
      {},
      { MATTERMOST_WEBHOOK_URL: URL_LOCAL },
    );
    expect(chosen).toBe(URL_LOCAL);
  });

  it("returns null when neither source has the key", () => {
    expect(resolveWebhookUrl({}, {})).toBeNull();
  });
});

describe("env-local — loadEnvLocal (I/O seam, never throws)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ds-envlocal-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads + parses the file at the explicit envFile override", () => {
    const file = join(dir, ".env.local");
    writeFileSync(
      file,
      "# recipe\nMATTERMOST_WEBHOOK_URL=https://mm.example/hooks/x\nOTHER=y\n",
    );
    const map = loadEnvLocal({ envFile: file });
    expect(map.MATTERMOST_WEBHOOK_URL).toBe("https://mm.example/hooks/x");
    expect(map.OTHER).toBe("y");
  });

  it("returns {} (never throws) when the file is missing", () => {
    const map = loadEnvLocal({
      home: join(dir, "no-such-home"),
      envFile: join(dir, "no-such-file.env"),
    });
    expect(map).toEqual({});
  });
});
