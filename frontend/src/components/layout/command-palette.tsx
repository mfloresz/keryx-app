import { useNavigate } from "@tanstack/react-router";
import { MessageCircleIcon, PlusIcon } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import { useI18n } from "#/i18n";
import { useChatStore } from "#/stores/chat";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useI18n();
  const { groups } = useChatStore();
  const navigate = useNavigate();

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t("command.searchPlaceholder")} />
      <CommandList>
        <CommandEmpty>{t("command.noResults")}</CommandEmpty>
        <CommandGroup heading={t("command.actions")}>
          <CommandItem
            value="new-chat"
            onSelect={() => {
              void navigate({ to: "/" });
              onOpenChange(false);
            }}
          >
            <PlusIcon className="mr-2 size-4" />
            {t("command.newChat")}
          </CommandItem>
        </CommandGroup>
        {groups.map((group) => (
          <CommandGroup
            key={group.id}
            heading={group.labelKey ? t(group.labelKey) : (group.label ?? group.id)}
          >
            {group.items.map((item) => (
              <CommandItem
                key={item.id}
                value={item.label}
                onSelect={() => {
                  void navigate({ to: "/chat/$id", params: { id: item.id } });
                  onOpenChange(false);
                }}
              >
                <MessageCircleIcon className="mr-2 size-4" />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
