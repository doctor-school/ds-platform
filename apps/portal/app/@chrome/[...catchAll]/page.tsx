import { AppShellHeader } from "../../../components/app-shell-header";

/** Every non-root portal route keeps the existing persistent application shell. */
export default function ApplicationChrome() {
  return <AppShellHeader />;
}
