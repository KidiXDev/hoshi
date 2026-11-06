<script setup lang="ts">
import BooruGridSkeleton from '@/components/booru/BooruGridSkeleton.vue';
import BooruPostInspector from '@/components/booru/BooruPostInspector.vue';
import BooruPostTile from '@/components/booru/BooruPostTile.vue';
import BooruSearchInput from '@/components/booru/BooruSearchInput.vue';
import {
  computed,
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Rows3,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X
} from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import PageLayout from '@/components/layout/PageLayout.vue';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  computeBooruGridLayout,
  filterVisibleBoxes,
  type BooruGridDensity,
  type BooruLayoutMode
} from '@/utils/booruGridLayout';
import { ratingColorClass } from '@/utils/booruPresentation';
import {
  fetchBooruSettings,
  fetchBooruSources,
  formatBooruWarnings,
  normalizeBooruRatings,
  searchBooru,
  solveBooruCloudflare,
  type BooruPost,
  type BooruSettings,
  type BooruSource
} from '../services/booruGallery';
import { loadAppData, saveAppData } from '../services/appStorage';

defineOptions({ name: 'BooruGalleryView' });

interface BooruGalleryState {
  ratingsBySource?: Record<string, unknown>;
  layoutMode?: BooruLayoutMode;
  gridDensity?: BooruGridDensity;
  selectedSource?: string;
  sortBySource?: Record<string, string>;
}

const LOCAL_PREFS_KEY = 'koharu:booru_gallery_prefs';

function isValidLayoutMode(value: unknown): value is BooruLayoutMode {
  return value === 'masonry' || value === 'justified' || value === 'cards';
}

function isValidGridDensity(value: unknown): value is BooruGridDensity {
  return value === 'compact' || value === 'comfortable' || value === 'spacious';
}

function readLocalPrefs(): {
  layoutMode?: BooruLayoutMode;
  gridDensity?: BooruGridDensity;
} {
  try {
    const raw = localStorage.getItem(LOCAL_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      layoutMode: isValidLayoutMode(parsed.layoutMode)
        ? parsed.layoutMode
        : undefined,
      gridDensity: isValidGridDensity(parsed.gridDensity)
        ? parsed.gridDensity
        : undefined
    };
  } catch {
    return {};
  }
}

function writeLocalPrefs(mode: BooruLayoutMode, density: BooruGridDensity) {
  try {
    localStorage.setItem(
      LOCAL_PREFS_KEY,
      JSON.stringify({ layoutMode: mode, gridDensity: density })
    );
  } catch {
    // Ignore storage quota errors
  }
}

const LAYOUT_OPTIONS: {
  value: BooruLayoutMode;
  label: string;
  title: string;
  icon: typeof LayoutDashboard;
}[] = [
  {
    value: 'masonry',
    label: 'Masonry',
    title: 'Masonry columns (maintains image aspect ratio)',
    icon: LayoutDashboard
  },
  {
    value: 'justified',
    label: 'Rows',
    title: 'Justified rows (maintains image aspect ratio)',
    icon: Rows3
  },
  {
    value: 'cards',
    label: 'Cards',
    title: 'Uniform 3:4 portrait cards',
    icon: LayoutGrid
  }
];

const DENSITY_OPTIONS: {
  value: BooruGridDensity;
  label: string;
  title: string;
}[] = [
  { value: 'compact', label: 'S', title: 'Compact tiles (more columns)' },
  { value: 'comfortable', label: 'M', title: 'Comfortable tile size' },
  { value: 'spacious', label: 'L', title: 'Large tiles (fewer columns)' }
];

const QUICK_SUGGESTION_TAGS = [
  '1girl',
  'solo',
  'scenery',
  'sky',
  'dress',
  'smile'
];

const detailDialog = ref<InstanceType<typeof BooruPostInspector>>();
function openDetail(post: BooruPost) {
  detailDialog.value?.open(post);
}

const route = useRoute();
const router = useRouter();
const sources = ref<BooruSource[]>([]);
const settings = ref<BooruSettings | null>(null);
const selectedSource = shallowRef('');
const query = shallowRef('');

const initialPrefs = readLocalPrefs();
const layoutMode = shallowRef<BooruLayoutMode>(
  initialPrefs.layoutMode ?? 'masonry'
);
const gridDensity = shallowRef<BooruGridDensity>(
  initialPrefs.gridDensity ?? 'comfortable'
);
let userChangedLayout = false;
let userChangedDensity = false;

watch(
  () => (route.name === 'booru' ? route.query.q : undefined),
  (q) => {
    if (typeof q !== 'string' || !q) return;
    query.value = q;
    void router.replace({ path: '/booru' });
    if (sources.value.length > 0) void runSearch(true);
  },
  { immediate: true }
);

const selectedSort = shallowRef('latest');
const selectedRatings = ref<string[]>([]);
const posts = ref<BooruPost[]>([]);
const nextCursor = shallowRef<string | null>(null);
const ended = shallowRef(false);
const isLoading = shallowRef(false);
const isSetupLoading = shallowRef(false);
const errorMessage = shallowRef('');
const warnings = ref<string[]>([]);
let ratingsBySource: Record<string, unknown> = {};

const scrollViewport = ref<HTMLElement | null>(null);
const gridWidth = shallowRef(1200);
const viewportHeight = shallowRef(800);
const scrollTop = shallowRef(0);
let resizeObserver: ResizeObserver | undefined;
let savedScrollTop = 0;

const loadedImages = shallowRef<Record<string, true>>({});
const measuredDimensions = shallowRef<
  Record<string, { width: number; height: number }>
>({});
const isViewActive = shallowRef(true);

const GRID_GAP = 14;
const OVERSCAN_PX = 800;

const activeSource = computed(() =>
  sources.value.find((source) => source.source === selectedSource.value)
);
const visibleWarnings = computed(() => formatBooruWarnings(warnings.value));

const activeQueryTags = computed(() =>
  query.value
    .split(/[\s,]+/u)
    .map((token) => token.trim())
    .filter(Boolean)
);

const postMap = computed(() => {
  const map = new Map<string, BooruPost>();
  for (const post of posts.value) {
    map.set(`${post.source}:${post.postId}`, post);
  }
  return map;
});

const sizablePosts = computed(() =>
  posts.value.map((post) => {
    const key = `${post.source}:${post.postId}`;
    const measured = measuredDimensions.value[key];
    return {
      key,
      width: post.width > 0 ? post.width : (measured?.width ?? 0),
      height: post.height > 0 ? post.height : (measured?.height ?? 0)
    };
  })
);

const gridLayout = computed(() =>
  computeBooruGridLayout({
    items: sizablePosts.value,
    containerWidth: gridWidth.value,
    mode: layoutMode.value,
    density: gridDensity.value,
    gap: GRID_GAP
  })
);

const visibleBoxes = computed(() => {
  if (!isViewActive.value) return [];
  return filterVisibleBoxes(
    gridLayout.value.boxes,
    scrollTop.value,
    viewportHeight.value,
    OVERSCAN_PX
  );
});

const visibleTiles = computed(() =>
  visibleBoxes.value.flatMap((box) => {
    const post = postMap.value.get(box.key);
    return post ? [{ box, post }] : [];
  })
);

function persistGalleryState() {
  writeLocalPrefs(layoutMode.value, gridDensity.value);
  void saveAppData('booru_gallery_state', {
    ratingsBySource,
    layoutMode: layoutMode.value,
    gridDensity: gridDensity.value,
    selectedSource: selectedSource.value || undefined
  }).catch((error) =>
    console.error('Failed to save Booru gallery state:', error)
  );
}

function setLayoutMode(mode: BooruLayoutMode) {
  userChangedLayout = true;
  layoutMode.value = mode;
  persistGalleryState();
}

function setGridDensity(density: BooruGridDensity) {
  userChangedDensity = true;
  gridDensity.value = density;
  persistGalleryState();
}

function ratingsForSource(source: string) {
  const available =
    sources.value.find((item) => item.source === source)?.ratings ?? [];
  const saved = ratingsBySource[source];
  return normalizeBooruRatings(
    available,
    Array.isArray(saved)
      ? saved.filter((rating): rating is string => typeof rating === 'string')
      : undefined
  );
}

function formatSortLabel(sort: string): string {
  if (!sort) return 'Sort';
  const s = sort.toLowerCase();
  switch (s) {
    case 'latest':
      return 'Latest';
    case 'new':
      return 'Newest';
    case 'score':
      return 'Score';
    case 'favcount':
    case 'favorites':
      return 'Favorites';
    case 'views':
      return 'Views';
    case 'random':
      return 'Random';
    case 'rank':
      return 'Rank';
    default:
      return sort.charAt(0).toUpperCase() + sort.slice(1);
  }
}

function onTileImageLoad(payload: {
  key: string;
  naturalWidth: number;
  naturalHeight: number;
}) {
  if (!loadedImages.value[payload.key]) {
    loadedImages.value = {
      ...loadedImages.value,
      [payload.key]: true
    };
  }
  const post = postMap.value.get(payload.key);
  if (
    post &&
    (post.width <= 0 || post.height <= 0) &&
    payload.naturalWidth > 0 &&
    payload.naturalHeight > 0 &&
    !measuredDimensions.value[payload.key]
  ) {
    measuredDimensions.value = {
      ...measuredDimensions.value,
      [payload.key]: {
        width: payload.naturalWidth,
        height: payload.naturalHeight
      }
    };
  }
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadSources() {
  if (isSetupLoading.value) return;
  isSetupLoading.value = true;
  errorMessage.value = '';
  try {
    const [availableSources, remoteSettings, savedState] = await Promise.all([
      fetchBooruSources(),
      fetchBooruSettings(),
      loadAppData<BooruGalleryState>('booru_gallery_state').catch((error) => {
        console.error('Failed to load Booru gallery state:', error);
        return null;
      })
    ]);
    sources.value = availableSources;
    settings.value = remoteSettings;
    const storedRatings = savedState?.ratingsBySource;
    ratingsBySource =
      storedRatings &&
      typeof storedRatings === 'object' &&
      !Array.isArray(storedRatings)
        ? storedRatings
        : {};
    if (
      !userChangedLayout &&
      !initialPrefs.layoutMode &&
      isValidLayoutMode(savedState?.layoutMode)
    ) {
      layoutMode.value = savedState.layoutMode;
    }
    if (
      !userChangedDensity &&
      !initialPrefs.gridDensity &&
      isValidGridDensity(savedState?.gridDensity)
    ) {
      gridDensity.value = savedState.gridDensity;
    }
    writeLocalPrefs(layoutMode.value, gridDensity.value);
    const preferredSource =
      savedState?.selectedSource &&
      availableSources.some(
        (source) => source.source === savedState.selectedSource
      )
        ? savedState.selectedSource
        : availableSources.some(
              (source) => source.source === remoteSettings.defaultSource
            )
          ? remoteSettings.defaultSource
          : availableSources[0]?.source || '';
    selectedSource.value = preferredSource;
    selectedSort.value =
      activeSource.value?.sortValues[0] ||
      (selectedSource.value === 'aitag' ? 'new' : 'latest');
    selectedRatings.value = ratingsForSource(selectedSource.value);
    if (selectedSource.value) await runSearch(true);
  } catch (error) {
    errorMessage.value = readableError(error);
  } finally {
    isSetupLoading.value = false;
  }
}

async function changeSource(source: string) {
  selectedSource.value = source;
  selectedSort.value = activeSource.value?.sortValues[0] || 'latest';
  selectedRatings.value = ratingsForSource(source);
  persistGalleryState();
  await runSearch(true);
}

async function changeSort(sort: string) {
  selectedSort.value = sort;
  await runSearch(true);
}

function toggleRating(rating: string) {
  const nextRatings = selectedRatings.value.includes(rating)
    ? selectedRatings.value.filter((item) => item !== rating)
    : [...selectedRatings.value, rating];
  selectedRatings.value = normalizeBooruRatings(
    activeSource.value?.ratings ?? [],
    nextRatings
  );
  ratingsBySource[selectedSource.value] = selectedRatings.value;
  persistGalleryState();
  void runSearch(true);
}

function removeQueryTag(tagToRemove: string) {
  const remaining = activeQueryTags.value.filter((tag) => tag !== tagToRemove);
  query.value = remaining.join(' ');
  void runSearch(true);
}

function clearQuery() {
  query.value = '';
  void runSearch(true);
}

function applySuggestionTag(tag: string) {
  query.value = tag;
  void runSearch(true);
}

const isCloudflareBlocked = computed(
  () =>
    selectedSource.value === 'konachan.com' &&
    (errorMessage.value.toLowerCase().includes('cloudflare') ||
      errorMessage.value.includes('403'))
);

const isSolvingCloudflare = shallowRef(false);

async function handleSolveCloudflare() {
  if (isSolvingCloudflare.value) return;
  isSolvingCloudflare.value = true;
  try {
    await solveBooruCloudflare('konachan.com');
    errorMessage.value = '';
    if (posts.value.length > 0) {
      await runSearch(false);
    } else {
      await runSearch(true);
    }
  } catch (error) {
    errorMessage.value = readableError(error);
  } finally {
    isSolvingCloudflare.value = false;
  }
}

async function retryPagination() {
  errorMessage.value = '';
  await runSearch(false);
}

async function runSearch(reset = false) {
  if (!selectedSource.value || isLoading.value) return;
  isLoading.value = true;
  errorMessage.value = '';
  if (reset) {
    posts.value = [];
    nextCursor.value = null;
    ended.value = false;
    loadedImages.value = {};
    measuredDimensions.value = {};
    savedScrollTop = 0;
    scrollTop.value = 0;
    scrollViewport.value?.scrollTo({ top: 0 });
  }
  try {
    const page = await searchBooru({
      source: selectedSource.value,
      query: query.value.trim(),
      ratings: selectedRatings.value,
      sort: selectedSort.value,
      cursor: reset ? null : nextCursor.value
    });
    const seen = new Set(
      posts.value.map((post) => `${post.source}:${post.postId}`)
    );
    posts.value = [
      ...posts.value,
      ...page.posts.filter((post) => !seen.has(`${post.source}:${post.postId}`))
    ];
    nextCursor.value = page.nextCursor;
    ended.value = page.ended || !page.nextCursor;
    warnings.value = page.warnings;
  } catch (error) {
    errorMessage.value = readableError(error);
  } finally {
    isLoading.value = false;
  }
}

function maybeLoadMore() {
  if (
    !isViewActive.value ||
    isLoading.value ||
    ended.value ||
    Boolean(errorMessage.value) ||
    posts.value.length === 0
  ) {
    return;
  }
  const remaining =
    gridLayout.value.totalHeight - (scrollTop.value + viewportHeight.value);
  if (remaining < 700) {
    void runSearch(false);
  }
}

function handleScroll(e: Event) {
  const target = e.target as HTMLElement;
  if (!target) return;
  savedScrollTop = target.scrollTop;
  scrollTop.value = target.scrollTop;
  viewportHeight.value = target.clientHeight;
  maybeLoadMore();
}

watch(
  () => gridLayout.value.totalHeight,
  () => {
    maybeLoadMore();
  }
);

function copyPostUrl(url: string) {
  void navigator.clipboard.writeText(url);
}

async function activateView() {
  isViewActive.value = true;
  if (scrollViewport.value) resizeObserver?.observe(scrollViewport.value);
  if (sources.value.length === 0) {
    void loadSources();
  }
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  if (scrollViewport.value) {
    scrollViewport.value.scrollTop = savedScrollTop;
    scrollTop.value = savedScrollTop;
    viewportHeight.value = scrollViewport.value.clientHeight;
  }
}

function deactivateView() {
  isViewActive.value = false;
  resizeObserver?.disconnect();
}

onMounted(() => {
  if (scrollViewport.value) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          gridWidth.value = Math.max(240, entry.contentRect.width - 40);
          viewportHeight.value = Math.max(400, entry.contentRect.height);
        }
      }
    });
    void activateView();
  }
  void loadSources();
});

onActivated(activateView);
onDeactivated(deactivateView);
onUnmounted(deactivateView);
</script>

<template>
  <PageLayout
    title="Booru Gallery"
    subtitle="Explore Danbooru, Gelbooru, Safebooru, and AI TAG inspirations"
    content-class="flex flex-col overflow-hidden p-0"
  >
    <template #icon>
      <ImageIcon class="h-4 w-4" />
    </template>

    <template #title-extra>
      <Badge
        v-if="posts.length"
        variant="secondary"
        class="font-mono text-xs font-medium tabular-nums"
      >
        {{ posts.length.toLocaleString() }} loaded
      </Badge>
    </template>

    <template #actions>
      <!-- Layout Mode Switcher (Masonry / Justified Rows / Cards) -->
      <div
        class="border-border/80 bg-secondary/60 flex items-center rounded-lg border p-0.5"
        role="group"
        aria-label="Gallery layout mode"
      >
        <button
          v-for="option in LAYOUT_OPTIONS"
          :key="option.value"
          type="button"
          :title="option.title"
          :aria-pressed="layoutMode === option.value"
          class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            layoutMode === option.value
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="setLayoutMode(option.value)"
        >
          <component :is="option.icon" class="size-3.5" />
          <span class="hidden sm:inline">{{ option.label }}</span>
        </button>
      </div>

      <!-- Density Switcher (S / M / L) -->
      <div
        class="border-border/80 bg-secondary/60 hidden items-center rounded-lg border p-0.5 md:flex"
        role="group"
        aria-label="Grid tile density"
      >
        <button
          v-for="density in DENSITY_OPTIONS"
          :key="density.value"
          type="button"
          :title="density.title"
          :aria-pressed="gridDensity === density.value"
          class="rounded-md px-2 py-1 font-mono text-xs font-semibold transition-colors"
          :class="
            gridDensity === density.value
              ? 'bg-accent text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="setGridDensity(density.value)"
        >
          {{ density.label }}
        </button>
      </div>

      <Button
        variant="outline"
        size="sm"
        class="h-8 text-xs"
        :disabled="!selectedSource || isLoading"
        title="Refresh search results"
        @click="runSearch(true)"
      >
        <RefreshCw class="size-3.5" :class="{ 'animate-spin': isLoading }" />
        <span class="hidden sm:inline">Refresh</span>
      </Button>
    </template>

    <template #below-header>
      <div
        class="border-border/80 bg-card/70 relative z-20 flex shrink-0 flex-col gap-3 border-b px-5 py-3.5 backdrop-blur-md"
      >
        <!-- Search Controls Bar -->
        <form
          class="flex flex-wrap items-center gap-2.5"
          @submit.prevent="runSearch(true)"
        >
          <!-- Source Selector -->
          <Select
            :model-value="selectedSource"
            :disabled="!sources.length || isLoading"
            @update:model-value="changeSource(String($event))"
          >
            <SelectTrigger class="bg-secondary/80 h-9 w-40 text-xs font-medium">
              <SelectValue placeholder="Source">
                {{ activeSource?.displayName || 'Source' }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup class="max-h-40 overflow-y-auto">
                <SelectItem
                  v-for="source in sources"
                  :key="source.source"
                  :value="source.source"
                >
                  {{ source.displayName }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <BooruSearchInput v-model="query" :disabled="!sources.length" />

          <!-- Sort Selector -->
          <Select
            :model-value="selectedSort"
            :disabled="!activeSource || isLoading"
            @update:model-value="changeSort(String($event))"
          >
            <SelectTrigger class="bg-secondary/80 h-9 w-34 text-xs font-medium">
              <SelectValue placeholder="Sort">
                {{ formatSortLabel(selectedSort) }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup class="max-h-40 overflow-y-auto">
                <SelectItem
                  v-for="sort in activeSource?.sortValues || []"
                  :key="sort"
                  :value="sort"
                >
                  {{ formatSortLabel(sort) }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <!-- Search Submit Button -->
          <Button
            type="submit"
            size="sm"
            class="bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 text-xs font-semibold shadow-xs"
            :disabled="!sources.length || isLoading"
          >
            <Loader2
              v-if="isLoading && posts.length === 0"
              class="h-3.5 w-3.5 animate-spin"
            />
            <Search v-else class="h-3.5 w-3.5" />
            <span>Search</span>
          </Button>
        </form>

        <!-- Rating Filters & Active Query Tag Chips -->
        <div
          v-if="activeSource?.ratings.length || activeQueryTags.length"
          class="flex flex-wrap items-center justify-between gap-3"
        >
          <div
            v-if="activeSource?.ratings.length"
            class="flex flex-wrap items-center gap-1.5"
          >
            <span class="text-muted-foreground mr-1 text-xs font-medium">
              Rating:
            </span>
            <button
              v-for="rating in activeSource.ratings"
              :key="rating"
              type="button"
              class="flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-medium capitalize transition-all"
              :class="
                selectedRatings.includes(rating)
                  ? ratingColorClass(rating)
                  : 'border-border/80 bg-secondary/40 text-muted-foreground hover:text-foreground'
              "
              :aria-pressed="selectedRatings.includes(rating)"
              @click="toggleRating(rating)"
            >
              <span
                class="h-1.5 w-1.5 rounded-full"
                :class="
                  selectedRatings.includes(rating)
                    ? 'bg-current shadow-xs'
                    : 'bg-muted-foreground'
                "
              />
              <span>{{ rating }}</span>
            </button>
          </div>

          <div
            v-if="activeQueryTags.length"
            class="flex flex-wrap items-center gap-1.5"
          >
            <span class="text-muted-foreground text-xs">Active tags:</span>
            <button
              v-for="tag in activeQueryTags"
              :key="tag"
              type="button"
              class="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs transition-colors"
              :title="`Remove tag '${tag}'`"
              @click="removeQueryTag(tag)"
            >
              <span>{{ tag }}</span>
              <X class="size-3" />
            </button>
            <button
              v-if="activeQueryTags.length > 1"
              type="button"
              class="text-muted-foreground hover:text-foreground px-1.5 text-xs underline-offset-2 hover:underline"
              @click="clearQuery"
            >
              Clear all
            </button>
          </div>
        </div>
      </div>
    </template>

    <main
      ref="scrollViewport"
      class="flex-1 overflow-y-auto p-5"
      @scroll.passive="handleScroll"
    >
      <!-- Cloudflare Challenge Error State -->
      <div
        v-if="isCloudflareBlocked && !posts.length"
        class="mx-auto mt-12 max-w-lg rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-xs leading-relaxed text-amber-200 shadow-sm"
      >
        <div class="flex items-start gap-3">
          <ShieldAlert class="h-5 w-5 shrink-0 text-amber-400" />
          <div class="space-y-2">
            <span class="block text-sm font-semibold text-amber-300"
              >Cloudflare Verification Required</span
            >
            <p class="text-muted-foreground leading-normal">
              konachan.com requires Cloudflare verification. Click the button
              below to solve the verification check first.
            </p>
            <div class="pt-1">
              <Button
                size="sm"
                class="cursor-pointer bg-amber-600 font-medium text-white shadow-xs hover:bg-amber-500"
                :disabled="isSolvingCloudflare"
                @click="handleSolveCloudflare"
              >
                <Loader2
                  v-if="isSolvingCloudflare"
                  class="mr-1.5 h-3.5 w-3.5 animate-spin"
                />
                <ShieldCheck v-else class="mr-1.5 h-3.5 w-3.5" />
                {{
                  isSolvingCloudflare
                    ? 'Verifying in window...'
                    : 'Solve Cloudflare Challenge'
                }}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Generic Error State -->
      <div
        v-else-if="errorMessage && !posts.length"
        class="border-destructive/30 bg-destructive/10 text-destructive mx-auto mt-12 max-w-lg rounded-xl border p-5 text-xs leading-relaxed shadow-sm"
      >
        <div class="flex items-start gap-3">
          <AlertCircle class="h-5 w-5 shrink-0" />
          <div class="space-y-2">
            <span class="block font-semibold">Unable to fetch posts</span>
            <p>{{ errorMessage }}</p>
            <Button
              size="sm"
              variant="outline"
              class="mt-1 h-7 text-xs"
              @click="runSearch(true)"
            >
              Try Again
            </Button>
          </div>
        </div>
      </div>

      <!-- Full-Page Aspect-Ratio Skeleton Loader on Initial Search -->
      <BooruGridSkeleton
        v-else-if="(isSetupLoading || isLoading) && !posts.length"
        :container-width="gridWidth"
        :mode="layoutMode"
        :density="gridDensity"
        :gap="GRID_GAP"
      />

      <!-- Loaded Virtualized Aspect-Ratio Gallery Results -->
      <template v-else>
        <!-- Warnings / Soft Errors -->
        <NoticeBanner v-if="visibleWarnings.length" class="mb-4">
          {{ visibleWarnings.join(' ') }}
        </NoticeBanner>

        <!-- Cloudflare Challenge Banner during pagination -->
        <div
          v-if="isCloudflareBlocked"
          class="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200"
        >
          <div class="flex items-center gap-2">
            <ShieldAlert class="h-4 w-4 shrink-0 text-amber-400" />
            <span
              >Cloudflare verification required for konachan.com. Please
              re-verify to fetch more posts.</span
            >
          </div>
          <Button
            size="sm"
            class="h-7 cursor-pointer bg-amber-600 px-3 text-xs text-white hover:bg-amber-500"
            :disabled="isSolvingCloudflare"
            @click="handleSolveCloudflare"
          >
            <Loader2
              v-if="isSolvingCloudflare"
              class="mr-1.5 h-3 w-3 animate-spin"
            />
            <ShieldCheck v-else class="mr-1.5 h-3 w-3" />
            {{ isSolvingCloudflare ? 'Verifying...' : 'Solve Challenge' }}
          </Button>
        </div>

        <NoticeBanner v-else-if="errorMessage" tone="destructive" class="mb-4">
          {{ errorMessage }}
        </NoticeBanner>

        <!-- Virtualized Positioned Aspect-Ratio Canvas -->
        <div
          v-if="posts.length"
          class="relative w-full"
          :style="{ height: `${gridLayout.totalHeight}px` }"
        >
          <BooruPostTile
            v-for="{ box, post } in visibleTiles"
            :key="box.key"
            :post="post"
            :box="box"
            :initially-loaded="Boolean(loadedImages[box.key])"
            @select="openDetail"
            @open-external="openUrl"
            @copy-url="copyPostUrl"
            @image-loaded="onTileImageLoad"
          />
        </div>

        <!-- Empty Results View with Clickable Suggestions -->
        <div
          v-if="!posts.length && !isLoading"
          class="mx-auto my-16 max-w-md text-center"
        >
          <div
            class="border-border bg-secondary text-muted-foreground mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border shadow-xs"
          >
            <Search class="h-5 w-5" />
          </div>
          <h3 class="text-foreground text-sm font-semibold">No posts found</h3>
          <p class="text-muted-foreground mt-1 text-xs">
            Try adjusting your search tags or rating filters, or explore a
            popular tag:
          </p>
          <div class="mt-4 flex flex-wrap items-center justify-center gap-1.5">
            <button
              v-for="tag in QUICK_SUGGESTION_TAGS"
              :key="tag"
              type="button"
              class="border-border bg-secondary/70 text-foreground hover:border-primary/50 hover:bg-secondary inline-flex items-center gap-1 rounded-full border px-3 py-1 font-mono text-xs transition-colors"
              @click="applySuggestionTag(tag)"
            >
              <Sparkles class="text-primary size-3" />
              <span>{{ tag }}</span>
            </button>
          </div>
        </div>

        <div class="flex flex-col items-center justify-center gap-3 py-6">
          <!-- Cloudflare Challenge Banner during pagination -->
          <div
            v-if="isCloudflareBlocked && posts.length"
            class="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 shadow-xs"
          >
            <div class="flex items-center gap-2">
              <ShieldAlert class="h-4 w-4 shrink-0 text-amber-400" />
              <span>Cloudflare verification required to load more posts.</span>
            </div>
            <Button
              size="sm"
              class="h-7 cursor-pointer bg-amber-600 px-3 text-xs text-white hover:bg-amber-500"
              :disabled="isSolvingCloudflare"
              @click="handleSolveCloudflare"
            >
              <Loader2
                v-if="isSolvingCloudflare"
                class="mr-1.5 h-3 w-3 animate-spin"
              />
              <ShieldCheck v-else class="mr-1.5 h-3 w-3" />
              {{ isSolvingCloudflare ? 'Verifying...' : 'Solve Challenge' }}
            </Button>
          </div>

          <!-- Generic Pagination Error Banner -->
          <div
            v-else-if="errorMessage && posts.length"
            class="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-3 rounded-lg border px-4 py-2 text-xs"
          >
            <AlertCircle class="h-4 w-4 shrink-0" />
            <span>{{ errorMessage }}</span>
            <Button
              size="sm"
              variant="outline"
              class="h-7 text-xs"
              @click="retryPagination"
            >
              Retry
            </Button>
          </div>

          <div
            v-else-if="isLoading && posts.length"
            class="border-border/80 bg-card/80 text-muted-foreground flex items-center gap-2.5 rounded-full border px-4 py-2 text-xs font-medium shadow-sm backdrop-blur-md"
          >
            <Loader2 class="text-primary h-4 w-4 animate-spin" />
            <span>Fetching more inspirations…</span>
          </div>
          <div
            v-else-if="ended && posts.length"
            class="text-muted-foreground flex items-center gap-1.5 font-mono text-xs"
          >
            <Check class="h-3.5 w-3.5 text-emerald-400" />
            <span>Reached end of gallery results</span>
          </div>
          <Button
            v-else-if="!ended && posts.length"
            variant="outline"
            size="sm"
            class="border-border bg-secondary text-foreground hover:bg-accent px-5 text-xs font-semibold shadow-xs"
            @click="runSearch(false)"
          >
            <ChevronDown class="h-4 w-4" />
            <span>Load More Results</span>
          </Button>
        </div>
      </template>
    </main>
  </PageLayout>

  <!-- Post Detail Dialog Modal -->
  <BooruPostInspector ref="detailDialog" :settings="settings" />
</template>
