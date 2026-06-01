"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { type RegisterActionState, register } from "../../actions";

export function InviteRegistrationClient({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const router = useRouter();
  const [isSuccessful, setIsSuccessful] = useState(false);

  const [state, formAction] = useActionState<RegisterActionState, FormData>(
    register,
    { status: "idle" }
  );

  useEffect(() => {
    if (state.status === "invite_invalid") {
      toast({ type: "error", description: "La invitación no es válida." });
    } else if (state.status === "invite_expired") {
      toast({ type: "error", description: "La invitación expiró." });
    } else if (state.status === "invite_used") {
      toast({ type: "error", description: "La invitación ya fue usada." });
    } else if (state.status === "invalid_data") {
      toast({
        type: "error",
        description: "Usa una contraseña de al menos 8 caracteres.",
      });
    } else if (state.status === "success") {
      setIsSuccessful(true);
      router.refresh();
      router.push("/");
    }
  }, [router, state.status]);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Completa tu registro
      </h1>
      <p className="text-sm text-muted-foreground">
        Define tu contraseña para activar tu cuenta.
      </p>
      <AuthForm
        action={formAction}
        defaultEmail={email}
        emailReadOnly={Boolean(email)}
        hiddenFields={[{ name: "token", value: token }]}
      >
        <SubmitButton isSuccessful={isSuccessful}>Activar cuenta</SubmitButton>
      </AuthForm>
    </>
  );
}
