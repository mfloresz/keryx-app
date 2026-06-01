import Link from "next/link";

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Registro solo por invitación
      </h1>
      <p className="text-sm text-muted-foreground">
        Un administrador debe generar un enlace único asociado a tu correo.
      </p>

      <div className="rounded-xl border border-border/50 bg-muted/40 p-4 text-sm text-muted-foreground">
        <ol className="list-decimal space-y-2 pl-5">
          <li>El admin crea una invitación para tu email.</li>
          <li>Recibes un enlace privado de un solo uso.</li>
          <li>Abres el enlace y eliges tu contraseña.</li>
          <li>Listo: tu cuenta queda activada.</li>
        </ol>
      </div>

      <p className="text-center text-[13px] text-muted-foreground">
        ¿Ya tienes cuenta?{" "}
        <Link
          className="text-foreground underline-offset-4 hover:underline"
          href="/login"
        >
          Inicia sesión
        </Link>
      </p>
    </>
  );
}
