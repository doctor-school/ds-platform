// Comment-mask fixture: the page really routes its error through the `FormError`
// primitive — the only `role="alert"` + `text-destructive` occurrence lives in a
// JS comment (a migration note). The guard strips comments before scanning, so
// this must NOT raise a false positive (exit 0).
import { FormError } from "@ds/design-system/form";

// Migration note: replaced the old `<p role="alert" className="text-destructive">`
// block with the `FormError` primitive below. Do not reintroduce the raw block.
export function LoginPage({ error }: { error?: string }) {
  return (
    <form>
      <input name="email" />
      <FormError>{error}</FormError>
      <button type="submit">Войти</button>
    </form>
  );
}
