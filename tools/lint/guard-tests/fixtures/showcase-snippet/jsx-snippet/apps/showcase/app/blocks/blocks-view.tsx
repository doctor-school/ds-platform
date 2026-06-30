// Defect (#396): a hand-typed template-literal constant DEPICTING block usage —
// a second, hand-maintained copy of code @ds/design-system already owns, which
// drifts. The PascalCase JSX opening tag lives INSIDE the template literal (not a
// real rendered element). The guard must flag this (exit 1).
import { AuthCard } from "@ds/design-system/blocks";

const AUTH_CARD_SNIPPET = `
<AuthCard title="Sign in">
  <Button type="submit">Continue</Button>
</AuthCard>
`;

export function BlocksView() {
  return (
    <div>
      <AuthCard title="Sign in" />
      <pre>{AUTH_CARD_SNIPPET}</pre>
    </div>
  );
}
