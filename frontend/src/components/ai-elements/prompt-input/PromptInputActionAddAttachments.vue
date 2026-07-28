<script setup lang="ts">
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { ImageIcon } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { usePromptInput } from './context'

type PromptInputActionAddAttachmentsProps = InstanceType<typeof DropdownMenuItem>['$props']

interface Props extends /* @vue-ignore */ PromptInputActionAddAttachmentsProps {
  label?: string
}

const props = defineProps<Props>()

const { t } = useI18n()
const { openFileDialog } = usePromptInput()
</script>

<template>
  <DropdownMenuItem @select="openFileDialog">
    <ImageIcon class="mr-2 size-4" />
    {{ props.label || t('chat.addPhotosOrFiles') }}
  </DropdownMenuItem>
</template>
