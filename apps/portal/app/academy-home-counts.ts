import type { paths } from "@ds/api-client";
import {
  PublicExpertCountSchema,
  PublicOrganisationCountSchema,
  PublicProjectCatalogSchema,
  type PublicProjectCatalog,
} from "@ds/schemas";

/**
 * 029 EARS-3 / EARS-5 (design §2) — the hero's count lines over three public
 * reads. Each read is settled on its own: it resolves to its value, or to
 * `null` when it failed, and never rejects, so a failed read drops only its
 * own segment and never fails the page.
 */

const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

const PUBLIC_PROJECTS_PATH = "/v1/public/projects" satisfies keyof paths;
const PUBLIC_EXPERT_COUNT_PATH =
  "/v1/public/experts/count" satisfies keyof paths;
const PUBLIC_ORGANISATION_COUNT_PATH =
  "/v1/public/organisations/count" satisfies keyof paths;

async function readPublic<T>(
  path: string,
  parse: (body: unknown) => T,
): Promise<T | null> {
  try {
    // A publish shows on the next request (029 US-9): no cache, as 030 / 048.
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parse(await res.json());
  } catch {
    return null;
  }
}

/**
 * The 030 EARS-8 catalog read, fetched ONCE per render: the hero counts its
 * `running` items, and the 030 EARS-12 «Что мы делаем» block reads the same
 * settled answer (`null` — the read failed).
 */
export function readPublicProjects(): Promise<PublicProjectCatalog | null> {
  return readPublic(PUBLIC_PROJECTS_PATH, (body) =>
    PublicProjectCatalogSchema.parse(body),
  );
}

/** 029 EARS-4 — the published-expert count, or `null` when the read failed. */
export function readPublicExpertCount(): Promise<number | null> {
  return readPublic(
    PUBLIC_EXPERT_COUNT_PATH,
    (body) => PublicExpertCountSchema.parse(body).count,
  );
}

/** 032 EARS-12 — the published-organisation count, or `null` when the read failed. */
export function readPublicOrganisationCount(): Promise<number | null> {
  return readPublic(
    PUBLIC_ORGANISATION_COUNT_PATH,
    (body) => PublicOrganisationCountSchema.parse(body).count,
  );
}

/** The number of catalog items at the stage `running`, or `null` when the read failed. */
export function runningProjectCount(
  catalog: PublicProjectCatalog | null,
): number | null {
  if (catalog === null) return null;
  return catalog.data.filter((project) => project.stage === "running").length;
}

type PluralForms = readonly [one: string, few: string, many: string];

/** The Russian plural form of `n`: one / few / many by its last two digits. */
export function pluralRu(n: number, [one, few, many]: PluralForms): string {
  const lastTwo = Math.abs(n) % 100;
  const last = lastTwo % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

const PROJECT_FORMS = ["проект", "проекта", "проектов"] as const;
const EXPERT_FORMS = ["эксперт", "эксперта", "экспертов"] as const;
const PARTNER_FORMS = ["партнёр", "партнёра", "партнёров"] as const;

function counted(n: number | null): n is number {
  return n !== null && n > 0;
}

/**
 * 029 EARS-3 — «N <проект> в производстве · M <эксперт>»; a zero or failed
 * segment is left out with its separator, and no line (`null`) is left when
 * both segments drop.
 */
export function expertCountLine({
  running,
  experts,
}: {
  running: number | null;
  experts: number | null;
}): string | null {
  const segments: string[] = [];
  if (counted(running)) {
    segments.push(`${running} ${pluralRu(running, PROJECT_FORMS)} в производстве`);
  }
  if (counted(experts)) {
    segments.push(`${experts} ${pluralRu(experts, EXPERT_FORMS)}`);
  }
  return segments.length > 0 ? segments.join(" · ") : null;
}

/**
 * 029 EARS-5 — «K <партнёр> · прозрачная модель»; «Прозрачная модель» alone
 * when the count is zero or its read failed.
 */
export function partnerCountLine(partners: number | null): string {
  if (!counted(partners)) return "Прозрачная модель";
  return `${partners} ${pluralRu(partners, PARTNER_FORMS)} · прозрачная модель`;
}
