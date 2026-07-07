import type {
  ObjectStorage,
  PutObjectInput,
  StoredObject,
} from "./storage.types.js";

/**
 * In-memory {@link ObjectStorage} (the boundary made testable, mirroring the IdP
 * fake). Bound when no S3 config is present (dev-stand without MinIO / a bare
 * unit boot) so `apps/api` starts and the non-storage flows run without object
 * storage. The events e2e `skipIf(!S3_ENDPOINT)` runs against the real MinIO
 * adapter; this fake keeps the app bootable everywhere else.
 */
export class FakeObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Buffer>();

  put(input: PutObjectInput): Promise<StoredObject> {
    this.objects.set(input.key, input.body);
    return Promise.resolve({ key: input.key, url: this.urlFor(input.key) });
  }

  urlFor(key: string): string {
    return `memory://uploads/${key}`;
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  getBytes(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
}
