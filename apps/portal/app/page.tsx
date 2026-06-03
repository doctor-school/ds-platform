import Link from "next/link";
import { Button } from "@ds/design-system/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ds/design-system/card";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">Doctor.School portal</CardTitle>
          <CardDescription>
            App shell scaffold (ADR-0004 §3 / §7). The authentication flows
            (password / email-OTP / SMS-OTP) land with feature 003 — this page
            exists to prove the app builds against the shared design system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/login">Go to sign-in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
