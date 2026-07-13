import { createHmac, randomBytes } from "node:crypto";
import type {
  ObjectStorage,
  PutObjectInput,
  StoredObject,
} from "./storage.types.js";

/** What the fake store answers when a URL is dereferenced (mirrors an HTTP GET). */
export interface FakeFetchResult {
  /** 200 (signed + present), 403 (unsigned / bad signature), 404 (absent key). */
  status: number;
  body: Buffer | null;
}

/** Query parameter carrying the fake's URL signature (mirrors `X-Amz-Signature`). */
const SIGNATURE_PARAM = "X-Fake-Signature";

/**
 * In-memory {@link ObjectStorage} (the boundary made testable, mirroring the IdP
 * fake). Bound when no S3 config is present (dev-stand without MinIO / a bare
 * unit boot) so `apps/api` starts and the non-storage flows run without object
 * storage.
 *
 * Contract parity (#842): the real bucket is PRIVATE, so the fake must not be
 * more permissive than real S3 — the unsigned-URL bug shipped past dev
 * verification precisely because the old fake happily "served" any URL shape.
 * `urlFor` therefore returns a **signed** URL (an HMAC token over the key,
 * mirroring a SigV4 presigned GET), and {@link fetchUrl} — the fake counterpart
 * of an HTTP GET against the store — denies a plain unsigned object path with
 * 403, exactly like the private prod bucket does.
 */
export class FakeObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Buffer>();
  /** Per-instance signing secret — a URL from another instance never verifies. */
  private readonly secret = randomBytes(16).toString("hex");

  async put(input: PutObjectInput): Promise<StoredObject> {
    this.objects.set(input.key, input.body);
    return { key: input.key, url: await this.urlFor(input.key) };
  }

  urlFor(key: string): Promise<string> {
    return Promise.resolve(
      `${this.baseUrlFor(key)}?${SIGNATURE_PARAM}=${this.sign(key)}`,
    );
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  getBytes(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /**
   * Dereference a URL the way a browser GET against the real store would
   * (fake-only — for the real adapter the counterpart is a plain HTTP fetch):
   * missing/invalid signature → 403 (private bucket denies the unsigned shape),
   * absent object → 404, else 200 + bytes.
   */
  fetchUrl(url: string): Promise<FakeFetchResult> {
    const parsed = new URL(url);
    const key = decodeURIComponent(
      `${parsed.host}${parsed.pathname}`.replace(/^uploads\//, ""),
    );
    if (parsed.searchParams.get(SIGNATURE_PARAM) !== this.sign(key)) {
      return Promise.resolve({ status: 403, body: null });
    }
    const body = this.objects.get(key) ?? null;
    return Promise.resolve(
      body ? { status: 200, body } : { status: 404, body: null },
    );
  }

  /** The unsigned object path — the shape the store DENIES (test seam, #842). */
  baseUrlFor(key: string): string {
    return `memory://uploads/${key}`;
  }

  private sign(key: string): string {
    return createHmac("sha256", this.secret).update(key).digest("hex");
  }
}
