"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
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
import { readAdminAuthState } from "@/lib/admin-auth";

/**
 * Admin login — since 011, **primary authentication only**.
 *
 * `useLogin` → `authProvider.login` → `POST /v1/admin/auth/login`, which issues
 * no session: it produces a short-lived pending authentication and names the
 * second-factor step it owes, and the provider's `redirectTo` carries the
 * operator to the enrollment or challenge screen. The session is issued there, in
 * place (LD-1) — there is no second sign-in on this screen and no branch here
 * that could produce one.
 *
 * The `login.errorForbidden` case is gone with the 007 client-side role check:
 * the admin tier refuses a principal outside the `role → mfa_required` policy
 * with the same uniform 401 it gives a wrong password (ADR-0001 §7 enumeration
 * safety), so this screen can no longer tell the two apart — and must not, since
 * "your password is right but you are not an admin" is exactly the oracle the
 * uniform refusal exists to deny.
 *
 * #665 rework (Stage-B finding: native «Please fill out this field.» bubbles):
 * client validation is RHF + the `@ds/design-system` field-schema fragments
 * ({@link LoginFormSchema}) rendered as RU `<FormMessage>` copy on blur — native
 * browser validation is suppressed (`noValidate`), matching every other admin form.
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
            data.error?.message === "login.errorThrottled"
              ? t("login.errorThrottled")
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
 * #675, re-based on the 011 state read: a browser that is already somewhere in
 * the admin flow does not get shown a password form.
 *
 * It reads {@link readAdminAuthState} directly rather than `useIsAuthenticated`.
 * The Refine hook answers one boolean, and the 011 flow has **four** positions —
 * an operator holding a live pending authentication is `authenticated: false`
 * but must be sent to their challenge/enrollment step, not asked for a password
 * they already gave. Reading the state itself is what lets this page tell "not
 * signed in" from "mid-flow", and it is a single fetch on mount rather than a
 * cached query the login mutation invalidates (the #825 regression: a v5
 * `isFetching`-keyed boundary unmounted the form on the background re-check
 * after a FAILED login, wiping the fields and the rendered RU error).
 *
 * `null` while that first read resolves, so no login form flashes before the
 * redirect lands.
 */
export default function LoginPage() {
  const router = useRouter();
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readAdminAuthState().then((state) => {
      if (cancelled) return;
      if (state === "active") router.replace("/events");
      else if (state === "mfa_pending_challenge") router.replace("/mfa/challenge");
      else if (state === "mfa_pending_enrollment") router.replace("/mfa/enroll");
      else setResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!resolved) return null;
  return <LoginForm />;
}
