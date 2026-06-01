import { requireRole } from "@/app/(auth)/auth";
import {
  getAiSettings,
  listInvitesForAdmin,
  listUsersForAdmin,
} from "@/lib/db/queries";
import { getModelsForProvider } from "@/lib/ai/models";
import {
  createInviteAction,
  deleteUserAction,
  disableUserAction,
  updateAiSettingsAction,
} from "./actions";

const providerLabels = {
  vercel_gateway: "Vercel AI Gateway",
  opencode_go: "OpenCode GO",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; invite?: string }>;
}) {
  const session = await requireRole("admin");
  const [
    { message, invite },
    settings,
    users,
    invites,
    gatewayModels,
    opencodeModels,
  ] = await Promise.all([
    searchParams,
    getAiSettings(),
    listUsersForAdmin(),
    listInvitesForAdmin(),
    getModelsForProvider("vercel_gateway"),
    getModelsForProvider("opencode_go"),
  ]);

  const modelsByProvider = {
    vercel_gateway: gatewayModels,
    opencode_go: opencodeModels,
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Administración
        </h1>
        <p className="text-sm text-muted-foreground">
          Gestiona invitaciones, usuarios y el proveedor global de IA. Las API
          keys nunca se muestran aquí: solo se leen desde variables de entorno.
        </p>
      </div>

      {message && (
        <div className="rounded-xl border border-border/50 bg-muted/40 p-4 text-sm text-muted-foreground">
          {message === "invite_created" && (
            <p>Invitación creada correctamente.</p>
          )}
          {message === "settings_updated" && (
            <p>Configuración de IA actualizada.</p>
          )}
          {message === "user_updated" && <p>Estado del usuario actualizado.</p>}
          {message === "user_deleted" && <p>Usuario eliminado.</p>}
          {invite && (
            <div className="mt-3 break-all rounded-lg border border-border/50 bg-background p-3 font-mono text-xs text-foreground">
              {invite}
            </div>
          )}
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <form
          action={createInviteAction}
          className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm"
        >
          <h2 className="text-lg font-medium">Crear invitación</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada enlace es de un solo uso y queda asociado a un correo.
          </p>

          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm">
              <span>Email</span>
              <input
                className="h-10 rounded-lg border border-border bg-background px-3"
                name="email"
                required
                type="email"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span>Rol</span>
                <select
                  className="h-10 rounded-lg border border-border bg-background px-3"
                  defaultValue="user"
                  name="role"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </label>

              <label className="grid gap-2 text-sm">
                <span>Expira en días</span>
                <input
                  className="h-10 rounded-lg border border-border bg-background px-3"
                  defaultValue="7"
                  max="30"
                  min="1"
                  name="expiresInDays"
                  required
                  type="number"
                />
              </label>
            </div>

            <button
              className="inline-flex h-10 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
              type="submit"
            >
              Crear enlace
            </button>
          </div>
        </form>

        <form
          action={updateAiSettingsAction}
          className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm"
        >
          <h2 className="text-lg font-medium">
            Proveedor y modelos para users
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Los admins no tienen restricciones. Los users solo verán los modelos
            marcados abajo para el proveedor activo.
          </p>

          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm">
              <span>Proveedor activo</span>
              <select
                className="h-10 rounded-lg border border-border bg-background px-3"
                defaultValue={settings.activeProvider}
                name="activeProvider"
              >
                {Object.entries(providerLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-2 rounded-xl border border-border/50 bg-muted/30 p-4">
              <span className="text-sm font-medium">Modelos permitidos</span>
              {Object.entries(modelsByProvider).map(
                ([providerKey, providerModels]) => (
                  <div
                    key={providerKey}
                    className="grid gap-2 rounded-lg border border-border/40 bg-background/60 p-3"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {
                        providerLabels[
                          providerKey as keyof typeof providerLabels
                        ]
                      }
                    </span>
                    {providerModels.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No hay modelos disponibles para este proveedor con la
                        configuración actual.
                      </p>
                    ) : (
                      providerModels.map((model) => (
                        <label
                          key={`${providerKey}:${model.id}`}
                          className="flex items-start gap-3 text-sm"
                        >
                          <input
                            defaultChecked={settings.userAllowedModelIds.includes(
                              model.id,
                            )}
                            name="allowedModels"
                            type="checkbox"
                            value={model.id}
                          />
                          <span>
                            <span className="font-medium text-foreground">
                              {model.name}
                            </span>
                            <span className="block text-muted-foreground">
                              {model.id}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                ),
              )}
            </div>

            <button
              className="inline-flex h-10 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
              type="submit"
            >
              Guardar configuración
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <h2 className="text-lg font-medium">Usuarios</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sesión actual:{" "}
          <span className="font-medium text-foreground">
            {session.user.email}
          </span>
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-3 pr-4 font-medium">Email</th>
                <th className="pb-3 pr-4 font-medium">Rol</th>
                <th className="pb-3 pr-4 font-medium">Estado</th>
                <th className="pb-3 pr-4 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-t border-border/40 align-top"
                >
                  <td className="py-3 pr-4">{user.email}</td>
                  <td className="py-3 pr-4">{user.role}</td>
                  <td className="py-3 pr-4">{user.status}</td>
                  <td className="py-3 pr-4">
                    <div className="flex flex-wrap gap-2">
                      {user.id !== session.user.id && (
                        <>
                          <form action={disableUserAction}>
                            <input
                              name="userId"
                              type="hidden"
                              value={user.id}
                            />
                            <input
                              name="status"
                              type="hidden"
                              value={
                                user.status === "active" ? "disabled" : "active"
                              }
                            />
                            <button
                              className="rounded-lg border border-border px-3 py-1.5"
                              type="submit"
                            >
                              {user.status === "active"
                                ? "Desactivar"
                                : "Reactivar"}
                            </button>
                          </form>

                          <form action={deleteUserAction}>
                            <input
                              name="userId"
                              type="hidden"
                              value={user.id}
                            />
                            <button
                              className="rounded-lg border border-destructive/30 px-3 py-1.5 text-destructive"
                              type="submit"
                            >
                              Eliminar
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <h2 className="text-lg font-medium">Invitaciones recientes</h2>
        <div className="mt-4 grid gap-3">
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no hay invitaciones.
            </p>
          ) : (
            invites.slice(0, 10).map((invite) => (
              <div
                key={invite.id}
                className="rounded-xl border border-border/40 bg-muted/20 p-3 text-sm"
              >
                <div className="font-medium text-foreground">
                  {invite.email}
                </div>
                <div className="text-muted-foreground">
                  rol: {invite.role} · expira:{" "}
                  {new Date(invite.expiresAt).toLocaleString()} · usado:{" "}
                  {invite.usedAt ? "sí" : "no"}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
