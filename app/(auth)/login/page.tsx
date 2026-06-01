"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useActionState, useEffect, useState } from "react";
import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { type LoginActionState, login } from "../actions";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);

  const [state, formAction] = useActionState<LoginActionState, FormData>(
    login,
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status === "failed") {
      toast({ type: "error", description: "Credenciales inválidas." });
    } else if (state.status === "invalid_data") {
      toast({
        type: "error",
        description:
          "Revisa el email y usa una contraseña de al menos 8 caracteres.",
      });
    } else if (state.status === "success") {
      setIsSuccessful(true);
      router.refresh();
      router.push(redirectTo.startsWith("/") ? redirectTo : "/");
    }
  }, [redirectTo, router, state.status]);

  const handleSubmit = (formData: FormData) => {
    setEmail(formData.get("email") as string);
    formAction(formData);
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Inicia sesión</h1>
      <p className="text-sm text-muted-foreground">
        Accede con una cuenta invitada por un administrador.
      </p>
      <AuthForm action={handleSubmit} defaultEmail={email}>
        <SubmitButton isSuccessful={isSuccessful}>Entrar</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          ¿Aún no tienes acceso? Solicita un enlace de invitación a un admin.
        </p>
        <p className="text-center text-[13px] text-muted-foreground">
          ¿Ya tienes un enlace? Ábrelo directamente desde tu email.
        </p>
        <p className="text-center text-[13px] text-muted-foreground">
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/register"
          >
            Ver instrucciones de registro
          </Link>
        </p>
      </AuthForm>
    </>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            Cargando acceso…
          </h1>
          <p className="text-sm text-muted-foreground">
            Espera un momento mientras preparamos el formulario.
          </p>
        </>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
