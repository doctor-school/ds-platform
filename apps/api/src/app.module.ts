import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { ReadinessModule } from "./readiness/readiness.module.js";
import { AuthzModule } from "./authz/authz.module.js";
import { BotProtectionModule } from "./bot-protection/bot-protection.module.js";
import { AuthModule } from "./auth/auth.module.js";

@Module({
  imports: [
    AuthzModule,
    BotProtectionModule,
    AuthModule,
    DatabaseModule,
    HealthModule,
    ReadinessModule,
  ],
})
export class AppModule {}
