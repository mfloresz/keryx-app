<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agents'
import type { Agent } from '@/stores/agents'
import AgentCard from '@/components/agents/AgentCard.vue'
import AgentPreviewDialog from '@/components/agents/AgentPreviewDialog.vue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const router = useRouter()
const { t } = useI18n()
const agentStore = useAgentStore()

const activeTab = ref<'all' | 'mine' | 'shared'>('all')
const previewOpen = ref(false)
const previewAgent = ref<Agent | null>(null)

const isLoading = computed(() => agentStore.isLoading)

const displayedAgents = computed(() => {
  if (activeTab.value === 'mine') return agentStore.mine
  if (activeTab.value === 'shared') return agentStore.shared
  return agentStore.all
})

function openPreview(agent: Agent) {
  previewAgent.value = agent
  previewOpen.value = true
}

function handleCreate() {
  router.push('/agents/new')
}

onMounted(async () => {
  await agentStore.fetchAgents()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <div class="flex flex-1 flex-col overflow-y-auto">
      <div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <!-- Header -->
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold tracking-tight">{{ t('agents.title') }}</h1>
            <p class="mt-1 text-sm text-muted-foreground">{{ t('agents.subtitle') }}</p>
          </div>
          <Button class="shrink-0 rounded-full px-5" @click="handleCreate">
            {{ t('agents.create') }}
          </Button>
        </div>

        <!-- Tabs -->
        <div class="mt-6">
          <Tabs :model-value="activeTab" @update:model-value="(v: any) => activeTab = v">
            <TabsList class="bg-transparent p-0 gap-2 h-auto">
              <TabsTrigger
                value="all"
                class="rounded-full px-4 py-1.5 text-sm data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm bg-muted"
              >
                {{ t('agents.tabsAll') }}
              </TabsTrigger>
              <TabsTrigger
                value="mine"
                class="rounded-full px-4 py-1.5 text-sm data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm bg-muted"
              >
                {{ t('agents.tabsMine') }}
              </TabsTrigger>
              <TabsTrigger
                value="shared"
                class="rounded-full px-4 py-1.5 text-sm data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm bg-muted"
              >
                {{ t('agents.tabsShared') }}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <!-- Loading skeleton -->
        <div v-if="isLoading && agentStore.agents.length === 0" class="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="i in 6" :key="i" class="h-52 animate-pulse rounded-xl border bg-muted/50" />
        </div>

        <!-- Empty / No results -->
        <div v-else-if="displayedAgents.length === 0" class="mt-16 flex flex-col items-center justify-center text-center">
          <div class="max-w-sm space-y-2">
            <h3 class="text-base font-medium">{{ activeTab === 'all' ? t('agents.emptyTitle') : t('agents.noResults') }}</h3>
            <p class="text-sm text-muted-foreground">
              {{ activeTab === 'all' ? t('agents.emptyDescription') : '' }}
            </p>
            <Button v-if="activeTab === 'all'" class="mt-4" @click="handleCreate">{{ t('agents.create') }}</Button>
          </div>
        </div>

        <!-- Grid -->
        <div v-else class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AgentCard
            v-for="agent in displayedAgents"
            :key="agent.id + ':' + agent.source"
            :agent="agent"
            @click="openPreview"
          />
        </div>
      </div>
    </div>

    <AgentPreviewDialog v-model:open="previewOpen" :agent="previewAgent" />
  </div>
</template>
