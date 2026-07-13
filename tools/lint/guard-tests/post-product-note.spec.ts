import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Pure seams exported from the Mattermost delivery script (Issue #654). Importing
// them does NOT fire the script's `main()` — it is guarded behind an entry-point
// check, the same idiom as tools/retro/extract.mjs. Issue #657 adds the mandatory
// DEV/prod environment footer, covered here (the #655 delivery-seam NIT).
import {
  buildPayload,
  envFooter,
  extractNote,
  labelsAreProductKind,
  parseLabels,
} from "../../ci/post-product-note.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "..", "..", "ci", "post-product-note.mjs");

const DEV_FOOTER =
  "🧪 Среда: DEV — смержено в разработку; на проде появится со следующим релизом.";
const PROD_FOOTER = "🚀 Среда: PROD — выкачено на продакшен.";

/** Run the script as a subprocess with a controlled env, returning code + streams. */
function runScript(env: Record<string, string | undefined>): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const res = spawnSync(process.execPath, [SCRIPT], {
    // Start from a clean env so a stray DELIVERY_ENV / webhook in the shell can't leak in.
    env: { PATH: process.env.PATH, ...env } as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

// ── pure-logic unit cover ───────────────────────────────────────────────────
describe("post-product-note — environment footer (pure)", () => {
  it("envFooter: `dev` → the DEV marker", () => {
    expect(envFooter("dev")).toBe(DEV_FOOTER);
  });

  it("envFooter: `prod` → the PROD marker", () => {
    expect(envFooter("prod")).toBe(PROD_FOOTER);
  });

  it("envFooter: case- and whitespace-insensitive", () => {
    expect(envFooter(" DEV ")).toBe(DEV_FOOTER);
    expect(envFooter("Prod")).toBe(PROD_FOOTER);
  });

  it("envFooter: unset/blank/unknown → null (caller must fail loudly)", () => {
    expect(envFooter(undefined)).toBeNull();
    expect(envFooter("")).toBeNull();
    expect(envFooter("staging")).toBeNull();
    expect(envFooter("production")).toBeNull();
  });

  it("buildPayload: the footer is the last line of the message", () => {
    const { text } = buildPayload(
      "Новая фича.",
      "feat: thing",
      "https://x/1",
      DEV_FOOTER,
    );
    expect(text.endsWith(DEV_FOOTER)).toBe(true);
    expect(text).toContain("[feat: thing](https://x/1)");
  });
});

// ── section-extraction stop boundary (Issue #659) ───────────────────────────
describe("post-product-note — extractNote stop boundary (pure)", () => {
  it("stops at a `---` thematic break — no English bleed (PR #658 shape)", () => {
    // The note sits at the top of the body, then a divider, then the English PR
    // summary + a `## What changed` heading — exactly the shape that leaked EN
    // text into the delivered message before the fix.
    const body = [
      "## Product note (RU)",
      "",
      "Мы починили доставку заметок в канал обновлений.",
      "",
      "---",
      "",
      "This English summary must not bleed into the delivered note.",
      "",
      "## What changed",
      "",
      "- extraction stop boundary",
    ].join("\n");
    expect(extractNote(body)).toBe(
      "Мы починили доставку заметок в канал обновлений.",
    );
  });

  it("stops at a spaced thematic break (`- - -`) too", () => {
    const body =
      "## Product note (RU)\n\nЗаметка на русском.\n\n- - -\n\nEnglish tail.";
    expect(extractNote(body)).toBe("Заметка на русском.");
  });

  it("stops at the next `##` heading — unchanged behavior", () => {
    const body =
      "## Product note (RU)\n\nЗаметка на русском.\n\n## What changed\n\nEnglish tail.";
    expect(extractNote(body)).toBe("Заметка на русском.");
  });

  it("captures to end of body when there is no divider/heading — unchanged", () => {
    const body =
      "## Product note (RU)\n\nЗаметка на русском.\nВторая строка заметки.\n\n";
    expect(extractNote(body)).toBe(
      "Заметка на русском.\nВторая строка заметки.",
    );
  });
});

// ── product-kind label gate (pure) — Issue #847 ─────────────────────────────
describe("post-product-note — product-kind label gate (pure)", () => {
  it("labelsAreProductKind: `feature` → true", () => {
    expect(labelsAreProductKind(["feature"])).toBe(true);
  });

  it("labelsAreProductKind: `bug` → true", () => {
    expect(labelsAreProductKind(["bug"])).toBe(true);
  });

  it("labelsAreProductKind: a product label among process labels → true", () => {
    expect(labelsAreProductKind(["tooling", "feature"])).toBe(true);
  });

  it("labelsAreProductKind: `docs` → false", () => {
    expect(labelsAreProductKind(["docs"])).toBe(false);
  });

  it("labelsAreProductKind: `tooling`/`dependencies` → false", () => {
    expect(labelsAreProductKind(["tooling", "dependencies"])).toBe(false);
  });

  it("labelsAreProductKind: empty label set → false", () => {
    expect(labelsAreProductKind([])).toBe(false);
  });

  it("labelsAreProductKind: non-array (malformed) → false", () => {
    expect(labelsAreProductKind(undefined)).toBe(false);
    expect(labelsAreProductKind(null)).toBe(false);
    expect(labelsAreProductKind("feature")).toBe(false);
  });

  it("labelsAreProductKind: case- and whitespace-insensitive", () => {
    expect(labelsAreProductKind([" Feature "])).toBe(true);
    expect(labelsAreProductKind(["BUG"])).toBe(true);
  });

  it("parseLabels: a JSON array → the array", () => {
    expect(parseLabels('["feature","docs"]')).toEqual(["feature", "docs"]);
  });

  it("parseLabels: empty/absent input → [] (→ suppressed)", () => {
    expect(parseLabels("")).toEqual([]);
    expect(parseLabels(undefined)).toEqual([]);
  });

  it("parseLabels: non-JSON → [] (fail-closed, never throws)", () => {
    expect(parseLabels("not json")).toEqual([]);
  });

  it("parseLabels: valid JSON that is not an array → []", () => {
    expect(parseLabels("{}")).toEqual([]);
  });
});

// ── end-to-end invariant cover (no network: skip/throw both precede fetch) ───
describe("post-product-note — DELIVERY_ENV invariant (subprocess)", () => {
  const realNoteBody =
    "## Product note (RU)\n\nМы выкатили новую заметную фичу для команды.";

  it("unset DELIVERY_ENV with a real note + product label + webhook → exit 1 (no unmarked post)", () => {
    const { code, stderr } = runScript({
      MATTERMOST_WEBHOOK_URL: "https://mattermost.invalid/hooks/x",
      PR_BODY: realNoteBody,
      PR_TITLE: "feat: thing",
      PR_URL: "https://x/1",
      PR_LABELS: '["feature"]',
      // DELIVERY_ENV intentionally unset
    });
    expect(code).toBe(1);
    expect(stderr).toContain("DELIVERY_ENV");
  });

  it("unknown DELIVERY_ENV → exit 1", () => {
    const { code, stderr } = runScript({
      MATTERMOST_WEBHOOK_URL: "https://mattermost.invalid/hooks/x",
      PR_BODY: realNoteBody,
      PR_TITLE: "feat: thing",
      PR_URL: "https://x/1",
      PR_LABELS: '["feature"]',
      DELIVERY_ENV: "staging",
    });
    expect(code).toBe(1);
    expect(stderr).toContain("DELIVERY_ENV");
  });

  it("process-kind labels + real note + webhook + valid DELIVERY_ENV → exit 0, suppressed (Issue #847)", () => {
    // The label gate must fire BEFORE the DELIVERY_ENV/post path — a docs/tooling PR
    // with a genuine note never reaches the product channel.
    const { code, stdout } = runScript({
      MATTERMOST_WEBHOOK_URL: "https://mattermost.invalid/hooks/x",
      PR_BODY: realNoteBody,
      PR_TITLE: "tooling(ci): thing",
      PR_URL: "https://x/3",
      PR_LABELS: '["tooling"]',
      DELIVERY_ENV: "dev",
    });
    expect(code).toBe(0);
    expect(stdout).toContain("not a product-kind change");
  });

  it("unset PR_LABELS (absent) + real note + webhook → exit 0, suppressed (fail-closed)", () => {
    const { code, stdout } = runScript({
      MATTERMOST_WEBHOOK_URL: "https://mattermost.invalid/hooks/x",
      PR_BODY: realNoteBody,
      PR_TITLE: "feat: thing",
      PR_URL: "https://x/4",
      DELIVERY_ENV: "dev",
      // PR_LABELS intentionally unset → parseLabels("") → [] → suppressed
    });
    expect(code).toBe(0);
    expect(stdout).toContain("not a product-kind change");
  });

  it("no webhook + unset DELIVERY_ENV → exit 0 (the env check never breaks a legitimate skip)", () => {
    const { code, stdout } = runScript({
      PR_BODY: realNoteBody,
      PR_TITLE: "feat: thing",
      PR_URL: "https://x/1",
      // no MATTERMOST_WEBHOOK_URL, no DELIVERY_ENV
    });
    expect(code).toBe(0);
    expect(stdout).toContain("not configured");
  });

  it("`none` note + unset DELIVERY_ENV → exit 0 (skip precedes the env check)", () => {
    const { code, stdout } = runScript({
      MATTERMOST_WEBHOOK_URL: "https://mattermost.invalid/hooks/x",
      PR_BODY: "## Product note (RU)\n\nnone",
      PR_TITLE: "chore: thing",
      PR_URL: "https://x/2",
    });
    expect(code).toBe(0);
    expect(stdout).toContain("nothing to deliver");
  });
});
