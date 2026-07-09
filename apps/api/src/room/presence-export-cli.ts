import { Logger, type INestApplicationContext } from "@nestjs/common";
import type { EventPresence } from "@ds/schemas";

import { PresenceDerivationService } from "./presence-derivation.service.js";
import { RoomRepository } from "./room.repository.js";

/**
 * 006 EARS-5 — the wave-1 **manual sponsor export** trigger (design §5). The
 * per-doctor presence minutes are a B2B deliverable with **no** report UI and
 * **no** public endpoint in wave 1: the operator runs this standalone CLI to emit
 * the `EventPresence` JSON for one event, then hands the per-doctor minutes to the
 * sponsor. Keeping it a script (not an HTTP route) is deliberate — the presence
 * data is never exposed on a public surface (EARS-8), so there is no
 * under-authorized read endpoint to secure.
 *
 * It boots an HTTP-less Nest application context (no listener), resolves the event
 * by its stable slug OR id (the same `idOrSlug` resolution the room gate uses),
 * derives the minutes at the server-config cadence N by default (an explicit
 * `intervalSeconds` recomputes the same beats at a different cadence — the
 * what-if / re-cadenced export, parameterized over N with no code change), prints
 * the JSON, and tears the context down. Run via `pnpm --filter @ds/api
 * presence:export -- <event-id-or-slug> [intervalSeconds]`.
 *
 * The pure {@link runPresenceExport} is unit-testable with a context double; the
 * Nest-boot half ({@link bootstrapAndExport}) is exercised live against the
 * dev-stand, never unit-mocked (mirrors the #119 reconcile CLI).
 */

/** The event whose room export was requested does not exist. */
export class PresenceExportEventNotFoundError extends Error {
  constructor(readonly idOrSlug: string) {
    super(`event not found: ${idOrSlug}`);
    this.name = "PresenceExportEventNotFoundError";
  }
}

/**
 * Resolve the event + derive its {@link EventPresence} against an already-booted
 * Nest context, then close it. `intervalSeconds` is optional — omitted, the
 * derivation uses the server-config cadence N.
 */
export async function runPresenceExport(
  app: INestApplicationContext,
  idOrSlug: string,
  intervalSeconds?: number,
): Promise<EventPresence> {
  try {
    const rooms = app.get(RoomRepository);
    const event = await rooms.findEventForRoom(idOrSlug);
    if (!event) throw new PresenceExportEventNotFoundError(idOrSlug);
    const derivation = app.get(PresenceDerivationService);
    return await derivation.deriveForEvent(event.id, intervalSeconds);
  } finally {
    await app.close();
  }
}

/**
 * Boot an HTTP-less Nest application context, run one export, log + return the
 * derivation. The entry script ({@link file://../../scripts/presence-export.ts})
 * calls this; it is also importable for an ops harness.
 */
export async function bootstrapAndExport(
  idOrSlug: string,
  intervalSeconds?: number,
): Promise<EventPresence> {
  const logger = new Logger("PresenceExportCli");
  // Lazy imports so a unit test of `runPresenceExport` never boots Nest.
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error"],
  });
  const result = await runPresenceExport(app, idOrSlug, intervalSeconds);
  logger.log(
    `presence export for ${idOrSlug} — ${result.doctors.length} doctor(s) at N=${result.intervalSeconds}s`,
  );
  return result;
}
