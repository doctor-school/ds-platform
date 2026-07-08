import { Module } from "@nestjs/common";
import { loadEnv } from "../config/env.schema.js";
import { RegistrationModule } from "../registration/registration.module.js";
import {
  CentrifugoChatGateway,
  resolveRoomChatConfig,
  type RoomChatConfig,
} from "./chat.gateway.js";
import { PresenceRepository } from "./presence.repository.js";
import { RoomController } from "./room.controller.js";
import { RoomRepository } from "./room.repository.js";
import { RoomService } from "./room.service.js";
import {
  ROOM_CHAT_CONFIG,
  ROOM_HEARTBEAT_INTERVAL_SECONDS,
} from "./room.tokens.js";

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
 * INSERT-only write (design §5). EARS-3 layers the gated `PostChatMessage` command
 * onto the same gate: {@link CentrifugoChatGateway} mints the gate-scoped
 * subscribe-only connection token the `RoomConfig` grant carries and publishes a
 * gated doctor's message to the Centrifugo room channel — the ONLY publish path
 * (design §4). Its config (`ROOM_CHAT_CONFIG`) is bound from `CENTRIFUGO_*` env; a
 * Centrifugo-less runtime binds `null` and chat degrades to the truthful
 * unavailable state (grant carries `chat: null`).
 */
@Module({
  imports: [RegistrationModule],
  controllers: [RoomController],
  providers: [
    RoomService,
    RoomRepository,
    PresenceRepository,
    CentrifugoChatGateway,
    {
      provide: ROOM_HEARTBEAT_INTERVAL_SECONDS,
      useFactory: (): number => loadEnv().ROOM_HEARTBEAT_INTERVAL_SECONDS,
    },
    {
      provide: ROOM_CHAT_CONFIG,
      useFactory: (): RoomChatConfig | null =>
        resolveRoomChatConfig(loadEnv()),
    },
  ],
})
export class RoomModule {}
