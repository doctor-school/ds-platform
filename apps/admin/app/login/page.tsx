"use client";

import { useState } from "react";
import { useLogin } from "@refinedev/core";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@ds/design-system";
import { Field } from "@/components/fields";

/**
 * Admin login (007 EARS-8). Reuses the shipped 003 password login via the Refine
 * `useLogin` binding → `authProvider.login` → `/v1/auth/login`; the provider then
 * admits ONLY a `platform_admin` session (a `doctor_guest`/non-admin is refused
 * with `login.errorForbidden`). 007 adds no auth primitive — this is the 003 flow.
 * Copy from the RU catalog (EARS-10); stock DS card + input (EARS-11).
 */
export default function LoginPage() {
  const t = useTranslations();
  const { mutate: login, isLoading } = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("login.title")}</CardTitle>
          <CardDescription>{t("login.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              login(
                { email, password },
                {
                  onSuccess: (data) => {
                    if (!data.success) {
                      setError(
                        data.error?.message === "login.errorForbidden"
                          ? t("login.errorForbidden")
                          : t("login.errorGeneric"),
                      );
                    }
                  },
                  onError: () => setError(t("login.errorGeneric")),
                },
              );
            }}
          >
            {error ? (
              <Alert variant="danger" data-testid="login-error">
                {error}
              </Alert>
            ) : null}
            <Field label={t("login.email")} htmlFor="email">
              <Input
                id="email"
                type="email"
                name="email"
                autoComplete="username"
                placeholder={t("login.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label={t("login.password")} htmlFor="password">
              <Input
                id="password"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" loading={isLoading} data-testid="login-submit">
              {t("login.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
