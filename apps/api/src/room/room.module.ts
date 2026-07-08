import { Module } from "@nestjs/common";
import { loadEnv } from "../config/env.schema.js";
import { RegistrationModule } from "../registration/registration.module.js";
import { PresenceRepository } from "./presence.repository.js";
import { RoomController } from "./room.controller.js";
import { RoomRepository } from "./room.repository.js";
import { RoomService } from "./room.service.js";
import { ROOM_HEARTBEAT_INTERVAL_SECONDS } from "./room.tokens.js";

/**
 * 006 room module (EARS-1) — the server-side admission gate + the `RoomConfig`
 * grant read (design §2). It owns no auth primitive (the global `AuthzGuard` +
 * the 003 session enforce the authenticated ∧ role precondition), no
 * registration, and no event lifecycle authoring: it imports
 * {@link RegistrationModule} to read the 005 `EventRoster` (the `registered`
 * condition, REUSED not reimplemented — F-22), and reads the 004/007
 * `EventLifecycleState` (the `live` condition) read-only through its own thin
 * {@link RoomRepository} view of the `events` aggregate. The heartbeat cadence N
 * the grant carries is bound from config (`ROOM_HEARTBEAT_INTERVAL_SECONDS`),
 * never a hardcoded constant.
 *
 * EARS-4 layers the gated `RecordPresenceHeartbeat` command onto the SAME gate:
 * {@link PresenceRepository} owns the durable append-only presence table's
 * INSERT-only write (design §5). The gated chat command (EARS-3) is the remaining
 * sibling handler that will layer onto this same gate.
 */
@Module({
  imports: [RegistrationModule],
  controllers: [RoomController],
  providers: [
    RoomService,
    RoomRepository,
    PresenceRepository,
    {
      provide: ROOM_HEARTBEAT_INTERVAL_SECONDS,
      useFactory: (): number => loadEnv().ROOM_HEARTBEAT_INTERVAL_SECONDS,
    },
  ],
})
export class RoomModule {}
