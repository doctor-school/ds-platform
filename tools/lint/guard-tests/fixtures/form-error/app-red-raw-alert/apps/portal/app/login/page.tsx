// Red fixture: the exact #333 defect shape — a form-level submit error
// hand-typed as a raw `<p role="alert" className="text-xs text-destructive">`
// in app source instead of routing through the `@ds/design-system` `FormError`
// primitive. The destructive text token is a VALID token, so no color / arbitrary
// -value guard catches it; only this guard does (WARN-level, exit 1).
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
