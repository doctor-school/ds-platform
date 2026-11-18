import { and, eq, isNull, type SQL } from "drizzle-orm";

import { experts } from "./schema/taxonomy.js";

/**
 * 012 public expert: published, not retired, not editorially removed. The one
 * predicate every public read that shows an expert joins on (048 feed, the
 * 030/048 material reads, the 024 course author).
 */
export const expertPubliclyVisible: SQL = and(
  eq(experts.status, "published"),
  isNull(experts.deletedAt),
  isNull(experts.contentRemovedAt),
)!;
