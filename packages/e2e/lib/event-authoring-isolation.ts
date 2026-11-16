import { createHash, createHmac } from "node:crypto";

type Redis = {
  eval(
    script: string,
    count: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  exists(...keys: string[]): Promise<number>;
};
type Store = {
  redis: Redis;
  consume(specs: { key: string }[], ...args: unknown[]): Promise<unknown>;
};

export function observeAuthoringRateStore(
  store: Store,
  pepper: string,
  previousPepper: string | undefined,
  record: (evidence: Record<string, unknown>) => void,
) {
  if (!pepper || pepper === previousPepper)
    throw new Error("4061 requires a disjoint private rate pepper");
  const keys = new Set<string>();
  const expected = new Set<string>();
  const shared = new Set<string>();
  const hash = (secret: string, key: string) =>
    `ds:rate-limit:${createHmac("sha256", secret).update(key).digest("hex")}`;
  const identify = (key: string) =>
    createHash("sha256").update(key).digest("hex");
  const consume = store.consume.bind(store);
  store.consume = async (specs, ...args) => {
    for (const spec of specs) {
      expected.add(hash(pepper, spec.key));
      if (previousPepper) shared.add(hash(previousPepper, spec.key));
    }
    return consume(specs, ...args);
  };
  const observe = (key: string) => {
    const base = key.replace(/:trip:\d+$/, "");
    if (!expected.has(base) || shared.has(base))
      throw new Error("4061 native Redis key is not proven disjoint");
    keys.add(key);
    record({ keySha256: identify(key), disjoint: true, observed: true });
  };
  const redis = store.redis;
  const nativeEval = redis.eval.bind(redis);
  const nativeSet = redis.set.bind(redis);
  const nativeDel = redis.del.bind(redis);
  redis.eval = async (script, count, ...args) => {
    for (const key of args.slice(0, count)) observe(String(key));
    return nativeEval(script, count, ...args);
  };
  redis.set = async (key, value, ...args) => {
    observe(key);
    return nativeSet(key, value, ...args);
  };
  redis.del = async (...targets) => {
    targets.forEach(observe);
    return nativeDel(...targets);
  };
  return {
    keys,
    async cleanup() {
      if (keys.size) {
        record({ action: "delete-exact", keySha256s: [...keys].map(identify) });
        await nativeDel(...keys);
        if (await redis.exists(...keys))
          throw new Error("4061 exact rate keys still exist after cleanup");
        record({
          action: "verified-absent",
          keySha256s: [...keys].map(identify),
        });
      }
    },
  };
}
