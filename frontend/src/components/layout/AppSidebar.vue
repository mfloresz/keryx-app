<script setup lang="ts">
/**
 * AppSidebar
 *
 * Displays the application sidebar with:
 * - New chat button
 * - Chat history grouped by date
 * - Settings access
 *
 * Uses shadcn/ui components exclusively.
 */
import { ref, computed, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { getChatRepository } from '@/services/runtime'
import { ENABLE_AUTH } from '@/app/config'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import SettingsModal from '@/components/settings/SettingsModal.vue'
import {
  Plus,
  MessageCircle,
  Settings,
  Pencil,
  Trash2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeft,
  Search,
  LogOut,
  Shield,
  Star,
  Sun,
  Moon,
  Monitor,
} from 'lucide-vue-next'
import { useTheme, type Theme } from '@/composables/useTheme'

// Mobile drawer mode (v-model from AppLayout). When true, the sidebar
// renders expanded inside the drawer and the desktop collapsed state is
// ignored — collapsing is meaningless inside an off-canvas drawer.
const props = defineProps<{
  mobileOpen?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:mobileOpen', value: boolean): void
}>()

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const chatStore = useChatStore()
const authStore = useAuthStore()
const { toast } = useToast()
const chatRepositoryPromise = getChatRepository()

// Sidebar collapse state (desktop only)
const collapsed = ref(false)

const isDrawer = computed(() => props.mobileOpen === true)

// Close the mobile drawer after any in-sidebar navigation. No-op on desktop
// (mobileOpen is always false there).
function closeMobile() {
  if (props.mobileOpen) emit('update:mobileOpen', false)
}

// Settings modal
const settingsOpen = ref(false)

// Search command dialog
const searchOpen = ref(false)

// Recent chats popover open state
const recentChatsOpen = ref(false)

// Alert dialog state for chat deletion
const alertOpen = ref(false)
const chatToDelete = ref<string | null>(null)

// Alert dialog state for chat rename
const renameOpen = ref(false)
const chatToRenameId = ref<string | null>(null)
const renameInputValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

// Last 10 recent chats computed
const recentChats = computed(() => {
  // Sort by createdAt desc and take first 10
  return [...chatStore.chats]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
})

const isAdmin = computed(() => authStore.session?.user.role === 'admin')

// User menu: theme selector and profile actions
const { theme, setTheme } = useTheme()
const userMenuOpen = ref(false)

const themeOptions: { value: Theme; icon: typeof Sun; labelKey: string }[] = [
  { value: 'light', icon: Sun, labelKey: 'settings.themeLight' },
  { value: 'dark', icon: Moon, labelKey: 'settings.themeDark' },
  { value: 'system', icon: Monitor, labelKey: 'settings.themeSystem' },
]

const userEmail = computed(() => authStore.session?.user.email ?? '')
const userName = computed(() => authStore.session?.user.name ?? '')
const userDisplayName = computed(() => {
  if (userName.value) return userName.value
  const local = userEmail.value.split('@')[0] ?? ''
  if (!local) return t('sidebar.user')
  return local.charAt(0).toUpperCase() + local.slice(1)
})
const userInitial = computed(() => userDisplayName.value.charAt(0).toUpperCase())

function renameChat(id: string, currentLabel: string) {
  chatToRenameId.value = id
  renameInputValue.value = currentLabel === 'Untitled' ? '' : currentLabel
  renameOpen.value = true
  nextTick(() => {
    renameInputRef.value?.focus()
  })
}

async function confirmRenameChat() {
  const id = chatToRenameId.value
  const newTitle = renameInputValue.value.trim()
  if (!id || !newTitle) {
    renameOpen.value = false
    return
  }
  renameOpen.value = false

  try {
    const chatRepository = await chatRepositoryPromise
    await chatRepository.updateTitle(id, newTitle)
    chatStore.updateChat(id, { label: newTitle })
  }
  catch {
    toast(t('chat.failedRename'))
  }
}

function promptDeleteChat(id: string) {
  chatToDelete.value = id
  alertOpen.value = true
}

async function confirmDeleteChat() {
  const id = chatToDelete.value
  if (!id) return
  alertOpen.value = false
  chatToDelete.value = null

  try {
    const chatRepository = await chatRepositoryPromise
    await chatRepository.deleteChat(id)
    chatStore.removeChat(id)
    if (route.params.id === id) {
      router.push('/')
    }
  }
  catch {
    toast(t('chat.failedDelete'))
  }
}

function isActive(chatId: string) {
  return route.params.id === chatId
}

function isFavoritesRoute() {
  return route.path === '/favorites'
}

async function handleLogout() {
  closeMobile()
  await authStore.logout()
  chatStore.chats = []
  router.push('/login')
}

// Keyboard shortcut for search
function onKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    searchOpen.value = true
  }
}

// Chat list is fetched eagerly from App.vue on app startup.
// This component is a pure consumer of the store state.
</script>

<template>
  <TooltipProvider>
    <aside
      id="app-sidebar"
      tabindex="-1"
      :class="[
        'flex h-full flex-col bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground transition-[width] duration-300',
        collapsed && !isDrawer ? 'w-16' : 'w-72'
      ]"
    >
      <!-- Header -->
      <div class="flex items-center gap-2 p-3">
        <template v-if="!collapsed || isDrawer">
          <RouterLink to="/" class="flex items-center gap-2 flex-1" @click="closeMobile">
            <img src="/logo.webp" alt="Keryx" class="h-8 w-8 object-contain" />
            <span class="font-bold text-sidebar-foreground">{{ $t('app.name') }}</span>
          </RouterLink>

          <Tooltip v-if="!isDrawer">
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="shrink-0"
                @click="collapsed = !collapsed"
              >
                <PanelLeftClose class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{{ $t('sidebar.collapse') }}</p>
            </TooltipContent>
          </Tooltip>
        </template>
        <template v-else>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="mx-auto"
                @click="collapsed = !collapsed"
              >
                <PanelLeft class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{{ $t('sidebar.expand') }}</p>
            </TooltipContent>
          </Tooltip>
        </template>
      </div>

      <!-- New Chat & Search -->
      <div class="px-3 pb-2 space-y-1">
        <Tooltip v-if="collapsed && !isDrawer">
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              class="w-full justify-center"
              size="sm"
              @click="router.push('/'); closeMobile()"
            >
              <Plus class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{{ $t('sidebar.newChat') }}</p>
          </TooltipContent>
        </Tooltip>
        <Button
          v-else
          variant="outline"
          class="w-full justify-start gap-2"
          size="sm"
          @click="router.push('/'); closeMobile()"
        >
          <Plus class="h-4 w-4" />
          {{ $t('sidebar.newChat') }}
        </Button>

        <Tooltip v-if="collapsed && !isDrawer">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              class="w-full justify-center"
              size="sm"
              @click="searchOpen = true"
            >
              <Search class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{{ $t('sidebar.searchChats') }}</p>
          </TooltipContent>
        </Tooltip>
        <Button
          v-else
          variant="ghost"
          class="w-full justify-start gap-2"
          size="sm"
          @click="searchOpen = true"
        >
          <Search class="h-4 w-4" />
          {{ $t('sidebar.search') }}
          <kbd class="ml-auto inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100">
            <span class="text-xs">Ctrl</span>K
          </kbd>
        </Button>

        <Tooltip v-if="collapsed && !isDrawer">
          <TooltipTrigger as-child>
            <Button
              :variant="isFavoritesRoute() ? 'secondary' : 'ghost'"
              class="w-full justify-center"
              size="sm"
              @click="router.push('/favorites'); closeMobile()"
            >
              <Star class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{{ $t('sidebar.favorites') }}</p>
          </TooltipContent>
        </Tooltip>
        <Button
          v-else
          :variant="isFavoritesRoute() ? 'secondary' : 'ghost'"
          class="w-full justify-start gap-2"
          size="sm"
          @click="router.push('/favorites'); closeMobile()"
        >
          <Star class="h-4 w-4" />
          {{ $t('sidebar.favorites') }}
        </Button>
      </div>

      <!-- Chat History -->
      <div v-if="!collapsed || isDrawer" class="flex-1 min-h-0 overflow-hidden">
        <ScrollArea class="h-full px-3 py-2">
          <div v-if="chatStore.isLoading && !chatStore.chats.length" class="text-sm text-muted-foreground text-center py-4">
            {{ $t('app.loading') }}
          </div>
          <div v-else-if="chatStore.chats.length === 0" class="text-sm text-muted-foreground text-center py-4">
            {{ $t('sidebar.noChats') }}
          </div>
          <div v-else class="space-y-4">
            <div v-for="group in chatStore.groups" :key="group.id">
              <div class="text-xs font-medium text-muted-foreground px-2 py-1 tracking-wider">
                {{ group.label }}
              </div>
              <div class="space-y-0.5">
                <RouterLink
                  v-for="item in group.items"
                  :key="item.id"
                  :to="item.to"
                  :class="[
                    'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                    isActive(item.id)
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  ]"
                  @click="closeMobile"
                >
                  <span class="truncate flex-1">
                    {{ item.label }}
                  </span>

                  <!-- Actions dropdown -->
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        @click.stop.prevent
                      >
                        <MoreHorizontal class="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem @click.stop="renameChat(item.id, item.label)">
                        <Pencil class="h-3.5 w-3.5 mr-2" />
                        {{ $t('sidebar.rename') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        class="text-destructive focus:text-destructive"
                        @click.stop="promptDeleteChat(item.id)"
                      >
                        <Trash2 class="h-3.5 w-3.5 mr-2" />
                        {{ $t('sidebar.delete') }}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </RouterLink>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      <!-- Collapsed: Recent Chats Popover -->
      <div v-else class="flex-1 min-h-0 overflow-hidden flex flex-col items-center py-2">
        <Popover v-model:open="recentChatsOpen">
          <PopoverTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="w-10 h-10"
            >
              <MessageCircle class="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            class="w-72 p-0"
            :side-offset="8"
          >
            <div class="px-3 py-2 border-b">
              <span class="text-sm font-medium text-muted-foreground">{{ $t('sidebar.recentChats') }}</span>
            </div>
            <ScrollArea class="h-80">
              <div v-if="chatStore.isLoading && !chatStore.chats.length" class="text-sm text-muted-foreground text-center py-4">
                {{ $t('app.loading') }}
              </div>
              <div v-else-if="recentChats.length === 0" class="text-sm text-muted-foreground text-center py-4">
                {{ $t('sidebar.noChats') }}
              </div>
              <div v-else class="py-1">
                <button
                  v-for="chat in recentChats"
                  :key="chat.id"
                  :class="[
                    'w-full text-left px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    isActive(chat.id)
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-sidebar-foreground'
                  ]"
                  @click="router.push(chat.to); recentChatsOpen = false; closeMobile()"
                >
                  {{ chat.label }}
                </button>
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      <!-- Footer: user card with account menu -->
      <div class="p-3">
        <DropdownMenu v-model:open="userMenuOpen">
          <DropdownMenuTrigger as-child>
            <button
              :class="[
                'group flex w-full items-center gap-2.5 rounded-md text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                collapsed && !isDrawer ? 'justify-center p-1.5' : 'p-2'
              ]"
              :aria-label="$t('sidebar.userMenu')"
            >
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground overflow-hidden">
                <template v-if="authStore.avatarUrl">
                  <img :src="authStore.avatarUrl" alt="" class="h-full w-full object-cover" />
                </template>
                <template v-else>
                  {{ userInitial }}
                </template>
              </span>
              <span v-if="!collapsed || isDrawer" class="min-w-0 flex-1 leading-tight">
                <span class="block truncate text-sm font-medium">{{ userDisplayName }}</span>
                <span class="block truncate text-xs text-muted-foreground">{{ userEmail }}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent :side="collapsed && !isDrawer ? 'right' : 'top'" align="start" class="w-64">
            <!-- User header -->
            <DropdownMenuLabel class="flex items-center gap-2.5 font-normal">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground overflow-hidden">
                <template v-if="authStore.avatarUrl">
                  <img :src="authStore.avatarUrl" alt="" class="h-full w-full object-cover" />
                </template>
                <template v-else>
                  {{ userInitial }}
                </template>
              </span>
              <span class="min-w-0 leading-tight">
                <span class="block truncate text-sm font-medium">{{ userDisplayName }}</span>
                <span class="block truncate text-xs text-muted-foreground">{{ userEmail }}</span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem @click="settingsOpen = true">
              <Settings class="mr-2 h-4 w-4" />
              {{ $t('sidebar.settings') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="ENABLE_AUTH && isAdmin" @click="router.push('/admin'); closeMobile()">
              <Shield class="mr-2 h-4 w-4" />
              Admin
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="ENABLE_AUTH"
              class="text-destructive focus:text-destructive"
              @click="handleLogout"
            >
              <LogOut class="mr-2 h-4 w-4" />
              {{ $t('sidebar.logout') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />

            <!-- Theme selector -->
            <div class="flex items-center justify-center gap-1 p-1.5">
              <button
                v-for="option in themeOptions"
                :key="option.value"
                type="button"
                :title="$t(option.labelKey)"
                :aria-label="$t(option.labelKey)"
                :aria-pressed="theme === option.value"
                :class="[
                  'flex h-8 w-10 items-center justify-center rounded-md transition-colors',
                  theme === option.value
                    ? 'bg-muted text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                ]"
                @click.stop="setTheme(option.value)"
              >
                <component :is="option.icon" class="h-4 w-4" />
              </button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>

    <!-- Search Command Dialog -->
    <CommandDialog v-model:open="searchOpen">
      <CommandInput :placeholder="$t('command.searchPlaceholder')" />
      <CommandList>
        <CommandEmpty>{{ $t('command.noResults') }}</CommandEmpty>
        <CommandGroup :heading="$t('command.actions')">
          <CommandItem value="new-chat" @select="router.push('/'); searchOpen = false; closeMobile()">
            <Plus class="mr-2 h-4 w-4" />
            {{ $t('command.newChat') }}
          </CommandItem>
        </CommandGroup>
        <CommandGroup v-for="group in chatStore.groups" :key="group.id" :heading="group.label">
          <CommandItem
            v-for="item in group.items"
            :key="item.id"
            :value="item.label"
            @select="router.push(item.to); searchOpen = false; closeMobile()"
          >
            <MessageCircle class="mr-2 h-4 w-4" />
            {{ item.label }}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>

    <!-- Delete Chat Alert Dialog -->
    <AlertDialog v-model:open="alertOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ $t('message.deleteTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ $t('message.deleteDescription') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="chatToDelete = null">{{ $t('app.cancel') }}</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="confirmDeleteChat">
            {{ $t('app.delete') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Rename Chat Alert Dialog -->
    <AlertDialog v-model:open="renameOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ $t('sidebar.rename') }}</AlertDialogTitle>
        </AlertDialogHeader>
        <div class="py-2">
          <input
            id="rename-input"
            ref="renameInputRef"
            v-model="renameInputValue"
            type="text"
            :placeholder="$t('sidebar.rename')"
            :aria-label="$t('sidebar.rename')"
            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            @keydown.enter.prevent="confirmRenameChat"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel @click="chatToRenameId = null">{{ $t('app.cancel') }}</AlertDialogCancel>
          <AlertDialogAction @click="confirmRenameChat">{{ $t('app.save') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Settings Modal -->
    <SettingsModal v-model:open="settingsOpen" />

    <!-- Global keyboard listener -->
    <div tabindex="-1" @keydown="onKeyDown" />
  </TooltipProvider>
</template>
