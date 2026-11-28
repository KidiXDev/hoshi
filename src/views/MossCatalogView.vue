<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual';
import {
  Dices,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  Shapes,
  X
} from '@lucide/vue';
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
import { toast } from 'vue-sonner';
import FilterPopover from '@/components/common/FilterPopover.vue';
import GalleryFilterSelect from '@/components/common/GalleryFilterSelect.vue';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import PageLayout from '@/components/layout/PageLayout.vue';
import MossCatalogCard from '@/components/moss-catalog/MossCatalogCard.vue';
import MossCatalogDetailDialog from '@/components/moss-catalog/MossCatalogDetailDialog.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  getMossCatalogFacets,
  searchMossCatalog
} from '@/services/mossCatalog';
import { useWorkflowStore } from '@/stores/workflowStore';
import type {
  MossCatalogEntry,
  MossCatalogFacets,
  MossCatalogKind,
  MossCatalogSort
} from '@/types/mossCatalog';

defineOptions({ name: 'MossCatalogView' });

const workflowStore = useWorkflowStore();

const TABS: { label: string; value: MossCatalogKind }[] = [
  { label: 'Characters', value: 'character' },
  { label: 'Styles', value: 'style' }
];

// Search state
const activeKind = ref<MossCatalogKind>('character');
const searchQuery = ref('');
const sort = ref<MossCatalogSort>('count');
const randomSeed = ref(Math.floor(Math.random() * 1_000_000));
const currentPage = ref(1);
const totalPages = ref(1);
const totalItems = ref(0);
const isLoading = ref(false);
const loadingMore = ref(false);
const isRefreshing = ref(false);
const errorMessage = ref('');
const items = ref<MossCatalogEntry[]>([]);
const facets = ref<MossCatalogFacets | null>(null);

// Filters
const selectedCopyright = ref('all');
const selectedGender = ref('all');
const selectedHairColor = ref('all');
const selectedHairLength = ref('all');
const selectedEyeColor = ref('all');
const selectedOutfit = ref('all');
const selectedCategory = ref('all');
const filterModels = [
  selectedCopyright,
  selectedGender,
  selectedHairColor,
  selectedHairLength,
  selectedEyeColor,
  selectedOutfit,
  selectedCategory
];

const selectedEntry = ref<MossCatalogEntry | null>(null);
const isDetailOpen = ref(false);

// Virtual grid geometry
const GRID_GAP = 14;
const CARD_ASPECT_RATIO = 4 / 3;
const CARD_FOOTER_HEIGHT = 64;
const OVERSCAN_ROWS = 3;

const scrollViewport = ref<HTMLElement | null>(null);
const gridWidth = ref(1200);
const isViewActive = ref(true);
let resizeObserver: ResizeObserver | null = null;
let savedScrollTop = 0;

const hasItems = computed(() => items.value.length > 0);
const hasMore = computed(() => currentPage.value < totalPages.value);

const columns = computed(() => {
  if (gridWidth.value < 540) return 2;
  if (gridWidth.value < 840) return 3;
  if (gridWidth.value < 1140) return 4;
  if (gridWidth.value < 1500) return 5;
  if (gridWidth.value < 1860) return 6;
  return 7;
});
const cardWidth = computed(() =>
  Math.max(
    80,
    (gridWidth.value - GRID_GAP * (columns.value - 1)) / columns.value
  )
);
const rowHeight = computed(
  () => cardWidth.value * CARD_ASPECT_RATIO + CARD_FOOTER_HEIGHT + GRID_GAP
);
const totalRows = computed(() => Math.ceil(items.value.length / columns.value));

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

const categoryLabels = computed(
  () =>
    new Map(facets.value?.category.map((value) => [value.value, value.label]))
);

const activeFilterCount = computed(
  () =>
    filterModels.filter((model) => model.value !== 'all').length +
    (sort.value === 'count' ? 0 : 1)
);

function filterValue(model: { value: string }): string | undefined {
  return model.value === 'all' ? undefined : model.value;
}

async function loadFacets(forceRefresh = false) {
  try {
    facets.value = await getMossCatalogFacets(forceRefresh);
  } catch (err) {
    errorMessage.value = String(err);
  }
}

async function performSearch(reset = true) {
  if (reset) {
    currentPage.value = 1;
    isLoading.value = true;
    errorMessage.value = '';
    items.value = [];
    savedScrollTop = 0;
    if (scrollViewport.value) scrollViewport.value.scrollTop = 0;
  }
  const isCharacter = activeKind.value === 'character';
  try {
    const response = await searchMossCatalog({
      query: searchQuery.value.trim() || undefined,
      kind: activeKind.value,
      sort: sort.value,
      seed: sort.value === 'random' ? randomSeed.value : undefined,
      page: currentPage.value,
      copyright: isCharacter ? filterValue(selectedCopyright) : undefined,
      gender: isCharacter ? filterValue(selectedGender) : undefined,
      hairColor: isCharacter ? filterValue(selectedHairColor) : undefined,
      hairLength: isCharacter ? filterValue(selectedHairLength) : undefined,
      eyeColor: isCharacter ? filterValue(selectedEyeColor) : undefined,
      outfit: isCharacter ? filterValue(selectedOutfit) : undefined,
      category: isCharacter ? undefined : filterValue(selectedCategory)
    });
    items.value = reset
      ? response.results
      : [...items.value, ...response.results];
    totalItems.value = response.total;
    totalPages.value = response.pages;
  } catch (err) {
    errorMessage.value = String(err);
  } finally {
    isLoading.value = false;
    loadingMore.value = false;
  }
}

async function loadMore() {
  if (isLoading.value || loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  currentPage.value++;
  await performSearch(false);
}

function handleScroll(event: Event) {
  if (!isViewActive.value) return;
  const target = event.target as HTMLElement;
  savedScrollTop = target.scrollTop;
  if (target.scrollHeight - target.scrollTop - target.clientHeight < 600)
    void loadMore();
}

watch(virtualRows, (rows) => {
  const lastRow = rows.at(-1);
  if (isViewActive.value && lastRow && lastRow.index >= totalRows.value - 2)
    void loadMore();
});

function handleTabChange(kind: MossCatalogKind) {
  if (activeKind.value === kind) return;
  activeKind.value = kind;
  searchQuery.value = '';
  void performSearch(true);
}

function resetAllFilters() {
  for (const model of filterModels) model.value = 'all';
  searchQuery.value = '';
  sort.value = 'count';
  void performSearch(true);
}

function rerollSeed() {
  randomSeed.value = Math.floor(Math.random() * 1_000_000);
  void performSearch(true);
}

async function refreshCatalog() {
  isRefreshing.value = true;
  await loadFacets(true);
  await performSearch(true);
  isRefreshing.value = false;
  if (!errorMessage.value) toast.success('MOSS Catalog refreshed');
}

function promptFor(entry: MossCatalogEntry): string {
  return workflowStore.profile === 'moss' || entry.kind === 'style'
    ? entry.caption
    : entry.tags;
}

function copyPrompt(entry: MossCatalogEntry) {
  void navigator.clipboard.writeText(promptFor(entry));
  toast.success('Prompt copied to clipboard');
}

function usePrompt(entry: MossCatalogEntry) {
  const text = promptFor(entry);
  const current = workflowStore.positivePrompt.trim();
  workflowStore.positivePrompt = current ? `${current}, ${text}` : text;
  toast.success('Appended prompt to Workflow Generator');
}

function openDetail(entry: MossCatalogEntry) {
  selectedEntry.value = entry;
  isDetailOpen.value = true;
}

function filterByCopyright(copyright: string) {
  selectedCopyright.value = copyright;
}

function filterByTag(tag: string) {
  searchQuery.value = tag;
  void performSearch(true);
}

async function activateView() {
  isViewActive.value = true;
  if (scrollViewport.value) resizeObserver?.observe(scrollViewport.value);
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  rowVirtualizer.value.measure();
  rowVirtualizer.value.scrollToOffset(savedScrollTop);
  if (scrollViewport.value && savedScrollTop > 0)
    scrollViewport.value.scrollTop = savedScrollTop;
}

function deactivateView() {
  isViewActive.value = false;
  resizeObserver?.disconnect();
}

onMounted(() => {
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.contentRect.width > 0)
        gridWidth.value = entry.contentRect.width - 40;
    }
  });
  if (scrollViewport.value) {
    resizeObserver.observe(scrollViewport.value);
    void activateView();
  }
  void loadFacets();
  void performSearch(true);
});

onActivated(activateView);
onDeactivated(deactivateView);
onUnmounted(deactivateView);

watch([sort, ...filterModels], () => {
  if (isViewActive.value) void performSearch(true);
});
</script>

<template>
  <PageLayout
    title="MOSS Catalog"
    subtitle="Browse MOSS Image character samples and art styles with reusable prompts"
    content-class="flex flex-col overflow-hidden p-0"
  >
    <template #icon>
      <Shapes class="h-4 w-4" />
    </template>
    <template #title-extra>
      <Badge
        v-if="facets"
        variant="outline"
        class="border-primary/30 text-primary h-4 px-1.5 text-[10px] font-normal"
      >
        {{ facets.characters.toLocaleString() }} characters,
        {{ facets.styles.toLocaleString() }} styles
      </Badge>
    </template>
    <template #actions>
      <div class="flex items-center gap-1">
        <button
          v-for="tab in TABS"
          :key="tab.value"
          type="button"
          class="cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            activeKind === tab.value
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          @click="handleTabChange(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>
    </template>

    <template #below-header>
      <div
        class="border-border/80 bg-card/70 shrink-0 border-b px-5 py-3.5 backdrop-blur-md"
      >
        <form
          class="flex flex-wrap items-center gap-2.5"
          @submit.prevent="performSearch(true)"
        >
          <div class="relative min-w-64 flex-1">
            <Search
              class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
            />
            <Input
              v-model="searchQuery"
              type="text"
              :placeholder="
                activeKind === 'character'
                  ? 'Search characters, series or tags'
                  : 'Search art styles'
              "
              class="border-border bg-secondary/50 focus:bg-background h-9 pr-8 pl-9 text-xs transition-colors"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              v-if="searchQuery"
              type="button"
              aria-label="Clear search"
              class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer p-0.5"
              @click="searchQuery = ''"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>

          <Select v-model="sort">
            <SelectTrigger class="bg-secondary/80 h-9 w-36 text-xs font-medium">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="count" class="text-xs"
                  >Most Popular</SelectItem
                >
                <SelectItem value="newest" class="text-xs">Newest</SelectItem>
                <SelectItem value="az" class="text-xs">A to Z</SelectItem>
                <SelectItem value="random" class="text-xs">Random</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Button
            v-if="sort === 'random'"
            type="button"
            variant="outline"
            size="sm"
            class="h-9 cursor-pointer gap-1.5 px-3 text-xs"
            @click="rerollSeed"
          >
            <Dices class="h-3.5 w-3.5" />
            <span>Re-roll</span>
          </Button>

          <FilterPopover
            :count="activeFilterCount"
            content-class="w-72"
            @reset="resetAllFilters"
          >
            <template v-if="activeKind === 'character'">
              <GalleryFilterSelect
                v-model="selectedCopyright"
                label="Series"
                placeholder="All Series"
                :options="facets?.copyright ?? []"
                class="justify-between"
                trigger-class="w-44"
                show-counts
              />
              <GalleryFilterSelect
                v-model="selectedGender"
                label="Gender"
                placeholder="All"
                :options="facets?.gender ?? []"
                class="justify-between"
                trigger-class="w-44"
                show-counts
              />
              <GalleryFilterSelect
                v-model="selectedHairColor"
                label="Hair"
                placeholder="Any Color"
                :options="facets?.hairColor ?? []"
                class="justify-between"
                trigger-class="w-44"
              />
              <GalleryFilterSelect
                v-model="selectedHairLength"
                label="Length"
                placeholder="Any Length"
                :options="facets?.hairLength ?? []"
                class="justify-between"
                trigger-class="w-44"
              />
              <GalleryFilterSelect
                v-model="selectedEyeColor"
                label="Eyes"
                placeholder="Any Color"
                :options="facets?.eyeColor ?? []"
                class="justify-between"
                trigger-class="w-44"
              />
              <GalleryFilterSelect
                v-model="selectedOutfit"
                label="Outfit"
                placeholder="Any Outfit"
                :options="facets?.outfit ?? []"
                class="justify-between"
                trigger-class="w-44"
                show-counts
              />
            </template>
            <GalleryFilterSelect
              v-else
              v-model="selectedCategory"
              label="Category"
              placeholder="All Categories"
              :options="facets?.category ?? []"
              class="justify-between"
              trigger-class="w-44"
              show-counts
            />
          </FilterPopover>

          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-9 cursor-pointer px-3"
            title="Download the latest catalog"
            aria-label="Refresh catalog"
            :disabled="isRefreshing"
            @click="refreshCatalog"
          >
            <RefreshCw
              class="h-3.5 w-3.5"
              :class="{ 'animate-spin': isRefreshing }"
            />
          </Button>

          <Button
            type="submit"
            size="sm"
            class="h-9 cursor-pointer px-4 text-xs font-semibold shadow-xs"
            :disabled="isLoading"
          >
            <Loader2
              v-if="isLoading && !hasItems"
              class="h-3.5 w-3.5 animate-spin"
            />
            <Search v-else class="h-3.5 w-3.5" />
            <span>Search</span>
          </Button>
        </form>
      </div>
    </template>

    <main
      ref="scrollViewport"
      class="min-h-0 flex-1 overflow-y-auto p-5"
      @scroll.passive="handleScroll"
    >
      <NoticeBanner
        v-if="errorMessage && !hasItems"
        tone="destructive"
        class="mb-4 shadow-xs"
      >
        <span>{{ errorMessage }}</span>
        <template #actions>
          <Button
            variant="outline"
            size="sm"
            class="border-destructive/40 hover:bg-destructive/10 h-7 cursor-pointer text-xs"
            @click="performSearch(true)"
          >
            Retry
          </Button>
        </template>
      </NoticeBanner>

      <div
        v-if="isLoading && !hasItems"
        class="grid gap-3.5"
        :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
      >
        <div
          v-for="n in columns * 3"
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

      <div
        v-else-if="!hasItems && !errorMessage"
        class="border-border/60 bg-card/40 mx-auto my-12 flex max-w-md flex-col items-center justify-center rounded-xl border p-8 text-center text-xs shadow-xs"
      >
        <div
          class="bg-muted text-muted-foreground mb-3 flex h-12 w-12 items-center justify-center rounded-full"
        >
          <ImageOff class="h-6 w-6" />
        </div>
        <h3 class="text-sm font-semibold">No results found</h3>
        <p class="text-muted-foreground mt-1 text-xs">
          Try another search or clear some filters.
        </p>
        <Button
          variant="outline"
          size="sm"
          class="mt-4 cursor-pointer text-xs"
          @click="resetAllFilters"
        >
          Reset Filters
        </Button>
      </div>

      <div
        v-else-if="hasItems"
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
          <MossCatalogCard
            v-for="entry in items.slice(
              virtualRow.index * columns,
              (virtualRow.index + 1) * columns
            )"
            :key="entry.id"
            :entry="entry"
            :category-label="categoryLabels.get(entry.category ?? '')"
            @select="openDetail"
            @copy="copyPrompt"
            @use="usePrompt"
          />
        </div>
      </div>

      <div
        v-if="loadingMore"
        class="text-muted-foreground flex items-center justify-center py-6"
      >
        <Loader2 class="h-5 w-5 animate-spin" />
        <span class="ml-2 text-xs">Loading more...</span>
      </div>
    </main>
  </PageLayout>

  <MossCatalogDetailDialog
    v-model:open="isDetailOpen"
    :entry="selectedEntry"
    :category-label="categoryLabels.get(selectedEntry?.category ?? '')"
    @filter-by-copyright="filterByCopyright"
    @filter-by-tag="filterByTag"
  />
</template>
