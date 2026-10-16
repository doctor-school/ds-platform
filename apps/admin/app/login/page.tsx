"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { useInvalidateAuthStore } from "@refinedev/core";
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
import {
  adminLandingFor,
  currentReturnTarget,
  withAdminReturnTarget,
} from "@/lib/admin-return-target";
import {
  loginFailureFromMessage,
  type LoginFailurePresentation,
} from "@/lib/login-failure";
import { authProvider } from "@/providers/auth-provider";

/**
 * Admin login — since 011, **primary authentication only**.
 *
 * `authProvider.login` → `POST /v1/admin/auth/login`, which issues
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
  const router = useRouter();
  const invalidateAuthStore = useInvalidateAuthStore();
  const [isPending, setIsPending] = useState(false);
  const [failure, setFailure] = useState<LoginFailurePresentation | null>(null);
  const form = useForm<LoginFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(LoginFormSchema, "login.validation"),
    defaultValues: { email: "", password: "" },
  });

  // #2782: the provider is called directly, NOT through Refine's `useLogin`.
  // `useLogin` reads the raw `?to=` from the URL and, on success, navigates to
  // it unvalidated in place of the provider's `redirectTo` — an open redirect
  // (`/login?to=//evil.example`) and a skip past the second-factor step. Here
  // the only navigation is the provider's `redirectTo`, whose carried target
  // went through `resolveAdminReturnTarget`.
  async function submit(values: LoginFormFields) {
    if (isPending) return;
    setFailure(null);
    setIsPending(true);
    try {
      const data = await authProvider.login({
        ...values,
        to: currentReturnTarget(),
      });
      if (!data.success) {
        // What the refusal WAS is decided by the provider and re-read here
        // (`login-failure.ts`): an IdP outage must not be repainted as a
        // verdict on the credentials, which were never checked (#1217).
        setFailure(loginFailureFromMessage(data.error?.message));
        return;
      }
      await invalidateAuthStore();
      if (data.redirectTo) router.replace(data.redirectTo);
    } catch {
      // A thrown transport error says nothing about the service being down in
      // the way a 503 does, so it stays the uniform refusal.
      setFailure(loginFailureFromMessage(undefined));
    } finally {
      setIsPending(false);
    }
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
              {failure ? (
                <Alert variant={failure.variant} data-testid={failure.testId}>
                  {t(`login.${failure.messageKey}`)}
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
                    <FormLabel htmlFor="password">
                      {t("login.password")}
                    </FormLabel>
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
              <Button
                type="submit"
                loading={isPending}
                data-testid="login-submit"
              >
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
      // #2782: every onward hop keeps the carried return target.
      const target = currentReturnTarget();
      if (state === "active") router.replace(adminLandingFor(target));
      else if (state === "mfa_pending_challenge")
        router.replace(withAdminReturnTarget("/mfa/challenge", target));
      else if (state === "mfa_pending_enrollment")
        router.replace(withAdminReturnTarget("/mfa/enroll", target));
      else setResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!resolved) return null;
  return <LoginForm />;
}
