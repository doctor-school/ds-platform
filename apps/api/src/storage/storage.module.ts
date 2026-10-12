import { Global, Logger, Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { loadEnv } from "../config/env.schema.js";
import {
  ObjectStorageReadiness,
  STORAGE_READINESS_INTERVAL,
  STORAGE_READINESS_INTERVAL_MS,
} from "./storage-readiness.js";
import { FakeObjectStorage } from "./storage.fake.js";
import { S3ObjectStorage } from "./storage.s3.js";
import type { ObjectStorage } from "./storage.types.js";
import { OBJECT_STORAGE } from "./storage.types.js";

/**
 * Binds the {@link ObjectStorage} port (007 program-PDF binary). The real S3
 * adapter is bound only when a full S3 config is present (endpoint + bucket +
 * credentials, resolved from env — never hardcoded); otherwise the in-memory
 * fake is bound so `apps/api` boots on a dev-stand without MinIO / in a bare
 * unit run (mirrors the IdP fake). `@Global` so the events module injects the
 * port without importing this module explicitly.
 *
 * Also provides {@link ObjectStorageReadiness} — the cached bucket probe
 * `GET /v1/ready` reads (002 EARS-3, #2821). `ScheduleModule.forRoot()` supplies
 * its SchedulerRegistry (Nest de-duplicates the identical dynamic module the
 * auth module also imports).
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    {
      provide: STORAGE_READINESS_INTERVAL,
      useValue: STORAGE_READINESS_INTERVAL_MS,
    },
    ObjectStorageReadiness,
    {
      provide: OBJECT_STORAGE,
      useFactory: (): ObjectStorage => {
        const env = loadEnv();
        if (
          env.S3_ENDPOINT &&
          env.S3_BUCKET_UPLOADS &&
          env.S3_ACCESS_KEY &&
          env.S3_SECRET_KEY
        ) {
          return new S3ObjectStorage({
            endpoint: env.S3_ENDPOINT,
            region: env.S3_REGION,
            bucket: env.S3_BUCKET_UPLOADS,
            accessKey: env.S3_ACCESS_KEY,
            secretKey: env.S3_SECRET_KEY,
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
          });
        }
        new Logger("StorageModule").warn(
          "no S3 config — binding in-memory object storage (dev/test fallback)",
        );
        return new FakeObjectStorage();
      },
    },
  ],
  exports: [OBJECT_STORAGE, ObjectStorageReadiness],
})
export class StorageModule {}
