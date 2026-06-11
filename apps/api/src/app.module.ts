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

@Module({
  imports: [
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
    HealthModule,
    ReadinessModule,
  ],
})
export class AppModule {}
