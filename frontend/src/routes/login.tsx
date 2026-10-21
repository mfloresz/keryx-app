import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useI18n } from "#/i18n";
import { getAuthAdapter } from "#/services/runtime";
import { useAuth } from "#/stores/auth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { setSession } = useAuth();

  const [needsSetup, setNeedsSetup] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});

  React.useEffect(() => {
    void (async () => {
      const auth = await getAuthAdapter();
      setNeedsSetup(await auth.getSetupStatus());
    })();
  }, []);

  function validate(): boolean {
    const errors: typeof fieldErrors = {};
    const trimmed = email.trim();

    if (!trimmed) {
      errors.email = t("auth.validation.emailRequired");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      errors.email = t("auth.validation.emailInvalid");
    }

    if (!password) {
      errors.password = t("auth.validation.passwordRequired");
    } else if (needsSetup) {
      if (password.length < 8) {
        errors.password = t("auth.setup.passwordMinLength");
      } else if (password !== confirmPassword) {
        errors.confirmPassword = t("auth.setup.passwordsDoNotMatch");
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    if (isSubmitting) return;
    if (!validate()) return;

    setIsSubmitting(true);
    setError("");

    try {
      const auth = await getAuthAdapter();
      const session = needsSetup
        ? await auth.register(email.trim(), password, name.trim())
        : await auth.login(email.trim(), password);
      setSession(session);
      void navigate({ to: "/" });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(needsSetup ? "auth.setup.error" : "auth.login.error"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="box-border flex h-[100dvh] overflow-hidden bg-muted p-6 sm:p-8 lg:p-10">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[28px] border border-border/70 bg-background md:aspect-[4/3] md:h-[calc(100dvh-6rem)] md:w-auto md:grid-cols-2">
          <div className="flex min-h-0 items-center justify-center px-5 py-6 sm:px-10 sm:py-8 md:aspect-[2/3] md:px-12 md:py-10">
            <div className="w-full max-w-[28rem]">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit();
                }}
                className="space-y-7"
              >
                <div className="space-y-2 text-center md:text-left">
                  <p className="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
                    Keryx
                  </p>
                  <h1 className="font-heading text-2xl font-semibold tracking-tight">
                    {needsSetup
                      ? t("auth.setup.title")
                      : t("auth.login.welcome")}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {needsSetup
                      ? t("auth.setup.subtitle", { appName: "Keryx" })
                      : t("auth.login.subtitle", { appName: "Keryx" })}
                  </p>
                </div>

                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}

                {needsSetup ? (
                  <div className="space-y-2">
                    <Label htmlFor="login-name">Name</Label>
                    <Input
                      id="login-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                    />
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    aria-invalid={Boolean(fieldErrors.email)}
                  />
                  {fieldErrors.email ? (
                    <p className="text-xs text-destructive">
                      {fieldErrors.email}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={
                      needsSetup ? "new-password" : "current-password"
                    }
                    minLength={needsSetup ? 8 : 1}
                    aria-invalid={Boolean(fieldErrors.password)}
                  />
                  {fieldErrors.password ? (
                    <p className="text-xs text-destructive">
                      {fieldErrors.password}
                    </p>
                  ) : null}
                </div>

                {needsSetup ? (
                  <div className="space-y-2">
                    <Label htmlFor="login-confirm-password">
                      Confirm password
                    </Label>
                    <Input
                      id="login-confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      autoComplete="new-password"
                      aria-invalid={Boolean(fieldErrors.confirmPassword)}
                    />
                    {fieldErrors.confirmPassword ? (
                      <p className="text-xs text-destructive">
                        {fieldErrors.confirmPassword}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? needsSetup
                      ? t("auth.setup.creatingAccount")
                      : t("auth.login.signingIn")
                    : needsSetup
                      ? t("auth.setup.button")
                      : t("auth.login.button")}
                </Button>
              </form>
            </div>
          </div>

          <div className="relative hidden min-h-0 overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.7),rgba(250,246,239,0.95))] md:aspect-[2/3] md:flex">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,250,235,0.96),rgba(240,241,235,0.72)_40%,rgba(225,236,228,0.38)_100%)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
