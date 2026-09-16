<script setup lang="ts">
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments'
import { usePromptInput } from '@/components/ai-elements/prompt-input'
import { Loader2Icon } from 'lucide-vue-next'

const { files, removeFile } = usePromptInput()
</script>

<template>
  <Attachments
    v-if="files.length > 0"
    variant="inline"
  >
    <Attachment
      v-for="attachment in files"
      :key="attachment.id"
      :data="attachment"
      @remove="removeFile(attachment.id)"
    >
      <AttachmentPreview />
      <AttachmentInfo />
      <Loader2Icon
        v-if="attachment.converting"
        class="size-3 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <AttachmentRemove />
    </Attachment>
  </Attachments>
</template>
