import { ref, computed } from 'vue'
import { supportsSearch } from '@/shared/utils/models'
import { secureGetItem, secureSetItem } from '@/utils/secureStorage'

export type SearchEngine = 'native' | 'tavily'
export type SearchDepth = 'basic' | 'advanced' | 'fast' | 'ultra-fast'
export type Topic = 'general' | 'news' | 'finance'
export type TimeRange = 'day' | 'week' | 'month' | 'year' | null
export type IncludeAnswer = 'none' | 'basic' | 'advanced'
export type IncludeRawContent = 'none' | 'markdown' | 'text'

export interface TavilyOptions {
  searchDepth: SearchDepth
  maxResults: number
  includeAnswer: IncludeAnswer
  includeRawContent: IncludeRawContent
  topic: Topic
  timeRange: TimeRange
  exactMatch: boolean
  chunksPerSource: number
}

const STORAGE_KEY_ENGINE = 'search-engine'
const STORAGE_KEY_TAVILY_KEY = 'tavily-api-key'
const STORAGE_KEY_TAVILY_OPTS = 'tavily-options'

function loadEngine(): SearchEngine {
  const raw = localStorage.getItem(STORAGE_KEY_ENGINE)
  return raw === 'tavily' ? 'tavily' : 'native'
}

function loadTavilyOptions(): TavilyOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TAVILY_OPTS)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        searchDepth: parsed.searchDepth ?? 'basic',
        maxResults: parsed.maxResults ?? 5,
        includeAnswer: parsed.includeAnswer ?? 'none',
        includeRawContent: parsed.includeRawContent ?? 'markdown',
        topic: parsed.topic ?? 'general',
        timeRange: parsed.timeRange ?? null,
        exactMatch: parsed.exactMatch ?? false,
        chunksPerSource: parsed.chunksPerSource ?? 3,
      }
    }
  }
  catch {
    // ignore parse errors
  }
  return {
    searchDepth: 'basic',
    maxResults: 5,
    includeAnswer: 'none',
    includeRawContent: 'markdown',
    topic: 'general',
    timeRange: null,
    exactMatch: false,
    chunksPerSource: 3,
  }
}

export function useSearchSettings() {
  const engine = ref<SearchEngine>(loadEngine())
  const tavilyApiKey = ref<string>('')
  const options = ref<TavilyOptions>(loadTavilyOptions())
  let hasUserSetKey = false

  // Load encrypted key asynchronously
  secureGetItem(STORAGE_KEY_TAVILY_KEY).then(v => {
    if (!hasUserSetKey) {
      tavilyApiKey.value = v || ''
    }
  })

  const isSearchAvailable = computed(() => {
    return (modelId: string) => {
      if (engine.value === 'native') {
        return supportsSearch(modelId)
      }
      // tavily mode: available for all models if key is set
      return tavilyApiKey.value.trim().length > 0
    }
  })

  function saveEngine(value: SearchEngine) {
    engine.value = value
    localStorage.setItem(STORAGE_KEY_ENGINE, value)
  }

  async function saveTavilyKey(value: string) {
    hasUserSetKey = true
    tavilyApiKey.value = value
    await secureSetItem(STORAGE_KEY_TAVILY_KEY, value.trim() || null)
  }

  function saveTavilyOptions(opts: Partial<TavilyOptions>) {
    options.value = { ...options.value, ...opts }
    localStorage.setItem(STORAGE_KEY_TAVILY_OPTS, JSON.stringify(options.value))
  }

  return {
    engine,
    tavilyApiKey,
    options,
    isSearchAvailable,
    saveEngine,
    saveTavilyKey,
    saveTavilyOptions,
  }
}
