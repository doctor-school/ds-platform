/**
 * RED (#1874): the doctor storefront is a full product front, so a raw `<a>`
 * carrying a bespoke hover stack must be a finding there exactly as it is on
 * the academy. Pre-fix `APP_GLOBS` named no `apps/doctor` root at all.
 */
export default function Page() {
  return (
    <a href="/events" className="underline hover:opacity-80 focus-visible:shadow-focus">
      Эфиры
    </a>
  );
}
