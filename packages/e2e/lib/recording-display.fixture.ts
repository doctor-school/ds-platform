const outline = "The display rule is derived from the published rows alone";
const single =
  "The secondary affordance is absent when only one kind is published";
const hidden = "A hidden event keeps its feature 004 render";
export function displayFixture(index = 0) {
  const kinds = [
    ["edited", "raw"],
    ["edited"],
    ["raw"],
    [],
    ["edited"],
    ["edited"],
  ][index]!;
  const primary = kinds.includes("edited")
    ? "edited"
    : kinds.includes("raw")
      ? "raw"
      : null;
  const secondary = kinds.length === 2 ? "raw" : null;
  const rows = kinds.map((kind) => ({
    id: kind,
    event_id: "owned",
    kind,
    status: "published",
    deleted_at: null,
    provider: "rutube",
    embed_ref:
      kind === "edited"
        ? "22222222222222222222222222222222"
        : "11111111111111111111111111111111",
  }));
  const playback = (kind: string | null) =>
    kind
      ? {
          kind,
          provider: "rutube",
          embedRef: rows.find((r) => r.kind === kind)!.embed_ref,
        }
      : null;
  const state =
    primary === "edited"
      ? "montage"
      : primary === "raw"
        ? "raw-only"
        : "preparing";
  const list = (present: boolean) =>
    [
      "timeframe=upcoming",
      "timeframe=past",
      "",
      "me:upcoming",
      "me:recordings",
    ].map((query) => ({
      query,
      status: 200,
      body:
        query === ""
          ? []
          : {
              data:
                present && ["timeframe=past", "me:recordings"].includes(query)
                  ? [{ id: "owned", slug: "owned-slug" }]
                  : [],
              counts: query.startsWith("me:")
                ? { recordings: present ? 1 : 0, upcoming: 0 }
                : { past: present ? 1 : 0, upcoming: 0 },
            },
    }));
  return {
    identity: index < 4 ? outline : index === 4 ? single : hidden,
    example: index < 4 ? index + 1 : null,
    published: kinds,
    fixture: { id: "owned", slug: "owned-slug", state: "ended", version: 1 },
    rows,
    projection: {
      status: 200,
      body: { state, primaryKind: primary, secondaryKind: secondary },
    },
    playback: {
      status: 200,
      body: { primary: playback(primary), secondary: playback(secondary) },
    },
    browser: {
      path: "/webinars/owned-slug",
      profileStatus: 200,
      primarySrc: primary
        ? `https://rutube.ru/play/embed/${playback(primary)!.embedRef}`
        : null,
      primaryTitle: primary
        ? `Проверка · ${primary === "edited" ? "Монтаж" : "Оригинал"}`
        : null,
      frameCount: primary ? 1 : 0,
      plaque: primary === null,
      secondaryRendered: secondary !== null,
      secondaryInitiallyOpen: false,
      secondaryFramesBefore: 0,
      secondaryFramesAfter: secondary ? 1 : 0,
      secondarySrc: secondary
        ? `https://rutube.ru/play/embed/${playback(secondary)!.embedRef}`
        : null,
      secondaryTitle: secondary ? "Проверка · Оригинал" : null,
      mainDetails: secondary ? 1 : 0,
      notice: false,
      participationControls: 0,
      sourceLeak: false,
    },
    hidden:
      index === 5
        ? {
            before: { id: "owned", state: "ended", version: 1 },
            after: { id: "owned", state: "hidden", version: 2 },
            answer: {
              status: 200,
              body: { state: "hidden" },
              request: {
                method: "POST",
                path: "/v1/admin/events/owned/hide",
                ifMatch: 'W/"1"',
                idempotencyKey: "12345678-1234-4123-8123-123456789abc",
              },
            },
            recordingBefore: rows,
            recordingAfter: rows,
            publicRead: { status: 200, body: { state: "hidden" } },
            beforeLists: list(true),
            afterLists: list(false),
            browser: {
              path: "/webinars/owned-slug",
              notice: true,
              participationControls: 0,
              frameCount: 0,
              playerCount: 0,
              plaqueCount: 0,
              sourceLeak: false,
            },
          }
        : undefined,
  };
}
export function displayReportFixture() {
  const spec = (index: number) => ({
    title: index < 4 ? `Example #${index + 1}` : index === 4 ? single : hidden,
    tests: [
      {
        projectId: "recording-attachment",
        projectName: "recording-attachment",
        status: "expected",
        results: [
          {
            status: "passed",
            retry: 0,
            attachments: [
              {
                name: "recording-attachment",
                contentType: "application/json",
                body: Buffer.from(
                  JSON.stringify({
                    sourceHost: "academy",
                    display: displayFixture(index),
                    backgrounds: [
                      "ended-only",
                      "hidden-exclusion",
                      "mutation-protocol",
                      "retention",
                      "derived-display",
                      "approved-composition",
                    ].map((clause) => ({ clause, evidence: [1] })),
                  }),
                ).toString("base64"),
              },
            ],
          },
        ],
      },
    ],
  });
  return {
    errors: [],
    suites: [
      {
        title:
          "A finished broadcast keeps its value as a recording, and the archive is browsable",
        suites: [
          {
            title:
              "Recording lifecycle, playback and remaining archive contracts",
            specs: [spec(4), spec(5)],
            suites: [{ title: outline, specs: [0, 1, 2, 3].map(spec) }],
          },
        ],
      },
    ],
  };
}
