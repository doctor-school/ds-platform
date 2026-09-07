import type { Resolver } from "react-hook-form";

/**
 * Build a react-hook-form resolver from per-field validators.
 *
 * The shared `@ds/design-system/blocks` auth cards take `Resolver`s because the
 * guard is HOST business (the Academy passes zod-backed localized ones). This app
 * has no message catalogue — `apps/doctor` is a single-locale RU app whose root
 * layout ships no `next-intl` provider — so the portal `useLocalizedResolver` has
 * nothing to translate into here. The shared field SCHEMAS still do the deciding
 * at every call site; this closure only shapes their verdict into what RHF
 * expects, and the sentence shown to the doctor stays doctor-owned.
 *
 * Extracted from `components/login-screen.tsx` when `/reset` (#1989) became the
 * SECOND doctor-host projection needing exactly this: one helper, two screens,
 * rather than the same fifteen lines written twice inside one app.
 *
 * The cast is the one every resolver factory needs: the RHF `Resolver` is generic
 * over its internal field-path machinery, which a plain record cannot express.
 */
export function makeResolver<T extends object>(rules: {
  [K in keyof T]?: (value: T[K], values: T) => string | null;
}): Resolver<T> {
  return ((values: T) => {
    const errors: Record<string, { type: string; message: string }> = {};
    for (const key of Object.keys(rules) as (keyof T)[]) {
      const message = rules[key]?.(values[key], values) ?? null;
      if (message) errors[key as string] = { type: "validate", message };
    }
    return Object.keys(errors).length > 0
      ? { values: {}, errors }
      : { values, errors: {} };
  }) as unknown as Resolver<T>;
}
