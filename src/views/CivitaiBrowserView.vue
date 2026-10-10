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
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Bookmark,
  ExternalLink,
  HardDriveDownload,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  X
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import CivitaiModelCard from '@/components/civitai/CivitaiModelCard.vue';
import FilterField from '@/components/common/FilterField.vue';
import FilterPopover from '@/components/common/FilterPopover.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import PageLayout from '@/components/layout/PageLayout.vue';
import { Input } from '@/components/ui/input';
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
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useInstalledCivitaiVersions } from '../composables/useInstalledCivitaiVersions';
import {
  cacheCivitaiModel,
  fetchCivitaiModels,
  type CivitaiModel,
  type CivitaiVersion
} from '../services/civitai';
import { loadAppData } from '../services/appStorage';
import { useCivitaiStore } from '../stores/civitaiStore';
import { useDownloadStore } from '../stores/downloadStore';
import { useLauncherStore } from '../stores/launcherStore';

defineOptions({ name: 'CivitaiBrowserView' });

const SUPPORTED_TYPES =
  'Checkpoint,LORA,LoCon,DoRA,TextualInversion,Hypernetwork,Controlnet,VAE,Upscaler';

const GRID_GAP = 14;
const CARD_ASPECT_RATIO = 4 / 3;
const CARD_FOOTER_HEIGHT = 53;
const OVERSCAN_ROWS = 3;

const router = useRouter();
const route = useRoute();
const civitaiStore = useCivitaiStore();
const downloadStore = useDownloadStore();
const launcherStore = useLauncherStore();
const { progress, isVersionInstalled } = useInstalledCivitaiVersions();
const { query, modelType, baseModel, sort, period, baseModels } =
  storeToRefs(civitaiStore);
const apiKey = ref('');
const nsfw = ref(false);
const models = ref<CivitaiModel[]>([]);
const nextCursor = ref<string>();
const selectedVersions = ref<Record<number, string>>({});
const activeImageIndices = ref<Record<number, number>>({});
const loading = ref(true);
const loadingMore = ref(false);
const errorMessage = ref('');
const scrollViewport = ref<HTMLElement | null>(null);
const gridWidth = ref(1200);
const isViewActive = ref(true);
const showBookmarks = ref(false);
let resizeObserver: ResizeObserver | null = null;
let savedScrollTop = 0;

const bookmarkedModels = computed(() => {
  const term = query.value.trim().toLowerCase();
  return civitaiStore.bookmarks.filter(
    (model) =>
      (modelType.value === 'all' || model.type === modelType.value) &&
      (!term ||
        model.name.toLowerCase().includes(term) ||
        !!model.creator?.username?.toLowerCase().includes(term))
  );
});
const visibleModels = computed(() =>
  showBookmarks.value ? bookmarkedModels.value : models.value
);
const canLoadMore = computed(
  () =>
    !showBookmarks.value &&
    !loading.value &&
    !loadingMore.value &&
    !!nextCursor.value &&
    models.value.length > 0
);
const hasModels = computed(() => visibleModels.value.length > 0);
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
  Math.ceil(visibleModels.value.length / columns.value)
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

function selectedVersion(model: CivitaiModel): CivitaiVersion | undefined {
  const selected = Number(selectedVersions.value[model.id]);
  return (
    model.modelVersions.find((version) => version.id === selected) ??
    model.modelVersions[0]
  );
}

function getActiveImageIndex(modelId: number): number {
  return activeImageIndices.value[modelId] ?? 0;
}

function isModelDownloaded(model: CivitaiModel): boolean {
  return model.modelVersions.some((version) =>
    isVersionInstalled(model, version)
  );
}

function refreshModels() {
  void civitaiStore.refreshLocalModels();
  void loadModels(false);
}

function openDetail(model: CivitaiModel) {
  cacheCivitaiModel(model);
  router.push(`/civitai/model/${model.id}`);
}

async function toggleBookmark(model: CivitaiModel) {
  try {
    const bookmarked = await civitaiStore.toggleBookmark(model);
    toast.success(
      bookmarked ? `Bookmarked ${model.name}` : `Removed ${model.name}`
    );
  } catch (error) {
    toast.error(`Bookmark failed: ${String(error)}`);
  }
}

function searchCreator(username: string) {
  showBookmarks.value = false;
  query.value = username;
  void loadModels(false);
}

function canDownload(model: CivitaiModel) {
  const version = selectedVersion(model);
  return (
    !!version?.files.length &&
    launcherStore.hasComfyDirectory &&
    !isVersionInstalled(model, version) &&
    !progress.value[version.id]
  );
}

async function downloadSelectedVersion(model: CivitaiModel) {
  const version = selectedVersion(model);
  if (!version) return;
  try {
    await downloadStore.enqueueCivitai({
      versionId: version.id,
      workingDir: launcherStore.config.workingDir,
      apiKey: apiKey.value
    });
    toast.success(`Downloading ${model.name} — ${version.name}`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

function clearSearch() {
  query.value = '';
  void loadModels();
}

function resetFilters() {
  civitaiStore.resetFilters();
  void loadModels();
}

const activeFilterCount = computed(
  () =>
    [
      baseModel.value !== 'all',
      sort.value !== 'Most Downloaded',
      period.value !== 'AllTime'
    ].filter(Boolean).length
);

function resetFilterPopover() {
  baseModel.value = 'all';
  sort.value = 'Most Downloaded';
  period.value = 'AllTime';
  void loadModels(false);
}

async function loadModels(append = false) {
  if (append) loadingMore.value = true;
  else loading.value = true;
  errorMessage.value = '';
  if (!append) {
    savedScrollTop = 0;
    scrollViewport.value?.scrollTo({ top: 0 });
  }
  try {
    const response = await fetchCivitaiModels({
      query: query.value,
      modelType: modelType.value === 'all' ? SUPPORTED_TYPES : modelType.value,
      baseModel: baseModel.value === 'all' ? '' : baseModel.value,
      sort: sort.value,
      period: period.value,
      cursor: append ? nextCursor.value : undefined,
      apiKey: apiKey.value,
      nsfw: nsfw.value
    });
    if (append) {
      const existingIds = new Set(models.value.map((m) => m.id));
      const newItems = response.items.filter((m) => !existingIds.has(m.id));
      models.value = [...models.value, ...newItems];
    } else {
      models.value = response.items;
    }
    nextCursor.value = response.metadata.nextCursor;
    for (const model of response.items) {
      if (model.modelVersions[0] && !selectedVersions.value[model.id]) {
        selectedVersions.value[model.id] = String(model.modelVersions[0].id);
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

function handleScroll(event: Event) {
  const target = event.target as HTMLElement;
  if (!target) return;
  savedScrollTop = target.scrollTop;
  if (!canLoadMore.value) return;
  const bottomThreshold = 600;
  if (
    target.scrollHeight - target.scrollTop - target.clientHeight <
    bottomThreshold
  ) {
    void loadModels(true);
  }
}

watch(virtualRows, (rows) => {
  if (!isViewActive.value || rows.length === 0 || !canLoadMore.value) return;
  const lastRow = rows.at(-1);
  if (lastRow && lastRow.index >= totalRows.value - 2) {
    void loadModels(true);
  }
});

watch(showBookmarks, () => {
  savedScrollTop = 0;
  scrollViewport.value?.scrollTo({ top: 0 });
});

async function restoreBrowseScroll() {
  isViewActive.value = true;
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  if (scrollViewport.value) resizeObserver?.observe(scrollViewport.value);
  rowVirtualizer.value.measure();
  rowVirtualizer.value.scrollToOffset(savedScrollTop);
  scrollViewport.value?.dispatchEvent(new Event('scroll'));
}

function deactivateView() {
  isViewActive.value = false;
  resizeObserver?.disconnect();
}

onMounted(async () => {
  void civitaiStore.refreshLocalModels();
  if (!civitaiStore.isLoaded) {
    await civitaiStore.init();
  }
  consumeRouteQuery();
  const settings = await loadAppData<{ apiKey?: string; nsfw?: boolean }>(
    'civitai_settings'
  );
  apiKey.value = settings?.apiKey ?? '';
  nsfw.value = settings?.nsfw ?? false;
  await loadModels();
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry) gridWidth.value = entry.contentRect.width;
  });
  await restoreBrowseScroll();
});

function consumeRouteQuery() {
  const requested = route.query.q;
  if (typeof requested !== 'string' || !requested) return false;
  void router.replace({ query: {} });
  showBookmarks.value = false;
  if (requested === query.value) return false;
  query.value = requested;
  return true;
}

onActivated(() => {
  isViewActive.value = true;
  if (consumeRouteQuery()) void loadModels(false);
  void restoreBrowseScroll();
});

async function syncSettingsAndRestore() {
  const settings = await loadAppData<{ apiKey?: string; nsfw?: boolean }>(
    'civitai_settings'
  );
  const newApiKey = settings?.apiKey ?? '';
  const newNsfw = settings?.nsfw ?? false;
  const changed = newApiKey !== apiKey.value || newNsfw !== nsfw.value;
  apiKey.value = newApiKey;
  nsfw.value = newNsfw;
  await restoreBrowseScroll();
  if (changed) {
    void loadModels();
  }
}

onActivated(syncSettingsAndRestore);
onDeactivated(deactivateView);

onUnmounted(() => {
  deactivateView();
});
</script>

<template>
  <PageLayout
    title="Civitai Model Browser"
    subtitle="Explore AI models for your ComfyUI workspace"
    content-class="flex flex-col overflow-hidden p-0"
  >
    <template #icon>
      <HardDriveDownload class="h-4 w-4" />
    </template>
    <template #actions>
      <Button
        :variant="showBookmarks ? 'default' : 'outline'"
        size="sm"
        class="h-8 text-xs"
        :aria-pressed="showBookmarks"
        @click="showBookmarks = !showBookmarks"
      >
        <Bookmark class="h-3.5 w-3.5" />
        <span class="hidden sm:inline">Bookmarks</span>
        <Badge
          v-if="civitaiStore.bookmarks.length"
          variant="secondary"
          class="h-4 min-w-4 px-1 text-xs font-semibold"
        >
          {{ civitaiStore.bookmarks.length }}
        </Badge>
      </Button>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="sm"
            class="h-8 text-xs"
            :disabled="loading"
            @click="refreshModels"
          >
            <RefreshCw
              class="h-3.5 w-3.5"
              :class="{ 'animate-spin': loading }"
            />
            <span class="hidden sm:inline">Refresh</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reload models list</TooltipContent>
      </Tooltip>

      <Button
        variant="outline"
        size="sm"
        class="h-8 text-xs"
        @click="openUrl('https://civitai.com/models')"
      >
        <ExternalLink class="h-3.5 w-3.5" />
        <span class="hidden sm:inline">Civitai.com</span>
      </Button>
    </template>

    <template #below-header>
      <div
        class="border-border/80 bg-card/75 shrink-0 border-b px-6 py-4 backdrop-blur-md"
      >
        <!-- Search & Filters -->
        <div class="flex flex-col gap-2.5">
          <form
            class="flex flex-wrap items-center gap-2.5"
            @submit.prevent="loadModels(false)"
          >
            <div class="relative min-w-60 flex-1">
              <Search
                class="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              />
              <Input
                v-model="query"
                class="pr-8 pl-9 text-xs"
                placeholder="Search checkpoints, LoRAs, ControlNets, VAEs..."
              />
              <button
                v-if="query"
                type="button"
                class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer p-0.5"
                @click="clearSearch"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>

            <Select
              v-model="modelType"
              @update:model-value="() => loadModels(false)"
            >
              <SelectTrigger class="h-9 w-38 text-xs">
                <SelectValue placeholder="Model type" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup class="max-h-40 overflow-y-auto">
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="Checkpoint">Checkpoint</SelectItem>
                  <SelectItem value="LORA">LoRA</SelectItem>
                  <SelectItem value="Controlnet">ControlNet</SelectItem>
                  <SelectItem value="VAE">VAE</SelectItem>
                  <SelectItem value="Upscaler">Upscaler</SelectItem>
                  <SelectItem value="TextualInversion">Embedding</SelectItem>
                  <SelectItem value="Hypernetwork">Hypernetwork</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            <FilterPopover
              :count="activeFilterCount"
              content-class="w-64"
              @reset="resetFilterPopover"
            >
              <FilterField label="Base model">
                <Select
                  v-model="baseModel"
                  @update:model-value="() => loadModels(false)"
                >
                  <SelectTrigger class="w-full text-xs">
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
              </FilterField>

              <FilterField label="Sort">
                <Select
                  v-model="sort"
                  @update:model-value="() => loadModels(false)"
                >
                  <SelectTrigger class="w-full text-xs">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup class="max-h-40 overflow-y-auto">
                      <SelectItem value="Most Downloaded"
                        >Most Downloaded</SelectItem
                      >
                      <SelectItem value="Highest Rated"
                        >Highest Rated</SelectItem
                      >
                      <SelectItem value="Newest">Newest</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FilterField>

              <FilterField label="Period">
                <Select
                  v-model="period"
                  @update:model-value="() => loadModels(false)"
                >
                  <SelectTrigger class="w-full text-xs">
                    <SelectValue placeholder="Period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup class="max-h-40 overflow-y-auto">
                      <SelectItem value="AllTime">All time</SelectItem>
                      <SelectItem value="Year">Year</SelectItem>
                      <SelectItem value="Month">Month</SelectItem>
                      <SelectItem value="Week">Week</SelectItem>
                      <SelectItem value="Day">Day</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FilterField>
            </FilterPopover>

            <Button
              type="submit"
              size="sm"
              class="bg-primary text-primary-foreground hover:bg-primary/90 h-9 cursor-pointer px-4 text-xs font-semibold shadow-xs"
              :disabled="loading"
            >
              <Loader2 v-if="loading" class="h-3.5 w-3.5 animate-spin" />
              <Search v-else class="h-3.5 w-3.5" />
              <span>Search</span>
            </Button>
          </form>
        </div>
      </div>
    </template>

    <!-- Main Content Viewport -->
    <div
      ref="scrollViewport"
      class="min-h-0 flex-1 overflow-y-auto p-5"
      @scroll.passive="handleScroll"
    >
      <!-- Error Message Banner -->
      <p
        v-if="civitaiStore.discoveryError"
        class="text-destructive mb-4 text-xs"
        role="alert"
      >
        {{ civitaiStore.discoveryError }}
      </p>
      <div
        v-if="launcherStore.localSetupMessage"
        class="bg-muted text-muted-foreground mb-4 flex items-center justify-between gap-3 rounded-lg p-3 text-xs"
        role="status"
      >
        <span
          >{{ launcherStore.localSetupMessage }} You can still browse
          Civitai.</span
        >
        <Button variant="outline" size="sm" @click="router.push('/settings')"
          >Open Settings</Button
        >
      </div>
      <div
        v-if="errorMessage && !showBookmarks"
        class="border-destructive/30 bg-destructive/10 text-destructive mb-4 flex items-center justify-between rounded-lg border px-4 py-3 text-xs shadow-xs"
      >
        <span>{{ errorMessage }}</span>
        <Button
          variant="outline"
          size="sm"
          class="h-7 text-xs"
          @click="loadModels(false)"
        >
          Retry
        </Button>
      </div>

      <div
        v-if="loading && !showBookmarks"
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

      <!-- Empty State -->
      <div
        v-else-if="!hasModels"
        class="border-border/60 bg-card/40 mx-auto my-12 flex max-w-md flex-col items-center justify-center rounded-xl border p-8 text-center text-xs shadow-xs"
      >
        <div
          class="bg-muted text-muted-foreground mb-3 flex h-12 w-12 items-center justify-center rounded-full"
        >
          <Bookmark v-if="showBookmarks" class="h-6 w-6" />
          <ImageOff v-else class="h-6 w-6" />
        </div>
        <template v-if="showBookmarks">
          <h3 class="text-sm font-semibold">No bookmarked models</h3>
          <p class="text-muted-foreground mt-1 text-xs">
            Right-click a model and choose Bookmark to keep it here.
          </p>
        </template>
        <template v-else>
          <h3 class="text-sm font-semibold">No models found</h3>
          <p class="text-muted-foreground mt-1 text-xs">
            Try adjusting your search query, model type, or time period filters.
          </p>
        </template>
        <Button
          variant="outline"
          size="sm"
          class="mt-4 text-xs"
          @click="resetFilters"
        >
          Reset Filters
        </Button>
      </div>

      <!-- Virtualized responsive model grid -->
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
          <CivitaiModelCard
            v-for="model in visibleModels.slice(
              virtualRow.index * columns,
              (virtualRow.index + 1) * columns
            )"
            :key="model.id"
            :model="model"
            :version="selectedVersion(model)"
            :image-index="getActiveImageIndex(model.id)"
            :bookmarked="civitaiStore.isBookmarked(model.id)"
            :installed="isModelDownloaded(model)"
            :downloadable="canDownload(model)"
            @open="openDetail(model)"
            @toggle-bookmark="toggleBookmark(model)"
            @download="downloadSelectedVersion(model)"
            @search-creator="searchCreator"
            @update:image-index="activeImageIndices[model.id] = $event"
          />
        </div>
      </div>

      <!-- Infinite Scroll Loading Spinner / Indicator -->
      <template v-if="!showBookmarks">
        <div
          v-if="loadingMore"
          class="text-muted-foreground flex items-center justify-center gap-2 py-8 text-xs"
        >
          <Loader2 class="text-primary h-4 w-4 animate-spin" />
          <span>Loading more models...</span>
        </div>
        <div
          v-else-if="hasModels && !nextCursor && !loading"
          class="text-muted-foreground py-8 text-center text-xs"
        >
          All models loaded
        </div>
      </template>
    </div>
  </PageLayout>
</template>
