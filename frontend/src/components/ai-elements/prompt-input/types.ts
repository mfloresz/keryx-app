import type { FileUIPart } from 'ai'
import type { Ref } from 'vue'

export interface PromptInputMessage {
  text: string
  files: AttachmentFile[]
}

export interface AttachmentFile extends FileUIPart {
  id: string
  file?: File
  /** True while the document is being converted to Markdown in the worker. */
  converting?: boolean
  /** Markdown conversion of the document, produced client-side at attach time. */
  convertedMarkdown?: string
}

export interface PromptInputContext {
  textInput: Ref<string>
  files: Ref<AttachmentFile[]>
  isLoading: Ref<boolean>
  fileInputRef: Ref<HTMLInputElement | null>
  setTextInput: (val: string) => void
  addFiles: (files: File[] | FileList) => void
  removeFile: (id: string) => void
  clearFiles: () => void
  clearInput: () => void
  openFileDialog: () => void
  submitForm: () => void
}

export const PROMPT_INPUT_KEY = Symbol('PromptInputContext')
