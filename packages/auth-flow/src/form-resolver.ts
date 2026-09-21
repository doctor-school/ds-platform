/**
 * The one way this package builds a react-hook-form resolver (#2027 wave 1).
 *
 * Every shared door takes `Resolver`s because the guard is HOST business, and
 * the door is where host business lives: the RULE is a package field projection
 * (`./fields`, the one identifier / password / code guard of both storefronts)
 * and the SENTENCE is the host's own `copy.*` string. Neither host's resolver
 * helper is imported — a package may not import from an app — and no message
 * catalogue is consulted, because the config already carries the sentences in
 * the host's voice.
 *
 * The cast is the one every resolver factory needs, and the reason this helper
 * is a module of its own rather than a trick repeated per door: the RHF
 * `Resolver` is generic over its internal field-path machinery, which a plain
 * record cannot express, and the exact shape the generic resolves to depends on
 * the compiling project. One home means one cast to audit.
 */
export function makeResolver<TValues extends object, TResolver>(rules: {
  [K in keyof TValues]?: (value: TValues[K], values: TValues) => string | null;
}): TResolver {
  return ((values: TValues) => {
    const errors: Record<string, { type: string; message: string }> = {};
    for (const key of Object.keys(rules) as (keyof TValues)[]) {
      const message = rules[key]?.(values[key], values) ?? null;
      if (message) errors[key as string] = { type: "validate", message };
    }
    return Object.keys(errors).length > 0
      ? { values: {}, errors }
      : { values, errors: {} };
  }) as unknown as TResolver;
}
