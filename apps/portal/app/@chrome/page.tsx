import { AppShellHeader } from "../../components/app-shell-header";

/**
 * The root route mounts the persistent 008 app-shell header like every other
 * portal route (#1877). The interim Academy home used to own a bespoke,
 * partly-disabled header of its own; it now sits inside the standard shell, per
 * the canonical 013 design §7 (EARS-16).
 */
export default function PublicAcademyChrome() {
  return <AppShellHeader />;
}
