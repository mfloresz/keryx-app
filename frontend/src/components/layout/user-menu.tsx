import { useNavigate } from "@tanstack/react-router";
import {
  LanguagesIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  ShieldIcon,
  SunIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useTheme, type Theme } from "#/composables/use-theme";
import { useI18n } from "#/i18n";
import { useAuth } from "#/stores/auth";

interface UserMenuProps {
  onOpenSettings: () => void;
  onOpenAdmin?: () => void;
}

const THEME_OPTIONS: Array<{ value: Theme; icon: typeof SunIcon; label: string }> = [
  { value: "light", icon: SunIcon, label: "Light" },
  { value: "dark", icon: MoonIcon, label: "Dark" },
  { value: "system", icon: MonitorIcon, label: "System" },
];

export function UserMenu({ onOpenSettings, onOpenAdmin }: UserMenuProps) {
  const { session, userName, userEmail, avatarUrl, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { locale, toggleLocale } = useI18n();
  const navigate = useNavigate();

  const displayName = userName || (userEmail ? userEmail.split("@")[0] : "") || "User";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="User menu"
            className="group flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          />
        }
      >
        <Avatar className="size-8 shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-xs">{initial}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
          <span className="block truncate text-sm font-medium">{displayName}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {userEmail}
          </span>
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="right" align="start" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2.5 font-normal">
          <Avatar className="size-9 shrink-0">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-xs">{initial}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-medium">{displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {userEmail}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onOpenSettings}>
          <SettingsIcon className="mr-2 size-4" />
          Settings
        </DropdownMenuItem>
        {onOpenAdmin ? (
          <DropdownMenuItem onClick={onOpenAdmin}>
            <ShieldIcon className="mr-2 size-4" />
            Admin
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={() => {
            toggleLocale();
          }}
        >
          <LanguagesIcon className="mr-2 size-4" />
          {locale === "en" ? "Español" : "English"}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            void logout().then(() => navigate({ to: "/login" }));
          }}
        >
          <LogOutIcon className="mr-2 size-4" />
          Log out
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        <div className="flex items-center justify-center gap-1 p-1.5">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.label}
              aria-label={option.label}
              aria-pressed={theme === option.value}
              onClick={() => setTheme(option.value)}
              className={
                theme === option.value
                  ? "flex size-8 items-center justify-center rounded-md bg-muted text-foreground shadow-sm"
                  : "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }
            >
              <option.icon className="size-4" />
            </button>
          ))}
        </div>
        <span className="sr-only">{session?.user.role}</span>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
