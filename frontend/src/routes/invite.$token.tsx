import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { AuthShell } from "#/components/auth/auth-shell";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useI18n } from "#/i18n";
import { getAuthAdapter } from "#/services/runtime";
import { useAuth } from "#/stores/auth";

export const Route = createFileRoute("/invite/$token")({
  component: InvitePage,
});

interface InvitationPayload {
  valid: boolean;
  email?: string;
  role?: string;
  modelIds?: string[];
}

function InvitePage() {
  const { token } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { setSession } = useAuth();

  const [invitation, setInvitation] = React.useState<InvitationPayload | null>(
    null,
  );
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");

  React.useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    void (async () => {
      setIsLoading(true);
      setLoadError("");
      try {
        const response = await fetch("/api/invitations/validate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            typeof payload?.message === "string"
              ? payload.message
              : t("auth.invite.loadError"),
          );
        }
        setInvitation((await response.json()) as InvitationPayload);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setLoadError(t("auth.invite.requestTimedOut"));
        } else {
          setLoadError(
            err instanceof Error ? err.message : t("auth.invite.loadError"),
          );
        }
      } finally {
        clearTimeout(timeoutId);
        setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [token, t]);

  async function handleAccept() {
    if (isSubmitting) return;
    setError("");

    if (!password.trim()) {
      setError(t("auth.invite.passwordRequired"));
      return;
    }
    if (!confirmPassword.trim()) {
      setError(t("auth.invite.confirmPasswordRequired"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.invite.passwordMinLength"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.invite.passwordsDoNotMatch"));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof payload?.message === "string"
            ? payload.message
            : t("auth.invite.error"),
        );
      }

      if (invitation?.email) {
        const auth = await getAuthAdapter();
        const session = await auth.login(invitation.email, password);
        setSession(session);
      }
      void navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.invite.error"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      imageAlt={t("auth.login.heroAlt")}
      imageSrc="/auth/login-hero.webp"
    >
      <div className="space-y-7">
        <div className="space-y-2 text-center md:text-left">
          <p className="text-xs font-semibold tracking-[0.32em] text-muted-foreground uppercase">
            Keryx
          </p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {t("auth.invite.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("auth.invite.subtitle", { appName: "Keryx" })}
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
        ) : loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleAccept();
            }}
            className="space-y-4"
          >
            {invitation?.email ? (
              <p className="text-sm">
                {t("auth.invite.emailLabel", {
                  email: invitation.email,
                })}
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="invite-password">Password</Label>
              <Input
                id="invite-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-confirm-password">Confirm password</Label>
              <Input
                id="invite-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t("app.loading") : t("auth.invite.acceptButton")}
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
