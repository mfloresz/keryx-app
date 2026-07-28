import { ref } from 'vue'

export interface Toast {
  id: string
  message: string
  type: 'error' | 'success' | 'info'
}

const toasts = ref<Toast[]>([])

export function useToast() {
  function toast(message: string, type: Toast['type'] = 'error') {
    const id = crypto.randomUUID()
    toasts.value.push({ id, message, type })
    setTimeout(() => {
      dismiss(id)
    }, 5000)
  }

  function dismiss(id: string) {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index !== -1) {
      toasts.value.splice(index, 1)
    }
  }

  return { toasts, toast, dismiss }
}
