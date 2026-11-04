import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { paths } from "@ds/api-client";
import { MaterialArticle } from "@ds/design-system/material-article";
import { PublicMaterialSchema, type PublicMaterial } from "@ds/schemas";

/**
 * 048 EARS-12 (#3514) — the Academy reading page `/materials/{slug}`.
 *
 * The page reads the public material `GET /v1/public/materials/{slug}` (#3513,
 * EARS-11 / EARS-19; the path is typed from `@ds/api-client`) and renders the
 * shared `MaterialArticle` (`@ds/design-system`, canvas
 * `design-source/academy-material.dc.html`) — the same block the admin
 * preview mounts. A draft, unknown or non-public material answers `404`, and
 * the page calls `notFound()`: the visitor gets the Academy not-found page with
 * a real 404 status. Any other failure throws into this segment's `error.tsx`,
 * the read error with «Повторить».
 *
 * The read is anonymous and viewer-independent; the partner mark is judged at
 * the moment of the read (EARS-19), so the page renders per request.
 *
 * The segment deliberately has no `loading.tsx`: a loading boundary streams the
 * shell first and commits a `200` before `notFound()` can run, so an
 * unpublished address would answer `200` with the not-found body. Without it
 * the read completes before the first byte and the status is the real `404`.
 */
export const dynamic = "force-dynamic";

const MATERIAL_READ_PATH = "/v1/public/materials/{slug}" satisfies keyof paths;

/** The way back: the Academy home news block (canvas `academy-home#feed-h`). */
const BACK_HREF = "/#feed-h";

const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

/** One read per request, shared by `generateMetadata` and the page. */
const readMaterial = cache(
  async (slug: string): Promise<PublicMaterial | null> => {
    const res = await fetch(
      `${API_BASE}${MATERIAL_READ_PATH.replace("{slug}", encodeURIComponent(slug))}`,
      { headers: { accept: "application/json" }, cache: "no-store" },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`material read failed: ${res.status}`);
    return PublicMaterialSchema.parse(await res.json());
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const material = await readMaterial(slug);
  if (!material) notFound();
  return { title: material.title };
}

export default async function MaterialPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const material = await readMaterial(slug);
  if (!material) notFound();
  // The content landmark is the Academy root layout's one `<main>`.
  return <MaterialArticle material={material} backHref={BACK_HREF} />;
}
