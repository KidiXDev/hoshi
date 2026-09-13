<script setup lang="ts">
import FilterPopover from '@/components/common/FilterPopover.vue';
import GalleryFilterSelect from '@/components/common/GalleryFilterSelect.vue';
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
import {
  BookOpen,
  Dices,
  ImageOff,
  Layers,
  Loader2,
  Palette,
  Search,
  Sparkles,
  User,
  X
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import AnimadexCard from '@/components/animadex/AnimadexCard.vue';
import AnimadexDetailDialog from '@/components/animadex/AnimadexDetailDialog.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
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
import { Switch } from '@/components/ui/switch';
import {
  getArtistFacets,
  getCharacterFacets,
  searchArtists,
  searchCharacters,
  searchCopyrights
} from '@/services/animadexApi';
import { useWorkflowStore } from '@/stores/workflowStore';
import type {
  AnimaDexArtist,
  AnimaDexCharacter,
  AnimaDexCopyright,
  ArtistFacetsResponse,
  ArtistFilterParams,
  ArtistSortOption,
  CharacterFacetsResponse,
  CharacterFilterParams,
  CharacterSortOption,
  CopyrightFilterParams,
  CopyrightSortOption
} from '@/types/animadex';

defineOptions({ name: 'AnimadexExploreView' });

const workflowStore = useWorkflowStore();

type BrowseTab = 'characters' | 'artists' | 'copyrights';
const activeTab = ref<BrowseTab>('characters');

const TAB_SHORTCUTS: { label: string; value: BrowseTab; icon: typeof User }[] =
  [
    { label: 'Characters', value: 'characters', icon: User },
    { label: 'Artists', value: 'artists', icon: Palette },
    { label: 'Series', value: 'copyrights', icon: BookOpen }
  ];

// Search & Infinite Pagination
const searchQuery = ref('');
const currentPage = ref(1);
const totalPages = ref(1);
const totalItems = ref(0);
const isLoading = ref(false);
const loadingMore = ref(false);
const errorMessage = ref('');

// Sorting
const characterSort = ref<CharacterSortOption>('count');
const artistSort = ref<ArtistSortOption>('count');
const copyrightSort = ref<CopyrightSortOption>('count');
const randomSeed = ref(Math.floor(Math.random() * 1_000_000));

// Character Filters
const selectedSeries = ref<string>('all');
const selectedGender = ref<string>('all');
const selectedHairColor = ref<string>('all');
const selectedHairLength = ref<string>('all');
const selectedEyeColor = ref<string>('all');
const filterLorasOnly = ref(false);

// Artist Filters
const selectedScoreBucket = ref<string>('all');
const selectedArtistCategory = ref<string>('all');

const filterFields = [
  { label: 'Series', model: selectedSeries },
  { label: 'Gender', model: selectedGender },
  { label: 'Hair', model: selectedHairColor },
  { label: 'Length', model: selectedHairLength },
  { label: 'Eyes', model: selectedEyeColor },
  { label: 'Score', model: selectedScoreBucket },
  { label: 'Category', model: selectedArtistCategory }
];

// Facets cache
const characterFacets = ref<CharacterFacetsResponse['facets'] | null>(null);
const artistFacets = ref<ArtistFacetsResponse['facets'] | null>(null);

// Data Results Lists
const charactersList = ref<AnimaDexCharacter[]>([]);
const artistsList = ref<AnimaDexArtist[]>([]);
const copyrightsList = ref<AnimaDexCopyright[]>([]);

// Detail modal
const selectedDetailItem = ref<
  AnimaDexCharacter | AnimaDexArtist | AnimaDexCopyright | null
>(null);
const isDetailOpen = ref(false);

// Virtualization geometry parameters (consistent with Booru & Civitai galleries)
const GRID_GAP = 14;
const CARD_ASPECT_RATIO = 4 / 3;
const CARD_FOOTER_HEIGHT = 72;
const OVERSCAN_ROWS = 3;

const scrollViewport = ref<HTMLElement | null>(null);
const gridWidth = ref(1200);
const isViewActive = ref(true);
let resizeObserver: ResizeObserver | null = null;
let savedScrollTop = 0;

const currentItems = computed<
  (AnimaDexCharacter | AnimaDexArtist | AnimaDexCopyright)[]
>(() => {
  if (activeTab.value === 'characters') return charactersList.value;
  if (activeTab.value === 'artists') return artistsList.value;
  return copyrightsList.value;
});

const hasItems = computed(() => currentItems.value.length > 0);
const hasMore = computed(() => currentPage.value < totalPages.value);

const columns = computed(() => {
  if (gridWidth.value < 540) return 2;
  if (gridWidth.value < 840) return 3;
  if (gridWidth.value < 1140) return 4;
  if (gridWidth.value < 1500) return 5;
  if (gridWidth.value < 1860) return 6;
  return 7;
});

const cardWidth = computed(() => {
  const totalGapWidth = GRID_GAP * (columns.value - 1);
  return Math.max(80, (gridWidth.value - totalGapWidth) / columns.value);
});

const cardImageHeight = computed(() => cardWidth.value * CARD_ASPECT_RATIO);
const rowHeight = computed(
  () => cardImageHeight.value + CARD_FOOTER_HEIGHT + GRID_GAP
);

const totalRows = computed(() =>
  Math.ceil(currentItems.value.length / columns.value)
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

// Active filter count computation
const activeFilterCount = computed(() => {
  let count = 0;
  if (searchQuery.value.trim()) count++;
  if (activeTab.value === 'characters') {
    if (selectedSeries.value !== 'all') count++;
    if (selectedGender.value !== 'all') count++;
    if (selectedHairColor.value !== 'all') count++;
    if (selectedHairLength.value !== 'all') count++;
    if (selectedEyeColor.value !== 'all') count++;
    if (filterLorasOnly.value) count++;
    if (characterSort.value !== 'count') count++;
  } else if (activeTab.value === 'artists') {
    if (selectedScoreBucket.value !== 'all') count++;
    if (selectedArtistCategory.value !== 'all') count++;
    if (artistSort.value !== 'count') count++;
  } else if (
    activeTab.value === 'copyrights' &&
    copyrightSort.value !== 'count'
  ) {
    count++;
  }
  return count;
});

async function loadFacets() {
  try {
    if (activeTab.value === 'characters' && !characterFacets.value) {
      const res = await getCharacterFacets();
      characterFacets.value = res.facets;
    } else if (activeTab.value === 'artists' && !artistFacets.value) {
      const res = await getArtistFacets();
      artistFacets.value = res.facets;
    }
  } catch (err) {
    console.warn('Failed to fetch facets:', err);
  }
}

async function performSearch(reset = true) {
  if (reset) {
    currentPage.value = 1;
    isLoading.value = true;
    errorMessage.value = '';
    if (activeTab.value === 'characters') charactersList.value = [];
    else if (activeTab.value === 'artists') artistsList.value = [];
    else copyrightsList.value = [];
    if (scrollViewport.value) {
      scrollViewport.value.scrollTop = 0;
      savedScrollTop = 0;
    }
  }

  try {
    if (activeTab.value === 'characters') {
      const params: CharacterFilterParams = {
        q: searchQuery.value.trim() || undefined,
        page: currentPage.value,
        sort: characterSort.value,
        seed: characterSort.value === 'random' ? randomSeed.value : undefined,
        loras: filterLorasOnly.value || undefined,
        copyright:
          selectedSeries.value === 'all' ? undefined : [selectedSeries.value],
        gender:
          selectedGender.value === 'all' ? undefined : [selectedGender.value],
        hair_color:
          selectedHairColor.value === 'all'
            ? undefined
            : [selectedHairColor.value],
        hair_length:
          selectedHairLength.value === 'all'
            ? undefined
            : [selectedHairLength.value],
        eye_color:
          selectedEyeColor.value === 'all'
            ? undefined
            : [selectedEyeColor.value]
      };

      const res = await searchCharacters(params);
      charactersList.value = reset
        ? res.results || []
        : [...charactersList.value, ...(res.results || [])];
      totalItems.value = res.total || 0;
      totalPages.value = Math.max(1, res.pages || 1);
    } else if (activeTab.value === 'artists') {
      const params: ArtistFilterParams = {
        q: searchQuery.value.trim() || undefined,
        page: currentPage.value,
        sort: artistSort.value,
        seed: artistSort.value === 'random' ? randomSeed.value : undefined,
        score:
          selectedScoreBucket.value === 'all'
            ? undefined
            : [selectedScoreBucket.value],
        category:
          selectedArtistCategory.value === 'all'
            ? undefined
            : [selectedArtistCategory.value]
      };

      const res = await searchArtists(params);
      artistsList.value = reset
        ? res.results || []
        : [...artistsList.value, ...(res.results || [])];
      totalItems.value = res.total || 0;
      totalPages.value = Math.max(1, res.pages || 1);
    } else if (activeTab.value === 'copyrights') {
      const params: CopyrightFilterParams = {
        q: searchQuery.value.trim() || undefined,
        page: currentPage.value,
        sort: copyrightSort.value,
        seed: copyrightSort.value === 'random' ? randomSeed.value : undefined
      };

      const res = await searchCopyrights(params);
      copyrightsList.value = reset
        ? res.results || []
        : [...copyrightsList.value, ...(res.results || [])];
      totalItems.value = res.total || 0;
      totalPages.value = Math.max(1, res.pages || 1);
    }
  } catch (err) {
    console.error('Animadex search error:', err);
    errorMessage.value =
      err instanceof Error
        ? err.message
        : 'Failed to retrieve data from AnimaDex';
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

function handleScroll(e: Event) {
  if (!isViewActive.value) return;
  const target = e.target as HTMLElement;
  if (!target) return;
  savedScrollTop = target.scrollTop;
  if (isLoading.value || loadingMore.value || !hasMore.value || !hasItems.value)
    return;
  const bottomThreshold = 600;
  if (
    target.scrollHeight - target.scrollTop - target.clientHeight <
    bottomThreshold
  ) {
    void loadMore();
  }
}

// Watch virtual rows to trigger pre-fetch when approaching list end
watch(virtualRows, (rows) => {
  if (
    !isViewActive.value ||
    rows.length === 0 ||
    isLoading.value ||
    loadingMore.value ||
    !hasMore.value ||
    !hasItems.value
  )
    return;
  const lastRow = rows.at(-1);
  if (lastRow && lastRow.index >= totalRows.value - 2) {
    void loadMore();
  }
});

function clearSearch() {
  searchQuery.value = '';
}

function rerollSeed() {
  randomSeed.value = Math.floor(Math.random() * 1_000_000);
  void performSearch(true);
}

function handleTabChange(tab: BrowseTab) {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  searchQuery.value = '';
  savedScrollTop = 0;
  void loadFacets();
  void performSearch(true);
}

function resetAllFilters() {
  for (const { model } of filterFields) model.value = 'all';
  searchQuery.value = '';
  filterLorasOnly.value = false;
  characterSort.value = 'count';
  artistSort.value = 'count';
  copyrightSort.value = 'count';
  savedScrollTop = 0;
  void performSearch(true);
}

function openDetail(
  item: AnimaDexCharacter | AnimaDexArtist | AnimaDexCopyright
) {
  selectedDetailItem.value = item;
  isDetailOpen.value = true;
}

function handleCopyTrigger(trigger: string) {
  void navigator.clipboard.writeText(trigger);
  toast.success('Trigger prompt copied to clipboard!');
}

function handleSendToWorkflow(trigger: string) {
  const current = workflowStore.positivePrompt.trim();
  if (current) {
    workflowStore.positivePrompt = `${current}, ${trigger}`;
  } else {
    workflowStore.positivePrompt = trigger;
  }
  toast.success('Appended trigger prompt to Workflow Generator!');
}

function filterBySeriesFromDetail(seriesSlug: string) {
  activeTab.value = 'characters';
  selectedSeries.value = seriesSlug;
  savedScrollTop = 0;
  void performSearch(true);
}

function filterByTagFromDetail(tag: string) {
  searchQuery.value = tag;
  savedScrollTop = 0;
  void performSearch(true);
}

function handleSelectSeriesCard(copyright: AnimaDexCopyright) {
  activeTab.value = 'characters';
  selectedSeries.value = copyright.slug;
  searchQuery.value = '';
  savedScrollTop = 0;
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
  if (scrollViewport.value && savedScrollTop > 0) {
    scrollViewport.value.scrollTop = savedScrollTop;
  }
  scrollViewport.value?.dispatchEvent(new Event('scroll'));
}

function deactivateView() {
  isViewActive.value = false;
  resizeObserver?.disconnect();
}

onMounted(() => {
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.contentRect.width > 0) {
        gridWidth.value = entry.contentRect.width - 40;
      }
    }
  });
  if (scrollViewport.value) {
    resizeObserver.observe(scrollViewport.value);
    void activateView();
  }
  void loadFacets();
  if (!hasItems.value) {
    void performSearch(true);
  }
});

onActivated(activateView);
onDeactivated(deactivateView);
onUnmounted(deactivateView);

watch(
  [
    characterSort,
    artistSort,
    copyrightSort,
    selectedSeries,
    selectedGender,
    selectedHairColor,
    selectedHairLength,
    selectedEyeColor,
    filterLorasOnly,
    selectedScoreBucket,
    selectedArtistCategory
  ],
  () => {
    if (!isViewActive.value) return;
    void performSearch(true);
  }
);
</script>

<template>
  <PageLayout
    title="Animadex Explore"
    subtitle="Explore anime character triggers, artist style tags, and series metadata"
    content-class="flex flex-col overflow-hidden p-0"
  >
    <template #icon>
      <Sparkles class="h-4 w-4" />
    </template>
    <template #title-extra>
      <Badge
        variant="outline"
        class="border-primary/30 text-primary h-4 px-1.5 text-[10px] font-normal"
      >
        Prompt Discovery
      </Badge>
    </template>
    <template #actions>
      <div class="flex items-center gap-1">
        <button
          v-for="tab in TAB_SHORTCUTS"
          :key="tab.value"
          type="button"
          class="cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            activeTab === tab.value
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
        <!-- Search Controls Bar -->
        <form
          class="flex flex-wrap items-center gap-2.5"
          @submit.prevent="performSearch(true)"
        >
          <!-- Search Input -->
          <div class="relative min-w-64 flex-1">
            <Search
              class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
            />
            <Input
              v-model="searchQuery"
              type="text"
              :placeholder="
                activeTab === 'characters'
                  ? 'Search characters or tags'
                  : activeTab === 'artists'
                    ? 'Search artists'
                    : 'Search series / copyright franchise'
              "
              class="border-border bg-secondary/50 focus:bg-background h-9 pr-8 pl-9 text-xs transition-colors"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer p-0.5"
              @click="clearSearch"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>

          <!-- Sort Selection -->
          <Select v-if="activeTab === 'characters'" v-model="characterSort">
            <SelectTrigger class="bg-secondary/80 h-9 w-36 text-xs font-medium">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup class="max-h-40 overflow-y-auto">
                <SelectItem value="count" class="text-xs"
                  >Most Popular</SelectItem
                >
                <SelectItem value="az" class="text-xs">A to Z</SelectItem>
                <SelectItem value="random" class="text-xs">Random</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select v-else-if="activeTab === 'artists'" v-model="artistSort">
            <SelectTrigger class="bg-secondary/80 h-9 w-36 text-xs font-medium">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup class="max-h-40 overflow-y-auto">
                <SelectItem value="count" class="text-xs"
                  >Most Popular</SelectItem
                >
                <SelectItem value="score" class="text-xs"
                  >Highest Score</SelectItem
                >
                <SelectItem value="az" class="text-xs">A to Z</SelectItem>
                <SelectItem value="random" class="text-xs">Random</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select v-else v-model="copyrightSort">
            <SelectTrigger class="bg-secondary/80 h-9 w-36 text-xs font-medium">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup class="max-h-40 overflow-y-auto">
                <SelectItem value="count" class="text-xs"
                  >Most Popular</SelectItem
                >
                <SelectItem value="az" class="text-xs">A to Z</SelectItem>
                <SelectItem value="random" class="text-xs">Random</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <!-- Re-roll Random Seed Button -->
          <Button
            v-if="
              (activeTab === 'characters' && characterSort === 'random') ||
              (activeTab === 'artists' && artistSort === 'random') ||
              (activeTab === 'copyrights' && copyrightSort === 'random')
            "
            type="button"
            variant="outline"
            size="sm"
            class="h-9 cursor-pointer gap-1.5 px-3 text-xs"
            title="Roll new random seed"
            @click="rerollSeed"
          >
            <Dices class="h-3.5 w-3.5" />
            <span>Re-roll</span>
          </Button>

          <!-- Filters Popover -->
          <FilterPopover
            v-if="activeTab !== 'copyrights'"
            :count="activeFilterCount"
            trigger-class="h-9"
            content-class="w-72"
            @reset="resetAllFilters"
          >
            <!-- Character Filters -->
            <template v-if="activeTab === 'characters'">
              <GalleryFilterSelect
                v-model="selectedSeries"
                label="Series"
                placeholder="All Series"
                :options="characterFacets?.copyright?.values || []"
                class="justify-between"
                trigger-class="w-44"
                show-counts
              />
              <GalleryFilterSelect
                v-model="selectedGender"
                label="Gender"
                placeholder="All"
                :options="[
                  { value: '1girl', label: 'Female (1girl)' },
                  { value: '1boy', label: 'Male (1boy)' },
                  { value: '1other', label: 'Ambiguous' },
                  { value: 'no humans', label: 'Non-Human' }
                ]"
                class="justify-between"
                trigger-class="w-44"
              />
              <GalleryFilterSelect
                v-model="selectedHairColor"
                label="Hair"
                placeholder="Any Color"
                :options="characterFacets?.hair_color?.values || []"
                class="justify-between"
                trigger-class="w-44"
              />
              <GalleryFilterSelect
                v-model="selectedHairLength"
                label="Length"
                placeholder="Any Length"
                :options="characterFacets?.hair_length?.values || []"
                class="justify-between"
                trigger-class="w-44"
              />
              <GalleryFilterSelect
                v-model="selectedEyeColor"
                label="Eyes"
                placeholder="Any Color"
                :options="characterFacets?.eye_color?.values || []"
                class="justify-between"
                trigger-class="w-44"
              />
              <div class="flex items-center justify-between gap-2">
                <label
                  for="loras-switch"
                  class="text-foreground flex cursor-pointer items-center gap-1 text-xs font-medium"
                >
                  <Layers class="h-3.5 w-3.5 text-purple-400" />
                  <span>LoRA Only</span>
                </label>
                <Switch
                  id="loras-switch"
                  :checked="filterLorasOnly"
                  @update:checked="(val: boolean) => (filterLorasOnly = val)"
                />
              </div>
            </template>

            <!-- Artist Filters -->
            <template v-else-if="activeTab === 'artists'">
              <GalleryFilterSelect
                v-model="selectedScoreBucket"
                label="Score"
                placeholder="All Scores"
                :options="[
                  { value: '5', label: '50% and up' },
                  { value: '4', label: '40% – 50%' },
                  { value: '3', label: '30% – 40%' },
                  { value: '2', label: '20% – 30%' },
                  { value: '1', label: 'Under 20%' }
                ]"
                class="justify-between"
                trigger-class="w-44"
              />
              <GalleryFilterSelect
                v-model="selectedArtistCategory"
                label="Category"
                placeholder="All Categories"
                :options="artistFacets?.category?.values || []"
                class="justify-between"
                trigger-class="w-44"
                show-counts
              />
            </template>
          </FilterPopover>

          <!-- Search Submit Button -->
          <Button
            type="submit"
            size="sm"
            class="bg-primary text-primary-foreground hover:bg-primary/90 h-9 cursor-pointer px-4 text-xs font-semibold shadow-xs"
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

    <!-- Main Content Viewport with Infinite Scroll & TanStack Virtualizer -->
    <main
      ref="scrollViewport"
      class="min-h-0 flex-1 overflow-y-auto p-5"
      @scroll.passive="handleScroll"
    >
      <!-- Error Message Banner -->
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

      <!-- Initial Loading Skeleton Grid -->
      <div
        v-if="isLoading && !hasItems"
        class="grid gap-3.5"
        :style="{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
        }"
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

      <!-- Empty State -->
      <div
        v-else-if="!hasItems && !isLoading"
        class="border-border/60 bg-card/40 mx-auto my-12 flex max-w-md flex-col items-center justify-center rounded-xl border p-8 text-center text-xs shadow-xs"
      >
        <div
          class="bg-muted text-muted-foreground mb-3 flex h-12 w-12 items-center justify-center rounded-full"
        >
          <ImageOff class="h-6 w-6" />
        </div>
        <h3 class="text-sm font-semibold">No results found</h3>
        <p class="text-muted-foreground mt-1 text-xs">
          Try adjusting your search query, series, or attribute filters.
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

      <!-- TanStack Virtualized Gallery Grid -->
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
          <AnimadexCard
            v-for="item in currentItems.slice(
              virtualRow.index * columns,
              (virtualRow.index + 1) * columns
            )"
            :key="item.slug"
            :item="item"
            :type="
              activeTab === 'characters'
                ? 'character'
                : activeTab === 'artists'
                  ? 'artist'
                  : 'copyright'
            "
            @select="
              activeTab === 'copyrights'
                ? handleSelectSeriesCard(item as AnimaDexCopyright)
                : openDetail(item)
            "
            @copy-trigger="handleCopyTrigger"
            @send-to-workflow="handleSendToWorkflow"
          />
        </div>
      </div>

      <!-- Infinite Scroll Bottom Loading Spinner -->
      <div
        v-if="loadingMore"
        class="text-muted-foreground flex items-center justify-center py-6"
      >
        <Loader2 class="h-5 w-5 animate-spin" />
        <span class="ml-2 text-xs">Loading more...</span>
      </div>
    </main>
  </PageLayout>

  <!-- Detail Dialog -->
  <AnimadexDetailDialog
    v-model:open="isDetailOpen"
    :item="selectedDetailItem"
    :type="
      activeTab === 'characters'
        ? 'character'
        : activeTab === 'artists'
          ? 'artist'
          : 'copyright'
    "
    @filter-by-copyright="filterBySeriesFromDetail"
    @filter-by-tag="filterByTagFromDetail"
  />
</template>
