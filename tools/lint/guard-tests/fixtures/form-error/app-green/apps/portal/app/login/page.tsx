// Green fixture: an auth page that routes its form-level submit error through
// the @ds/design-system `FormError` primitive. The error look (role="alert" +
// the destructive text token) is owned ONCE in the primitive — the page carries
// no hand-typed alert block, so the guard passes (exit 0).
import { FormError } from "@ds/design-system/form";

export function LoginPage({ error }: { error?: string }) {
  return (
    <form>
      <input name="email" />
      <FormError>{error}</FormError>
      <button type="submit">Войти</button>
    </form>
  );
}
