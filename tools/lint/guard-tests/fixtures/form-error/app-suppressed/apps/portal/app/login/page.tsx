// Suppressed fixture: the same raw `role="alert"` + `text-destructive` block,
// but the file carries a reasoned opt-out marker. A genuine exception (e.g. a
// third-party widget that ships its own alert markup) is acknowledged in a
// comment, mirroring `interaction-states-ok`. The guard skips the file (exit 0).
/* form-error-ok: third-party captcha widget renders its own alert markup */
export function LoginPage({ error }: { error?: string }) {
  return (
    <form>
      <input name="email" />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <button type="submit">Войти</button>
    </form>
  );
}
