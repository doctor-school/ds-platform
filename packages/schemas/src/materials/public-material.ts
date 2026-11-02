import { z } from "zod";
import { SlugSchema } from "../taxonomy/taxonomy.schema.js";
import { FeedPartnerSchema } from "./feed.js";
import { materialBodySchema } from "./material-body.js";
import { MaterialKindSchema } from "./material.js";

// 048 (#3513) — `GET /v1/public/materials/{slug}` (EARS-11, EARS-19). The
// author is a plain name — the news author line or the column expert's current
// public display name — with no expert slug or link (nothing may link to an
// expert page before 031). A draft, unknown or non-public material is `404`
// alike, so this shape only ever describes a public one.

export const PublicMaterialSchema = z
  .object({
    slug: SlugSchema,
    kind: MaterialKindSchema,
    title: z.string().min(1),
    publishedAt: z.iso.datetime(),
    cover: z
      .object({ url: z.string().min(1) })
      .strict()
      .nullable(),
    author: z
      .object({ name: z.string().min(1) })
      .strict()
      .nullable(),
    partner: FeedPartnerSchema.nullable(),
    body: materialBodySchema,
  })
  .strict();
export type PublicMaterial = z.infer<typeof PublicMaterialSchema>;
