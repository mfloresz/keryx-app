<script setup lang="ts">
/**
 * SettingsModal
 *
 * Sidebar left (General, Search, Privacy) + content right.
 */
import { ref, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { useTheme, type Theme } from '@/composables/useTheme'
import { useLanguage } from '@/composables/useLanguage'
import { useAppFont, type AppFont, type AppFontSize } from '@/composables/useAppFont'
import { useModels } from '@/composables/useModels'
import { useToast } from '@/composables/useToast'
import { secureGetItem, secureSetItem } from '@/utils/secureStorage'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Trash2, Settings, Shield, User, Camera, KeyRound } from 'lucide-vue-next'
import { ENABLE_LOCAL_KEYS } from '@/app/config'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const apiKey = ref('')
const opencodeApiKey = ref('')
const { theme, setTheme } = useTheme()
const { locale, setLocale } = useLanguage()
const { appFont, appFontSize, setFont, setFontSize } = useAppFont()
const { provider, providers, allowsLocalKeys } = useModels()
const authStore = useAuthStore()
const chatStore = useChatStore()
const router = useRouter()
const deletePopoverOpen = ref(false)
const isDeletingAll = ref(false)

const { toast } = useToast()
const activeSection = ref<'general' | 'privacy' | 'account'>('general')

// Local refs for settings
const localChatFont = ref<AppFont>(appFont.value)
const localChatFontSize = ref<AppFontSize>(appFontSize.value)
const localProvider = ref(provider.value)

const canManageLocalKeys = computed(() => ENABLE_LOCAL_KEYS && allowsLocalKeys.value)
const showProviderSelector = computed(() => canManageLocalKeys.value && providers.value.length > 1)
const showVercelKeyInput = computed(() => canManageLocalKeys.value && localProvider.value === 'vercel')
const showOpenCodeKeyInput = computed(() => canManageLocalKeys.value && localProvider.value === 'opencode')

// Account form
const localName = ref('')
const localAvatarFile = ref<File | null>(null)
const localAvatarPreview = ref<string | null>(null)
const avatarInputRef = ref<HTMLInputElement | null>(null)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const isSavingProfile = ref(false)
const isChangingPassword = ref(false)
const passwordError = ref('')
const passwordSuccess = ref('')
const profileSuccess = ref('')

// Load existing values on open
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    localProvider.value = provider.value
    secureGetItem('ai-gateway-api-key').then(v => { apiKey.value = v || '' })
    secureGetItem('opencode-api-key').then(v => { opencodeApiKey.value = v || '' })
    localChatFont.value = appFont.value
    localChatFontSize.value = appFontSize.value
    localName.value = authStore.userName || ''
    localAvatarFile.value = null
    localAvatarPreview.value = null
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordError.value = ''
    passwordSuccess.value = ''
    profileSuccess.value = ''
    activeSection.value = 'general'
  }
})

const userEmail = computed(() => authStore.session?.user?.email ?? '')

async function handleSaveAccount() {
  isSavingProfile.value = true
  profileSuccess.value = ''
  try {
    const name = localName.value.trim()
    if (name && name !== authStore.userName) {
      await authStore.updateProfile({ name })
    }
    if (localAvatarFile.value) {
      await authStore.updateProfile({ avatar: localAvatarFile.value })
    }
    profileSuccess.value = 'Profile saved successfully'
    localAvatarFile.value = null
    localAvatarPreview.value = null
  }
  catch (err: any) {
    toast(err?.message || 'Failed to update profile')
  }
  finally {
    isSavingProfile.value = false
  }
}

async function handleRemoveAvatar() {
  try {
    await authStore.updateProfile({ removeAvatar: true })
    localAvatarPreview.value = null
    localAvatarFile.value = null
    profileSuccess.value = 'Avatar removed'
  }
  catch (err: any) {
    toast(err?.message || 'Failed to remove avatar')
  }
}

function handleAvatarSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) {
    toast('Image must be under 5MB')
    return
  }
  localAvatarFile.value = file
  const reader = new FileReader()
  reader.onload = (e) => {
    localAvatarPreview.value = e.target?.result as string
  }
  reader.readAsDataURL(file)
}

async function handleChangePassword() {
  passwordError.value = ''
  passwordSuccess.value = ''

  if (!currentPassword.value || !newPassword.value) {
    passwordError.value = 'All fields are required'
    return
  }
  if (newPassword.value.length < 8) {
    passwordError.value = 'Password must be at least 8 characters'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = 'Passwords do not match'
    return
  }

  isChangingPassword.value = true
  try {
    await authStore.changePassword(currentPassword.value, newPassword.value)
    passwordSuccess.value = 'Password changed successfully'
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  }
  catch (err: any) {
    passwordError.value = err?.message === 'Current password is incorrect'
      ? 'Current password is incorrect'
      : (err?.message || 'Failed to change password')
  }
  finally {
    isChangingPassword.value = false
  }
}

async function save() {
  provider.value = localProvider.value

  if (canManageLocalKeys.value) {
    await secureSetItem('ai-gateway-api-key', apiKey.value.trim() || null)
    await secureSetItem('opencode-api-key', opencodeApiKey.value.trim() || null)
  }

  setFont(localChatFont.value)
  setFontSize(localChatFontSize.value)

  emit('update:open', false)
}

function handleOpenChange(val: boolean) {
  emit('update:open', val)
}

async function handleDeleteAllChats() {
  if (isDeletingAll.value) return
  isDeletingAll.value = true
  try {
    await chatStore.deleteAllChats()
    deletePopoverOpen.value = false
    emit('update:open', false)
    router.push('/')
  }
  catch {
    toast('Failed to delete all chats')
  }
  finally {
    isDeletingAll.value = false
  }
}

const navItems = [
  { key: 'general' as const, label: 'settings.sections.general', icon: Settings },
  { key: 'account' as const, label: 'settings.sections.account', icon: User },
  { key: 'privacy' as const, label: 'settings.sections.privacy', icon: Shield },
]
</script>

<template>
  <Dialog :open="props.open" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-2xl p-0 gap-0 overflow-hidden">
      <!-- Header -->
      <DialogHeader class="px-6 pt-6 pb-2">
        <DialogTitle>{{ $t('settings.title') }}</DialogTitle>
        <DialogDescription class="sr-only">
          {{ $t('settings.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex h-[400px]">
          <!-- Sidebar -->
          <nav class="w-48 bg-muted/50 border-r border-border flex flex-col py-4 px-2 gap-0.5 shrink-0">
            <button
              v-for="item in navItems"
              :key="item.key"
              type="button"
              :class="[
                'flex items-center gap-2.5 w-full px-3 py-2.5 rounded-md text-sm font-medium transition-colors text-left',
                activeSection === item.key
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'
              ]"
              @click="activeSection = item.key"
            >
              <component :is="item.icon" class="size-4 shrink-0" />
              {{ $t(item.label) }}
            </button>
          </nav>

          <!-- Content -->
          <ScrollArea class="flex-1">
            <div class="p-6 space-y-6">
              <!-- General -->
            <div v-if="activeSection === 'general'" class="space-y-6">
              <div v-if="showProviderSelector" class="space-y-2">
                <Label for="ai-provider">{{ $t('settings.providerLabel') }}</Label>
                <Select v-model="localProvider">
                  <SelectTrigger id="ai-provider" class="w-full">
                    <SelectValue :placeholder="$t('settings.providerPlaceholder')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="p in providers" :key="p.value" :value="p.value">
                      {{ p.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p class="text-xs text-muted-foreground">
                  {{ $t('settings.providerHint') }}
                </p>
              </div>

              <template v-if="showVercelKeyInput">
                <div class="space-y-2">
                  <Label for="api-key">{{ $t('settings.vercelApiKeyLabel') }}</Label>
                  <Input
                    id="api-key"
                    v-model="apiKey"
                    type="password"
                    :placeholder="$t('settings.vercelApiKeyPlaceholder')"
                  />
                  <p class="text-xs text-muted-foreground">
                    {{ $t('settings.vercelApiKeyHint') }}
                  </p>
                </div>
              </template>

              <template v-if="showOpenCodeKeyInput">
                <div class="space-y-2">
                  <Label for="opencode-api-key">{{ $t('settings.opencodeApiKeyLabel') }}</Label>
                  <Input
                    id="opencode-api-key"
                    v-model="opencodeApiKey"
                    type="password"
                    :placeholder="$t('settings.opencodeApiKeyPlaceholder')"
                  />
                  <p class="text-xs text-muted-foreground">
                    {{ $t('settings.opencodeApiKeyHint') }}
                  </p>
                </div>
              </template>

              <div class="space-y-2">
                <Label for="theme">{{ $t('settings.theme') }}</Label>
                <Select :model-value="theme" @update:model-value="setTheme($event as Theme)">
                  <SelectTrigger id="theme" class="w-full">
                    <SelectValue :placeholder="$t('settings.themePlaceholder')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">{{ $t('settings.themeLight') }}</SelectItem>
                    <SelectItem value="dark">{{ $t('settings.themeDark') }}</SelectItem>
                    <SelectItem value="system">{{ $t('settings.themeSystem') }}</SelectItem>
                  </SelectContent>
                </Select>
                <p class="text-xs text-muted-foreground">
                  {{ $t('settings.themeHint') }}
                </p>
              </div>

              <div class="space-y-2">
                <Label for="app-font">{{ $t('settings.appFont') }}</Label>
                <Select v-model="localChatFont">
                  <SelectTrigger id="app-font" class="w-full">
                    <SelectValue :placeholder="$t('settings.appFontPlaceholder')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="spectral">{{ $t('settings.appFontSpectral') }}</SelectItem>
                    <SelectItem value="open-sans">{{ $t('settings.appFontOpenSans') }}</SelectItem>
                    <SelectItem value="montserrat">{{ $t('settings.appFontMontserrat') }}</SelectItem>
                    <SelectItem value="manrope">{{ $t('settings.appFontManrope') }}</SelectItem>
                    <SelectItem value="ibm-plex-sans">{{ $t('settings.appFontIbmPlexSans') }}</SelectItem>
                    <SelectItem value="merriweather">{{ $t('settings.appFontMerriweather') }}</SelectItem>
                    <SelectItem value="geist">{{ $t('settings.appFontGeist') }}</SelectItem>
                    <SelectItem value="sn-pro">{{ $t('settings.appFontSnPro') }}</SelectItem>
                    <SelectItem value="ibm-plex-mono">{{ $t('settings.appFontIbmPlexMono') }}</SelectItem>
                  </SelectContent>
                </Select>
                <p class="text-xs text-muted-foreground">
                  {{ $t('settings.appFontHint') }}
                </p>
              </div>

              <div class="space-y-2">
                <Label for="app-font-size">{{ $t('settings.appFontSize') }}</Label>
                <Select v-model="localChatFontSize">
                  <SelectTrigger id="app-font-size" class="w-full">
                    <SelectValue :placeholder="$t('settings.appFontSizePlaceholder')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sm">{{ $t('settings.appFontSizeSm') }}</SelectItem>
                    <SelectItem value="md">{{ $t('settings.appFontSizeMd') }}</SelectItem>
                    <SelectItem value="lg">{{ $t('settings.appFontSizeLg') }}</SelectItem>
                    <SelectItem value="xl">{{ $t('settings.appFontSizeXl') }}</SelectItem>
                  </SelectContent>
                </Select>
                <p class="text-xs text-muted-foreground">
                  {{ $t('settings.appFontSizeHint') }}
                </p>
              </div>

              <div class="space-y-2">
                <Label for="language">{{ $t('settings.language') }}</Label>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    :class="[
                      'px-4 py-2 text-sm font-medium rounded-l-md border transition-colors',
                      locale === 'en'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-foreground border-input hover:bg-accent hover:text-accent-foreground'
                    ]"
                    @click="setLocale('en')"
                  >
                    English
                  </button>
                  <button
                    type="button"
                    :class="[
                      'px-4 py-2 text-sm font-medium rounded-r-md border border-l-0 transition-colors',
                      locale === 'es'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-foreground border-input hover:bg-accent hover:text-accent-foreground'
                    ]"
                    @click="setLocale('es')"
                  >
                    Español
                  </button>
                </div>
                <p class="text-xs text-muted-foreground">
                  {{ $t('settings.languageHint') }}
                </p>
              </div>
            </div>

            <!-- Account -->
            <div v-if="activeSection === 'account'" class="space-y-6">
              <!-- Profile photo -->
              <div class="space-y-2">
                <Label>{{ $t('settings.account.avatarLabel') }}</Label>
                <div class="flex items-center gap-4">
                  <div class="relative">
                    <span class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted text-xl font-medium text-muted-foreground overflow-hidden">
                      <template v-if="localAvatarPreview">
                        <img :src="localAvatarPreview" alt="Preview" class="h-full w-full object-cover" />
                      </template>
                      <template v-else-if="authStore.avatarUrl">
                        <img :src="authStore.avatarUrl" alt="Avatar" class="h-full w-full object-cover" />
                      </template>
                      <template v-else>
                        {{ (localName || authStore.userName || userEmail || 'U').charAt(0).toUpperCase() }}
                      </template>
                    </span>
                    <button
                      type="button"
                      class="absolute -bottom-1 -right-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                      @click="avatarInputRef?.click()"
                    >
                      <Camera class="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      class="gap-2"
                      @click="avatarInputRef?.click()"
                    >
                      <Camera class="h-3.5 w-3.5" />
                      {{ $t('settings.account.changePhoto') }}
                    </Button>
                    <Button
                      v-if="authStore.avatarUrl"
                      variant="ghost"
                      size="sm"
                      class="text-destructive gap-2"
                      @click="handleRemoveAvatar"
                    >
                      {{ $t('settings.account.removePhoto') }}
                    </Button>
                  </div>
                </div>
                <input
                  ref="avatarInputRef"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  class="hidden"
                  @change="handleAvatarSelected"
                />
              </div>

              <!-- Name -->
              <div class="space-y-2">
                <Label for="account-name">{{ $t('settings.account.nameLabel') }}</Label>
                <Input
                  id="account-name"
                  v-model="localName"
                  type="text"
                  :placeholder="$t('settings.account.namePlaceholder')"
                />
                <p class="text-xs text-muted-foreground">
                  {{ $t('settings.account.nameHint') }}
                </p>
              </div>

              <!-- Email (read-only) -->
              <div class="space-y-2">
                <Label for="account-email">{{ $t('settings.account.emailLabel') }}</Label>
                <Input
                  id="account-email"
                  :model-value="userEmail"
                  type="email"
                  disabled
                  class="opacity-60"
                />
                <p class="text-xs text-muted-foreground">
                  {{ $t('settings.account.emailHint') }}
                </p>
              </div>

              <div v-if="profileSuccess" class="text-sm text-green-600 dark:text-green-400">
                {{ profileSuccess }}
              </div>

              <Button
                :disabled="isSavingProfile"
                @click="handleSaveAccount"
              >
                {{ isSavingProfile ? $t('settings.account.saving') : $t('settings.account.saveProfile') }}
              </Button>

              <Separator class="my-4" />

              <!-- Change password -->
              <div class="space-y-4">
                <div class="flex items-center gap-2">
                  <KeyRound class="h-4 w-4 text-muted-foreground" />
                  <h3 class="text-sm font-medium">{{ $t('settings.account.changePassword') }}</h3>
                </div>

                <div class="space-y-2">
                  <Label for="current-password">{{ $t('settings.account.currentPassword') }}</Label>
                  <Input
                    id="current-password"
                    v-model="currentPassword"
                    type="password"
                    :placeholder="$t('settings.account.currentPasswordPlaceholder')"
                  />
                </div>

                <div class="space-y-2">
                  <Label for="new-password">{{ $t('settings.account.newPassword') }}</Label>
                  <Input
                    id="new-password"
                    v-model="newPassword"
                    type="password"
                    :placeholder="$t('settings.account.newPasswordPlaceholder')"
                  />
                </div>

                <div class="space-y-2">
                  <Label for="confirm-password">{{ $t('settings.account.confirmNewPassword') }}</Label>
                  <Input
                    id="confirm-password"
                    v-model="confirmPassword"
                    type="password"
                    :placeholder="$t('settings.account.confirmNewPasswordPlaceholder')"
                  />
                </div>

                <div v-if="passwordError" class="text-sm text-destructive">
                  {{ passwordError }}
                </div>

                <div v-if="passwordSuccess" class="text-sm text-green-600 dark:text-green-400">
                  {{ passwordSuccess }}
                </div>

                <Button
                  variant="secondary"
                  :disabled="isChangingPassword"
                  @click="handleChangePassword"
                >
                  {{ isChangingPassword ? $t('settings.account.changing') : $t('settings.account.updatePassword') }}
                </Button>
              </div>
            </div>

            <!-- Privacy -->
            <div v-if="activeSection === 'privacy'" class="space-y-6">
              <div class="space-y-2">
                <Label>{{ $t('settings.data') }}</Label>
                <Popover v-model:open="deletePopoverOpen">
                  <PopoverTrigger as-child>
                    <Button variant="destructive" class="w-full gap-2" :disabled="chatStore.chats.length === 0">
                      <Trash2 class="h-4 w-4" />
                      {{ $t('settings.deleteAllChats') }}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-80">
                    <div class="space-y-4">
                      <div>
                        <h4 class="font-medium text-sm">{{ $t('settings.deleteConfirmTitle') }}</h4>
                        <p class="text-xs text-muted-foreground mt-1">
                          {{ $t('settings.deleteConfirmDescription') }}
                        </p>
                      </div>
                      <div class="flex justify-end gap-2">
                        <Button variant="outline" size="sm" @click="deletePopoverOpen = false">
                          {{ $t('app.cancel') }}
                        </Button>
                        <Button variant="destructive" size="sm" :disabled="isDeletingAll" @click="handleDeleteAllChats">
                          {{ isDeletingAll ? $t('settings.deleting') : $t('settings.confirmDelete') }}
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <p class="text-xs text-muted-foreground">
                  {{ $t('settings.deleteHint') }}
                </p>
              </div>
            </div>
          </div>
        </ScrollArea>
        </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 px-6 py-4 border-t border-border">
        <Button variant="outline" @click="handleOpenChange(false)">
          {{ $t('app.cancel') }}
        </Button>
        <Button @click="save">
          {{ $t('app.save') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
