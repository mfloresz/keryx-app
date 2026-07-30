import { computed } from 'vue'
import { supportsSearch } from '@/shared/utils/models'
import type { ChatModel } from '@/domain/models/types'

const LEGACY_STORAGE_KEYS = ['search-engine', 'tavily-api-key', 'tavily-options']

// Remove keys left behind by the retired client-side Tavily integration
for (const key of LEGACY_STORAGE_KEYS) {
  localStorage.removeItem(key)
}

export function useSearchSettings() {
  const isSearchAvailable = computed(() => {
    return (models: ChatModel[], modelId: string) => supportsSearch(models, modelId)
  })

  return {
    isSearchAvailable,
  }
}
