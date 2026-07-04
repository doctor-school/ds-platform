import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@ds/schemas';
import { Authz, Public } from '../authz/index.js';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  @Get()
  @Public()
  @Authz({ access: 'public', check: 'none', audit: 'none', tests: ['EARS-1'] })
  get(): HealthResponse {
    // DEPLOY_SHA is stamped into the container by `pnpm deploy:prod` (DSO-127);
    // absent in local dev / tests, in which case `version` is omitted.
    const version = process.env.DEPLOY_SHA?.trim();
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      ...(version ? { version } : {}),
    };
  }
}
