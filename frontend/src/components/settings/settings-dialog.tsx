import { useNavigate } from "@tanstack/react-router";
import {
  CameraIcon,
  KeyRoundIcon,
  SettingsIcon,
  ShieldIcon,
  Trash2Icon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { ScrollArea } from "#/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Separator } from "#/components/ui/separator";
import {
  appFontSizes,
  appFonts,
  useAppFont,
  type AppFont,
  type AppFontSize,
} from "#/composables/use-app-font";
import { useTheme, type Theme } from "#/composables/use-theme";
import { useI18n } from "#/i18n";
import { useAuth } from "#/stores/auth";
import { useChatStore } from "#/stores/chat";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsSection = "general" | "account" | "privacy";

const NAV_ITEMS: Array<{
  key: SettingsSection;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "general", label: "settings.sections.general", icon: SettingsIcon },
  { key: "account", label: "settings.sections.account", icon: UserIcon },
  { key: "privacy", label: "settings.sections.privacy", icon: ShieldIcon },
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
  const { chats, deleteAllChats } = useChatStore();
  const navigate = useNavigate();

  const [activeSection, setActiveSection] =
    React.useState<SettingsSection>("general");
  const [name, setName] = React.useState("");
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = React.useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [passwordError, setPasswordError] = React.useState("");
  const [passwordSuccess, setPasswordSuccess] = React.useState("");
  const [profileSuccess, setProfileSuccess] = React.useState("");
  const [isSavingProfile, setIsSavingProfile] = React.useState(false);
  const [isChangingPassword, setIsChangingPassword] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [isDeletingAll, setIsDeletingAll] = React.useState(false);

  // Font changes are staged and only applied when the dialog is saved, so
  // Cancel leaves the current font untouched.
  const [draftFont, setDraftFont] = React.useState<AppFont>(appFont);
  const [draftFontSize, setDraftFontSize] =
    React.useState<AppFontSize>(appFontSize);

  const avatarInputRef = React.useRef<HTMLInputElement>(null);

  // Reset the form each time the dialog opens. Adjusting state while
  // rendering (instead of in an effect) keeps the fields in sync with the
  // `open` prop without an extra paint.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setActiveSection("general");
      setName(userName);
      setDraftFont(appFont);
      setDraftFontSize(appFontSize);
      setAvatarFile(null);
      setAvatarPreview(null);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError("");
      setPasswordSuccess("");
      setProfileSuccess("");
    }
  }

  async function handleSaveProfile() {
    setIsSavingProfile(true);
    setProfileSuccess("");
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
      setProfileSuccess(t("settings.account.profileSaved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update profile",
      );
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleRemoveAvatar() {
    try {
      await updateProfile({ removeAvatar: true });
      setAvatarPreview(null);
      setAvatarFile(null);
      setProfileSuccess(t("settings.account.avatarRemoved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove avatar",
      );
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
    setPasswordSuccess("");
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
      setPasswordSuccess(t("settings.account.passwordChanged"));
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

  function handleSave() {
    setFont(draftFont);
    setFontSize(draftFontSize);
    onOpenChange(false);
  }

  const preview = avatarPreview ?? avatarUrl ?? undefined;
  const themeItems: Record<string, string> = {
    light: t("settings.themeLight"),
    dark: t("settings.themeDark"),
    system: t("settings.themeSystem"),
  };
  const fontItems: Record<string, string> = Object.fromEntries(
    appFonts.map((font) => [font.value, font.label]),
  );
  const fontSizeItems: Record<string, string> = Object.fromEntries(
    appFontSizes.map((size) => [size.value, size.label]),
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>{t("settings.title")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("settings.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex h-[400px]">
            {/* Sidebar */}
            <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-border bg-muted/50 px-2 py-4">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  className={
                    activeSection === item.key
                      ? "flex w-full items-center gap-2.5 rounded-md bg-muted px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors"
                      : "flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                  }
                >
                  <item.icon className="size-4 shrink-0" />
                  {t(item.label)}
                </button>
              ))}
            </nav>

            {/* Content */}
            <ScrollArea className="flex-1">
              <div className="space-y-6 p-6">
                {activeSection === "general" ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="settings-theme">
                        {t("settings.theme")}
                      </Label>
                      <Select
                        items={themeItems}
                        value={theme}
                        onValueChange={(value) => setTheme(value as Theme)}
                      >
                        <SelectTrigger id="settings-theme" className="w-full">
                          <SelectValue
                            placeholder={t("settings.themePlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="light">
                            {t("settings.themeLight")}
                          </SelectItem>
                          <SelectItem value="dark">
                            {t("settings.themeDark")}
                          </SelectItem>
                          <SelectItem value="system">
                            {t("settings.themeSystem")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.themeHint")}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="settings-font">
                        {t("settings.appFont")}
                      </Label>
                      <Select
                        items={fontItems}
                        value={draftFont}
                        onValueChange={(value) =>
                          setDraftFont(value as AppFont)
                        }
                      >
                        <SelectTrigger id="settings-font" className="w-full">
                          <SelectValue
                            placeholder={t("settings.appFontPlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {appFonts.map((font) => (
                            <SelectItem key={font.value} value={font.value}>
                              {font.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.appFontHint")}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="settings-font-size">
                        {t("settings.appFontSize")}
                      </Label>
                      <Select
                        items={fontSizeItems}
                        value={draftFontSize}
                        onValueChange={(value) =>
                          setDraftFontSize(value as AppFontSize)
                        }
                      >
                        <SelectTrigger
                          id="settings-font-size"
                          className="w-full"
                        >
                          <SelectValue
                            placeholder={t("settings.appFontSizePlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {appFontSizes.map((size) => (
                            <SelectItem key={size.value} value={size.value}>
                              {size.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.appFontSizeHint")}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>{t("settings.language")}</Label>
                      <div className="flex items-center gap-2">
                        {(["en", "es"] as const).map((code) => (
                          <button
                            key={code}
                            type="button"
                            onClick={() => setLocale(code)}
                            className={
                              locale === code
                                ? "rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors"
                                : "rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                            }
                          >
                            {code === "en" ? "English" : "Español"}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.languageHint")}
                      </p>
                    </div>
                  </>
                ) : null}

                {activeSection === "account" ? (
                  <>
                    <div className="space-y-2">
                      <Label>{t("settings.account.avatarLabel")}</Label>
                      <div className="flex items-center gap-4">
                        <div className="relative">
                          <Avatar className="size-16 text-xl">
                            {preview ? (
                              <AvatarImage src={preview} alt="" />
                            ) : null}
                            <AvatarFallback>
                              {(name || userName || userEmail || "U")
                                .charAt(0)
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <button
                            type="button"
                            aria-label={t("settings.account.changePhoto")}
                            onClick={() => avatarInputRef.current?.click()}
                            className="absolute -right-1 -bottom-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                          >
                            <CameraIcon className="size-3.5" />
                          </button>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() => avatarInputRef.current?.click()}
                          >
                            <CameraIcon className="size-3.5" />
                            {t("settings.account.changePhoto")}
                          </Button>
                          {avatarUrl ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-2 text-destructive"
                              onClick={() => void handleRemoveAvatar()}
                            >
                              {t("settings.account.removePhoto")}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="hidden"
                        onChange={(event) => void handleAvatarSelected(event)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="settings-name">
                        {t("settings.account.nameLabel")}
                      </Label>
                      <Input
                        id="settings-name"
                        type="text"
                        value={name}
                        placeholder={t("settings.account.namePlaceholder")}
                        onChange={(event) => setName(event.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("settings.account.nameHint")}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="settings-email">
                        {t("settings.account.emailLabel")}
                      </Label>
                      <Input
                        id="settings-email"
                        type="email"
                        value={userEmail}
                        disabled
                        className="opacity-60"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("settings.account.emailHint")}
                      </p>
                    </div>

                    {profileSuccess ? (
                      <p className="text-sm text-foreground">
                        {profileSuccess}
                      </p>
                    ) : null}

                    <Button
                      disabled={isSavingProfile}
                      onClick={() => void handleSaveProfile()}
                    >
                      {isSavingProfile
                        ? t("settings.account.saving")
                        : t("settings.account.saveProfile")}
                    </Button>

                    <Separator className="my-4" />

                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <KeyRoundIcon className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-medium">
                          {t("settings.account.changePassword")}
                        </h3>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="settings-current-password">
                          {t("settings.account.currentPassword")}
                        </Label>
                        <Input
                          id="settings-current-password"
                          type="password"
                          value={currentPassword}
                          placeholder={t(
                            "settings.account.currentPasswordPlaceholder",
                          )}
                          onChange={(event) =>
                            setCurrentPassword(event.target.value)
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="settings-new-password">
                          {t("settings.account.newPassword")}
                        </Label>
                        <Input
                          id="settings-new-password"
                          type="password"
                          value={newPassword}
                          placeholder={t(
                            "settings.account.newPasswordPlaceholder",
                          )}
                          onChange={(event) =>
                            setNewPassword(event.target.value)
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="settings-confirm-password">
                          {t("settings.account.confirmNewPassword")}
                        </Label>
                        <Input
                          id="settings-confirm-password"
                          type="password"
                          value={confirmPassword}
                          placeholder={t(
                            "settings.account.confirmNewPasswordPlaceholder",
                          )}
                          onChange={(event) =>
                            setConfirmPassword(event.target.value)
                          }
                        />
                      </div>

                      {passwordError ? (
                        <p className="text-sm text-destructive">
                          {passwordError}
                        </p>
                      ) : null}

                      {passwordSuccess ? (
                        <p className="text-sm text-foreground">
                          {passwordSuccess}
                        </p>
                      ) : null}

                      <Button
                        variant="secondary"
                        disabled={isChangingPassword}
                        onClick={() => void handleChangePassword()}
                      >
                        {isChangingPassword
                          ? t("settings.account.changing")
                          : t("settings.account.updatePassword")}
                      </Button>
                    </div>
                  </>
                ) : null}

                {activeSection === "privacy" ? (
                  <div className="space-y-2">
                    <Label>{t("settings.data")}</Label>
                    <Button
                      variant="destructive"
                      className="w-full gap-2"
                      disabled={chats.length === 0}
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2Icon className="size-4" />
                      {t("settings.deleteAllChats")}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.deleteHint")}
                    </p>
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("app.cancel")}
            </Button>
            <Button onClick={handleSave}>{t("app.save")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("settings.deleteConfirmTitle")}
        description={t("settings.deleteConfirmDescription")}
        confirmLabel={
          isDeletingAll ? t("settings.deleting") : t("settings.confirmDelete")
        }
        cancelLabel={t("app.cancel")}
        destructive
        onConfirm={() => void handleDeleteAllChats()}
      />
    </>
  );
}
