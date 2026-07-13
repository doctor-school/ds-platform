import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * Clean product-ready page — a comment mentioning EARS-1 or ADR-0004 must NOT
 * trip the tell scan (comments are stripped before matching).
 */
export default function HomePage() {
  const t = useTranslations("home");
  return (
    <main>
      <h1>{t("title")}</h1>
      {/* Facade re-point (EARS-2): the home route forwards to the catalog. */}
      <Link href="/webinars">{t("goToCatalog")}</Link>
    </main>
  );
}
