import {
  BotIcon,
  CheckIcon,
  FolderIcon,
  GlobeIcon,
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import type {
  ChatAgent,
  ChatProject,
  ModelPreset,
  PendingAttachment,
} from "#/components/chat/types";
import { Attachment, AttachmentMedia } from "#/components/ui/attachment";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
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
import { Spinner } from "#/components/ui/spinner";
import { useI18n } from "#/i18n";
import {
  convertToMarkdown,
  isConvertible,
} from "#/services/document-conversion";
import { listSkills, type SkillInfo } from "#/services/skills";

const DOCUMENT_ACCEPT =
  ".pdf,.txt,.md,.doc,.docx,.docm,.odt,.ods,.odp,.ppt,.pptx,.pptm,.ppsx,.ppsm,.xls,.xlsx,.xlsm,.rtf,.epub,.csv,.json,.xml,.html,.css,.js,.ts,.py,.java,.cpp,.go,.rs";

const MAX_FILES = 3;

const PRESET_DESCRIPTION_KEYS: Record<
  string,
  { title: string; subtitle: string }
> = {
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
  /**
   * Request from the parent to set the composer text (starter prompt
   * chips). The nonce makes each request unique.
   */
  prefill?: { text: string; nonce: number } | null;
  onSubmit: (payload: {
    text: string;
    files: PendingAttachment[];
    webSearch: boolean;
    pinnedSkills: string[];
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
  prefill,
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
  // Skills are fetched once and cached; pinned ones apply to the next
  // message only and are cleared after each send.
  const [skills, setSkills] = React.useState<SkillInfo[]>([]);
  const [pinnedSkills, setPinnedSkills] = React.useState<string[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const [unsupportedImageOpen, setUnsupportedImageOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const prefillNonceRef = React.useRef(0);

  React.useEffect(() => {
    if (!prefill || prefill.nonce === prefillNonceRef.current) return;
    prefillNonceRef.current = prefill.nonce;
    setText(prefill.text);
  }, [prefill]);

  React.useEffect(() => {
    let cancelled = false;
    void listSkills()
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch(() => {
        // Without the catalog the skills button simply stays hidden.
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPreset = presets.find((p) => p.preset === preset);
  // The trigger shows the readable label of the selected preset.
  const presetItems = React.useMemo(
    () => Object.fromEntries(presets.map((p) => [p.preset, p.label])),
    [presets],
  );
  const modelSupportsImages = selectedPreset?.supportsImages ?? true;
  const selectedAgent = agents?.find((a) => a.id === agentId) ?? null;
  const selectedProject = projects?.find((p) => p.id === projectId) ?? null;

  // The base prompt is the default when nothing is selected, so the catalog
  // never lists a "general" agent; filter it defensively.
  const selectableAgents = (agents ?? []).filter(
    (a) => a.id !== "general" && a.builtinId !== "general",
  );

  const activePresetTitle = selectedPreset
    ? PRESET_DESCRIPTION_KEYS[preset]?.title
      ? t(PRESET_DESCRIPTION_KEYS[preset].title)
      : selectedPreset.label
    : preset;

  const isBusy = status === "streaming" || status === "submitted";
  const isConverting = files.some((file) => file.converting);

  /**
   * Starts the client-side document conversion. The attachment stays
   * visible with a spinner meanwhile; a failed conversion removes it,
   * because a document without a text layer cannot be attached.
   */
  const startConversion = React.useCallback(
    (attachment: PendingAttachment) => {
      if (!isConvertible(attachment.filename)) return;

      setFiles((current) =>
        current.map((f) =>
          f.id === attachment.id ? { ...f, converting: true } : f,
        ),
      );

      void convertToMarkdown(attachment.file)
        .then((markdown) => {
          setFiles((current) =>
            current.map((f) =>
              f.id === attachment.id
                ? { ...f, convertedMarkdown: markdown }
                : f,
            ),
          );
        })
        .catch((code: string) => {
          setFiles((current) => current.filter((f) => f.id !== attachment.id));
          toast.error(
            code === "needsOcr"
              ? t("chat.attachmentNoTextLayer")
              : t("chat.attachmentConvertError"),
          );
        })
        .finally(() => {
          setFiles((current) =>
            current.map((f) =>
              f.id === attachment.id ? { ...f, converting: false } : f,
            ),
          );
        });
    },
    [t],
  );

  const addFiles = React.useCallback(
    (fileList: FileList | null | File[]) => {
      if (!fileList) return;
      let incoming = Array.from(fileList);

      // The model does not accept images: reject them with an explanation
      // and keep the rest of the drop.
      const hasImage = incoming.some((file) => file.type.startsWith("image/"));
      if (hasImage && !modelSupportsImages) {
        setUnsupportedImageOpen(true);
        incoming = incoming.filter((file) => !file.type.startsWith("image/"));
        if (!incoming.length) return;
      }

      setFiles((current) => {
        const room = Math.max(0, MAX_FILES - current.length);
        const next: PendingAttachment[] = incoming
          .slice(0, room)
          .map((file, index) => ({
            id: `${file.name}-${file.size}-${Date.now()}-${index}`,
            file,
            filename: file.name,
            mediaType: file.type || "application/octet-stream",
          }));
        // Documents that need converting start right away.
        for (const attachment of next) startConversion(attachment);
        return [...current, ...next];
      });
    },
    [modelSupportsImages, startConversion],
  );

  function removeFile(id: string) {
    setFiles((current) => current.filter((f) => f.id !== id));
  }

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    if (isBusy || isConverting) return;

    onSubmit({
      text: trimmed,
      files,
      webSearch: useWebSearch,
      pinnedSkills,
    });
    setText("");
    setFiles([]);
    // Pinned skills apply to the next message only.
    setPinnedSkills([]);
  }

  function handlePresetChange(value: string) {
    onPresetChange(value);
    const next = presets.find((p) => p.preset === value);
    if (next && !next.supportsSearch) {
      setUseWebSearch(false);
    }
  }

  // Drag & drop anywhere on the document.
  React.useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      setIsDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      setIsDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      setIsDragging(false);
      addFiles(event.dataTransfer.files);
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  return (
    <div className="bg-background px-4 pt-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
      <div
        className={`relative mx-auto max-w-3xl transition-shadow ${
          isDragging ? "ring-2 ring-primary/50" : ""
        }`}
      >
        <InputGroup className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm focus-within:border-primary/30 focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary/10">
          {/* Pinned skills row (apply to the next message only) */}
          {pinnedSkills.length > 0 ? (
            <InputGroupAddon
              align="block-start"
              className="flex-wrap px-3 pt-3"
            >
              {pinnedSkills.map((name) => (
                <span
                  key={name}
                  className="group flex max-w-full items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs"
                >
                  <SparklesIcon className="size-3 shrink-0" />
                  <span className="max-w-30 truncate">{name}</span>
                  <button
                    type="button"
                    aria-label={t("chat.skills.remove")}
                    onClick={() =>
                      setPinnedSkills((current) =>
                        current.filter((skill) => skill !== name),
                      )
                    }
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
            </InputGroupAddon>
          ) : null}

          {/* Attachments row */}
          {files.length > 0 ? (
            <InputGroupAddon
              align="block-start"
              className="flex-wrap px-3 pt-3"
            >
              {files.map((file) => (
                <Attachment key={file.id} size="sm">
                  <AttachmentMedia variant="icon">
                    {file.converting ? <Spinner /> : <PaperclipIcon />}
                  </AttachmentMedia>
                  <span className="max-w-40 truncate text-xs">
                    {file.filename}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("chat.removeAttachment")}
                    onClick={() => removeFile(file.id)}
                  >
                    <XIcon />
                  </Button>
                </Attachment>
              ))}
            </InputGroupAddon>
          ) : null}

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
                return;
              }
              // Backspace on an empty input removes the last attachment.
              if (event.key === "Backspace" && !text && files.length > 0) {
                event.preventDefault();
                removeFile(files[files.length - 1]!.id);
              }
            }}
            onPaste={(event) => {
              const pasted = Array.from(event.clipboardData.files);
              if (pasted.length) {
                event.preventDefault();
                addFiles(pasted);
              }
            }}
            placeholder={t("chat.inputPlaceholder")}
            aria-label={t("chat.inputPlaceholder")}
            className="min-h-12 resize-none p-3"
          />

          {/* Toolbar: left tools, then right-aligned controls, in one row. */}
          <InputGroupAddon align="block-end" className="px-2 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("chat.addTools")}
                    className={isBusy ? "pointer-events-none opacity-50" : ""}
                  />
                }
              >
                <PlusIcon className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <PaperclipIcon className="mr-2 size-4" />
                  {t("chat.attachFiles")}
                </DropdownMenuItem>

                {selectableAgents.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onAgentChange(null)}>
                      <BotIcon className="mr-2 size-4 text-muted-foreground" />
                      <span className="truncate">
                        {t("chat.agent.menuLabel")}
                      </span>
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

            {skills.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant={pinnedSkills.length ? "default" : "ghost"}
                      size="xs"
                      aria-label={t("chat.skills.menuLabel")}
                      className={isBusy ? "pointer-events-none opacity-50" : ""}
                    />
                  }
                >
                  <SparklesIcon className="size-4" />
                  <span className="hidden sm:inline">
                    {t("chat.skills.menuLabel")}
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {skills.map((skill) => {
                    const pinned = pinnedSkills.includes(skill.name);
                    return (
                      <DropdownMenuItem
                        key={skill.name}
                        onClick={() =>
                          setPinnedSkills((current) =>
                            pinned
                              ? current.filter((s) => s !== skill.name)
                              : [...current, skill.name],
                          )
                        }
                      >
                        <SparklesIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate">{skill.name}</span>
                          {skill.description ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {skill.description}
                            </span>
                          ) : null}
                        </span>
                        {pinned ? (
                          <CheckIcon className="ms-auto size-4 shrink-0" />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

            {webSearchGloballyEnabled ? (
              <Button
                type="button"
                variant={useWebSearch ? "default" : "ghost"}
                size="xs"
                className={isBusy ? "pointer-events-none opacity-50" : ""}
                onClick={() => setUseWebSearch((value) => !value)}
              >
                <GlobeIcon className="size-4" />
                {t("chat.search")}
              </Button>
            ) : null}

            {/* Right-aligned controls */}
            <div className="ms-auto flex min-w-0 flex-wrap items-center gap-2">
              {selectedAgent ? (
                <span className="group flex max-w-full items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs">
                  <BotIcon className="size-3 shrink-0" />
                  <span className="max-w-30 truncate">
                    {selectedAgent.name}
                  </span>
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
                  <span className="max-w-30 truncate">
                    {selectedProject.name}
                  </span>
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

              <Select
                items={presetItems}
                value={preset}
                onValueChange={(value) => handlePresetChange(String(value))}
              >
                <SelectTrigger
                  size="sm"
                  className={`h-8 max-w-full min-w-0 px-3 text-xs ${
                    isBusy ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  <SelectValue placeholder={activePresetTitle} />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem
                      key={p.preset}
                      value={p.preset}
                      className="py-2"
                    >
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {isBusy ? (
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
                  disabled={isConverting}
                  onClick={handleSubmit}
                >
                  <span aria-hidden>↑</span>
                </InputGroupButton>
              )}
            </div>
          </InputGroupAddon>
        </InputGroup>

        {isDragging ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-primary">
            {t("chat.dropFiles")}
          </p>
        ) : null}
      </div>

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

      {/* The model does not accept images. */}
      <Dialog
        open={unsupportedImageOpen}
        onOpenChange={setUnsupportedImageOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("chat.unsupportedImageTitle")}</DialogTitle>
            <DialogDescription>
              {t("chat.unsupportedImageDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setUnsupportedImageOpen(false)}>
              {t("app.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
