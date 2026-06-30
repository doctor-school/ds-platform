// Clean showcase view: REAL top-of-file import + REAL rendered JSX — neither is
// inside a string literal, so nothing can drift. The guard must pass this (exit 0).
import { AuthCard } from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";

export function BlocksView() {
  return (
    <AuthCard className="w-full max-w-sm" title="Sign in">
      <Button type="submit" className="w-full">
        Continue
      </Button>
    </AuthCard>
  );
}
