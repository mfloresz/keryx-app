import { Suspense } from "react";
import { getInviteByToken } from "@/lib/db/queries";
import { InviteRegistrationClient } from "./invite-registration-client";

async function InviteRegistrationContent({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  const [{ token }, { email }] = await Promise.all([params, searchParams]);
  const invite = await getInviteByToken(token);

  if (
    !invite ||
    invite.usedAt ||
    new Date(invite.expiresAt).getTime() < Date.now()
  ) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          Invitación inválida
        </h1>
        <p className="text-sm text-muted-foreground">
          Este enlace ya no es válido. Solicita una nueva invitación a un
          administrador.
        </p>
      </>
    );
  }

  return (
    <InviteRegistrationClient
      email={invite.email ?? email ?? ""}
      token={token}
    />
  );
}

export default function InviteRegistrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            Verificando invitación…
          </h1>
          <p className="text-sm text-muted-foreground">
            Espera un momento mientras validamos tu enlace.
          </p>
        </>
      }
    >
      <InviteRegistrationContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
