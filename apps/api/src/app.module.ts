import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { ReadinessModule } from "./readiness/readiness.module.js";
import { AuthzModule } from "./authz/authz.module.js";
import { FeatureFlagsModule } from "./feature-flags/feature-flags.module.js";
import { DeliveryReconcileModule } from "./delivery-reconcile/delivery-reconcile.module.js";
import { BotProtectionModule } from "./bot-protection/bot-protection.module.js";
import { RateLimitModule } from "./auth/rate-limit/rate-limit.module.js";
import { TimingEqualizationModule } from "./auth/timing/timing-equalization.module.js";
import { LoginChallengeModule } from "./auth/login-challenge/login-challenge.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { EventsModule } from "./events/events.module.js";
import { RegistrationModule } from "./registration/registration.module.js";
import { RoomModule } from "./room/room.module.js";
import { MeModule } from "./me/me.module.js";

@Module({
  imports: [
    // Global Sentry/GlitchTip exception filter (DSO-125) — first so it wraps
    // every downstream module's errors; inert when SENTRY_DSN is unset.
    ObservabilityModule,
    // RateLimit first so a throttled request (EARS-13) sheds before the heavier
    // bot-protection / authz guards run.
    RateLimitModule,
    TimingEqualizationModule,
    AuthzModule,
    // FeatureFlags first — it is @Global and the BotProtection provider + the
    // delivery reconcile inject the FEATURE_FLAGS port from it (#185).
    FeatureFlagsModule,
    BotProtectionModule,
    // Repoints Zitadel's active email/SMS provider from the delivery flags (#185).
    DeliveryReconcileModule,
    // After BotProtectionModule — the EARS-17 conditional login challenge reuses
    // the global BOT_PROTECTION provider it binds.
    LoginChallengeModule,
    AuthModule,
    DatabaseModule,
    // Object storage for the 007 program-PDF binary (real S3/MinIO when
    // configured, in-memory fake otherwise).
    StorageModule,
    // 007 event-admin authoring surface (CreateEvent + admin reads).
    EventsModule,
    // 005 registration write + per-user EventRegistrationState read
    // (doctor_guest-authenticated).
    RegistrationModule,
    // 006 webinar-room server-side admission gate + RoomConfig grant read
    // (doctor_guest-authenticated, registration-and-live `policy` gate).
    RoomModule,
    // 006 self-scoped display name — the JIT room-entry «Имя и фамилия» write +
    // owner-only read (authenticated ∧ doctor_guest ∧ fast-path; EARS-14/16).
    MeModule,
    HealthModule,
    ReadinessModule,
  ],
})
export class AppModule {}
