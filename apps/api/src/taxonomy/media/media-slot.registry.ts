import { Injectable } from "@nestjs/common";
import { getTableName } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { experts, organisations, projects } from "@ds/db";

// The ONE list of media-slot columns: every column whose value is an
// object-storage key the two media sweeps may be handed. `MediaCleanupService`
// (a released key from a `media_cleanup_jobs` row) and `UploadReconcileService`
// (an upload locator on `idempotency_keys`) both ask
// `MediaCleanupService.isObjectReferenced`, and that predicate iterates THIS
// registry — so a slot is taught to both sweeps at once or to neither. A slot
// missing here is a live object a sweep deletes after its window.
//
// A module outside taxonomy that writes a slot through the same upload pipeline
// registers its column from its own module (`onModuleInit`), injecting the
// registry `TaxonomyModule` exports — it never edits this file. The schema
// coverage e2e (`test/taxonomy/media-slots.e2e-spec.ts`) reads the booted app's
// registry, so a `*_ref` media column in `packages/db/src/schema/` that nobody
// registered fails CI.

/** The slots taxonomy itself writes (012-design §2.2; 032 for organisations). */
export const TAXONOMY_MEDIA_SLOT_COLUMNS: readonly AnyPgColumn[] = [
  projects.coverRef,
  experts.photoRef,
  organisations.logoRef,
];

/** `table.column` — the identity a slot is registered and compared under. */
export function mediaSlotName(column: AnyPgColumn): string {
  return `${getTableName(column.table)}.${column.name}`;
}

@Injectable()
export class MediaSlotRegistry {
  private readonly slots = new Map<string, AnyPgColumn>();

  constructor() {
    this.register(...TAXONOMY_MEDIA_SLOT_COLUMNS);
  }

  /** Register media-slot columns. Idempotent per `table.column`. */
  register(...columns: AnyPgColumn[]): void {
    for (const column of columns) this.slots.set(mediaSlotName(column), column);
  }

  /** Every registered slot column, in registration order. */
  columns(): readonly AnyPgColumn[] {
    return [...this.slots.values()];
  }

  /** Registered slot names (`table.column`), in registration order. */
  names(): readonly string[] {
    return [...this.slots.keys()];
  }
}
