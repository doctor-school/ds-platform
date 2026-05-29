import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { ReadinessModule } from './readiness/readiness.module.js';

@Module({
  imports: [DatabaseModule, HealthModule, ReadinessModule],
})
export class AppModule {}
