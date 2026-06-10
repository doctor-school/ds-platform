import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@ds/design-system/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ds/design-system/card";

export default function HomePage() {
  const t = useTranslations("home");
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/login">{t("goToSignIn")}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
