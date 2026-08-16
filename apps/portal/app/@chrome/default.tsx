import { AppShellHeader } from "../../components/app-shell-header";

/** Fallback for unmatched parallel-route state during a hard navigation. */
export default function DefaultApplicationChrome() {
  return <AppShellHeader />;
}
