"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
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
 */
export default function LoginPage() {
  const t = useTranslations();
  const { mutate: login, isLoading } = useLogin();
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
              <Button type="submit" loading={isLoading} data-testid="login-submit">
                {t("login.submit")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
