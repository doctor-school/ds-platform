import { Button } from "@ds/design-system/button";

import { applicationsCopy as copy } from "../copy";

/** Where the gate's one action leads — it carries `/apply` as its return target. */
export interface AccountGateHost {
  signInHref: string;
}

/**
 * 033 EARS-3 — the account gate a guest sees in place of the form: the same
 * account as a doctor's, one «Войти / Регистрация» action starting the 003 / 021
 * flow that returns to `/apply`. No form field is drawn.
 */
export function AccountGate({ host }: { host: AccountGateHost }) {
  return (
    <div
      data-testid="apply-gate"
      className="border-2 border-border bg-card p-6 shadow-lg md:p-9"
    >
      <span
        aria-hidden="true"
        className="mb-5 inline-flex size-13 items-center justify-center bg-tint text-xl font-extrabold text-primary-action"
      >
        →
      </span>
      <h2 className="text-title-lg font-extrabold leading-title tracking-tight text-foreground">
        {copy.gate.title}
      </h2>
      <p className="mt-3 text-sm leading-assurance text-muted-foreground">
        {copy.gate.text}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild size="lg">
          <a href={host.signInHref}>{copy.gate.signIn}</a>
        </Button>
      </div>
    </div>
  );
}
