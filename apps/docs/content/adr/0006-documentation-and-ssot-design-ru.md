---
title: "Design Spec — Documentation Framework + SSOT для DS Platform [RU]"
description: "Этот документ — реализационная детализация ADR-0006. ADR фиксирует «что и почему»; spec — «как именно»: file paths, code sketches, CI gates yml,..."
lang: ru
---

> **EN:** [`0006-documentation-and-ssot-design-en.md`](./0006-documentation-and-ssot-design-en.md) · **RU (this)**

# Design Spec — Documentation Framework + SSOT для DS Platform

**Дата:** 2026-05-14
**Статус:** Accepted
**Связан с:** ADR-0006, Plane DSO-60 (`55222f0b-ba97-4b2f-ac91-194fed38ea18`)
**Brainstorm:** через superpowers:brainstorming skill, симметрично DSO-25..29
**Reference (не authoritative):** `docs/documentation-pattern/documentation-framework-final.md`

Этот документ — реализационная детализация ADR-0006. ADR фиксирует «что и почему»; spec — «как именно»: file paths, code sketches, CI gates yml, lint-tool архитектура, migration plan.

---

## 1. Сводка решений (cross-ref ADR-0006)

| Решение         | Выбор                                                                           | ADR-0006 § |
| --------------- | ------------------------------------------------------------------------------- | ---------- |
| ADR split       | Один ADR-0006 + этот design spec                                                | —          |
| SSOT топология  | SSOT-per-kind (см. §3 ниже)                                                     | §1         |
| Doc portal      | Fumadocs (Next.js + MDX)                                                        | §2         |
| MD editor       | Keystatic (block UI, files in Git)                                              | §3         |
| Prose Master    | Git (через Keystatic+Fumadocs) — Notion/Outline не используются для DS Platform | §1         |
| Spec format     | Hybrid B (tech brainstorm + feature SDD)                                        | §4         |
| AI Constitution | AGENTS.md + CLAUDE.md split                                                     | §5         |
| Glossary        | yaml в Git + 4-layer validation + Payload sync                                  | §6         |
| Drift detection | Spectral + drizzle-kit + custom AST + Playwright                                | §7         |
| Diagrams        | Mermaid only v1                                                                 | §8         |
| Tooling stack   | См. §9 detailed below                                                           | §7         |

---

## 2. Architecture overview

### 2.1 Слои

```
┌─ Git (SSOT) ───────────────────────────────────────────────┐
│  apps/docs/content/  (markdown/MDX)                         │
│  packages/db/schema/ (Drizzle TS — DB SSOT)                 │
│  packages/schemas/   (Zod TS — API SSOT)                    │
│  packages/glossary/  (generated artifacts)                  │
│  AGENTS.md, CLAUDE.md                                       │
└────┬─────────────────────┬────────────────────┬─────────────┘
     │ reads/writes        │ reads              │ reads
     ▼                     ▼                    ▼
┌─ Layer 3 (editor) ─┐ ┌─ Layer 2 (portal)─┐ ┌─ AI / IDE ───┐
│ apps/docs-cms      │ │ apps/docs         │ │ Direct file  │
│ Keystatic          │ │ Fumadocs build    │ │ access       │
│ → block UI         │ │ → static site     │ │ → context    │
│ → save = git commit│ │ → cdn deploy      │ │ → write PR   │
└────────────────────┘ └───────────────────┘ └──────────────┘
     │ on save                  ▲
     │ commit                   │ on merge
     ▼                          │
┌─ GitHub repo ─────────────────┘
│  merge to main → CI:
│    1. Lint & drift checks (§7)
│    2. Generate artifacts (openapi-ts, glossary ids, ERD)
│    3. Build apps/docs (Fumadocs) → deploy docs.doctor.school
│    4. Sync glossary.yaml → Payload Glossary Collection
└────────────────────────────────────────────────────────────
                                ▼
┌─ Layer 4 (product runtime — ADR-0004 §7) ──────────────────┐
│  apps/cms (Payload v3)                                      │
│    glossary collection (synced from Git)                    │
│    marketing content + Lexical "Insert glossary term"       │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Топология deploy

- `docs.doctor.school` — Fumadocs (public read-only).
- `docs-cms.doctor.school` — Keystatic admin (Zitadel-protected — same tenant as `apps/admin` per ADR-0001/0004).
- `apps/docs` и `apps/docs-cms` живут как 5-й и 6-й Next.js app в `apps/` директории monorepo (см. §4 layout).
- Build: один Turborepo task `pnpm docs:build` пересобирает оба.

---

## 3. SSOT topology — полная таблица с propagation rules

| Тип правды              | Master file/source                                                                                                                                                                          | Generated artifacts                                                                                     | Propagation script                                                                                   | Validation                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| API contract            | `packages/schemas/**/*.ts` (Zod)                                                                                                                                                            | `openapi.snapshot.json`, `packages/api-client/` (typed SDK)                                             | `pnpm generate:openapi` (NestJS boot → export); `pnpm generate:sdk` (`openapi-typescript`)           | Spectral lint + snapshot diff                 |
| DB schema               | `packages/db/schema/**/*.ts` (Drizzle)                                                                                                                                                      | `apps/api/drizzle/*.sql` (миграции per ADR-0008 §2.3), `packages/db/erd.svg`                            | `pnpm db:generate` (drizzle-kit; `out: ../../apps/api/drizzle`); `pnpm db:erd` (introspect → render) | `drizzle-kit check`                           |
| Domain IDs              | `apps/docs/content/product/glossary/*.md` (per-term markdown; canonical id in body marker)                                                                                                  | `packages/glossary/src/ids.ts` (TS const)                                                               | `pnpm generate:glossary`                                                                             | ESLint custom rule + roundtrip check          |
| Domain labels (ru/en)   | same glossary frontmatter                                                                                                                                                                   | `packages/glossary/messages/<lang>/glossary.json`; Payload Glossary Collection rows                     | `pnpm generate:glossary`; `pnpm sync:glossary-payload` (on staging+prod)                             | Payload Lexical AST glossary-ref check        |
| Business content        | Payload collections (`apps/cms` DB)                                                                                                                                                         | Build-time fetch / runtime API                                                                          | Payload native                                                                                       | Lexical glossary-ref check                    |
| Architectural decisions | `docs/adr/NNNN-*.md` Git, immutable                                                                                                                                                         | Rendered Fumadocs                                                                                       | (none — content as-is)                                                                               | Manual review on PR                           |
| Tech specs              | `docs/content/specs/tech/YYYY-MM-DD-*.md`                                                                                                                                                   | Rendered Fumadocs                                                                                       | (none — content as-is)                                                                               | Manual review                                 |
| Feature specs           | `apps/docs/content/specs/features/NNN-<slug>/` (3 files: `NNN-requirements.md`, `NNN-design.md`, `NNN-scenarios.feature` — per ADR-0006 §4 + §9; tasks tracked в GitHub Issues, не в файле) | Vitest tests (EARS hints), Playwright tests (Gherkin via `playwright-bdd`), NestJS scaffolding (manual) | `pnpm generate:tests:playwright` (gherkin → playwright)                                              | Tests pass; EARS-ID ↔ Vitest describe linkage |
| Module README           | `apps/*/src/<module>/README.md` (директория модуля = прямой потомок `apps/<app>/src/` с файлом `*.module.ts`)                                                                               | Rendered Fumadocs                                                                                       | (none)                                                                                               | `module-readme-lint.ts`                       |
| Prose narrative         | `apps/docs/content/product/{vision,prd/*,business-rules,user-journeys}.md`                                                                                                                  | Rendered Fumadocs                                                                                       | (none)                                                                                               | Markdown link check; glossary-mdx-lint        |
| Operations              | `apps/docs/content/operations/*.md`, `runbooks/*.md`                                                                                                                                        | Rendered Fumadocs                                                                                       | (none)                                                                                               | Markdown link check                           |
| AI constitution         | `AGENTS.md` (root), `CLAUDE.md` (root)                                                                                                                                                      | (none — read directly by AI)                                                                            | (none)                                                                                               | Manual review                                 |

**Никаких других «source of truth».** Если значение появляется в двух местах вне этой таблицы, это false-SSOT.

---

## 4. Monorepo layout (input для DSO-31)

```
ds-platform/                          # репо корень
├── AGENTS.md                          # AI constitution (universal)
├── CLAUDE.md                          # Claude-Code overlay
├── README.md                          # for humans (entry)
├── package.json, turbo.json, pnpm-workspace.yaml
├── apps/
│   ├── docs/                          # Fumadocs portal (Next.js 15)
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── source.config.ts           # Fumadocs source config
│   │   └── content/                   # ALL content lives here
│   │       │   (no adr/ folder here — ADRs живут в docs/adr/ и подключаются
│   │       │    через Fumadocs source.config.ts mapper — см. §4 ниже, Variant B)
│   │       ├── architecture/
│   │       │   ├── overview.md
│   │       │   ├── c4-context.md
│   │       │   ├── c4-containers.md
│   │       │   ├── c4-components.md
│   │       │   ├── deployment.md
│   │       │   ├── security.md
│   │       │   └── integrations.md
│   │       ├── data/
│   │       │   ├── entities.md
│   │       │   ├── database.md
│   │       │   ├── erd.md             # embeds ../../../packages/db/erd.svg
│   │       │   └── data-retention.md
│   │       ├── operations/
│   │       │   ├── environments.md
│   │       │   ├── monitoring.md
│   │       │   ├── backup-restore.md
│   │       │   ├── incident-response.md
│   │       │   └── runbooks/
│   │       ├── product/
│   │       │   ├── vision.md
│   │       │   ├── prd/                # PRD chapters
│   │       │   │   ├── 01-overview.md
│   │       │   │   ├── 02-goals.md
│   │       │   │   └── ...
│   │       │   ├── roles.md
│   │       │   ├── user-journeys.md
│   │       │   ├── business-rules.md
│   │       │   └── glossary/           # file-per-term
│   │       │       ├── doctor.md
│   │       │       ├── nmo_credit.md
│   │       │       └── ...
│   │       ├── specs/
│   │       │   ├── tech/               # arch brainstorm-style
│   │       │   │   └── 2026-05-14-frontend-stack-design.md
│   │       │   └── features/           # SDD-style
│   │       │       └── 001-doctor-registration/
│   │       │           ├── NNN-requirements.md   # incl. frontmatter `tracker:` (GitHub Milestone URL)
│   │       │           ├── NNN-design.md
│   │       │           └── NNN-scenarios.feature
│   │       │           # (НЕТ tasks.md — task state живёт в GitHub Issues, не в Git;
│   │       │            см. ADR-0006 §9 tracker split)
│   │       └── user-guides/            # Diátaxis
│   │           ├── tutorials/
│   │           ├── how-to/
│   │           ├── reference/
│   │           └── explanation/
│   ├── docs-cms/                       # Keystatic editor app (Next.js App Router)
│   │   ├── keystatic.config.ts
│   │   ├── package.json
│   │   └── app/
│   │       ├── api/keystatic/[...params]/route.ts   # makeRouteHandler({ config })
│   │       └── keystatic/[[...params]]/page.tsx     # <KeystaticApp />
│   ├── portal/, admin/, promo/, cms/   # ADR-0004
│   └── mobile/                         # ADR-0005
├── packages/
│   ├── schemas/                        # Zod (API SSOT)
│   ├── api-client/                     # generated TypeScript SDK
│   ├── db/
│   │   ├── schema/                     # Drizzle TS (DB SSOT)
│   │   ├── migrations/                 # generated SQL
│   │   └── erd.svg                     # generated
│   ├── glossary/
│   │   ├── src/ids.ts                  # GENERATED — never edit
│   │   ├── loader.ts                   # YAML loader для scripts
│   │   └── (canonical-ids ESLint rule живёт в tools/lint/eslint-rules, namespace local/ — §6.3)
│   ├── i18n/
│   ├── observability/, hooks/, utils/, design-system/, design-system-mobile/
│   ├── eslint-config/, tsconfig/
│   └── ...
├── docs/                               # legacy: ADR files; будут sync'нуты в apps/docs/content/adr/
│   └── adr/0001..NNNN.md
└── tools/lint/
    ├── events-lint.ts
    ├── glossary-mdx-lint.ts
    ├── glossary-roundtrip-lint.ts
    ├── module-readme-lint.ts
    ├── generated-artifacts-check.ts
    └── package.json
```

**Resolved: Variant B** (после ревью 2026-05-14). ADR живут в `docs/adr/NNNN-*.md` (legacy путь, продолжается). `apps/docs/source.config.ts` через Fumadocs custom source mapper читает их и рендерит в `/adr/<slug>` route. Преимущества:

- Нет симлинков (которые ломаются в Docker-build / Windows CI runner).
- Нет копий (которые создают false-SSOT — нарушение принципа 7).
- ADR canonical path остаётся `docs/adr/` — symmetric с DSO-25..29 pattern.

Sketch `apps/docs/source.config.ts`:

```ts
import { loader } from "fumadocs-core/source";
import { createMDXSource } from "fumadocs-mdx";
import { docs, meta } from "@/.source";

export const source = loader({
  baseUrl: "/",
  rootDir: "content",
  source: createMDXSource(docs, meta),
  // ADR overlay: map docs/adr/*.md into /adr/<slug> route
  // via Fumadocs custom transformer reading from monorepo root + 'docs/adr/'
});
```

Детали mapping — implementation DSO-31.

---

## 5. Keystatic config (sketch)

**Content format decision: MDX, not Markdoc.** Keystatic's `fields.markdoc` стораит контент в Markdoc syntax, который Fumadocs не рендерит нативно (Fumadocs ожидает MDX). Чтобы не вводить Markdoc→MDX transform pipeline, используем `fields.document` (Keystatic's serialization to MDX) для prose. Glossary `definition` остаётся как plain markdown body файла (через `contentField` config). DSO-31 верифицирует на первом deployed примере, что Keystatic-edit → MDX → Fumadocs-render работает end-to-end.

`apps/docs-cms/keystatic.config.ts`:

```ts
import { config, collection, fields, singleton } from "@keystatic/core";

export default config({
  storage: {
    kind: "github",
    repo: { owner: "doctor-school", name: "ds-platform" },
    branchPrefix: "docs/", // PR branch naming
  },
  ui: {
    brand: { name: "DS Platform Docs", mark: () => "📚" },
    navigation: {
      Product: [
        "vision",
        "prdChapters",
        "businessRules",
        "userJourneys",
        "glossary",
      ],
      Architecture: ["techSpecs", "architecturePages"],
      Operations: ["operationsPages", "runbooks"],
    },
  },
  collections: {
    glossary: collection({
      label: "Glossary",
      slugField: "id",
      path: "apps/docs/content/product/glossary/*",
      format: { contentField: "definition" },
      schema: {
        id: fields.slug({
          name: {
            label: "ID (snake_case)",
            description:
              "IMMUTABLE — never change after first save. Referenced by code, specs, Payload. Renaming requires a deprecation+supersede flow, not edit.",
          },
          validation: { length: { min: 2, max: 60 } },
        }),
        label_ru: fields.text({
          label: "Лейбл RU",
          validation: { length: { min: 1 } },
        }),
        label_en: fields.text({ label: "Label EN" }),
        aliases: fields.array(fields.text(), { label: "Aliases (RU+EN)" }),
        bounded_context: fields.select({
          label: "Bounded context",
          options: [
            { label: "identity", value: "identity" },
            { label: "learning", value: "learning" },
            { label: "payments", value: "payments" },
            { label: "gameplay", value: "gameplay" },
            { label: "content", value: "content" },
            { label: "compliance", value: "compliance" },
          ],
          defaultValue: "identity",
        }),
        related: fields.array(
          fields.relationship({ collection: "glossary", label: "Related" }),
        ),
        definition: fields.markdoc({ label: "Definition" }),
        // Note: glossary definition is short prose, Markdoc is OK here because
        // glossary entries are rendered by a custom Fumadocs component, not directly.
        // For prose-collections (PRD, Vision) — use fields.document which serializes to MDX.
      },
    }),
    prdChapters: collection({
      label: "PRD chapters",
      slugField: "slug",
      path: "apps/docs/content/product/prd/*",
      format: { contentField: "content", data: "yaml" },
      schema: {
        slug: fields.slug({ name: { label: "Slug" } }),
        title: fields.text({ label: "Title" }),
        order: fields.integer({ label: "Order", defaultValue: 0 }),
        content: fields.document({
          label: "Content",
          formatting: true,
          dividers: true,
          links: true,
          images: true,
        }),
      },
    }),
    // techSpecs, architecturePages, operationsPages — collections с fields.document
    // (Tech Lead/AI редактируют чаще в IDE — Keystatic дает viewer + occasional edit)
    //
    // featureSpecs — отдельный case: SDD pattern требует 4-file folder (requirements/design/
    // scenarios/tasks). Keystatic не управляет multi-file folder в одной "entry". Решение v1:
    // НЕ создавать featureSpecs collection в Keystatic. Feature-specs — IDE-only (Tech Lead/AI
    // пишут напрямую). Product Lead их не редактирует — он работает только с PRD/vision/glossary.
    // Trigger to revisit: если Product Lead начнёт регулярно править feature-specs prose.
  },
  singletons: {
    vision: singleton({
      label: "Vision",
      path: "apps/docs/content/product/vision",
      format: { contentField: "content", data: "yaml" },
      schema: {
        content: fields.document({
          label: "Vision",
          formatting: true,
          dividers: true,
          links: true,
          images: true,
        }),
      },
    }),
    businessRules: singleton({
      label: "Business rules",
      path: "apps/docs/content/product/business-rules",
      format: { contentField: "content", data: "yaml" },
      schema: {
        content: fields.document({
          label: "Rules (BR-NNN)",
          formatting: true,
          links: true,
        }),
      },
    }),
    // userJourneys, operationsPages, runbooks — analogous
  },
});
```

**Authentication:** Keystatic admin защищён Zitadel (закрыто по ADR-0001 §8, DSP-209) тем же tenant что `apps/admin`. Group `docs-editors` (Tech Lead + Product Lead) даёт access. Commits идут от GitHub App (`ds-docs-bot`), в commit message — `Co-authored-by: <oidc-user-email>`.

**Immutability of `id`:** не enforce'ится в Keystatic UI (slugField field в Keystatic editable). Вместо этого:

- UI description явно говорит «IMMUTABLE — never change».
- ESLint rule `local/glossary-canonical-ids` ловит изменения downstream (TS refs ломаются на rename → fail).
- Roundtrip CI check ловит расхождения glossary.yaml ↔ generated ids ↔ Payload Glossary Collection.
- Перенос на новый id = deprecation+supersede flow: добавить новый term, оставить старый с `aliases: [<новый_id>]`, перевести references по одному. Старый удаляется только после grep-clean.

---

## 6. Glossary mechanism — детально

### 6.1 File format

Каждый термин — отдельный markdown-файл в `apps/docs/content/product/glossary/` (slug = kebab-имя файла, например `doctor-guest.md`). Файл — это **Keystatic-entry**: frontmatter `title` / `description` / `lang`, затем тело, которое открывается заголовком термина и строкой метаданных с **каноническим id** и его bounded context, после чего идут определение, related terms и sources.

**Канонический id живёт в теле**, а не во frontmatter — его несёт маркер `**Canonical id:** \`snake_id\``. Этот маркер — авторитетный, машинно-проверяемый ключ: glossary-guard'ы (`glossary-mdx-lint`, `glossary-roundtrip-lint`, через `tools/lint/lib/glossary.ts`) читают id именно из него, а маркер `**Bounded context:** <ctx>` в той же строке фиксирует DDD-контекст.

```markdown
---
title: "doctor_guest"
description: "The v1 self-service backend role and mirror identity granted to a net-new visitor who self-registers on the doctor portal."
lang: en
---

# doctor_guest

**Bounded context:** identity · **Canonical id:** `doctor_guest`

`doctor_guest` is the coarse v1 role a net-new visitor receives when they
self-register on the doctor portal. It is the identity produced by the first
authentication feature (003): a self-service web registrant who has obtained a
backend identity but has not yet been verified and upgraded to a full `doctor`.

**Related terms:** domain user mirror, consent gate, enumeration resistance.

**Sources:** ADR-0001 §1, §4; feature 003 requirements + design.
```

**Про sketches §5 (Keystatic config) и §6.2 (generator).** Эти sketches предшествуют принятому Keystatic-формату выше — они иллюстрируют frontmatter-схему `label_ru` / `bounded_context` / `related` и generator, который её парсит. Формат на диске, имеющий силу, — тот, что в этом §6.1 (frontmatter + маркер `**Canonical id:**` в теле). Пайплайн генерации (§6.2) ещё не существует — он отслеживается в #460, где field-mapping генератора и приводится в соответствие реальному формату (id из body-маркера + сохраняемый frontmatter).

### 6.2 Generator script

`packages/glossary/scripts/generate.ts`:

```ts
import { glob } from "fast-glob";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../.."); // packages/glossary/scripts → repo root

const TermSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case"),
  label_ru: z.string().min(1),
  label_en: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  bounded_context: z.enum([
    "identity",
    "learning",
    "payments",
    "gameplay",
    "content",
    "compliance",
  ]),
  related: z.array(z.string()).default([]),
});

async function main() {
  const files = await glob("apps/docs/content/product/glossary/*.md", {
    cwd: REPO_ROOT,
    absolute: true,
  });
  const terms = await Promise.all(
    files.map(async (f) => {
      const raw = await readFile(f, "utf-8");
      const { data, content } = matter(raw);
      return { ...TermSchema.parse(data), definition: content.trim() };
    }),
  );

  // verify related references exist
  const ids = new Set(terms.map((t) => t.id));
  for (const t of terms) {
    for (const r of t.related) {
      if (!ids.has(r))
        throw new Error(`Term "${t.id}" references unknown related "${r}"`);
    }
  }

  // generate ids.ts — committed to Git (NOT gitignored) so @ds/glossary/ids consumers + the roundtrip guard resolve it on a fresh checkout (§6.3: the ESLint rule reads the glossary source, not this file)
  const idsOut = resolve(REPO_ROOT, "packages/glossary/src/ids.ts");
  await mkdir(dirname(idsOut), { recursive: true });
  const idsTs = `// AUTO-GENERATED by packages/glossary/scripts/generate.ts — DO NOT EDIT
// Run \`pnpm generate:glossary\` to regenerate. CI checks freshness.
export const GLOSSARY_IDS = {
${terms.map((t) => `  ${t.id}: '${t.id}',`).join("\n")}
} as const;
export type GlossaryId = keyof typeof GLOSSARY_IDS;

export interface GlossaryTerm {
  id: GlossaryId;
  label_ru: string;
  label_en?: string;
  aliases: string[];
  bounded_context: string;
}

export const GLOSSARY_TERMS: ReadonlyArray<GlossaryTerm> = ${JSON.stringify(
    terms.map((t) => ({
      id: t.id,
      label_ru: t.label_ru,
      label_en: t.label_en,
      aliases: t.aliases,
      bounded_context: t.bounded_context,
    })),
    null,
    2,
  )} as const;
`;
  await writeFile(idsOut, idsTs);

  // generate i18n bundles
  const ruOut = resolve(
    REPO_ROOT,
    "packages/glossary/messages/ru/glossary.json",
  );
  const enOut = resolve(
    REPO_ROOT,
    "packages/glossary/messages/en/glossary.json",
  );
  await mkdir(dirname(ruOut), { recursive: true });
  await mkdir(dirname(enOut), { recursive: true });
  await writeFile(
    ruOut,
    JSON.stringify(
      Object.fromEntries(terms.map((t) => [t.id, t.label_ru])),
      null,
      2,
    ),
  );
  await writeFile(
    enOut,
    JSON.stringify(
      Object.fromEntries(terms.map((t) => [t.id, t.label_en ?? t.label_ru])),
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run на CI: `pnpm generate:glossary`. Файл `packages/glossary/src/ids.ts` **committed to Git** (помечен «AUTO-GENERATED», но tracked) — это нужно чтобы consumers `@ds/glossary/ids` (Payload `GlossaryRef` hook, docs-компоненты, roundtrip-guard) резолвили его на fresh checkout до запуска `pnpm generate:glossary`. (Сам ESLint rule `local/glossary-canonical-ids` этот файл **не** импортирует — он читает glossary-source напрямую через `tools/lint/lib/glossary-ids.mjs`, §6.3.) CI добавляет дополнительный freshness-check: после `pnpm generate:all` `git diff --exit-code` должен быть пуст.

### 6.3 ESLint custom rule `local/glossary-canonical-ids`

Rule `tools/lint/eslint-rules/glossary-canonical-ids.mjs`, зарегистрирован под repo-local flat-config plugin namespace `local/` (`tools/lint/eslint-rules/index.mjs`) и подключён в корневом `eslint.config.js` — **не** sub-package `packages/glossary/eslint-plugin/`. Plain ESM, поэтому корневой путь `eslint .` использует его без build/tsx step, как и остальные `local/*` rules (#197/#234/#256).

**Что enforce'ится.** Bare string literal (или single-quasi template literal), значение которого равно glossary canonical id, должен быть typed-ссылкой `GLOSSARY_IDS.<id>` (import из `@ds/glossary/ids`), чтобы rename id ломал TS-build, а не оставлял висячий литерал. Import/export module-source строки exempt (module id, который просто совпал с glossary id, не является glossary-ссылкой). Ссылки в прозе — через отдельную директиву `[[g:<id>]]` (§6.4).

**Id-vs-domain-enum scoping (несущее решение).** Наивное правило «flag любой литерал, равный glossary id» здесь неверно: canonical id `doctor_guest` — одновременно glossary-термин **и** живое v1 RBAC role wire-value, используемое как строковый литерал в ~35 auth/authz/db-сайтах (role-массивы, DB-default `users.role`, Zitadel grant-payloads). Его SSOT — roles-vocabulary `apps/api/src/authz/authz.types.ts` `ROLES` / `apps/api/src/auth/idp/idp.types.ts` `DOCTOR_GUEST_ROLE`, а не glossary-doc-артефакт, поэтому связывание этого wire-value с `GLOSSARY_IDS` было бы false positive. Два механизма держат правило чистым, но всё ещё ловят настоящие doc-ссылки:

1. **Surface scope (primary).** `eslint.config.js` scope'ит правило только на glossary-**consumer** поверхность — `apps/cms/**`, `apps/docs/**` — где программная glossary-ссылка легитимна и должна быть typed. Это полностью держит правило вне `apps/api/**` / `packages/db/**` / `packages/schemas/**`, где живут wire-value-сайты. **Расширять аддитивно** по мере появления новых consumer-поверхностей (как в прецеденте scope `no-hardcoded-display-string`).
2. **Опция `domainEnumIds` (defense-in-depth).** Явный, auditable список ids, совпадающих с живым domain-enum wire-value; правило **abstains** на них в scope. Seeded `["doctor_guest"]`. Так даже если scope позже включит директорию с этим wire-value, известная коллизия останется exempt по SSOT-tracked конфигу, а не случайно. Остальные три текущих id (`consent_gate`, `enumeration_resistance`, `user_mirror`) — чистые doc-термины без коллизии → enforce'ятся полностью.

**Id set — читается из glossary-source, не из `@ds/glossary/ids`.** Флагируемый id-set читается на module load из живого glossary-source (`apps/docs/content/product/glossary/*.md`, маркер `**Canonical id:**`) через plain-ESM sync-twin loader'а guard'а `glossary-mdx` (`tools/lint/lib/glossary-ids.mjs`). Он **не** делает `import { GLOSSARY_IDS } from "@ds/glossary/ids"` — это резолвится в built `dist/`, который plain-node путь `eslint .` на fresh checkout никогда не производит.

**CI posture (WARN v1, ADR-0007 §2.6).** Два wiring'а: (a) severity `warn` в `eslint.config.js` для editor/dev in-line feedback, едет в `lint`-job non-blocking (`eslint .` exits 0 на warnings); (b) выделенный CI-job `glossary-ids`, запускающий `pnpm lint:glossary-ids` (свой `eslint.glossary-ids.config.mjs`, включающий только это правило на `error`) как promotable pass/fail check surface, `continue-on-error: true`. Promote до BLOCK — flip `continue-on-error` + добавить в `ci` needs-list, без изменения правила — когда появится настоящая glossary-consumer поверхность и откроется §2.6 sweep.

### 6.4 MDX glossary-lint — prefixed `[[g:term-id]]` glossary directive

Decision: ссылка на glossary в прозе пишется **маркером с namespace `g:`** — `[[g:term-id]]` (или `[[g:term-id|display label]]`). Префикс `g:` разводит glossary-директивы с **bare `[[…]]`**, который уже повсеместно используется для memory / decision cross-reference convention (`[[feedback_…]]`, `[[reference_…]]`, `[[project_…]]`) — §7.0 валидирует его как свой отдельный `[[refs]]`-check. Итог: bare `[[…]]` остаётся за refs-convention; `[[g:…]]` — это glossary-lookup. Директива резолвится тогда и только тогда, когда id после `g:` — канонический glossary-id (body-маркер из §6.1); всё остальное не трогается — никакого bold / эвристического детекта.

**Guard status (heuristic → exact).** Закоммиченный `tools/lint/glossary-mdx-lint.ts` сейчас аппроксимирует это на уровне **WARN** (burn-in): матчит bare `[[…]]`, исключает memory-namespace `reference_` / `feedback_` / `project_` и маскирует fenced + inline code. Promotion guard'а до требования точной грамматики `g:` (и до BLOCK) отслеживается на его promotion-окне ADR-0007 §2.6 — этот ADR фиксирует синтаксис (#459); сам guard этой ревизией не меняется.

`tools/lint/glossary-mdx-lint.ts`:

```ts
import { glob } from "fast-glob";
import { readFile } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { GLOSSARY_IDS } from "@ds/glossary/ids";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// Target grammar: [[g:term_id]] or [[g:term_id|display label]] — g:-namespaced
const DIRECTIVE_RE = /\[\[g:([a-z][a-z0-9_]*)(?:\|[^\]]+)?\]\]/g;

async function main() {
  const validIds = new Set(Object.keys(GLOSSARY_IDS));
  const files = await glob("apps/docs/content/**/*.{md,mdx}", {
    cwd: REPO_ROOT,
    absolute: true,
    ignore: ["**/glossary/**"],
  });
  const errors: string[] = [];

  for (const file of files) {
    const raw = await readFile(file, "utf-8");
    let match: RegExpExecArray | null;
    DIRECTIVE_RE.lastIndex = 0;
    while ((match = DIRECTIVE_RE.exec(raw)) !== null) {
      const id = match[1];
      if (!validIds.has(id)) {
        // Allow opt-out marker on same line: HTML-style comment new-term: <id>
        const lineStart = raw.lastIndexOf("\n", match.index) + 1;
        const lineEnd = raw.indexOf("\n", match.index);
        const line = raw.slice(
          lineStart,
          lineEnd === -1 ? raw.length : lineEnd,
        );
        if (line.includes(`new-term: ${id}`)) continue;
        errors.push(
          `${relative(REPO_ROOT, file)}: [[${id}]] is not in glossary (and not marked with new-term opt-out)`,
        );
      }
    }
  }

  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

**Usage в prose:**

- `платформа авторизует [[g:doctor_guest]] через [[g:consent_gate]]` — canonical references; Fumadocs рендерит как inline tooltip с definition + cross-link.
- `платформа авторизует [[g:doctor_guest|гостя]] через...` — alias display label.
- Новый термин: `... [[g:new_role]]` + same-line маркер `new-term: new_role` — explicit opt-out. В том же PR обязан появиться glossary entry для `new_role` (CI поймает в roundtrip-check).

**Расширение в v2 (если нужно)** — добавить эвристику для bold-detected canonical labels (Spec-Driven term detection) — но v1 = только директивы `[[g:…]]`, zero false-positives.

### 6.5 Payload Glossary Collection sync

Sync `apps/docs/content/product/glossary/*.md` → Payload Glossary Collection table. `tools/scripts/sync-glossary-to-payload.ts`:

```ts
import payload from "payload";
import { GLOSSARY_TERMS } from "@ds/glossary/ids";

async function main() {
  await payload.init({/* config */});

  for (const term of GLOSSARY_TERMS) {
    const existing = await payload.find({
      collection: "glossary",
      where: { canonical_id: { equals: term.id } },
      limit: 1,
    });
    if (existing.totalDocs === 0) {
      await payload.create({
        collection: "glossary",
        data: {
          canonical_id: term.id,
          label_ru: term.label_ru,
          bounded_context: term.bounded_context,
        },
      });
    } else {
      await payload.update({
        collection: "glossary",
        id: existing.docs[0].id,
        data: {
          label_ru: term.label_ru,
          bounded_context: term.bounded_context,
        },
      });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

Запускается post-deploy hook on staging+production. Idempotent. CommonJS/ESM agnostic — wrap в `async main()` обязательно (top-level await не везде работает).

### 6.6 Payload Lexical glossary-ref — **save-time + export-time validation**

Two checkpoints чтобы избежать window of inconsistency между Payload write и следующим CI:

**Checkpoint 1 — Payload `beforeChange` hook (save-time, runtime).** Когда Product Lead сохраняет marketing page в Payload UI, hook валидирует все `<GlossaryRef id="...">` ноды в Lexical state против `GLOSSARY_IDS`. Если id неизвестен — save **блокируется** с явной ошибкой в UI («GlossaryRef points to id "x" which does not exist in glossary — add it in docs-cms first»).

`apps/cms/src/collections/MarketingPages.ts` (sketch):

```ts
import type { CollectionConfig } from "payload";
import { GLOSSARY_IDS } from "@ds/glossary/ids";

function extractGlossaryRefIds(lexicalRoot: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (node.type === "glossaryRef" && typeof node.fields?.id === "string") {
      ids.push(node.fields.id);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(lexicalRoot);
  return ids;
}

export const MarketingPages: CollectionConfig = {
  slug: "marketing-pages",
  hooks: {
    beforeChange: [
      async ({ data }) => {
        const refs = extractGlossaryRefIds(data.content?.root);
        for (const id of refs) {
          if (!(id in GLOSSARY_IDS)) {
            throw new Error(
              `Glossary term "${id}" does not exist. Add it in docs-cms before referencing.`,
            );
          }
        }
        return data;
      },
    ],
  },
  fields: [/* ... */],
};
```

Note: `GLOSSARY_IDS` импортируется во время Payload runtime. Поэтому Payload deploy должен идти ПОСЛЕ глоссарий-генерации в `packages/glossary/src/ids.ts`. При обновлении глоссария (PR в Git) → `pnpm generate:glossary` → `git commit` → CI deploy `apps/cms` с обновлённым `GLOSSARY_IDS`. Window of inconsistency = время между merge и Payload deploy (~5 минут), что приемлемо.

**Checkpoint 2 — Export-time check (CI build).** На каждом build `apps/promo` валидируется Lexical AST экспорта. Это safety net на случай если Checkpoint 1 был bypassed (e.g., direct DB write):

```ts
// apps/promo/lib/payload-fetch.ts
import { GLOSSARY_IDS } from "@ds/glossary/ids";

function validateGlossaryRefs(lexicalState: unknown) {
  const refs = extractGlossaryRefIds((lexicalState as any)?.root);
  const missing = refs.filter((id) => !(id in GLOSSARY_IDS));
  if (missing.length > 0) {
    throw new Error(
      `Marketing content references unknown glossary ids: ${missing.join(", ")}`,
    );
  }
}
```

CI fail → marketing-страница референсит несуществующий term → block deploy.

---

## 7. Drift detection — CI gates yml

### 7.0 CI checks phasing (DSO-63 mini-D, 2026-05-18)

Не все drift checks одинаково срочны. Phased rollout по фазам Pre-pilot / Pilot / Scale из engineering-readiness §"Phase definitions":

| Phase                                          | CI checks (incremental list)                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pre-pilot (mandatory)**                      | OpenAPI drift (NestJS schemas ↔ generated client), DB migrations drift (drizzle-kit check), spec links integrity (no broken `[[refs]]`), glossary terms canonical IDs (ESLint `local/glossary-canonical-ids`), retention-matrix lint (ADR-0009 §10), PII scanner (engineering-readiness §3.bis), audit-egress-channels (ADR-0011 §2.4). |
| **Pilot** (добавляется когда есть pilot users) | Roundtrip validation Payload ↔ glossary, MDX glossary-lint `[[g:term-id]]` opt-in, generated ERD freshness, module README freshness checks.                                                                                                                                                                                             |
| **Scale** (добавляется при scale-фазе)         | Editorial UI integration (Payload), advanced roundtrip checks, machine-validatable spec fragments (JSON Schema / OpenAPI in-spec), automated spec re-validation against code changes.                                                                                                                                                   |

**Rationale:** Claude valid pre-pilot review flag — «Fumadocs + Keystatic + glossary YAML + roundtrip validation + many CI gates may slow early delivery and produce false positives». Phasing предотвращает overhead на ранней стадии, давая полную defense at scale.

### 7.1 GitHub Actions workflow

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    services:
      # Postgres сервис нужен для OpenAPI gen step (NestJS bootstrap;
      # см. §7.3 ниже про альтернативу без DB через application context mode)
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: ci
          POSTGRES_DB: ds_ci
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 5
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile

      # FIRST: regenerate all artifacts. ESLint and other steps depend on
      # packages/glossary/src/ids.ts being up-to-date for static imports.
      - name: Generate all artifacts
        env:
          DATABASE_URL: postgres://postgres:ci@localhost:5432/ds_ci
        run: pnpm generate:all # runs db:migrate, generate:glossary, generate:openapi, generate:sdk

      - name: Verify generated artifacts committed (freshness gate)
        run: |
          git diff --exit-code -- \
            packages/glossary/src/ids.ts \
            packages/api-client/openapi.snapshot.json \
            packages/api-client/src/*.generated.ts \
            packages/glossary/messages/*/glossary.json \
            || (echo "::error::Generated artifacts out of date. Run 'pnpm generate:all' and commit."; exit 1)

      - name: TypeScript compile
        run: pnpm typecheck

      - name: ESLint (local/glossary-canonical-ids rides here at warn)
        run: pnpm lint

      - name: Prettier
        run: pnpm format:check

      - name: Unit tests
        run: pnpm test:unit

      - name: OpenAPI Spectral lint
        # Lint the committed snapshot (already validated as up-to-date above)
        run: pnpm spectral:lint # script in root package.json: "spectral lint packages/api-client/openapi.snapshot.json"

      - name: DB schema drift
        env:
          DATABASE_URL: postgres://postgres:ci@localhost:5432/ds_ci
        run: pnpm db:check

      - name: Events drift
        run: pnpm lint:events

      - name: Glossary IDs lint (dedicated job, WARN — §6.3)
        # In the real ci.yml this is a standalone `glossary-ids` job with
        # `continue-on-error: true` (the promotable check surface); the ESLint step
        # above only rides `local/glossary-canonical-ids` at warn (non-blocking).
        continue-on-error: true
        run: pnpm lint:glossary-ids

      - name: Glossary MDX lint (opt-in directive)
        run: pnpm lint:glossary-mdx

      - name: Glossary roundtrip lint
        run: pnpm lint:glossary-roundtrip

      - name: Markdown links (lychee)
        # Pinned version for supply-chain hygiene (mutable @v2 tag avoided)
        uses: lycheeverse/lychee-action@v2.3.0
        with:
          args: --no-progress 'apps/docs/content/**/*.md' 'AGENTS.md' 'CLAUDE.md' 'README.md' 'docs/adr/*.md'

      - name: Module README ↔ exports (WARN-ONLY v1)
        continue-on-error: true
        run: pnpm lint:module-readme

      - name: Docs build (Fumadocs)
        run: pnpm docs:build

      - name: E2E (Playwright + Gherkin via playwright-bdd)
        # Runs AFTER docs build — Playwright tests may hit the built docs site
        run: pnpm test:e2e
```

**Required root `package.json` scripts (sketch):**

```json
{
  "scripts": {
    "generate:all": "pnpm generate:glossary && pnpm generate:openapi && pnpm generate:sdk",
    "generate:glossary": "tsx packages/glossary/scripts/generate.ts",
    "generate:openapi": "tsx tools/scripts/generate-openapi.ts",
    "generate:sdk": "openapi-typescript packages/api-client/openapi.snapshot.json -o packages/api-client/src/types.generated.ts",
    "spectral:lint": "spectral lint packages/api-client/openapi.snapshot.json",
    "db:check": "drizzle-kit check --config=packages/db/drizzle.config.ts",
    "lint:events": "tsx tools/lint/events-lint.ts",
    "lint:glossary-mdx": "tsx tools/lint/glossary-mdx-lint.ts",
    "lint:glossary-roundtrip": "tsx tools/lint/glossary-roundtrip-lint.ts",
    "lint:module-readme": "tsx tools/lint/module-readme-lint.ts",
    "docs:build": "turbo run build --filter=docs"
  },
  "devDependencies": {
    "@stoplight/spectral-cli": "^6.14.0",
    "openapi-typescript": "^7.0.0",
    "tsx": "^4.0.0"
  }
}
```

### 7.3 OpenAPI generation — NestJS bootstrap without HTTP layer

`tools/scripts/generate-openapi.ts` использует NestJS `createApplicationContext` (без HTTP-сервера) и `SwaggerModule.createDocument`. DB-подключение нужно при boot, поэтому CI имеет Postgres сервис (см. §7.1 YAML). Альтернативный air-gap режим — `DataSource` override на in-memory `pglite` — defer DSO-31:

```ts
// tools/scripts/generate-openapi.ts
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import { writeFile } from "node:fs/promises";
import { AppModule } from "../../apps/api/src/app.module.js";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const doc = SwaggerModule.createDocument(
    app as any,
    {
      openapi: "3.1.0",
      info: { title: "DS Platform API", version: "0.0.0" },
    } as any,
  );
  await writeFile(
    "packages/api-client/openapi.snapshot.json",
    JSON.stringify(doc, null, 2),
  );
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

### 7.2 Sync-glossary-to-payload — pre-deploy step

Отдельный job в `cd.yml` запускается после merge в main:

```yaml
sync-glossary:
  needs: [validate]
  if: github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: pnpm install --frozen-lockfile
    - run: pnpm generate:glossary
    - name: Sync to Payload staging
      env: { PAYLOAD_SECRET: ${{ secrets.PAYLOAD_STAGING_SECRET }} }
      run: pnpm sync:glossary-payload --env=staging
    # production sync — separate manual approval
```

---

## 8. Feature-spec template (SDD)

Каждая фича создаётся как папка `apps/docs/content/specs/features/NNN-<slug>/` с **3 файлами** (без `tasks.md` — задачи живут в GitHub Issues, см. ADR-0006 §9). Шаблон в `apps/docs/content/specs/features/_template/`:

### 8.1 `NNN-requirements.md`

```markdown
---
status: draft # draft / spec-approved / in-dev / shipped
owner: <name>
plane_ref: DSP-XXX # strategic parent в Plane (если есть)
tracker: https://github.com/doctor-school/ds-platform/milestone/N # GitHub Milestone для implementation Issues
related_adr: [ADR-NNNN]
---

# Feature NNN: <Name>

## 1. Outcomes

Что считается успехом фичи в бизнес-смысле (≤3 предложения).

## 2. Scope

### In scope

- ...

### Out of scope

- ...

## 3. Constraints

- Performance: ...
- Security: ...
- Compliance: 152-ФЗ ...

## 4. Prior decisions

- ADR-NNNN — <decision>
- Feature MMM — <related>

## 5. Event Model

### Commands

- `<CommandName>(<args>)` — initiated by <actor>.

### Events

- `<EventName>(<payload>)` — emitted by <module> after <trigger>.

### Read models

- `<read_model_name>` — updated <sync|async> on `<EventName>`.

### Policies (reactive)

- `<PolicyName>` — reacts to `<EventName>`, triggers <action>.

## 6. EARS requirements

EARS-1 [Ubiquitous]: The system shall ...
EARS-2 [Event-driven]: When <trigger>, the system shall ...
EARS-3 [State-driven]: While <state>, the system shall ...
EARS-4 [Conditional]: Where <feature>, the system shall ...
EARS-5 [Unwanted]: If <unwanted>, then the system shall ...

(один EARS = один handler = один test)

## 7. Invariants

- ...

## 8. Saga (если есть длинная цепочка с компенсациями)

Step 1: <action> → compensate: <reverse>
...

## 9. Verification

- Unit tests: один per EARS
- Integration tests: `NNN-scenarios.feature`
- Property-based (если invariants): packages/<module>/test/<feature>.property.test.ts
```

### 8.2 `NNN-design.md`

```markdown
# Design — Feature NNN

## Sequence (happy path)

\`\`\`mermaid
sequenceDiagram
...
\`\`\`

## State machine (если есть lifecycle)

\`\`\`mermaid
stateDiagram-v2
...
\`\`\`

## Data model fragment

\`\`\`mermaid
erDiagram
...
\`\`\`

## Failure modes

- ...
```

### 8.3 `NNN-scenarios.feature`

```gherkin
Feature: <Feature name>

  Scenario: Happy path
    Given ...
    When ...
    Then ...

  Scenario: Validation failure
    ...

  Scenario: Network retry
    ...
```

### 8.4 Task decomposition — **GitHub Issues, не файл**

Decomposition spec'а на атомарные задачи происходит в GitHub Issues (один EARS-handler ≈ один Issue), не в Git-файле. Spec удерживает intent (EARS-N requirement), Issues — execution state.

**Milestone vs spec.** GitHub Milestone — это долгоживущая **product-тема** (например `Doctor onboarding v1`, `Auth foundations v1`), которая обычно охватывает несколько feature-спек и живёт недели–месяцы. Milestone — это **не** spec-папка. Спека, которую реализует конкретная работа, привязывается к ней **лейблом** `feature:NNN-<slug>`, slug которого и есть имя spec-папки (`apps/docs/content/specs/features/NNN-<slug>/`). Несколько спек могут жить под одним Milestone.

**Setup для каждого feature:**

1. **Назначить product-тему Milestone.** Переиспользовать существующий Milestone-тему, к которой относится feature, либо создать, если тема новая (имя темы, не `NNN-<slug>`):

   ```
   Doctor onboarding v1 — net-new onboarding theme; spans 001-doctor-onboarding and later onboarding verticals.
   ```

2. **Create Issues** — один per EARS-handler + cross-cutting tasks (DB migration, OpenAPI snapshot update, Playwright tests, Module README, glossary updates если новые термины). Лейбл `feature:NNN-<slug>` привязывает Issue к его спеке; Milestone группирует execution под темой:

   ```bash
   gh issue create \
     --milestone "Doctor onboarding v1" \
     --title "[001] EARS-3: When OIDC callback received, the system shall ..." \
     --label "feature:001-doctor-onboarding,kind:ears-handler" \
     --body "Spec: apps/docs/content/specs/features/001-doctor-onboarding/001-requirements.md#ears-3

   ## Implementation
   - Handler: \`apps/api/src/auth/oidc-callback.handler.ts\`
   - Test: \`oidc-callback.handler.test.ts\` (must reference EARS-3 in describe)
   "
   ```

3. **Update `NNN-requirements.md` frontmatter** `tracker:` field → URL Milestone-темы, под которой сидит feature.

4. **AI agent workflow при работе:**
   ```bash
   gh issue list --milestone "Doctor onboarding v1" --label "feature:001-doctor-onboarding" --state open
   gh issue view N    # read Issue + linked spec
   # implement → commit → push → PR auto-closes Issue on merge
   ```

**Labels convention:**

- `feature:NNN-<slug>` — group by feature
- `kind:ears-handler` / `kind:policy` / `kind:saga-step` / `kind:bug` / `kind:refactor` / `kind:dep-upgrade` / `kind:infra`
- `plane:DSO-N` (optional) — cross-link если есть strategic parent в Plane

**GitHub Project v2 board «DS Platform Implementation»:**

- Swimlanes by feature (label-driven)
- Columns: Backlog / Ready / In progress / In review / Done
- Auto-add на issue create в repo с label `feature:*`

---

## 9. AGENTS.md / CLAUDE.md — sketches

### 9.1 AGENTS.md (root)

```markdown
# Agent Instructions — DS Platform

## Stack

- Runtime: Node.js 22 LTS
- Framework: NestJS 11 (backend, ADR-0002), Next.js 15 App Router (frontend, ADR-0004)
- Mobile: React Native 0.78 + Expo SDK 53 (ADR-0005)
- DB: PostgreSQL 17 + Drizzle ORM (ADR-0003)
- Schema/Validation: Zod (single SSOT — ADR-0002 §3)
- Auth/RBAC: Zitadel OIDC (закрыто по ADR-0001 §8, DSP-209) + Cerbos RBAC (ADR-0003 §5)
- Realtime: Centrifugo (ADR-0002 §7)
- CMS: Payload v3 content-only (ADR-0004 §7)
- Test: Vitest + Playwright + Maestro (mobile)
- Observability: GlitchTip (Sentry-API-compat) + PostHog

## Documentation structure

- /AGENTS.md, /CLAUDE.md — AI constitution (this file + Claude-specific)
- /docs/adr/ — accepted architectural decisions (immutable)
- /apps/docs/content/specs/tech/ — architectural specs (brainstorm-style)
- /apps/docs/content/specs/features/NNN/ — feature specs (SDD: req+design+scenarios; tasks live in GitHub Issues)
- /apps/docs/content/product/glossary/ — domain terms (canonical)
- /apps/docs/content/architecture/ — overview + C4
- /apps/docs/content/operations/ — runbooks
- /apps/*/src/<module>/README.md — module README per ADR-0006
- /packages/schemas/ — Zod schemas (API SSOT)
- /packages/db/schema/ — Drizzle schemas (DB SSOT)
- /packages/glossary/src/ids.ts — GENERATED, never edit

## Before any task

1. `gh issue view <N>` — read the Issue (it links to feature spec + EARS-ID).
2. Read the feature spec at `apps/docs/content/specs/features/<NNN>/<NNN>-requirements.md` — full EARS context.
3. Read related ADRs listed in spec's "Prior decisions" section.
4. Check `packages/schemas/<module>/*.ts` for current Zod contract.
5. Check `packages/db/schema/<module>.ts` for current DB schema.
6. Check `apps/<app>/src/<name>/README.md`.

## During implementation

1. Respect existing architecture (see ADRs).
2. Do not change public API without updating `packages/schemas/<module>` in same PR (OpenAPI auto-regenerates).
3. Do not change DB schema without `pnpm db:generate` migration in same PR.
4. Do not hardcode glossary IDs as strings — `import { GLOSSARY_IDS } from '@ds/glossary/ids'`.
5. Do not emit undocumented `@OutboxEmit('...')` events — add to spec's events.md first.
6. Keep changes scoped to the assigned GitHub Issue (one EARS-handler per Issue per PR).

## After implementation

- Update `NNN-requirements.md` if behaviour diverged from spec
- Run `pnpm generate:all` and commit generated artifacts
- Update module README if module boundaries changed
- Update glossary if new domain terms appeared
- Add ADR if non-trivial architectural decision was made

## PR requirements

Every PR must include:

- code + unit tests
- docs updates OR explicit "no docs needed" note in PR description
- migration (if DB changed)
- updated OpenAPI snapshot (auto via `pnpm generate:openapi`)
- ADR (if architectural)

## Forbidden

- Silent architecture changes (must add ADR)
- Hardcoded glossary canonical IDs (use `@ds/glossary/ids`)
- Undocumented domain events (must appear in spec events.md)
- Editing accepted ADRs after status: Accepted (create superseding ADR)
- Editing generated files (look for `// AUTO-GENERATED` header)
- Editing past migrations in `apps/api/drizzle/` (append-only; per ADR-0008 §2.3)
- Bypassing module boundaries
- Skipping CI hooks (--no-verify)
- Vercel-only API usage (ESLint rule `no-vercel-only-api` blocks this)
- class-validator decorators (ESLint rule `no-class-validator` per ADR-0002)

## References

- /docs/adr/0001..NNNN.md — accepted decisions
- /docs/superpowers/specs/ — design specs
- /apps/docs/content/specs/features/ — feature specs
- /apps/docs/content/product/glossary/ — domain terms
```

### 9.2 CLAUDE.md (Claude-Code overlay)

```markdown
# Claude Code instructions — DS Platform

Inherit from `/AGENTS.md` (universal AI constitution). This file adds Claude-Code-specific behaviour.

## MCP servers configured

- plane-pp-mcp — DS Platform Plane workspace `doctor-school`
- payload — Payload v3 admin (apps/cms) for AI content reads (read-only by default)
- (TBD) keystatic — once an MCP server lands

## Tool preferences

- **For code-level task tracking** (current sprint, EARS-handler Issues, bugs, refactors): `gh` CLI first — `gh issue view`, `gh issue list --milestone`, `gh pr create`. Issues live in DS Platform repo.
- **For strategic / cross-tracker references** (Plane DSO-XXX из ADR/spec): `plane-pp-cli`.
- For DB inspection: `drizzle-kit introspect:pg` over raw `psql`
- For schema changes: edit `packages/db/schema/<module>.ts`, then `pnpm db:generate` — never hand-write migrations

## Skill priority

- Before any creative work: invoke superpowers:brainstorming
- Before implementation: invoke superpowers:writing-plans
- Before claiming work complete: invoke superpowers:verification-before-completion
- For Fumadocs MDX issues: TBD skill (DSO-31 may author)

## Slash commands

- `/spec NNN` — open feature spec NNN in editor
- `/adr` — open most recent ADR

## Notes for Claude

- Skill output language: Russian (per project convention)
- Doc-as-SSOT — STRICT rule. Read docs first, code second (per [[feedback_docs_as_ssot]])
- No bias arguments — see [[feedback_tech_stack_criteria_no_team_skill]]
```

---

## 10. Migration plan (from current state to target)

Phase 0 (Tech Lead solo, sequential):

| Step | Action                                                                                                                                                                                                                                                          | Output                                                   | Blocking  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------- |
| 1    | Создать DS Platform repo (DSO-31)                                                                                                                                                                                                                               | `ds-platform/` skeleton                                  | DSO-31    |
| 2    | Scaffold `apps/docs/` (Fumadocs)                                                                                                                                                                                                                                | empty portal builds                                      | —         |
| 3    | Scaffold `apps/docs-cms/` (Keystatic)                                                                                                                                                                                                                           | empty editor admin                                       | step 2    |
| 4    | Подключить `docs/adr/*.md` в Fumadocs через `apps/docs/source.config.ts` mapper (Variant B — без симлинков и копий)                                                                                                                                             | ADR visible в portal на `/adr/<slug>` route              | step 2    |
| 5    | Scaffold `packages/glossary/` + generate.ts                                                                                                                                                                                                                     | пустой ids.ts                                            | —         |
| 6    | Создать seed glossary (~30 DS Platform доменных терминов: doctor, nmo_credit, accreditation, course, lesson, certificate, ledger, con, pul, au, etc.) — seed list определяется в отдельном prep-step DSO-31 на основе PRD §13-15 + bounded contexts ADR-0006 §5 | glossary populated                                       | step 5    |
| 7    | Add `tools/lint/` scripts                                                                                                                                                                                                                                       | events-lint, glossary-mdx-lint, module-readme-lint stubs | —         |
| 8    | Add CI workflow.yml                                                                                                                                                                                                                                             | green build на empty app                                 | steps 2-7 |
| 9    | Write AGENTS.md + CLAUDE.md draft                                                                                                                                                                                                                               | committed                                                | —         |
| 10   | Deploy `docs.doctor.school` + `docs-cms.doctor.school`                                                                                                                                                                                                          | live portal + editor                                     | step 8    |

Phase 0.5 (после Phase 0 готов):

- Product Lead pilot edit Vision в Keystatic (smoke test UX).
- Tech Lead пишет первый feature-spec в SDD-формате (`docs/content/specs/features/001-doctor-onboarding/` — 3 файла, без tasks.md).
- **Создать (или переиспользовать) product-тему GitHub Milestone** (например `Doctor onboarding v1`) + Issues per EARS-handler через `gh issue create`, каждый с лейблом `feature:001-doctor-onboarding`. Заполнить frontmatter `tracker:` URL в `NNN-requirements.md`.
- **Setup GitHub Project v2 «DS Platform Implementation»** с swimlanes by feature label.
- Drift detection в CI начинает блокировать merge.

Phase 1 (продакшн):

- Все feature-specs пишутся в SDD-формате до кода.
- Sync glossary → Payload запускается post-merge.
- Module README enforcement переключается с warn на block.

---

## 11. Связанные decisions (cross-ref)

- **ADR-0001** — OIDC tenant: Zitadel (закрыто по ADR-0001 §8, DSP-209); `docs-cms.doctor.school` использует тот же OIDC client что `apps/admin`. Group `docs-editors`.
- **ADR-0002 §3-5** — Zod как API SSOT, openapi-typescript как codegen. Подтверждено как Master в SSOT-таблице §3 этого spec'а.
- **ADR-0003 §4** — Drizzle как DB SSOT, drizzle-kit как migrations. drizzle-kit check заменяет atlas schema diff.
- **ADR-0004 §7, §10.3** — Payload v3 content-only + Glossary Collection. §10.3 hard dep — этот spec разрешает: Payload Glossary Collection синхронизируется FROM glossary.yaml, не наоборот.
- **ADR-0005** — Mobile module README rendered in Fumadocs portal.

---

## 12. Open follow-ups (DSO-31+)

1. Fumadocs setup specifics (theme, search provider, navigation config).
2. Keystatic GitHub App registration (`ds-docs-bot`).
3. Lint-tools пакет structure (один пакет `@ds/lint-tools` или per-tool?).
4. EARS-ID ↔ Vitest linkage convention (закрыто): плоская нумерация — `it('EARS-N: ...', ...)`; вложенное `N.M` только если один handler несёт несколько shall-выражений. Референс-spec: `001-api-bootstrap-health`.
5. Gherkin → Playwright transpilation pipeline setup (`playwright-bdd` setup details).
6. Initial 30 glossary terms — какие переносим первым batch'ом.
7. Migration: что делать с существующими Notion DS-Platform-страницами (если есть). Recommend: deprecated + redirect notice в Notion, content уже в Git.
