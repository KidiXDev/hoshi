<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  watch
} from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import type { UnlistenFn } from '@tauri-apps/api/event';
import {
  ArrowDownUp,
  ArrowUpCircle,
  Box,
  CloudDownload,
  CloudOff,
  Copy,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  ImageOff,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X
} from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import PageLayout from '@/components/layout/PageLayout.vue';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import ModelPreviewImage from '@/components/models/ModelPreviewImage.vue';
import ModelSyncDialog from '@/components/models/ModelSyncDialog.vue';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { useModelSyncDialog } from '@/composables/useModelSyncDialog';
import {
  loadCivitaiApiKey,
  useDeleteModelMutation,
  useLocalModelsIndexQuery,
  useRescanModelsMutation,
  useSetModelPreviewMutation
} from '@/composables/useModelManagerQueries';
import {
  cancelModelSync,
  isVerified,
  modelCategoryLabel,
  modelPreviewUrl,
  onModelIndexProgress,
  onModelSyncProgress,
  pickPreviewImageFile,
  readModelSidecar,
  showModelInFolder,
  syncAllModels,
  type LocalModel,
  type ModelIndexProgress,
  type ModelSyncProgress,
  type SyncAllResult
} from '@/services/modelManager';
import { isVideoMedia } from '@/services/civitai';
import { useModelManagerStore } from '@/stores/modelManagerStore';
import {
  cleanPath,
  parseLauncherArgs,
  useLauncherStore
} from '@/stores/launcherStore';
import { formatFileSize } from '@/utils/formatters';
import {
  collectBaseModels,
  countByCategory,
  filterModels,
  hasModelUpdate,
  sortModels
} from '@/utils/modelFilters';

defineOptions({ name: 'ModelManagerView' });

const GRID_GAP = 14;
const CARD_ASPECT_RATIO = 4 / 3;
const CARD_FOOTER_HEIGHT = 53;
const OVERSCAN_ROWS = 3;
const CATEGORY_ORDER = [
  'checkpoints',
  'diffusion_models',
  'loras',
  'vae',
  'text_encoders',
  'clip_vision',
  'controlnet',
  'upscale_models',
  'embeddings',
  'hypernetworks'
];

const router = useRouter();
const launcherStore = useLauncherStore();
const store = useModelManagerStore();
const { category, search, baseModel, sync, preview, sort, sortDir } =
  storeToRefs(store);
const { confirm } = useConfirmDialog();

const indexQuery = useLocalModelsIndexQuery();
const rescan = useRescanModelsMutation();
const syncDialog = useModelSyncDialog();
const setPreview = useSetModelPreviewMutation();
const removeModel = useDeleteModelMutation();

const scrollViewport = ref<HTMLElement | null>(null);
const gridWidth = ref(1200);
const isViewActive = ref(true);
const dismissedWarnings = ref(false);
// Thumbnail failed → fall back to the full preview; full failed → placeholder.
const thumbFailed = ref(new Set<string>());
const failedImages = ref(new Set<string>());
const busyIds = ref(new Set<string>());
const indexProgress = ref<ModelIndexProgress | null>(null);
const syncDialogOpen = ref(false);
const syncProgress = ref<ModelSyncProgress | null>(null);
const syncResult = ref<SyncAllResult | null>(null);
const syncRunning = ref(false);
let resizeObserver: ResizeObserver | null = null;
let savedScrollTop = 0;
let unlistenIndex: UnlistenFn | null = null;
let unlistenSync: UnlistenFn | null = null;

const allModels = computed(() => indexQuery.data.value?.models ?? []);
const warnings = computed(() => indexQuery.data.value?.warnings ?? []);
const loading = computed(() => indexQuery.isLoading.value);
const errorMessage = computed(() =>
  indexQuery.error.value ? String(indexQuery.error.value) : ''
);
const baseModels = computed(() => collectBaseModels(allModels.value));
const categoryCounts = computed(() => countByCategory(allModels.value));
const categories = computed(() => {
  const present = Object.keys(categoryCounts.value);
  const ordered = CATEGORY_ORDER.filter((key) => present.includes(key));
  const rest = present.filter((key) => !CATEGORY_ORDER.includes(key));
  rest.sort((a, b) => a.localeCompare(b));
  return [...ordered, ...rest];
});
// Sort once per sort change; filtering (every keystroke) preserves that order.
const sortedModels = computed(() =>
  sortModels(allModels.value, sort.value, sortDir.value)
);
const filteredModels = computed(() =>
  filterModels(sortedModels.value, store.filters)
);
const hasModels = computed(() => filteredModels.value.length > 0);
const unsyncedCount = computed(
  () =>
    allModels.value.filter(
      (model) => !isVerified(model) && model.syncAttemptedMs === 0
    ).length
);

const columns = computed(() => {
  if (gridWidth.value < 600) return 1;
  if (gridWidth.value < 760) return 2;
  if (gridWidth.value < 1000) return 3;
  if (gridWidth.value < 1240) return 4;
  if (gridWidth.value < 1480) return 5;
  return 6;
});
const cardWidth = computed(
  () => (gridWidth.value - GRID_GAP * (columns.value - 1)) / columns.value
);
const rowHeight = computed(
  () => cardWidth.value * CARD_ASPECT_RATIO + CARD_FOOTER_HEIGHT + GRID_GAP
);
const totalRows = computed(() =>
  Math.ceil(filteredModels.value.length / columns.value)
);
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: totalRows.value,
    enabled: isViewActive.value,
    getScrollElement: () => scrollViewport.value,
    initialOffset: () => savedScrollTop,
    estimateSize: () => rowHeight.value,
    overscan: OVERSCAN_ROWS
  }))
);
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());
const totalVirtualHeight = computed(() => rowVirtualizer.value.getTotalSize());

const syncPercent = computed(() => {
  const progress = syncProgress.value;
  if (!progress || progress.total === 0) return 0;
  return Math.round((progress.processed / progress.total) * 100);
});

function categoryIcon(model: LocalModel) {
  return model.category === 'loras' ? Layers : Box;
}

function displayName(model: LocalModel) {
  return model.civitai?.modelName || model.filename;
}

function folderLabel(model: LocalModel) {
  const folder = model.relativeName.includes('/')
    ? model.relativeName.slice(0, model.relativeName.lastIndexOf('/'))
    : '';
  return folder
    ? `${modelCategoryLabel(model.category)} / ${folder}`
    : modelCategoryLabel(model.category);
}

function isBusy(model: LocalModel) {
  return busyIds.value.has(model.id);
}

function markBusy(id: string, busy: boolean) {
  const next = new Set(busyIds.value);
  if (busy) next.add(id);
  else next.delete(id);
  busyIds.value = next;
}

function openDetail(model: LocalModel) {
  router.push(`/models/${model.id}`);
}

async function copyPath(model: LocalModel) {
  try {
    await navigator.clipboard.writeText(model.path);
    toast.success('Path copied');
  } catch (error) {
    toast.error(`Copy failed: ${String(error)}`);
  }
}

async function syncModel(model: LocalModel) {
  markBusy(model.id, true);
  try {
    const synced = await syncDialog.run(model);
    if (synced) resetImageState(model.id);
  } finally {
    markBusy(model.id, false);
  }
}

async function setPreviewFromFile(model: LocalModel) {
  const path = await pickPreviewImageFile(model.path);
  if (!path) return;
  markBusy(model.id, true);
  try {
    await setPreview.mutateAsync({
      id: model.id,
      source: { kind: 'localPath', path }
    });
    resetImageState(model.id);
    toast.success('Preview updated');
  } catch (error) {
    toast.error(`Preview update failed: ${String(error)}`);
  } finally {
    markBusy(model.id, false);
  }
}

async function setPreviewFromCivitai(model: LocalModel) {
  markBusy(model.id, true);
  try {
    const sidecar = await readModelSidecar(model.id);
    const images = Array.isArray(sidecar?.images)
      ? (sidecar.images as { url?: string; type?: string }[])
      : [];
    const sample = images.find((image) => image.url && !isVideoMedia(image));
    if (!sample?.url) {
      toast.warning('This model has no Civitai sample images.');
      return;
    }
    await setPreview.mutateAsync({
      id: model.id,
      source: { kind: 'url', url: sample.url }
    });
    resetImageState(model.id);
    toast.success('Preview fetched from Civitai');
  } catch (error) {
    toast.error(`Preview update failed: ${String(error)}`);
  } finally {
    markBusy(model.id, false);
  }
}

async function confirmDelete(model: LocalModel) {
  const sidecars = [
    model.sidecar ? 'metadata sidecars' : null,
    model.previewPath ? 'preview image' : null
  ].filter(Boolean);
  const confirmed = await confirm({
    title: `Delete ${model.filename}?`,
    description: `This permanently deletes the model file (${formatFileSize(model.fileSize)})${
      sidecars.length > 0 ? ` and its ${sidecars.join(' and ')}` : ''
    } from disk. This cannot be undone.`,
    confirmLabel: 'Delete'
  });
  if (!confirmed) return;
  markBusy(model.id, true);
  try {
    await removeModel.mutateAsync(model.id);
    toast.success(`Deleted ${model.filename}`);
  } catch (error) {
    toast.error(`Delete failed: ${String(error)}`);
  } finally {
    markBusy(model.id, false);
  }
}

async function runRescan() {
  try {
    const index = await rescan.mutateAsync();
    toast.success(`Indexed ${index.models.length} models`);
  } catch (error) {
    toast.error(`Rescan failed: ${String(error)}`);
  } finally {
    indexProgress.value = null;
  }
}

async function runSyncAll() {
  syncDialogOpen.value = true;
  syncRunning.value = true;
  syncResult.value = null;
  syncProgress.value = {
    stage: 'syncing',
    processed: 0,
    total: unsyncedCount.value,
    current: '',
    error: null
  };
  try {
    const apiKey = await loadCivitaiApiKey();
    syncResult.value = await syncAllModels(
      cleanPath(launcherStore.config.workingDir),
      parseLauncherArgs(launcherStore.config.args),
      apiKey,
      true
    );
    await indexQuery.refetch();
  } catch (error) {
    syncResult.value = {
      synced: 0,
      failed: 0,
      skipped: 0,
      cancelled: false,
      error: String(error)
    };
  } finally {
    syncRunning.value = false;
  }
}

function cancelSyncAll() {
  void cancelModelSync();
}

function closeSyncDialog(open: boolean) {
  if (!open && syncRunning.value) return;
  syncDialogOpen.value = open;
}

function previewSrc(model: LocalModel) {
  return modelPreviewUrl(model, !thumbFailed.value.has(model.id));
}

function onImageError(model: LocalModel) {
  if (thumbFailed.value.has(model.id)) {
    failedImages.value = new Set(failedImages.value).add(model.id);
  } else {
    thumbFailed.value = new Set(thumbFailed.value).add(model.id);
  }
}

function resetImageState(id: string) {
  const thumbs = new Set(thumbFailed.value);
  const failed = new Set(failedImages.value);
  thumbs.delete(id);
  failed.delete(id);
  thumbFailed.value = thumbs;
  failedImages.value = failed;
}

function isLocalOnly(model: LocalModel) {
  return !model.civitai && model.syncAttemptedMs > 0;
}

function handleScroll(event: Event) {
  savedScrollTop = (event.target as HTMLElement).scrollTop;
}

function clearSearch() {
  search.value = '';
}

function toggleSortDir() {
  sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
}

watch([search, category, baseModel, sync, preview, sort, sortDir], () => {
  savedScrollTop = 0;
  scrollViewport.value?.scrollTo({ top: 0 });
});

async function restoreScroll() {
  isViewActive.value = true;
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  if (scrollViewport.value) resizeObserver?.observe(scrollViewport.value);
  rowVirtualizer.value.measure();
  rowVirtualizer.value.scrollToOffset(savedScrollTop);
}

function deactivateView() {
  isViewActive.value = false;
  resizeObserver?.disconnect();
}

onMounted(async () => {
  await store.loadState();
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry) gridWidth.value = entry.contentRect.width;
  });
  unlistenIndex = await onModelIndexProgress((progress) => {
    indexProgress.value = progress.stage === 'done' ? null : progress;
  });
  unlistenSync = await onModelSyncProgress((progress) => {
    syncProgress.value = progress;
  });
  await restoreScroll();
});

onActivated(() => {
  void restoreScroll();
});
onDeactivated(deactivateView);
onUnmounted(() => {
  deactivateView();
  unlistenIndex?.();
  unlistenSync?.();
});
</script>

<template>
  <PageLayout
    title="Model Manager"
    subtitle="Installed checkpoints, LoRAs, VAEs and more — synced with Civitai"
    content-class="flex flex-col overflow-hidden p-0"
  >
    <template #icon>
      <HardDrive class="h-4 w-4" />
    </template>
    <template #actions>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="sm"
            class="h-8 text-xs"
            :disabled="
              rescan.isPending.value || !launcherStore.hasComfyDirectory
            "
            @click="runRescan"
          >
            <RefreshCw
              class="h-3.5 w-3.5"
              :class="{ 'animate-spin': rescan.isPending.value }"
            />
            <span class="hidden sm:inline">
              {{
                indexProgress
                  ? `${indexProgress.stage === 'scanning' ? 'Scanning' : 'Indexing'} ${indexProgress.processed}${indexProgress.total ? ` / ${indexProgress.total}` : ''}`
                  : 'Rescan'
              }}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Re-scan model folders on disk</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            size="sm"
            class="h-8 text-xs"
            :disabled="syncRunning || unsyncedCount === 0"
            @click="runSyncAll"
          >
            <CloudDownload class="h-3.5 w-3.5" />
            <span class="hidden sm:inline">Sync unsynced</span>
            <Badge
              v-if="unsyncedCount > 0"
              variant="secondary"
              class="ml-0.5 h-4 px-1.5 font-mono text-xs"
            >
              {{ unsyncedCount }}
            </Badge>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Hash each model without metadata and look it up on Civitai
        </TooltipContent>
      </Tooltip>
    </template>

    <template #below-header>
      <div
        class="border-border/80 bg-card/75 shrink-0 border-b px-6 py-4 backdrop-blur-md"
      >
        <div class="flex flex-col gap-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <div class="relative min-w-60 flex-1">
              <Search
                class="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              />
              <Input
                v-model="search"
                class="pr-8 pl-9 text-xs"
                placeholder="Search by file name, Civitai name, base model or trigger word..."
              />
              <button
                v-if="search"
                type="button"
                class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer p-0.5"
                aria-label="Clear search"
                @click="clearSearch"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>

            <Select v-model="baseModel">
              <SelectTrigger class="w-42 text-xs">
                <SelectValue placeholder="Base model" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup class="max-h-40 overflow-y-auto">
                  <SelectItem value="all">All base models</SelectItem>
                  <SelectItem
                    v-for="value in baseModels"
                    :key="value"
                    :value="value"
                  >
                    {{ value }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select v-model="sync">
              <SelectTrigger class="w-36 text-xs">
                <SelectValue placeholder="Civitai" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup class="max-h-40 overflow-y-auto">
                  <SelectItem value="all">Any sync state</SelectItem>
                  <SelectItem value="synced">Verified on Civitai</SelectItem>
                  <SelectItem value="unsynced">Not verified</SelectItem>
                  <SelectItem value="update">Update available</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select v-model="preview">
              <SelectTrigger class="w-34 text-xs">
                <SelectValue placeholder="Preview" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup class="max-h-40 overflow-y-auto">
                  <SelectItem value="all">Any preview</SelectItem>
                  <SelectItem value="with">With preview</SelectItem>
                  <SelectItem value="without">Missing preview</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            <div class="flex items-center gap-1">
              <Select v-model="sort">
                <SelectTrigger class="w-28 text-xs">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup class="max-h-40 overflow-y-auto">
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="size">File size</SelectItem>
                    <SelectItem value="date">Modified</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="outline"
                    size="icon"
                    class="h-8 w-8"
                    :aria-label="`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`"
                    @click="toggleSortDir"
                  >
                    <ArrowDownUp
                      class="h-3.5 w-3.5 transition-transform"
                      :class="{ 'rotate-180': sortDir === 'desc' }"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {{ sortDir === 'asc' ? 'Ascending' : 'Descending' }}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <!-- Category Pills -->
          <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span class="text-muted-foreground mr-1 text-xs">Category:</span>
            <button
              type="button"
              class="cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
              :class="
                category === 'all'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
              "
              @click="category = 'all'"
            >
              All
              <span class="ml-1 font-mono opacity-70">{{
                allModels.length
              }}</span>
            </button>
            <button
              v-for="key in categories"
              :key="key"
              type="button"
              class="cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
              :class="
                category === key
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
              "
              @click="category = key"
            >
              {{ modelCategoryLabel(key) }}
              <span class="ml-1 font-mono opacity-70">{{
                categoryCounts[key]
              }}</span>
            </button>
          </div>
        </div>
      </div>
    </template>

    <div
      ref="scrollViewport"
      class="min-h-0 flex-1 overflow-y-auto p-5"
      @scroll.passive="handleScroll"
    >
      <NoticeBanner
        v-if="!launcherStore.hasComfyDirectory"
        tone="info"
        class="mb-4"
      >
        <span>{{ launcherStore.localSetupMessage }}</span>
        <template #actions>
          <Button variant="outline" size="sm" @click="router.push('/settings')">
            Open Settings
          </Button>
        </template>
      </NoticeBanner>

      <NoticeBanner
        v-if="warnings.length > 0 && !dismissedWarnings"
        tone="amber"
        class="mb-4"
      >
        <div class="flex flex-col gap-1">
          <span class="font-semibold">
            Some model paths could not be read
          </span>
          <span
            v-for="warning in warnings.slice(0, 5)"
            :key="warning"
            class="font-mono text-xs opacity-90"
          >
            {{ warning }}
          </span>
          <span v-if="warnings.length > 5" class="opacity-70">
            +{{ warnings.length - 5 }} more
          </span>
        </div>
        <template #actions>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7"
            aria-label="Dismiss warnings"
            @click="dismissedWarnings = true"
          >
            <X class="h-3.5 w-3.5" />
          </Button>
        </template>
      </NoticeBanner>

      <NoticeBanner v-if="errorMessage" tone="destructive" class="mb-4">
        <span>{{ errorMessage }}</span>
        <template #actions>
          <Button
            variant="outline"
            size="sm"
            class="h-7 text-xs"
            @click="indexQuery.refetch()"
          >
            Retry
          </Button>
        </template>
      </NoticeBanner>

      <!-- Skeleton Loading State -->
      <div
        v-if="loading"
        class="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      >
        <div
          v-for="n in 12"
          :key="n"
          class="border-border/60 bg-card/60 overflow-hidden rounded-xl border p-0 shadow-xs"
        >
          <Skeleton class="aspect-3/4 w-full rounded-b-none" />
          <div class="flex flex-col gap-2 p-2.5">
            <Skeleton class="h-3.5 w-3/4 rounded" />
            <Skeleton class="h-3 w-1/2 rounded" />
          </div>
        </div>
      </div>

      <!-- Empty States -->
      <div
        v-else-if="!hasModels"
        class="border-border/60 bg-card/40 mx-auto my-12 flex max-w-md flex-col items-center justify-center rounded-xl border p-8 text-center text-xs shadow-xs"
      >
        <div
          class="bg-muted text-muted-foreground mb-3 flex h-12 w-12 items-center justify-center rounded-full"
        >
          <HardDrive class="h-6 w-6" />
        </div>
        <template v-if="allModels.length === 0">
          <h3 class="text-sm font-semibold">No models indexed yet</h3>
          <p class="text-muted-foreground mt-1 text-xs">
            {{
              launcherStore.hasComfyDirectory
                ? 'Nothing was found under the ComfyUI models folders or extra_model_paths.yaml. Add models and rescan.'
                : 'Choose your ComfyUI folder in Settings to index installed models.'
            }}
          </p>
          <Button
            v-if="launcherStore.hasComfyDirectory"
            variant="outline"
            size="sm"
            class="mt-4 text-xs"
            :disabled="rescan.isPending.value"
            @click="runRescan"
          >
            Rescan
          </Button>
        </template>
        <template v-else>
          <h3 class="text-sm font-semibold">No models match these filters</h3>
          <p class="text-muted-foreground mt-1 text-xs">
            Try another search or reset the category and sync filters.
          </p>
          <Button
            variant="outline"
            size="sm"
            class="mt-4 text-xs"
            @click="store.resetFilters"
          >
            Reset Filters
          </Button>
        </template>
      </div>

      <!-- Virtualized model grid -->
      <div
        v-else
        class="relative w-full"
        :style="{ height: `${totalVirtualHeight}px` }"
      >
        <div
          v-for="virtualRow in virtualRows"
          :key="virtualRow.index"
          class="absolute top-0 left-0 grid w-full gap-3.5"
          :style="{
            height: `${virtualRow.size - GRID_GAP}px`,
            transform: `translateY(${virtualRow.start}px)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
          }"
        >
          <ContextMenu
            v-for="model in filteredModels.slice(
              virtualRow.index * columns,
              (virtualRow.index + 1) * columns
            )"
            :key="model.id"
          >
            <ContextMenuTrigger as-child>
              <article
                class="border-border/70 bg-card/75 hover:border-primary/50 hover:bg-card/95 group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border shadow-xs transition-all duration-200 hover:shadow-md"
                :class="{ 'opacity-60': isBusy(model) }"
                @click="openDetail(model)"
              >
                <div
                  class="bg-muted/40 relative aspect-3/4 w-full overflow-hidden select-none"
                >
                  <ModelPreviewImage
                    v-if="model.previewPath && !failedImages.has(model.id)"
                    :key="previewSrc(model)"
                    :src="previewSrc(model)"
                    :alt="`${displayName(model)} preview`"
                    :icon="categoryIcon(model)"
                    fit="cover"
                    @error="onImageError(model)"
                  />
                  <div
                    v-else
                    class="text-muted-foreground flex h-full flex-col items-center justify-center gap-2"
                  >
                    <component :is="categoryIcon(model)" class="h-8 w-8" />
                    <span class="text-xs opacity-70">No preview</span>
                  </div>

                  <div
                    v-if="isBusy(model)"
                    class="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
                  >
                    <Loader2 class="h-6 w-6 animate-spin text-white" />
                  </div>

                  <div
                    class="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-linear-to-b from-black/75 via-black/30 to-transparent"
                  />

                  <div
                    class="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-1"
                  >
                    <Badge
                      variant="outline"
                      class="border-white/20 bg-black/65 px-2 py-0.5 text-xs font-medium text-white shadow-sm backdrop-blur-md"
                    >
                      {{ modelCategoryLabel(model.category) }}
                    </Badge>
                    <div class="flex items-center gap-1">
                      <Badge
                        v-if="hasModelUpdate(model)"
                        class="flex items-center gap-1 border-sky-400/30 bg-sky-600/90 px-1.5 py-0.5 text-xs text-white shadow-sm backdrop-blur-md"
                      >
                        <ArrowUpCircle class="h-3 w-3" />
                        <span>Update</span>
                      </Badge>
                      <Badge
                        v-else-if="model.civitai && !model.civitai.verified"
                        variant="outline"
                        class="border-amber-400/30 bg-black/65 px-1.5 py-0.5 text-xs text-amber-200 shadow-sm backdrop-blur-md"
                        title="Metadata comes from a sidecar file; the file hash has not been checked against Civitai"
                      >
                        Unverified
                      </Badge>
                      <Badge
                        v-else-if="isLocalOnly(model)"
                        variant="outline"
                        class="flex items-center gap-1 border-white/20 bg-black/65 px-1.5 py-0.5 text-xs text-white/80 shadow-sm backdrop-blur-md"
                        title="No Civitai record matched this file's hash"
                      >
                        <CloudOff class="h-3 w-3" />
                        <span>Not on Civitai</span>
                      </Badge>
                    </div>
                  </div>

                  <div
                    class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between bg-linear-to-t from-black/85 via-black/40 to-transparent p-2 text-white"
                  >
                    <span
                      v-if="model.civitai?.baseModel"
                      class="max-w-[60%] truncate text-xs font-medium text-amber-300 drop-shadow-xs"
                    >
                      {{ model.civitai.baseModel }}
                    </span>
                    <span v-else class="text-xs text-white/60 uppercase">
                      {{ model.extension }}
                    </span>
                    <span class="font-mono text-xs text-white/80">
                      {{ formatFileSize(model.fileSize) }}
                    </span>
                  </div>
                </div>

                <div class="flex flex-col gap-0.5 p-2.5">
                  <h2
                    class="group-hover:text-primary truncate text-xs font-semibold transition-colors"
                    :title="model.path"
                  >
                    {{ displayName(model) }}
                  </h2>
                  <p
                    class="text-muted-foreground truncate text-xs"
                    :title="model.relativeName"
                  >
                    {{ folderLabel(model) }}
                  </p>
                </div>
              </article>
            </ContextMenuTrigger>
            <ContextMenuContent class="w-56">
              <ContextMenuItem @select="openDetail(model)">
                <Info /> Details
              </ContextMenuItem>
              <ContextMenuItem @select="showModelInFolder(model.path)">
                <FolderOpen /> Show in Explorer
              </ContextMenuItem>
              <ContextMenuItem @select="copyPath(model)">
                <Copy /> Copy path
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                :disabled="isBusy(model)"
                @select="syncModel(model)"
              >
                <CloudDownload />
                {{
                  model.civitai ? 'Re-sync with Civitai' : 'Sync with Civitai'
                }}
              </ContextMenuItem>
              <ContextMenuItem
                :disabled="isBusy(model)"
                @select="setPreviewFromFile(model)"
              >
                <ImageIcon /> Set preview from file…
              </ContextMenuItem>
              <ContextMenuItem
                :disabled="isBusy(model) || !model.civitai"
                @select="setPreviewFromCivitai(model)"
              >
                <ImageOff /> Fetch preview from Civitai
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                :disabled="isBusy(model)"
                @select="confirmDelete(model)"
              >
                <Trash2 /> Delete model…
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
      </div>

      <p
        v-if="hasModels"
        class="text-muted-foreground py-6 text-center text-xs"
      >
        {{ filteredModels.length }} of {{ allModels.length }} models
      </p>
    </div>

    <ModelSyncDialog
      :state="syncDialog.state"
      @cancel="syncDialog.cancel"
      @close="syncDialog.close"
    />

    <!-- Bulk sync progress -->
    <Dialog :open="syncDialogOpen" @update:open="closeSyncDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sync with Civitai</DialogTitle>
          <DialogDescription>
            Each model is hashed (SHA-256) and looked up by hash. Large
            checkpoints can take a while.
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-3">
          <Progress :model-value="syncPercent" class="h-2" />
          <div
            class="text-muted-foreground flex items-center justify-between gap-3 font-mono text-xs"
          >
            <span class="truncate">
              {{
                syncRunning
                  ? syncProgress?.current || 'Preparing…'
                  : syncResult?.cancelled
                    ? 'Cancelled'
                    : 'Finished'
              }}
            </span>
            <span class="shrink-0">
              {{ syncProgress?.processed ?? 0 }} /
              {{ syncProgress?.total ?? 0 }}
            </span>
          </div>
          <p
            v-if="syncProgress?.error && syncRunning"
            class="text-xs text-amber-300"
          >
            {{ syncProgress.current }}: {{ syncProgress.error }}
          </p>
          <div
            v-if="syncResult"
            class="border-border bg-muted/40 grid grid-cols-3 gap-2 rounded-lg border p-3 text-center text-xs"
          >
            <div>
              <div class="text-base font-semibold text-emerald-400">
                {{ syncResult.synced }}
              </div>
              <div class="text-muted-foreground">synced</div>
            </div>
            <div>
              <div class="text-base font-semibold text-amber-300">
                {{ syncResult.skipped }}
              </div>
              <div class="text-muted-foreground">not on Civitai</div>
            </div>
            <div>
              <div class="text-destructive text-base font-semibold">
                {{ syncResult.failed }}
              </div>
              <div class="text-muted-foreground">failed</div>
            </div>
          </div>
          <p v-if="syncResult?.error" class="text-destructive text-xs">
            {{ syncResult.error }}
          </p>
        </div>

        <DialogFooter>
          <Button v-if="syncRunning" variant="outline" @click="cancelSyncAll">
            Cancel
          </Button>
          <Button v-else @click="syncDialogOpen = false">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </PageLayout>
</template>
