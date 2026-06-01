"use client";

import { ChevronUp, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import type { AuthUser } from "@/lib/auth/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { LoaderIcon } from "./icons";
import { toast } from "./toast";

function emailToHue(email: string): number {
  let hash = 0;
  for (const char of email) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

export function SidebarUserNav({ user }: { user: AuthUser }) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const [isSigningOut, setIsSigningOut] = useState(false);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="h-8 px-2 rounded-lg bg-transparent text-sidebar-foreground/70 transition-colors duration-150 hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              data-testid="user-nav-button"
            >
              <div
                className="size-5 shrink-0 rounded-full ring-1 ring-sidebar-border/50"
                style={{
                  background: `linear-gradient(135deg, oklch(0.35 0.08 ${emailToHue(user.email ?? "")}), oklch(0.25 0.05 ${emailToHue(user.email ?? "") + 40}))`,
                }}
              />
              <span className="truncate text-[13px]" data-testid="user-email">
                {user.email}
              </span>
              <ChevronUp className="ml-auto size-3.5 text-sidebar-foreground/50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-popper-anchor-width) rounded-lg border border-border/60 bg-card/95 backdrop-blur-xl shadow-[var(--shadow-float)]"
            data-testid="user-nav-menu"
            side="top"
          >
            <DropdownMenuItem
              className="cursor-pointer text-[13px]"
              data-testid="user-nav-item-theme"
              onSelect={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              {`Toggle ${resolvedTheme === "light" ? "dark" : "light"} mode`}
            </DropdownMenuItem>
            {user.role === "admin" && (
              <DropdownMenuItem
                className="cursor-pointer text-[13px]"
                onSelect={() => router.push("/admin")}
              >
                <ShieldCheckIcon className="size-4" />
                <span>Administración</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild data-testid="user-nav-item-auth">
              <button
                className="w-full cursor-pointer text-[13px]"
                disabled={isSigningOut}
                onClick={async () => {
                  if (isSigningOut) {
                    return;
                  }

                  setIsSigningOut(true);

                  try {
                    await fetch("/api/session/logout", { method: "POST" });
                    router.push("/login");
                    router.refresh();
                  } catch {
                    toast({
                      type: "error",
                      description: "No se pudo cerrar la sesión.",
                    });
                  } finally {
                    setIsSigningOut(false);
                  }
                }}
                type="button"
              >
                {isSigningOut ? (
                  <span className="inline-flex items-center gap-2">
                    <LoaderIcon />
                    Cerrando sesión...
                  </span>
                ) : (
                  "Cerrar sesión"
                )}
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
