import { Global, Logger, Module } from "@nestjs/common";
import { loadEnv } from "../config/env.schema.js";
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
 */
@Global()
@Module({
  providers: [
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
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
