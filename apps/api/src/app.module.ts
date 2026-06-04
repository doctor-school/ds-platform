import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { ReadinessModule } from "./readiness/readiness.module.js";
import { AuthzModule } from "./authz/authz.module.js";
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
    BotProtectionModule,
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
