import { z } from "zod";
import { SlugSchema } from "../taxonomy/taxonomy.schema.js";

/**
 * One option a facet panel lists: the value written into the URL (`slug`) and
 * its title, with `count` — the events of the read's tense carrying it under
 * the OTHER facets' current selections (014-design §9). A zero-yield option
 * stays listed with `count: 0` (014 EARS-12). ONE item shape for both hosts'
 * option blocks (wave-2 gate §4.3 D9).
 */
export const PublicEventFacetOptionSchema = z
  .object({
    slug: SlugSchema,
    title: z.string().min(1),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type PublicEventFacetOption = z.infer<
  typeof PublicEventFacetOptionSchema
>;
