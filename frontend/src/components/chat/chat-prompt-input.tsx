import * as React from "react";
import {
  BotIcon,
  CheckIcon,
  FolderIcon,
  GlobeIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";

import { Attachment, AttachmentMedia } from "#/components/ui/attachment";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "#/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { useI18n } from "#/i18n";
import type {
  ChatAgent,
  ChatProject,
  ModelPreset,
  PendingAttachment,
} from "#/components/chat/types";

const DOCUMENT_ACCEPT =
  ".pdf,.txt,.md,.doc,.docx,.docm,.odt,.ods,.odp,.ppt,.pptx,.pptm,.ppsx,.ppsm,.xls,.xlsx,.xlsm,.rtf,.epub,.csv,.json,.xml,.html,.css,.js,.ts,.py,.java,.cpp,.go,.rs";

const PRESET_DESCRIPTION_KEYS: Record<string, { title: string; subtitle: string }> = {
  fast: { title: "chat.presetFast", subtitle: "chat.presetFastDesc" },
  reflect: { title: "chat.presetReflect", subtitle: "chat.presetReflectDesc" },
  extended_context: {
    title: "chat.presetExtended",
    subtitle: "chat.presetExtendedDesc",
  },
};

export interface ChatPromptInputProps {
  status: "ready" | "streaming" | "submitted" | "error";
  preset: string;
  presets: ModelPreset[];
  webSearch?: boolean;
  webSearchGloballyEnabled?: boolean;
  agents?: ChatAgent[];
  agentId?: string | null;
  projects?: ChatProject[];
  projectId?: string | null;
  onSubmit: (payload: {
    text: string;
    files: PendingAttachment[];
    webSearch: boolean;
  }) => void;
  onStop: () => void;
  onPresetChange: (preset: string) => void;
  onAgentChange: (agentId: string | null) => void;
  onProjectChange: (projectId: string | null) => void;
  onCreateProject: () => void;
}

export function ChatPromptInput({
  status,
  preset,
  presets,
  webSearch,
  webSearchGloballyEnabled,
  agents,
  agentId,
  projects,
  projectId,
  onSubmit,
  onStop,
  onPresetChange,
  onAgentChange,
  onProjectChange,
  onCreateProject,
}: ChatPromptInputProps) {
  const { t } = useI18n();
  const [text, setText] = React.useState("");
  const [files, setFiles] = React.useState<PendingAttachment[]>([]);
  const [useWebSearch, setUseWebSearch] = React.useState(webSearch ?? false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const selectedPreset = presets.find((p) => p.preset === preset);
  const modelSupportsImages = selectedPreset?.supportsImages ?? true;
  const selectedAgent = agents?.find((a) => a.id === agentId) ?? null;
  const selectedProject = projects?.find((p) => p.id === projectId) ?? null;

  // The base prompt is the default when nothing is selected, so the catalog
  // never lists a "general" agent; filter it defensively.
  const selectableAgents = (agents ?? []).filter(
    (a) => a.id !== "general" && a.builtinId !== "general",
  );

  const activePresetTitle = selectedPreset
    ? (PRESET_DESCRIPTION_KEYS[preset]?.title
        ? t(PRESET_DESCRIPTION_KEYS[preset].title)
        : selectedPreset.label)
    : preset;

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const next: PendingAttachment[] = [];
    for (const file of Array.from(fileList)) {
      next.push({
        id: `${file.name}-${file.size}-${next.length}`,
        file,
        filename: file.name,
        mediaType: file.type || "application/octet-stream",
      });
    }
    setFiles((current) => [...current, ...next].slice(0, 3));
  }

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    if (status === "streaming" || status === "submitted") return;

    onSubmit({ text: trimmed, files, webSearch: useWebSearch });
    setText("");
    setFiles([]);
  }

  function handlePresetChange(value: string) {
    onPresetChange(value);
    const next = presets.find((p) => p.preset === value);
    if (next && !next.supportsSearch) {
      setUseWebSearch(false);
    }
  }

  return (
    <div className="bg-background px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
      <InputGroup className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm focus-within:border-primary/30 focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary/10 transition-shadow">
        {/* Attachments row */}
        {files.length > 0 ? (
          <div className="order-first w-full px-3 pt-3">
            <div className="flex flex-wrap gap-2">
              {files.map((file) => (
                <Attachment key={file.id} size="sm">
                  <AttachmentMedia variant="icon">
                    <PaperclipIcon />
                  </AttachmentMedia>
                  <span className="max-w-40 truncate text-xs">{file.filename}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${file.filename}`}
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((f) => f.id !== file.id),
                      )
                    }
                  >
                    <XIcon />
                  </Button>
                </Attachment>
              ))}
            </div>
          </div>
        ) : null}

        {/* Textarea: always a full-width row stacked above the toolbar. */}
        <InputGroupTextarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={t("chat.inputPlaceholder")}
          aria-label={t("chat.inputPlaceholder")}
          className="resize-none"
        />

        {/* Left tools */}
        <InputGroupAddon align="block-end" className="px-2 pb-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" aria-label="Add tools" />
              }
            >
              <PlusIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuItem
                onClick={() => fileInputRef.current?.click()}
              >
                <PaperclipIcon className="mr-2 size-4" />
                Attach files
              </DropdownMenuItem>

              {selectableAgents.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className={agentId ? "bg-accent" : undefined}
                    onClick={() => onAgentChange(null)}
                  >
                    <BotIcon className="mr-2 size-4 text-muted-foreground" />
                    <span className="truncate">{t("chat.agent.menuLabel")}</span>
                    {agentId === null ? (
                      <CheckIcon className="ms-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  {selectableAgents.map((agent) => (
                    <DropdownMenuItem
                      key={agent.id + ":" + agent.source}
                      onClick={() => onAgentChange(agent.id)}
                    >
                      <BotIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{agent.name}</span>
                      {agentId === agent.id ? (
                        <CheckIcon className="ms-auto size-4 shrink-0" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}

              {projects && projects.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  {projects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => onProjectChange(project.id)}
                    >
                      <FolderIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{project.name}</span>
                      {projectId === project.id ? (
                        <CheckIcon className="ms-auto size-4 shrink-0" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    className="border-t border-border"
                    onClick={onCreateProject}
                  >
                    <PlusIcon className="mr-2 size-4" />
                    {t("chat.project.createItem")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          {webSearchGloballyEnabled ? (
            <Button
              type="button"
              variant={useWebSearch ? "default" : "ghost"}
              size="xs"
              onClick={() => setUseWebSearch((value) => !value)}
            >
              <GlobeIcon className="size-4" />
              {t("chat.search")}
            </Button>
          ) : null}
        </InputGroupAddon>

        {/* Right tools */}
        <InputGroupAddon align="block-end" className="justify-end px-2 pb-2">
          {selectedAgent ? (
            <span className="group flex max-w-full items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs">
              <BotIcon className="size-3 shrink-0" />
              <span className="max-w-30 truncate">{selectedAgent.name}</span>
              <button
                type="button"
                aria-label={t("chat.agent.clear")}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => onAgentChange(null)}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ) : null}

          {selectedProject ? (
            <span className="group flex max-w-full items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs">
              <FolderIcon className="size-3 shrink-0" />
              <span className="max-w-30 truncate">{selectedProject.name}</span>
              <button
                type="button"
                aria-label={t("chat.project.clear")}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => onProjectChange(null)}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ) : null}

          <Select value={preset} onValueChange={(value) => handlePresetChange(String(value))}>
            <SelectTrigger size="sm" className="h-8 min-w-0 max-w-full px-3 text-xs">
              <SelectValue placeholder={activePresetTitle} />
            </SelectTrigger>
            <SelectContent>
              {presets.map((p) => (
                <SelectItem key={p.preset} value={p.preset} className="py-2">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {status === "streaming" || status === "submitted" ? (
            <InputGroupButton
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={t("chat.stop")}
              onClick={onStop}
            >
              <SquareIcon className="size-4 fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              size="icon-sm"
              aria-label={t("chat.send")}
              disabled={(!text.trim() && files.length === 0) || status === "error"}
              onClick={handleSubmit}
            >
              <span aria-hidden>↑</span>
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        accept={modelSupportsImages ? undefined : DOCUMENT_ACCEPT}
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
