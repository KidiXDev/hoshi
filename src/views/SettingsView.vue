<script setup lang="ts">
import BooruSettings from '@/components/settings/BooruSettings.vue';
import AiSettings from '@/components/settings/AiSettings.vue';
import SystemInfoSettings from '@/components/settings/SystemInfoSettings.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  AppWindow,
  Bot,
  Check,
  CheckCircle2,
  CloudDownload,
  Cpu,
  ExternalLink,
  FlaskConical,
  FolderOpen,
  FolderSearch,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Info,
  KeyRound,
  Loader2,
  MonitorCog,
  Puzzle,
  RefreshCw,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  WholeWord,
  Wifi,
  Wrench,
  XCircle
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { BRAND_NAME, REPO_SLUG } from '@/lib/brand';
import { loadAppData, saveAppData } from '../services/appStorage';
import { ComfyApi } from '../services/comfyApi';
import {
  getGalleryCacheStats,
  type GalleryCacheStats
} from '../services/imageGallery';
import { WordAutocomplete } from '../services/wordAutocomplete';
import { useComfyStore } from '../stores/comfyStore';
import { useGalleryCacheStore } from '../stores/galleryCacheStore';
import {
  cleanPath,
  DEFAULT_LAUNCHER_CONFIG,
  useLauncherStore
} from '../stores/launcherStore';
import type { ComfyUpdateStatus } from '../types/launcher';
import { formatFileSize, formatRelativeTime } from '../utils/formatters';
import { APP_VERSION, isNewerVersion } from '../version';
import PageLayout from '@/components/layout/PageLayout.vue';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import SettingsSection from '@/components/layout/SettingsSection.vue';
import SettingsSwitchRow from '@/components/layout/SettingsSwitchRow.vue';

const launcherStore = useLauncherStore();
const comfyStore = useComfyStore();

const tabs = [
  { id: 'comfyui', label: 'ComfyUI', icon: Terminal },
  { id: 'booru', label: 'Booru gallery', icon: ImageIcon },
  { id: 'civitai', label: 'Civitai', icon: KeyRound },
  { id: 'ai', label: 'AI assistant', icon: Bot },
  { id: 'general', label: 'General', icon: AppWindow },
  { id: 'system', label: 'System Information', icon: MonitorCog }
] as const;
type SettingsTab = (typeof tabs)[number]['id'];
const activeTab = ref<SettingsTab>('comfyui');

const workingDir = ref(launcherStore.config.workingDir);
const pythonPath = ref(launcherStore.config.pythonPath);
const args = ref(launcherStore.config.args);
const serverUrl = ref(launcherStore.config.serverUrl);
const autoStart = ref(launcherStore.config.autoStart);
const closeToTray = ref(launcherStore.config.closeToTray);
const autocompleteEnabled = ref(launcherStore.config.autocompleteEnabled);
const autocompleteAlgorithm = ref(launcherStore.config.autocompleteAlgorithm);
const autocompleteLimit = ref(launcherStore.config.autocompleteLimit);
const autocompleteReplaceUnderscores = ref(
  launcherStore.config.autocompleteReplaceUnderscores
);
const autocompleteIncludeArtistPrefix = ref(
  launcherStore.config.autocompleteIncludeArtistPrefix
);
const autocompleteEscapeParentheses = ref(
  launcherStore.config.autocompleteEscapeParentheses
);
const wordAutocompleteEnabled = ref(
  launcherStore.config.wordAutocompleteEnabled
);
const promptEditorMode = ref(launcherStore.config.promptEditorMode);
const WORDFREQ_DATA_URL =
  'https://github.com/rspeer/wordfreq/tree/master/wordfreq/data';
const wordListStatus = ref<{ ok: boolean; message: string } | null>(null);
const isLoadingWordList = ref(false);
const civitaiApiKey = ref('');
const savedCivitaiApiKey = ref('');
const hasCivitaiApiKey = ref(false);
const civitaiNsfw = ref(false);
let applyingCivitaiSettings = true;
let lastSavedCivitaiNsfw = false;

const isTesting = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);
const saveSuccess = ref(false);
const updateChecking = ref(false);
const updateResult = ref<{
  message: string;
  type: 'current' | 'update' | 'error';
  url?: string;
} | null>(null);
const isInstallDialogOpen = ref(false);
const repositoryUrl = ref('');
const isInstallingCustomNode = ref(false);
const installResult = ref<{ ok: boolean; message: string } | null>(null);
const autocompleteReady = computed(
  () => comfyStore.isConnected && comfyStore.isYetEssentialAvailable
);
const comfyUpdate = ref<ComfyUpdateStatus | null>(null);
const comfyUpdateError = ref('');
const isCheckingComfyUpdate = ref(false);
const isComfyServerActive = computed(
  () => !['stopped', 'error'].includes(launcherStore.processStatus)
);

async function loadCivitaiSettings() {
  try {
    const settings = await loadAppData<{ apiKey?: string; nsfw?: boolean }>(
      'civitai_settings'
    );
    const storedKey = settings?.apiKey?.trim() ?? '';
    savedCivitaiApiKey.value = storedKey;
    hasCivitaiApiKey.value = !!storedKey;
    civitaiApiKey.value = '';
    civitaiNsfw.value = settings?.nsfw ?? false;
    lastSavedCivitaiNsfw = civitaiNsfw.value;
  } catch (error) {
    console.error(error);
  } finally {
    applyingCivitaiSettings = false;
  }
}

async function clearCivitaiApiKey() {
  savedCivitaiApiKey.value = '';
  civitaiApiKey.value = '';
  hasCivitaiApiKey.value = false;
  try {
    await saveAppData('civitai_settings', {
      apiKey: '',
      nsfw: civitaiNsfw.value
    });
    showSaved();
  } catch (error) {
    console.error(error);
  }
}

async function refreshWordList() {
  isLoadingWordList.value = true;
  try {
    const words = await WordAutocomplete.reload();
    wordListStatus.value = {
      ok: true,
      message: `${words.length.toLocaleString()} words loaded`
    };
  } catch (error) {
    wordListStatus.value = {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    isLoadingWordList.value = false;
  }
}

function openWordListFolder() {
  void WordAutocomplete.openFolder().catch(console.error);
}

onMounted(() => {
  void loadCivitaiSettings();
  void refreshWordList();
});
let saveSuccessTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  autocompleteReady,
  async (ready) => {
    if (!ready) return;
    const settings = await ComfyApi.fetchTagAutocompleteSettings(
      serverUrl.value
    );
    if (!settings) return;
    autocompleteAlgorithm.value = settings.search_algorithm;
    autocompleteLimit.value = settings.search_limit;
  },
  { immediate: true }
);

async function handleBrowseComfyDir() {
  const dir = await launcherStore.selectComfyDir();
  if (dir) {
    workingDir.value = dir;
  }
}

function openInExplorer(path: string) {
  const target = cleanPath(path);
  if (!target) return;
  void invoke('show_in_folder', { path: target }).catch(console.error);
}

async function handleBrowsePythonDir() {
  const dir = await launcherStore.selectPythonDir();
  if (dir) {
    pythonPath.value = dir;
  }
}

function showSaved() {
  saveSuccess.value = true;
  clearTimeout(saveSuccessTimer);
  saveSuccessTimer = setTimeout(() => {
    saveSuccess.value = false;
  }, 2500);
}

async function saveApplicationSettings() {
  autocompleteLimit.value = Math.min(
    50,
    Math.max(5, Number(autocompleteLimit.value) || 20)
  );
  const cleanedServerUrl = cleanPath(serverUrl.value);
  const serverChanged = cleanedServerUrl !== launcherStore.config.serverUrl;
  await launcherStore.saveConfig({
    workingDir: cleanPath(workingDir.value),
    pythonPath: cleanPath(pythonPath.value),
    args: args.value.trim(),
    serverUrl: cleanedServerUrl,
    autoStart: autoStart.value,
    closeToTray: closeToTray.value,
    autocompleteEnabled: autocompleteEnabled.value,
    autocompleteAlgorithm: autocompleteAlgorithm.value,
    autocompleteLimit: autocompleteLimit.value,
    autocompleteReplaceUnderscores: autocompleteReplaceUnderscores.value,
    autocompleteIncludeArtistPrefix: autocompleteIncludeArtistPrefix.value,
    autocompleteEscapeParentheses: autocompleteEscapeParentheses.value,
    wordAutocompleteEnabled: wordAutocompleteEnabled.value,
    promptEditorMode: promptEditorMode.value
  });
  if (!serverChanged && autocompleteEnabled.value && autocompleteReady.value) {
    await ComfyApi.updateTagAutocompleteSettings(
      cleanedServerUrl,
      autocompleteAlgorithm.value,
      autocompleteLimit.value
    );
  }
  showSaved();
  if (serverChanged) comfyStore.init();
}

const autosaveApplicationSettings = useDebounceFn(
  () => void saveApplicationSettings().catch(console.error),
  600
);
const autosaveCivitaiSettings = useDebounceFn(() => {
  const newKey = civitaiApiKey.value.trim();
  const nsfwChanged = civitaiNsfw.value !== lastSavedCivitaiNsfw;
  if (!newKey && !nsfwChanged) return;

  const keyToSave = newKey ? newKey : savedCivitaiApiKey.value;
  void saveAppData('civitai_settings', {
    apiKey: keyToSave,
    nsfw: civitaiNsfw.value
  })
    .then(() => {
      lastSavedCivitaiNsfw = civitaiNsfw.value;
      if (newKey) {
        savedCivitaiApiKey.value = newKey;
        hasCivitaiApiKey.value = true;
        civitaiApiKey.value = '';
      }
      showSaved();
    })
    .catch(console.error);
}, 600);

watch(
  [
    workingDir,
    pythonPath,
    args,
    serverUrl,
    autoStart,
    closeToTray,
    autocompleteEnabled,
    autocompleteAlgorithm,
    autocompleteLimit,
    autocompleteReplaceUnderscores,
    autocompleteIncludeArtistPrefix,
    autocompleteEscapeParentheses,
    wordAutocompleteEnabled,
    promptEditorMode
  ],
  () => autosaveApplicationSettings(),
  { deep: true }
);

watch([civitaiApiKey, civitaiNsfw], () => {
  if (!applyingCivitaiSettings) autosaveCivitaiSettings();
});

async function installCustomNode() {
  if (!repositoryUrl.value.trim() || isInstallingCustomNode.value) return;
  isInstallingCustomNode.value = true;
  installResult.value = null;
  try {
    const message = await invoke<string>('install_custom_node', {
      repositoryUrl: repositoryUrl.value.trim(),
      workingDir: cleanPath(workingDir.value),
      pythonPath: cleanPath(pythonPath.value)
    });
    installResult.value = { ok: true, message };
    repositoryUrl.value = '';
  } catch (error) {
    installResult.value = {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    isInstallingCustomNode.value = false;
  }
}

async function checkComfyUpdate() {
  isCheckingComfyUpdate.value = true;
  comfyUpdateError.value = '';
  try {
    comfyUpdate.value = await launcherStore.checkComfyUpdate();
  } catch (error) {
    comfyUpdate.value = null;
    comfyUpdateError.value =
      error instanceof Error ? error.message : String(error);
  } finally {
    isCheckingComfyUpdate.value = false;
  }
}

async function updateComfy() {
  comfyUpdateError.value = '';
  try {
    await launcherStore.updateComfy();
    await checkComfyUpdate();
  } catch (error) {
    comfyUpdateError.value =
      error instanceof Error ? error.message : String(error);
  }
}

function handleResetDefaults() {
  workingDir.value = DEFAULT_LAUNCHER_CONFIG.workingDir;
  pythonPath.value = DEFAULT_LAUNCHER_CONFIG.pythonPath;
  args.value = DEFAULT_LAUNCHER_CONFIG.args;
  serverUrl.value = DEFAULT_LAUNCHER_CONFIG.serverUrl;
  autoStart.value = DEFAULT_LAUNCHER_CONFIG.autoStart;
  closeToTray.value = DEFAULT_LAUNCHER_CONFIG.closeToTray;
  autocompleteEnabled.value = DEFAULT_LAUNCHER_CONFIG.autocompleteEnabled;
  autocompleteAlgorithm.value = DEFAULT_LAUNCHER_CONFIG.autocompleteAlgorithm;
  autocompleteLimit.value = DEFAULT_LAUNCHER_CONFIG.autocompleteLimit;
  autocompleteReplaceUnderscores.value =
    DEFAULT_LAUNCHER_CONFIG.autocompleteReplaceUnderscores;
  autocompleteIncludeArtistPrefix.value =
    DEFAULT_LAUNCHER_CONFIG.autocompleteIncludeArtistPrefix;
  autocompleteEscapeParentheses.value =
    DEFAULT_LAUNCHER_CONFIG.autocompleteEscapeParentheses;
  wordAutocompleteEnabled.value =
    DEFAULT_LAUNCHER_CONFIG.wordAutocompleteEnabled;
  promptEditorMode.value = DEFAULT_LAUNCHER_CONFIG.promptEditorMode;
  civitaiApiKey.value = '';
  civitaiNsfw.value = false;
}

async function testConnection() {
  isTesting.value = true;
  testResult.value = null;
  const start = Date.now();
  const ok = await ComfyApi.checkHealth(serverUrl.value);
  comfyStore.isConnected = ok;
  comfyStore.isYetEssentialAvailable = ok
    ? await ComfyApi.checkTagAutocomplete(serverUrl.value)
    : false;
  const latency = Date.now() - start;
  isTesting.value = false;

  if (ok) {
    testResult.value = {
      ok: true,
      message: `Successfully connected to ComfyUI server (${latency}ms)`
    };
    comfyStore.fetchDiscovery();
  } else {
    testResult.value = {
      ok: false,
      message:
        'Failed to reach ComfyUI server. Make sure the server is running.'
    };
  }
}

async function checkForUpdates() {
  updateChecking.value = true;
  updateResult.value = null;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_SLUG}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

    const release = (await response.json()) as {
      tag_name: string;
      html_url: string;
    };
    const developmentBuild = APP_VERSION === 'dev-build';
    const updateAvailable =
      developmentBuild || isNewerVersion(release.tag_name, APP_VERSION);

    updateResult.value = updateAvailable
      ? {
          type: 'update',
          message: developmentBuild
            ? `Latest release: ${release.tag_name}`
            : `${release.tag_name} is available.`,
          url: release.html_url
        }
      : {
          type: 'current',
          message: `You're up to date (${APP_VERSION}).`
        };
  } catch (error) {
    updateResult.value = {
      type: 'error',
      message: `Unable to check for updates: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    updateChecking.value = false;
  }
}

// Disk cache (network responses + generation thumbnails)
const galleryCache = useGalleryCacheStore();
const networkCacheStats = ref<{
  totalEntries: number;
  totalSizeBytes: number;
} | null>(null);
const thumbnailCacheStats = ref<GalleryCacheStats | null>(null);
const isClearingNetworkCache = ref(false);
const cacheResult = ref<{ ok: boolean; message: string } | null>(null);
let cacheResultTimer: ReturnType<typeof setTimeout> | undefined;

async function loadCacheStats() {
  const [network, thumbnails] = await Promise.allSettled([
    invoke<{ totalEntries: number; totalSizeBytes: number }>(
      'get_network_cache_stats'
    ),
    getGalleryCacheStats()
  ]);
  if (network.status === 'fulfilled') networkCacheStats.value = network.value;
  else console.warn('Failed to load network cache stats:', network.reason);
  if (thumbnails.status === 'fulfilled')
    thumbnailCacheStats.value = thumbnails.value;
  else console.warn('Failed to load thumbnail cache stats:', thumbnails.reason);
}

function showCacheResult(error: string, successMessage: string) {
  clearTimeout(cacheResultTimer);
  cacheResult.value = error
    ? { ok: false, message: `Failed to clear: ${error}` }
    : { ok: true, message: successMessage };
  if (!error) {
    cacheResultTimer = setTimeout(() => {
      cacheResult.value = null;
    }, 3000);
  }
}

async function clearNetworkCache() {
  if (isClearingNetworkCache.value) return;
  isClearingNetworkCache.value = true;
  let error = '';
  try {
    await invoke('clear_network_cache', { namespace: null });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    isClearingNetworkCache.value = false;
  }
  await loadCacheStats();
  showCacheResult(error, 'Network cache cleared.');
}

async function clearThumbnailCache() {
  if (galleryCache.isRebuilding) return;
  await galleryCache.clearAndRebuild();
  await loadCacheStats();
  showCacheResult(
    galleryCache.error,
    'Thumbnail cache cleared and re-indexed.'
  );
}

void loadCacheStats();
</script>

<template>
  <PageLayout
    title="Settings"
    subtitle="Runtime, connection, integrations, and app preferences"
    content-class="p-0"
  >
    <template #icon>
      <Settings class="h-4 w-4" />
    </template>
    <template #actions>
      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 translate-x-1"
        enter-to-class="opacity-100 translate-x-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="saveSuccess"
          class="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400"
        >
          <Check class="h-3.5 w-3.5" />
          <span>Saved</span>
        </div>
      </transition>

      <Button
        variant="outline"
        size="sm"
        class="border-border bg-secondary/80 text-foreground hover:bg-accent text-xs font-medium"
        @click="handleResetDefaults"
      >
        <RefreshCw class="h-3.5 w-3.5" />
        <span>Reset defaults</span>
      </Button>
    </template>

    <div class="flex h-full min-h-0">
      <!-- Section navigation -->
      <nav
        class="border-border/80 bg-card/40 flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-3"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors"
          :class="
            activeTab === tab.id
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          "
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="h-3.5 w-3.5 shrink-0" />
          <span class="truncate">{{ tab.label }}</span>
          <span
            v-if="tab.id === 'comfyui'"
            class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full"
            :class="
              comfyStore.isConnected
                ? 'bg-emerald-400'
                : 'bg-muted-foreground/50'
            "
          />
        </button>

        <div class="mt-auto px-3 pt-4">
          <p class="text-muted-foreground/70 font-mono text-xs">
            {{ APP_VERSION }}
          </p>
        </div>
      </nav>

      <!-- Section content -->
      <div class="min-w-0 flex-1 overflow-y-auto p-6">
        <div class="flex flex-col gap-5 pb-8">
          <!-- ComfyUI -->
          <template v-if="activeTab === 'comfyui'">
            <SettingsSection
              title="Runtime"
              description="Where ComfyUI lives and how it is launched."
              icon-class="text-cyan-400"
            >
              <template #icon>
                <Terminal class="h-3.5 w-3.5" />
              </template>
              <template #actions>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="border-border bg-secondary text-xs font-medium"
                  @click="isInstallDialogOpen = true"
                >
                  <Puzzle class="h-3.5 w-3.5" />
                  Install custom node
                </Button>
              </template>

              <Field class="gap-1.5">
                <FieldLabel class="text-foreground text-xs font-medium">
                  ComfyUI directory
                </FieldLabel>
                <div class="flex items-center gap-2">
                  <div class="relative flex-1">
                    <FolderOpen
                      class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
                    />
                    <Input
                      v-model="workingDir"
                      placeholder="Folder containing main.py"
                      class="text-foreground pl-9 font-mono text-xs"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="iconSm"
                    :disabled="!cleanPath(workingDir)"
                    title="Open in Explorer"
                    class="border-border bg-secondary text-muted-foreground hover:text-foreground h-8 w-8 shrink-0"
                    @click="openInExplorer(workingDir)"
                  >
                    <FolderOpen class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    class="border-border bg-secondary text-foreground hover:bg-accent shrink-0 text-xs font-medium"
                    @click="handleBrowseComfyDir"
                  >
                    <FolderSearch class="h-3.5 w-3.5" />
                    Browse
                  </Button>
                </div>
              </Field>

              <Field class="gap-1.5">
                <FieldLabel class="text-foreground text-xs font-medium">
                  Python
                </FieldLabel>
                <div class="flex items-center gap-2">
                  <div class="relative flex-1">
                    <Cpu
                      class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
                    />
                    <Input
                      v-model="pythonPath"
                      placeholder="python_embeded or python_embeded\python.exe"
                      class="text-foreground pl-9 font-mono text-xs"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="iconSm"
                    :disabled="!cleanPath(pythonPath)"
                    title="Open in Explorer"
                    class="border-border bg-secondary text-muted-foreground hover:text-foreground h-8 w-8 shrink-0"
                    @click="openInExplorer(pythonPath)"
                  >
                    <FolderOpen class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    class="border-border bg-secondary text-foreground hover:bg-accent shrink-0 text-xs font-medium"
                    @click="handleBrowsePythonDir"
                  >
                    <FolderSearch class="h-3.5 w-3.5" />
                    Browse
                  </Button>
                </div>
                <FieldDescription class="text-xs">
                  Embedded Python directory or interpreter used to run
                  <code class="font-mono">main.py</code>.
                </FieldDescription>
              </Field>

              <Field class="gap-1.5">
                <FieldLabel class="text-foreground text-xs font-medium">
                  Launch arguments
                </FieldLabel>
                <Textarea
                  v-model="args"
                  rows="3"
                  placeholder="--windows-standalone-build --fast fp16_accumulation --cuda-malloc --use-sage-attention --preview-method latent2rgb --enable-manager --disable-auto-launch"
                  class="text-foreground border-border bg-secondary/50 focus:bg-background w-full font-mono text-xs leading-relaxed transition-colors"
                />
              </Field>

              <SettingsSwitchRow
                v-model="autoStart"
                label="Auto-launch on startup"
                description="Start the ComfyUI process as soon as the app opens."
              />
            </SettingsSection>

            <SettingsSection
              title="Updates"
              description="Pull the latest ComfyUI master, like update_comfyui.bat in the portable build."
              icon-class="text-sky-400"
            >
              <template #icon>
                <CloudDownload class="h-3.5 w-3.5" />
              </template>
              <template #actions>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="border-border bg-secondary text-xs font-medium"
                  :disabled="
                    !!launcherStore.localSetupMessage ||
                    isCheckingComfyUpdate ||
                    launcherStore.isUpdating
                  "
                  @click="checkComfyUpdate"
                >
                  <Loader2
                    v-if="isCheckingComfyUpdate"
                    class="h-3.5 w-3.5 animate-spin"
                  />
                  <RefreshCw v-else class="h-3.5 w-3.5" />
                  Check for updates
                </Button>
                <Button
                  type="button"
                  size="sm"
                  class="text-xs font-medium"
                  :disabled="
                    !!launcherStore.localSetupMessage ||
                    isComfyServerActive ||
                    launcherStore.isUpdating
                  "
                  @click="updateComfy"
                >
                  <Loader2
                    v-if="launcherStore.isUpdating"
                    class="h-3.5 w-3.5 animate-spin"
                  />
                  <CloudDownload v-else class="h-3.5 w-3.5" />
                  {{
                    launcherStore.isUpdating ? 'Updating…' : 'Update ComfyUI'
                  }}
                </Button>
              </template>

              <div v-if="comfyUpdate">
                <p class="text-muted-foreground text-xs">Installed</p>
                <p class="mt-1 font-mono text-sm font-semibold">
                  {{
                    comfyUpdate.version
                      ? `v${comfyUpdate.version}`
                      : 'Unknown version'
                  }}
                  <span class="text-muted-foreground text-xs font-normal">
                    {{ comfyUpdate.commit.slice(0, 7) }} on
                    {{ comfyUpdate.branch || 'detached HEAD' }}
                  </span>
                </p>
              </div>

              <p
                v-if="isComfyServerActive && !launcherStore.isUpdating"
                class="text-muted-foreground text-xs"
              >
                Stop ComfyUI before updating it.
              </p>

              <NoticeBanner v-if="launcherStore.isUpdating" tone="info">
                <template #icon>
                  <Loader2 class="h-4 w-4 shrink-0 animate-spin" />
                </template>
                Updating ComfyUI. Live output is in the terminal.
                <template #actions>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="h-7 shrink-0 text-xs"
                    @click="launcherStore.isTerminalOpen = true"
                  >
                    <Terminal class="h-3.5 w-3.5" />
                    Open terminal
                  </Button>
                </template>
              </NoticeBanner>
              <NoticeBanner v-else-if="comfyUpdateError" tone="destructive">
                <template #icon>
                  <XCircle class="h-4 w-4 shrink-0" />
                </template>
                {{ comfyUpdateError }}
              </NoticeBanner>
              <NoticeBanner
                v-else-if="comfyUpdate"
                :tone="comfyUpdate.behind ? 'info' : 'emerald'"
              >
                <template v-if="!comfyUpdate.behind" #icon>
                  <CheckCircle2 class="h-4 w-4 shrink-0" />
                </template>
                {{
                  comfyUpdate.behind
                    ? `${comfyUpdate.behind} new commit${comfyUpdate.behind === 1 ? '' : 's'} on master.`
                    : 'ComfyUI is up to date with master.'
                }}
              </NoticeBanner>

              <ul
                v-if="comfyUpdate?.commits.length && !launcherStore.isUpdating"
                class="border-border/60 divide-border/60 max-h-64 divide-y overflow-y-auto rounded-lg border"
              >
                <li
                  v-for="commit in comfyUpdate.commits"
                  :key="commit.id"
                  class="flex items-baseline gap-2.5 px-3 py-1.5 text-xs"
                >
                  <code class="text-muted-foreground shrink-0 font-mono">
                    {{ commit.id.slice(0, 7) }}
                  </code>
                  <span
                    class="text-foreground min-w-0 flex-1 truncate"
                    :title="`${commit.summary} — ${commit.author}`"
                  >
                    {{ commit.summary }}
                  </span>
                  <span class="text-muted-foreground shrink-0">
                    {{ formatRelativeTime(commit.timestamp) }}
                  </span>
                </li>
              </ul>
            </SettingsSection>

            <SettingsSection
              title="Connection"
              description="Endpoint the app talks to for generation and model discovery."
              icon-class="text-emerald-400"
              body-class="gap-3.5"
            >
              <template #icon>
                <Globe class="h-3.5 w-3.5" />
              </template>
              <template #actions>
                <span
                  class="flex h-2 w-2 rounded-full"
                  :class="
                    comfyStore.isConnected
                      ? 'bg-emerald-400 shadow-xs shadow-emerald-400/50'
                      : 'bg-muted-foreground'
                  "
                />
                <span class="text-muted-foreground text-xs">
                  {{ comfyStore.isConnected ? 'Connected' : 'Offline' }}
                </span>
              </template>

              <Field class="gap-1.5">
                <FieldLabel class="text-foreground text-xs font-medium">
                  Server URL
                </FieldLabel>
                <div class="flex items-center gap-2">
                  <div class="relative flex-1">
                    <Wifi
                      class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
                    />
                    <Input
                      v-model="serverUrl"
                      placeholder="http://127.0.0.1:8188"
                      class="text-foreground pl-9 font-mono text-xs"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="isTesting"
                    class="border-border bg-secondary text-foreground hover:bg-accent text-xs font-medium"
                    @click="testConnection"
                  >
                    <Loader2
                      v-if="isTesting"
                      class="h-3.5 w-3.5 animate-spin"
                    />
                    <Wifi v-else class="h-3.5 w-3.5" />
                    <span>Test</span>
                  </Button>
                </div>
              </Field>

              <NoticeBanner
                v-if="testResult"
                :tone="testResult.ok ? 'emerald' : 'destructive'"
              >
                <template #icon>
                  <CheckCircle2 v-if="testResult.ok" class="h-4 w-4 shrink-0" />
                  <XCircle v-else class="h-4 w-4 shrink-0" />
                </template>
                {{ testResult.message }}
              </NoticeBanner>
            </SettingsSection>
          </template>

          <!-- Booru -->
          <BooruSettings v-show="activeTab === 'booru'" @saved="showSaved" />

          <!-- Civitai -->
          <SettingsSection
            v-if="activeTab === 'civitai'"
            title="Civitai"
            description="Optional API key for gated models and NSFW browsing."
            icon-class="text-orange-400"
          >
            <template #icon>
              <KeyRound class="h-3.5 w-3.5" />
            </template>
            <template #actions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="text-xs"
                @click="openUrl('https://civitai.com/user/account')"
              >
                <ExternalLink class="h-3.5 w-3.5" />
                Manage API keys
              </Button>
            </template>

            <Field class="gap-1.5">
              <FieldLabel class="text-xs">API key</FieldLabel>
              <div class="relative">
                <Input
                  v-model="civitaiApiKey"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="
                    hasCivitaiApiKey
                      ? 'Saved'
                      : 'Optional for browsing, required by gated models'
                  "
                  class="pr-10 font-mono text-xs"
                  @keydown.enter="autosaveCivitaiSettings.flush()"
                  @blur="autosaveCivitaiSettings.flush()"
                />
                <button
                  v-if="hasCivitaiApiKey && !civitaiApiKey"
                  type="button"
                  class="text-muted-foreground hover:text-destructive absolute top-1/2 right-2.5 -translate-y-1/2 p-1 transition-colors"
                  title="Remove saved Civitai API key"
                  @click="clearCivitaiApiKey"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
            </Field>

            <SettingsSwitchRow
              v-model="civitaiNsfw"
              label="Show NSFW content"
              description="Include NSFW models and images in the Civitai browser."
              label-for="civitai-nsfw-switch"
            />
          </SettingsSection>

          <!-- AI -->
          <AiSettings v-show="activeTab === 'ai'" @saved="showSaved" />

          <!-- System information -->
          <SystemInfoSettings v-if="activeTab === 'system'" />

          <!-- General -->
          <template v-if="activeTab === 'general'">
            <SettingsSection
              title="Window"
              description="What happens when you close the main window."
              icon-class="text-sky-400"
            >
              <template #icon>
                <AppWindow class="h-3.5 w-3.5" />
              </template>
              <SettingsSwitchRow
                v-model="closeToTray"
                label="Minimize to tray on close"
                :description="`Keep ${BRAND_NAME} running in the system tray. Use Quit from the tray menu to exit completely.`"
              />
            </SettingsSection>

            <!-- Autocomplete -->
            <SettingsSection
              title="Tag autocomplete"
              description="Danbooru tag suggestions for Anima prompts, prompt chips and tag fields. Requires the yet_essential custom node."
              icon-class="text-amber-400"
            >
              <template #icon>
                <Sparkles class="h-3.5 w-3.5" />
              </template>
              <template #actions>
                <Label
                  class="text-foreground flex cursor-pointer items-center gap-2 text-xs font-medium"
                  :class="{ 'opacity-50': !autocompleteReady }"
                >
                  <Switch
                    v-model="autocompleteEnabled"
                    :disabled="!autocompleteReady"
                  />
                  <span>Enabled</span>
                </Label>
              </template>

              <NoticeBanner v-if="!autocompleteReady">
                <span v-if="!comfyStore.isConnected">
                  Start the ComfyUI server to detect autocomplete support.
                </span>
                <span v-else>
                  The
                  <code class="font-mono font-semibold">yet_essential</code>
                  custom node is not detected. Install it into
                  <code class="font-mono">custom_nodes</code> and restart
                  ComfyUI.
                </span>
              </NoticeBanner>

              <div
                class="grid grid-cols-1 gap-4 sm:grid-cols-2"
                :class="{
                  'pointer-events-none opacity-50':
                    !autocompleteEnabled || !autocompleteReady
                }"
              >
                <Field class="gap-1.5">
                  <FieldLabel class="text-foreground text-xs font-medium">
                    Search mode
                  </FieldLabel>
                  <Select
                    v-model="autocompleteAlgorithm"
                    :disabled="!autocompleteEnabled || !autocompleteReady"
                  >
                    <SelectTrigger class="w-full text-xs">
                      <SelectValue placeholder="Search mode">
                        {{
                          autocompleteAlgorithm === 'fuzzy'
                            ? 'Fuzzy (flexible matching)'
                            : autocompleteAlgorithm === 'contains'
                              ? 'Contains (substring search)'
                              : autocompleteAlgorithm === 'prefix'
                                ? 'Prefix (fastest & strictest)'
                                : autocompleteAlgorithm
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup class="max-h-40 overflow-y-auto">
                        <SelectItem value="fuzzy">
                          Fuzzy (flexible matching)
                        </SelectItem>
                        <SelectItem value="contains">
                          Contains (substring search)
                        </SelectItem>
                        <SelectItem value="prefix">
                          Prefix (fastest & strictest)
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field class="gap-1.5">
                  <FieldLabel class="text-foreground text-xs font-medium">
                    Max suggestions
                  </FieldLabel>
                  <Input
                    v-model="autocompleteLimit"
                    type="number"
                    min="5"
                    max="50"
                    :disabled="!autocompleteEnabled || !autocompleteReady"
                    class="font-mono text-xs"
                  />
                  <FieldDescription class="text-xs">5 – 50</FieldDescription>
                </Field>
              </div>

              <SettingsSwitchRow
                v-model="autocompleteReplaceUnderscores"
                label="Replace underscores with spaces"
                description="Insert “long hair” instead of “long_hair”."
                :disabled="!autocompleteEnabled || !autocompleteReady"
              />

              <SettingsSwitchRow
                v-model="autocompleteIncludeArtistPrefix"
                label="Keep @ on artist tags"
                description="Prefix inserted artist tags with @ so Anima treats them as artists."
                :disabled="!autocompleteEnabled || !autocompleteReady"
              />

              <SettingsSwitchRow
                v-model="autocompleteEscapeParentheses"
                label="Escape parentheses"
                description="Insert “miku_\(vocaloid\)” so ComfyUI does not read a tag's parentheses as emphasis."
                :disabled="!autocompleteEnabled || !autocompleteReady"
              />
            </SettingsSection>

            <!-- Word autocomplete -->
            <SettingsSection
              title="Word autocomplete"
              description="English word suggestions for MOSS-Image prompts, ranked by how common each word is. Enter or Tab accepts; Shift+Enter adds a new line, Esc dismisses."
              icon-class="text-teal-400"
            >
              <template #icon>
                <WholeWord class="h-3.5 w-3.5" />
              </template>
              <template #actions>
                <Label
                  class="text-foreground flex cursor-pointer items-center gap-2 text-xs font-medium"
                >
                  <Switch v-model="wordAutocompleteEnabled" />
                  <span>Enabled</span>
                </Label>
              </template>

              <div
                class="border-border/60 bg-muted/20 flex items-center justify-between gap-4 rounded-lg border p-3"
              >
                <div class="min-w-0">
                  <p class="text-foreground text-xs font-medium">Word list</p>
                  <p class="mt-1.5 font-mono text-sm font-semibold">
                    <span
                      v-if="wordListStatus"
                      :class="{ 'text-muted-foreground': !wordListStatus.ok }"
                    >
                      {{ wordListStatus.message }}
                    </span>
                    <span v-else class="text-muted-foreground">Loading…</span>
                  </p>
                </div>
                <div class="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    class="border-border bg-secondary hover:bg-accent h-8 gap-1.5 text-xs font-medium"
                    @click="openWordListFolder"
                  >
                    <FolderOpen class="h-3.5 w-3.5" />
                    Open folder
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    :disabled="isLoadingWordList"
                    class="border-border bg-secondary hover:bg-accent h-8 gap-1.5 text-xs font-medium"
                    @click="refreshWordList"
                  >
                    <Loader2
                      v-if="isLoadingWordList"
                      class="h-3.5 w-3.5 animate-spin"
                    />
                    <RefreshCw v-else class="h-3.5 w-3.5" />
                    Refresh
                  </Button>
                </div>
              </div>

              <NoticeBanner v-if="wordListStatus && !wordListStatus.ok">
                <span>
                  Download
                  <code class="font-mono font-semibold"
                    >small_en.msgpack.gz</code
                  >
                  or
                  <code class="font-mono font-semibold"
                    >large_en.msgpack.gz</code
                  >
                  from the
                  <button
                    type="button"
                    class="font-semibold underline underline-offset-2"
                    @click="openUrl(WORDFREQ_DATA_URL)"
                  >
                    wordfreq repository
                  </button>
                  and put it in the word list folder, then click Refresh.
                </span>
              </NoticeBanner>

              <p class="text-muted-foreground text-xs">
                Word frequencies from wordfreq by Robyn Speer, licensed CC-BY-SA
                4.0.
              </p>
            </SettingsSection>

            <!-- Disk cache -->
            <SettingsSection
              title="Disk cache"
              description="Data cached on disk"
              icon-class="text-cyan-400"
            >
              <template #icon>
                <HardDrive class="h-3.5 w-3.5" />
              </template>

              <div
                class="border-border/60 bg-muted/20 flex items-center justify-between gap-4 rounded-lg border p-3"
              >
                <div class="min-w-0">
                  <p class="text-foreground text-xs font-medium">
                    Network responses
                  </p>
                  <p class="mt-1.5 font-mono text-sm font-semibold">
                    <template v-if="networkCacheStats">
                      {{ formatFileSize(networkCacheStats.totalSizeBytes) }}
                    </template>
                    <span v-else class="text-muted-foreground">Loading…</span>
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  :disabled="
                    isClearingNetworkCache || !networkCacheStats?.totalEntries
                  "
                  class="border-border bg-secondary hover:bg-accent h-8 shrink-0 gap-1.5 text-xs font-medium"
                  @click="clearNetworkCache"
                >
                  <Loader2
                    v-if="isClearingNetworkCache"
                    class="h-3.5 w-3.5 animate-spin"
                  />
                  <Trash2 v-else class="h-3.5 w-3.5 text-rose-400" />
                  {{ isClearingNetworkCache ? 'Clearing…' : 'Clear cache' }}
                </Button>
              </div>

              <div
                class="border-border/60 bg-muted/20 flex items-center justify-between gap-4 rounded-lg border p-3"
              >
                <div class="min-w-0">
                  <p class="text-foreground text-xs font-medium">
                    Generation thumbnails
                  </p>
                  <p class="mt-1.5 font-mono text-sm font-semibold">
                    <template v-if="thumbnailCacheStats">
                      {{ formatFileSize(thumbnailCacheStats.totalSizeBytes) }}
                    </template>
                    <span v-else class="text-muted-foreground">Loading…</span>
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  :disabled="
                    galleryCache.isRebuilding ||
                    !thumbnailCacheStats?.totalSizeBytes
                  "
                  class="border-border bg-secondary hover:bg-accent h-8 shrink-0 gap-1.5 text-xs font-medium"
                  @click="clearThumbnailCache"
                >
                  <Loader2
                    v-if="galleryCache.isRebuilding"
                    class="h-3.5 w-3.5 animate-spin"
                  />
                  <Trash2 v-else class="h-3.5 w-3.5 text-rose-400" />
                  {{
                    galleryCache.isRebuilding ? 'Re-indexing…' : 'Clear cache'
                  }}
                </Button>
              </div>

              <NoticeBanner
                v-if="cacheResult"
                :tone="cacheResult.ok ? 'emerald' : 'destructive'"
              >
                {{ cacheResult.message }}
              </NoticeBanner>
            </SettingsSection>

            <!-- Advanced -->
            <SettingsSection
              title="Advanced"
              description="Power-user options that change how the app behaves."
              icon-class="text-fuchsia-400"
            >
              <template #icon>
                <Wrench class="h-3.5 w-3.5" />
              </template>

              <div class="flex flex-col gap-2.5">
                <div class="flex items-center gap-2">
                  <FlaskConical class="h-3.5 w-3.5 text-fuchsia-400" />
                  <h3 class="text-foreground text-xs font-semibold">
                    Experimental features
                  </h3>
                </div>
                <p class="text-muted-foreground text-xs">
                  Still in progress. They may change or be removed in a future
                  release.
                </p>
                <SettingsSwitchRow
                  v-model="promptEditorMode"
                  label="Prompt editor mode"
                  description="Show the prompt fields on the generation page as a text editor with line numbers."
                />
              </div>
            </SettingsSection>

            <!-- About -->
            <SettingsSection
              :title="`About ${BRAND_NAME}`"
              icon-class="text-violet-400"
            >
              <template #icon>
                <Info class="h-3.5 w-3.5" />
              </template>

              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-muted-foreground text-xs">Current version</p>
                  <p class="mt-1 font-mono text-sm font-semibold">
                    {{ APP_VERSION }}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  :disabled="updateChecking"
                  class="border-border bg-secondary text-xs font-medium"
                  @click="checkForUpdates"
                >
                  <Loader2
                    v-if="updateChecking"
                    class="h-3.5 w-3.5 animate-spin"
                  />
                  <RefreshCw v-else class="h-3.5 w-3.5" />
                  Check for updates
                </Button>
              </div>

              <NoticeBanner
                v-if="updateResult"
                :tone="
                  updateResult.type === 'current'
                    ? 'emerald'
                    : updateResult.type === 'update'
                      ? 'info'
                      : 'destructive'
                "
              >
                {{ updateResult.message }}
                <template v-if="updateResult.url" #actions>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="h-7 shrink-0 text-xs"
                    @click="openUrl(updateResult.url)"
                  >
                    View release
                    <ExternalLink class="h-3.5 w-3.5" />
                  </Button>
                </template>
              </NoticeBanner>
            </SettingsSection>
          </template>
        </div>
      </div>
    </div>
  </PageLayout>

  <Dialog v-model:open="isInstallDialogOpen">
    <DialogContent>
      <DialogHeader class="flex-row items-center justify-between">
        <DialogTitle>Install custom node</DialogTitle>
        <DialogCloseButton class="-my-1.5 -mr-2" />
      </DialogHeader>

      <Field class="gap-1.5">
        <FieldLabel>GitHub repository URL</FieldLabel>
        <Input
          v-model="repositoryUrl"
          type="url"
          autocomplete="off"
          placeholder="https://github.com/owner/custom-node"
          class="font-mono text-xs"
          :disabled="isInstallingCustomNode"
          @keydown.enter="installCustomNode"
        />
      </Field>

      <NoticeBanner
        v-if="installResult"
        :tone="installResult.ok ? 'emerald' : 'destructive'"
      >
        {{ installResult.message }}
      </NoticeBanner>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          :disabled="isInstallingCustomNode"
          @click="isInstallDialogOpen = false"
        >
          Close
        </Button>
        <Button
          type="button"
          :disabled="!repositoryUrl.trim() || isInstallingCustomNode"
          @click="installCustomNode"
        >
          <Loader2
            v-if="isInstallingCustomNode"
            class="h-3.5 w-3.5 animate-spin"
          />
          {{ isInstallingCustomNode ? 'Installing…' : 'Install' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
