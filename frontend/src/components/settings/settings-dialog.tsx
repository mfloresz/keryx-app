import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { CameraIcon, KeyRoundIcon, Trash2Icon, UserIcon } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  appFontSizes,
  appFonts,
  useAppFont,
} from "#/composables/use-app-font";
import { useTheme, type Theme } from "#/composables/use-theme";
import { useI18n } from "#/i18n";
import { useAuth } from "#/stores/auth";
import { useChatStore } from "#/stores/chat";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

async function compressAvatarToJpeg(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.8),
  );
  if (!blob) return file;
  return new File([blob], "avatar.jpg", { type: "image/jpeg" });
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { appFont, appFontSize, setFont, setFontSize } = useAppFont();
  const { locale, setLocale } = useI18n();
  const { userName, userEmail, avatarUrl, updateProfile, changePassword } =
    useAuth();
  const { deleteAllChats } = useChatStore();
  const navigate = useNavigate();

  const [name, setName] = React.useState("");
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = React.useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [passwordError, setPasswordError] = React.useState("");
  const [isSavingProfile, setIsSavingProfile] = React.useState(false);
  const [isChangingPassword, setIsChangingPassword] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [isDeletingAll, setIsDeletingAll] = React.useState(false);

  // The form resets whenever the dialog opens. Keying the section on
  // `open` remounts it, so the fields start from a clean slate without
  // syncing state in an effect.
  const formKey = open ? "open" : "closed";

  async function handleSaveProfile() {
    setIsSavingProfile(true);
    try {
      const trimmed = name.trim();
      if (trimmed && trimmed !== userName) {
        await updateProfile({ name: trimmed });
      }
      if (avatarFile) {
        await updateProfile({ avatar: avatarFile });
      }
      setAvatarFile(null);
      setAvatarPreview(null);
      toast.success("Profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleRemoveAvatar() {
    try {
      await updateProfile({ removeAvatar: true });
      setAvatarPreview(null);
      setAvatarFile(null);
      toast.success("Avatar removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove avatar");
    }
  }

  async function handleAvatarSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      input.value = "";
      return;
    }
    try {
      const compressed = await compressAvatarToJpeg(file);
      setAvatarFile(compressed);
      setAvatarPreview(URL.createObjectURL(compressed));
    } catch {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    } finally {
      input.value = "";
    }
  }

  async function handleChangePassword() {
    setPasswordError("");
    if (!currentPassword || !newPassword) {
      setPasswordError("All fields are required");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    setIsChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "Failed to change password",
      );
    } finally {
      setIsChangingPassword(false);
    }
  }

  async function handleDeleteAllChats() {
    if (isDeletingAll) return;
    setIsDeletingAll(true);
    try {
      await deleteAllChats();
      setDeleteOpen(false);
      onOpenChange(false);
      void navigate({ to: "/" });
    } catch {
      toast.error("Failed to delete all chats");
    } finally {
      setIsDeletingAll(false);
    }
  }

  const preview = avatarPreview ?? avatarUrl ?? undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settings.title")}</DialogTitle>
            <DialogDescription>{t("settings.description")}</DialogDescription>
          </DialogHeader>

          <div key={formKey} className="space-y-6 py-2">
            {/* Appearance */}
            <section className="space-y-3">
              <h3 className="text-sm font-medium">{t("settings.theme")}</h3>
              <div className="flex gap-2">
                {THEME_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={theme === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="settings-font">
                    {t("settings.fontLabel")}
                  </Label>
                  <Select
                    value={appFont}
                    onValueChange={(value) => setFont(value as never)}
                  >
                    <SelectTrigger id="settings-font" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {appFonts.map((font) => (
                        <SelectItem key={font.value} value={font.value}>
                          {font.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="settings-font-size">
                    {t("settings.fontSizeLabel")}
                  </Label>
                  <Select
                    value={appFontSize}
                    onValueChange={(value) => setFontSize(value as never)}
                  >
                    <SelectTrigger id="settings-font-size" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {appFontSizes.map((size) => (
                        <SelectItem key={size.value} value={size.value}>
                          {size.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                {(["en", "es"] as const).map((code) => (
                  <Button
                    key={code}
                    type="button"
                    variant={locale === code ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLocale(code)}
                  >
                    {code === "en" ? "English" : "Español"}
                  </Button>
                ))}
              </div>
            </section>

            {/* Profile */}
            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <UserIcon className="size-4" aria-hidden />
                Account
              </h3>
              <div className="flex items-center gap-3">
                <Avatar className="size-14">
                  {preview ? <AvatarImage src={preview} alt="" /> : null}
                  <AvatarFallback>
                    {(userName || userEmail || "U").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                    <CameraIcon className="size-4" aria-hidden />
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(event) => void handleAvatarSelected(event)}
                    />
                  </label>
                  {avatarUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRemoveAvatar()}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-name">Name</Label>
                <Input
                  id="settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <Button
                size="sm"
                disabled={isSavingProfile}
                onClick={() => void handleSaveProfile()}
              >
                {isSavingProfile ? "Saving…" : "Save profile"}
              </Button>
            </section>

            {/* Password */}
            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <KeyRoundIcon className="size-4" aria-hidden />
                Password
              </h3>
              <div className="space-y-1.5">
                <Label htmlFor="settings-current-password">
                  Current password
                </Label>
                <Input
                  id="settings-current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-new-password">New password</Label>
                <Input
                  id="settings-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-confirm-password">
                  Confirm new password
                </Label>
                <Input
                  id="settings-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
              {passwordError ? (
                <p className="text-sm text-destructive">{passwordError}</p>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={isChangingPassword}
                onClick={() => void handleChangePassword()}
              >
                {isChangingPassword ? "Changing…" : "Change password"}
              </Button>
            </section>

            {/* Data */}
            <section className="space-y-3">
              <h3 className="text-sm font-medium">Data</h3>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon className="mr-2 size-4" aria-hidden />
                Delete all chats
              </Button>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete all chats"
        description="This permanently removes every chat. It cannot be undone."
        confirmLabel={t("app.delete")}
        destructive
        onConfirm={() => void handleDeleteAllChats()}
      />
    </>
  );
}
