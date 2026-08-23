import { ref } from 'vue'
import { toast as sonnerToast } from 'vue-sonner'

export interface Toast {
  id: string | number
  message: string
  type: 'error' | 'success' | 'info'
}

const toasts = ref<Toast[]>([])

export function useToast() {
  function toast(message: string, type: Toast['type'] = 'error') {
    if (type === 'success') {
      sonnerToast.success(message)
    } else if (type === 'info') {
      sonnerToast.info(message)
    } else {
      sonnerToast.error(message)
    }
  }

  function dismiss(id: string | number) {
    sonnerToast.dismiss(id)
  }

  return { toasts, toast, dismiss }
}
