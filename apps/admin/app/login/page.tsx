"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useIsAuthenticated, useLogin } from "@refinedev/core";
import { NavigateToResource } from "@refinedev/nextjs-router";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import { LoginFormSchema, type LoginFormFields } from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

/**
 * Admin login (007 EARS-8). Reuses the shipped 003 password login via the Refine
 * `useLogin` binding → `authProvider.login` → `/v1/auth/login`; the provider then
 * admits ONLY a `platform_admin` session (a `doctor_guest`/non-admin is refused
 * with `login.errorForbidden`). 007 adds no auth primitive — this is the 003 flow.
 * Copy from the RU catalog (EARS-10); stock DS card + form + input (EARS-11).
 *
 * #665 rework (Stage-B finding: native «Please fill out this field.» bubbles):
 * client validation is RHF + the `@ds/design-system` field-schema fragments
 * ({@link LoginFormSchema}) rendered as RU `<FormMessage>` copy on blur — native
 * browser validation is suppressed (`noValidate`), matching every other admin form.
 *
 * #675 auth-surface guard: the default export gates on `useIsAuthenticated` (the
 * same `authProvider.check` used everywhere — no new gate). An already-admitted
 * `platform_admin` renders `<NavigateToResource resource="events">` → the admin
 * root `/events`; an unauthenticated caller renders this form. While the FIRST
 * `check` resolves the page renders `null`, so no login form flashes before the
 * redirect resolves. The gate deliberately keys on `isLoading` (initial fetch,
 * no cached data), NOT `isFetching`: Refine v5's `useLogin` invalidates the
 * auth-check query even on a FAILED login (`success: false`), and an
 * `isFetching`-keyed boundary (v5 `<Authenticated>`) unmounts the form on that
 * background refetch — wiping the fields and the rendered RU error (#825
 * live-verify regression). With `isLoading` the background re-check keeps the
 * previous `authenticated: false` data, the form stays mounted, and the
 * `login.errorGeneric` Alert renders exactly as pre-migration.
 */
function LoginForm() {
  const t = useTranslations();
  const { mutate: login, isPending } = useLogin();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(LoginFormSchema, "login.validation"),
    defaultValues: { email: "", password: "" },
  });

  function submit(values: LoginFormFields) {
    setError(null);
    login(values, {
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
    });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("login.title")}</CardTitle>
          <CardDescription>{t("login.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              className="flex flex-col gap-4"
              data-testid="login-form"
              noValidate
              onSubmit={form.handleSubmit(submit)}
            >
              {error ? (
                <Alert variant="danger" data-testid="login-error">
                  {error}
                </Alert>
              ) : null}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="email">{t("login.email")}</FormLabel>
                    <FormControl>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="username"
                        placeholder={t("login.emailPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="password">{t("login.password")}</FormLabel>
                    <FormControl>
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" loading={isPending} data-testid="login-submit">
                {t("login.submit")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * #675: redirect an already-authenticated admin away from `/login`. When
 * `authProvider.check` admits the caller (a `platform_admin` session),
 * `<NavigateToResource>` sends them to the `events` resource (admin root);
 * otherwise the login form renders exactly as before. `null` while the initial
 * check resolves suppresses any pre-resolution flash of the form. See the
 * docblock above for why this gates on `isLoading`, not v5 `<Authenticated>`.
 */
export default function LoginPage() {
  const { isLoading, data } = useIsAuthenticated();
  if (isLoading) return null;
  if (data?.authenticated) return <NavigateToResource resource="events" />;
  return <LoginForm />;
}
