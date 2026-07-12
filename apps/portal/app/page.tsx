import { redirect } from "next/navigation";

/**
 * #769 facade re-point — the portal front door forwards to the real public
 * upcoming-broadcasts listing (`/webinars`, 004 EARS-7). The former 003-era
 * "Каркас приложения" scaffold card is retired now that the product surface it
 * stood in for exists one level deeper: a visitor landing on `/` is taken
 * straight to the live listing rather than a placeholder that only linked to
 * sign-in.
 */
export default function HomePage() {
  redirect("/webinars");
}
