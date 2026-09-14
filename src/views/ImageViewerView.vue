<script setup lang="ts">
import { useRouter } from 'vue-router';
import OutputImageInspector from '@/components/gallery/OutputImageInspector.vue';
import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  nextTick,
  ref,
  shallowRef,
  watch
} from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { formatFileSize } from '@/utils/formatters';
import {
  ArrowUpDown,
  Columns2,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
  ZoomIn
} from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import PageLayout from '@/components/layout/PageLayout.vue';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  clearGalleryCache,
  dragOutputImage,
  GALLERY_IMAGE_MIME,
  getGalleryCacheDirectory,
  listOutputImages,
  localImageUrl,
  prepareOutputGallery,
  refreshOutputImages,
  type OutputImage
} from '../services/imageGallery';
import { useLauncherStore } from '../stores/launcherStore';
import { pickCompareTarget } from '@/utils/imageCompare';

const router = useRouter();

const imageInspector = ref<InstanceType<typeof OutputImageInspector>>();
function openImage(image: OutputImage) {
  // While picking a partner via "Compare with…", the next click completes the pair.
  if (compareSource.value) {
    const pair = pickCompareTarget(compareSource.value, image);
    compareSource.value = undefined;
    if (pair) {
      void imageInspector.value?.openCompare(pair.a, pair.b);
      return;
    }
  }
  void imageInspector.value?.open(image);
}

// ─── A/B compare: drag a card onto another, or "Compare with…" then click ───
const dragSourceId = ref<string>();
const dropTargetId = ref<string>();
const compareSource = ref<OutputImage>();

function resetDragState() {
  dragSourceId.value = undefined;
  dropTargetId.value = undefined;
}

function onCardDragStart(event: DragEvent, image: OutputImage) {
  dragOutputImage(event, image);
  dragSourceId.value = image.localId;
}

function isCompareDrag(event: DragEvent) {
  return Boolean(
    dragSourceId.value || event.dataTransfer?.types.includes(GALLERY_IMAGE_MIME)
  );
}

function onCardDragEnter(event: DragEvent, image: OutputImage) {
  if (!isCompareDrag(event) || dragSourceId.value === image.localId) return;
  dropTargetId.value = image.localId;
}

function onCardDragOver(event: DragEvent, image: OutputImage) {
  if (!isCompareDrag(event) || dragSourceId.value === image.localId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'link';
  if (dropTargetId.value !== image.localId) dropTargetId.value = image.localId;
}

function onCardDragLeave(event: DragEvent, image: OutputImage) {
  const currentTarget = event.currentTarget as HTMLElement | null;
  const relatedTarget = event.relatedTarget as Node | null;
  if (
    dropTargetId.value === image.localId &&
    (!currentTarget || !relatedTarget || !currentTarget.contains(relatedTarget))
  ) {
    dropTargetId.value = undefined;
  }
}

function onCardDrop(event: DragEvent, image: OutputImage) {
  const sourceId =
    event.dataTransfer?.getData(GALLERY_IMAGE_MIME) || dragSourceId.value;
  resetDragState();
  if (!sourceId) return;
  event.preventDefault();
  const source = images.value.find((item) => item.localId === sourceId);
  const pair = pickCompareTarget(source, image);
  if (pair) void imageInspector.value?.openCompare(pair.a, pair.b);
}

function startCompareWith(image: OutputImage) {
  compareSource.value = image;
}

function cancelCompare() {
  compareSource.value = undefined;
}

function onCompareKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && compareSource.value) cancelCompare();
}

// Grid layout parameters
const GRID_GAP = 12;
// 3:4 Portrait aspect ratio
const CARD_ASPECT_RATIO = 4 / 3;
const CARD_FOOTER_HEIGHT = 52;
const OVERSCAN_ROWS = 3;
const launcherStore = useLauncherStore();

const images = shallowRef<OutputImage[]>([]);
const query = ref('');
const sortBy = ref<
  'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc'
>('date-desc');
const selectedSubfolder = ref<string>('all');

const scrollViewport = ref<HTMLElement | null>(null);
const gridWidth = ref(1200);
const isViewActive = ref(true);
const isLoading = ref(false);
const indexStage = ref('Preparing image index');
const indexProcessed = ref(0);
const indexTotal = ref(0);
const cacheDirectory = ref('');
const errorMessage = ref('');

let resizeObserver: ResizeObserver | undefined;
let unlistenProgress: UnlistenFn | undefined;
let savedScrollTop = 0;

const availableSubfolders = computed<string[]>(() => {
  const folders = new Set<string>();
  for (const img of images.value) {
    if (img.subfolder?.trim()) {
      folders.add(img.subfolder.trim());
    }
  }
  const folderList = Array.from(folders);
  folderList.sort((a: string, b: string) => a.localeCompare(b));
  return folderList;
});

const filteredImages = computed<OutputImage[]>(() => {
  const search = query.value.trim().toLowerCase();
  const folder = selectedSubfolder.value;

  let result = images.value;

  if (folder !== 'all') {
    result = result.filter((img) => (img.subfolder || '') === folder);
  }

  if (search) {
    // Terms are ANDed. `model:name` matches the checkpoint; anything else matches
    // the path or the positive prompt (so tags like `1girl` work).
    const terms = search.split(/\s+/u);
    result = result.filter((img) => {
      const path = `${img.subfolder}/${img.filename}`.toLowerCase();
      const prompt = img.prompt.toLowerCase();
      const model = img.model.toLowerCase();
      return terms.every((term) =>
        term.startsWith('model:')
          ? model.includes(term.slice(6))
          : path.includes(term) || prompt.includes(term)
      );
    });
  }

  const sortedList = [...result];
  sortedList.sort((a: OutputImage, b: OutputImage) => {
    switch (sortBy.value) {
      case 'date-desc':
        return b.modifiedMs - a.modifiedMs;
      case 'date-asc':
        return a.modifiedMs - b.modifiedMs;
      case 'name-asc':
        return a.filename.localeCompare(b.filename);
      case 'name-desc':
        return b.filename.localeCompare(a.filename);
      case 'size-desc':
        return b.fileSize - a.fileSize;
      case 'size-asc':
        return a.fileSize - b.fileSize;
      default:
        return 0;
    }
  });
  return sortedList;
});

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
  Math.ceil(filteredImages.value.length / columns.value)
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

const indexPercent = computed(() =>
  indexTotal.value > 0
    ? Math.round((indexProcessed.value / indexTotal.value) * 100)
    : 0
);

function imageUrl(image: OutputImage, thumbnail = true) {
  return localImageUrl(image.localId, thumbnail);
}

async function loadImages() {
  if (!launcherStore.hasComfyDirectory) {
    images.value = [];
    errorMessage.value = '';
    isLoading.value = false;
    return;
  }
  const workingDir = launcherStore.config.workingDir;
  isLoading.value = true;
  indexStage.value = 'Scanning output files';
  indexProcessed.value = 0;
  indexTotal.value = 0;
  errorMessage.value = '';
  try {
    const result = await prepareOutputGallery(workingDir);
    if (workingDir !== launcherStore.config.workingDir) return;
    images.value = result;
    scrollViewport.value?.scrollTo({ top: 0 });
  } catch (error) {
    if (workingDir === launcherStore.config.workingDir)
      errorMessage.value = String(error);
  } finally {
    if (workingDir === launcherStore.config.workingDir) isLoading.value = false;
  }
}

async function clearCacheAndReindex() {
  if (isLoading.value) return;
  try {
    await clearGalleryCache();
    await loadImages();
  } catch (error) {
    errorMessage.value = String(error);
  }
}

async function openLocalPath(path?: string) {
  if (!path) return;
  try {
    await invoke('show_in_folder', { path });
  } catch (error) {
    console.error('Failed to open path in explorer:', error);
  }
}

function outputDirectory() {
  const path = images.value[0]?.path;
  const marker = path?.toLowerCase().lastIndexOf('\\output\\') ?? -1;
  if (path && marker >= 0) return path.slice(0, marker + 7);
  const markerFwd = path?.toLowerCase().lastIndexOf('/output/') ?? -1;
  if (path && markerFwd >= 0) return path.slice(0, markerFwd + 7);
  const root = launcherStore.config.workingDir.replace(/[\\/]+$/u, '');
  return /[\\/]comfyui$/iu.test(root)
    ? `${root}\\output`
    : `${root}\\ComfyUI\\output`;
}

watch([query, selectedSubfolder, sortBy], () => {
  savedScrollTop = 0;
  scrollViewport.value?.scrollTo({ top: 0 });
});

function rememberScroll(event: Event) {
  savedScrollTop = (event.target as HTMLElement).scrollTop;
}

async function activateView() {
  isViewActive.value = true;
  if (scrollViewport.value) resizeObserver?.observe(scrollViewport.value);
  window.addEventListener('dragend', resetDragState);
  window.addEventListener('keydown', onCompareKeydown);

  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  rowVirtualizer.value.measure();
  rowVirtualizer.value.scrollToOffset(savedScrollTop);
  scrollViewport.value?.dispatchEvent(new Event('scroll'));
}

function deactivateView() {
  isViewActive.value = false;
  resizeObserver?.disconnect();
  window.removeEventListener('dragend', resetDragState);
  window.removeEventListener('keydown', onCompareKeydown);
  resetDragState();
  compareSource.value = undefined;
}

async function restoreImages() {
  if (!launcherStore.hasComfyDirectory) return;
  const workingDir = launcherStore.config.workingDir;
  try {
    const cached = await listOutputImages(workingDir);
    if (workingDir !== launcherStore.config.workingDir) return;
    images.value = cached;
    void refreshOutputImages(workingDir)
      .then((latestImages) => {
        if (workingDir === launcherStore.config.workingDir)
          images.value = latestImages;
      })
      .catch(() => {});
  } catch {
    if (workingDir === launcherStore.config.workingDir) await loadImages();
  }
}

watch(
  () => launcherStore.config.workingDir,
  () => {
    images.value = [];

    errorMessage.value = '';
    isLoading.value = false;
    void restoreImages();
  }
);

onMounted(async () => {
  cacheDirectory.value = await getGalleryCacheDirectory();
  unlistenProgress = await listen<{
    stage: string;
    processed: number;
    total: number;
  }>('gallery-index-progress', (event) => {
    indexStage.value = event.payload.stage;
    indexProcessed.value = event.payload.processed;
    indexTotal.value = event.payload.total;
  });
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.contentRect.width > 0) {
        // 16px padding left + right (p-4 = 32px)
        gridWidth.value = entry.contentRect.width - 32;
      }
    }
  });
  activateView();
  await restoreImages();
});

onActivated(activateView);
onDeactivated(deactivateView);

onUnmounted(() => {
  deactivateView();
  unlistenProgress?.();
});
</script>

<template>
  <PageLayout
    title="Output Gallery"
    subtitle="Explore images generated by ComfyUI"
    header-class="bg-card/60 h-13 px-4"
    content-class="flex flex-col overflow-hidden p-0"
  >
    <template #icon>
      <ImageIcon class="h-4 w-4" />
    </template>

    <template #actions>
      <div class="flex items-center gap-2">
        <!-- Search Input -->
        <div class="relative w-56 sm:w-64">
          <Search
            class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2"
          />
          <Input
            v-model="query"
            placeholder="Search tags, files, or model:name..."
            class="border-border/80 bg-background/80 focus-visible:ring-primary/40 h-8 pr-7 pl-8 font-mono text-xs shadow-2xs"
          />
          <button
            v-if="query"
            type="button"
            class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 p-0.5"
            @click="query = ''"
          >
            <X class="h-3 w-3" />
          </button>
        </div>

        <!-- Subfolder Filter Dropdown -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              size="sm"
              class="border-border/80 bg-secondary/70 hover:bg-secondary h-8 gap-1.5 px-2.5 text-xs"
            >
              <Layers class="text-muted-foreground h-3.5 w-3.5" />
              <span class="hidden max-w-22.5 truncate sm:inline">
                {{
                  selectedSubfolder === 'all'
                    ? 'All Folders'
                    : selectedSubfolder
                }}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuLabel class="text-xs"
              >Filter Subfolder</DropdownMenuLabel
            >
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup v-model="selectedSubfolder">
              <DropdownMenuRadioItem value="all">
                All Folders ({{ images.length }})
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                v-for="folder in availableSubfolders"
                :key="folder"
                :value="folder"
              >
                {{ folder }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Sort Dropdown -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              size="sm"
              class="border-border/80 bg-secondary/70 hover:bg-secondary h-8 gap-1.5 px-2.5 text-xs"
            >
              <ArrowUpDown class="text-muted-foreground h-3.5 w-3.5" />
              <span class="hidden sm:inline">Sort</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-44">
            <DropdownMenuLabel class="text-xs">Sort By</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup v-model="sortBy">
              <DropdownMenuRadioItem value="date-desc">
                Date: Newest First
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="date-asc">
                Date: Oldest First
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="name-asc">
                Filename (A-Z)
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="name-desc">
                Filename (Z-A)
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="size-desc">
                Size: Largest First
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="size-asc">
                Size: Smallest First
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" class="h-5" />

        <!-- Cache Folder Button -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="iconSm"
              class="border-border/80 bg-secondary/70 hover:bg-secondary h-8 w-8"
              @click="openLocalPath(cacheDirectory)"
            >
              <HardDrive
                class="text-muted-foreground hover:text-foreground h-3.5 w-3.5"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p class="text-xs">Open thumbnail cache directory</p>
          </TooltipContent>
        </Tooltip>

        <!-- Clear Cache & Rebuild -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="iconSm"
              :disabled="isLoading"
              class="border-border/80 bg-secondary/70 hover:bg-destructive/10 hover:text-destructive h-8 w-8 disabled:opacity-40"
              @click="clearCacheAndReindex"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p class="text-xs">Clear cache and re-index images</p>
          </TooltipContent>
        </Tooltip>

        <!-- Output Folder Button -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="iconSm"
              class="border-border/80 bg-secondary/70 hover:bg-secondary h-8 w-8"
              @click="openLocalPath(outputDirectory())"
            >
              <FolderOpen
                class="text-muted-foreground hover:text-foreground h-3.5 w-3.5"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p class="text-xs">Open ComfyUI output directory</p>
          </TooltipContent>
        </Tooltip>

        <!-- Refresh Images Button -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="iconSm"
              class="border-border/80 bg-secondary/70 hover:bg-secondary h-8 w-8"
              @click="loadImages"
            >
              <RefreshCw
                class="text-muted-foreground hover:text-foreground h-3.5 w-3.5"
                :class="{ 'animate-spin': isLoading }"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p class="text-xs">Refresh gallery</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </template>

    <!-- Compare partner picker banner -->
    <div
      v-if="compareSource"
      class="border-primary/30 bg-primary/10 text-primary flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-xs"
      role="status"
    >
      <span class="flex min-w-0 items-center gap-2">
        <Columns2 class="h-3.5 w-3.5 shrink-0" />
        <span class="truncate">
          Select a second image to compare with
          <span class="font-mono font-semibold">{{
            compareSource.filename
          }}</span>
          — or drag any card onto another. Esc to cancel.
        </span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 shrink-0 text-xs"
        @click="cancelCompare"
      >
        <X class="h-3.5 w-3.5" /> Cancel
      </Button>
    </div>

    <div
      ref="scrollViewport"
      class="min-h-0 flex-1 overflow-y-auto p-4"
      @scroll.passive="rememberScroll"
    >
      <!-- Scanning / Indexing Loader -->
      <div
        v-if="!launcherStore.hasComfyDirectory"
        class="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <h3 class="text-foreground text-sm font-semibold">
          Set up your local gallery
        </h3>
        <p class="text-xs">
          Choose your ComfyUI folder in Settings to view local output images.
        </p>
        <Button variant="outline" size="sm" @click="router.push('/settings')"
          >Open Settings</Button
        >
      </div>
      <div
        v-else-if="isLoading && images.length === 0"
        class="flex h-full items-center justify-center p-8"
      >
        <div
          class="border-border/60 bg-card/80 flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border p-6 text-center shadow-lg backdrop-blur-md"
        >
          <div
            class="border-primary/30 bg-primary/10 flex h-12 w-12 items-center justify-center rounded-xl border"
          >
            <Loader2 class="text-primary h-6 w-6 animate-spin" />
          </div>
          <div>
            <p class="text-foreground text-sm font-bold tracking-tight">
              {{ indexStage }}
            </p>
            <p class="text-muted-foreground mt-1 font-mono text-xs">
              {{ indexProcessed }} / {{ indexTotal || '—' }} images processed
            </p>
          </div>
          <div class="w-full">
            <Progress
              :model-value="indexTotal ? indexPercent : 15"
              class="h-2 w-full"
              :class="{ 'animate-pulse': !indexTotal }"
            />
          </div>
          <p class="text-muted-foreground text-xs">
            The 7-column portrait grid will appear automatically once cache is
            ready.
          </p>
        </div>
      </div>

      <!-- Error State -->
      <div
        v-else-if="errorMessage"
        class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <div
          class="border-destructive/30 bg-destructive/10 text-destructive flex h-12 w-12 items-center justify-center rounded-2xl border"
        >
          <X class="h-6 w-6" />
        </div>
        <div class="max-w-md">
          <h3 class="text-destructive text-sm font-bold">
            Failed to load gallery
          </h3>
          <p class="text-muted-foreground mt-1 font-mono text-xs break-all">
            {{ errorMessage }}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          class="mt-2 text-xs"
          @click="loadImages"
        >
          <RefreshCw class="mr-1.5 h-3.5 w-3.5" /> Retry
        </Button>
      </div>

      <!-- Empty Results State -->
      <div
        v-else-if="filteredImages.length === 0"
        class="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <div
          class="border-border/60 bg-muted/40 flex h-16 w-16 items-center justify-center rounded-2xl border"
        >
          <ImageIcon class="h-8 w-8 opacity-40" />
        </div>
        <div>
          <h3 class="text-foreground text-sm font-semibold">No images found</h3>
          <p class="text-muted-foreground mt-1 text-xs">
            {{
              query
                ? 'Try adjusting your search query or folder filter.'
                : 'Generate images in ComfyUI to see them here.'
            }}
          </p>
        </div>
        <Button
          v-if="query || selectedSubfolder !== 'all'"
          variant="outline"
          size="sm"
          class="mt-1 text-xs"
          @click="
            query = '';
            selectedSubfolder = 'all';
          "
        >
          Reset Filters
        </Button>
      </div>

      <!-- TanStack Virtualized 7-Column Portrait Grid -->
      <div
        v-else
        class="relative w-full"
        :style="{ height: `${totalVirtualHeight}px` }"
      >
        <div
          v-for="virtualRow in virtualRows"
          :key="virtualRow.index"
          class="absolute top-0 left-0 grid w-full gap-3"
          :style="{
            height: `${virtualRow.size - GRID_GAP}px`,
            transform: `translateY(${virtualRow.start}px)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
          }"
        >
          <!-- Portrait Card Item -->
          <ContextMenu
            v-for="image in filteredImages.slice(
              virtualRow.index * columns,
              (virtualRow.index + 1) * columns
            )"
            :key="image.path"
          >
            <ContextMenuTrigger as-child>
              <div
                role="button"
                tabindex="0"
                draggable="true"
                class="group border-border/70 bg-card/60 hover:bg-card/90 hover:border-border relative flex cursor-pointer flex-col overflow-hidden rounded-xl border text-left transition-colors duration-200 [content-visibility:auto]"
                :class="{
                  'opacity-60': dragSourceId === image.localId,
                  'ring-primary border-primary ring-2':
                    dropTargetId === image.localId ||
                    compareSource?.localId === image.localId
                }"
                :title="
                  compareSource && compareSource.localId !== image.localId
                    ? `Compare ${compareSource.filename} with ${image.filename}`
                    : 'Drag onto another image to compare side by side'
                "
                @click="openImage(image)"
                @keydown.enter="openImage(image)"
                @keydown.space.prevent="openImage(image)"
                @dragstart="onCardDragStart($event, image)"
                @dragend="resetDragState"
                @dragenter="onCardDragEnter($event, image)"
                @dragover="onCardDragOver($event, image)"
                @dragleave="onCardDragLeave($event, image)"
                @drop="onCardDrop($event, image)"
              >
                <!-- Portrait Image Viewport (3:4 ratio) -->
                <div
                  class="bg-muted/50 relative aspect-3/4 w-full overflow-hidden"
                >
                  <img
                    :src="imageUrl(image, true)"
                    :alt="image.filename"
                    loading="lazy"
                    decoding="async"
                    draggable="false"
                    class="h-full w-full object-cover"
                  />

                  <!-- Drop-to-compare hint -->
                  <div
                    v-if="dropTargetId === image.localId"
                    class="bg-primary/25 text-primary-foreground pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 backdrop-blur-xs"
                  >
                    <Columns2 class="h-6 w-6 drop-shadow" />
                    <span class="text-xs font-semibold drop-shadow">
                      Drop to compare
                    </span>
                  </div>

                  <!-- Floating Subfolder Badge -->
                  <div
                    v-if="image.subfolder"
                    class="absolute top-2 left-2 flex items-center gap-1 transition-opacity duration-200"
                  >
                    <Badge
                      variant="secondary"
                      class="border-white/10 bg-black/60 font-mono text-xs font-medium text-white/90 shadow-sm backdrop-blur-md"
                    >
                      {{ image.subfolder }}
                    </Badge>
                  </div>

                  <div
                    class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-linear-to-t from-black/90 via-black/50 to-transparent px-2.5 pt-6 pb-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  >
                    <Button
                      size="iconSm"
                      variant="secondary"
                      class="h-7 w-7 rounded-full border border-white/20 bg-black/70 text-white shadow-md transition-colors hover:bg-white/20 hover:text-white"
                      title="View Fullscreen & Metadata"
                      @click.stop="openImage(image)"
                    >
                      <ZoomIn class="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="iconSm"
                      variant="secondary"
                      class="h-7 w-7 rounded-full border border-white/20 bg-black/70 text-white shadow-md transition-colors hover:bg-white/20 hover:text-white"
                      title="Open in System Explorer"
                      @click.stop="openLocalPath(image.path)"
                    >
                      <FolderOpen class="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <!-- Card Footer Metadata -->
                <div class="flex flex-col justify-between p-2.5">
                  <p
                    class="text-foreground truncate font-mono text-xs font-medium transition-colors"
                    :title="image.filename"
                  >
                    {{ image.filename }}
                  </p>
                  <div
                    class="text-muted-foreground mt-1 flex items-center justify-between font-mono text-xs"
                  >
                    <span class="truncate">{{
                      image.extension?.toUpperCase() || 'PNG'
                    }}</span>
                    <span class="shrink-0">{{
                      formatFileSize(image.fileSize)
                    }}</span>
                  </div>
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent class="w-52">
              <ContextMenuItem @select="openImage(image)">
                <ZoomIn /> View Image
              </ContextMenuItem>
              <ContextMenuItem @select="startCompareWith(image)">
                <Columns2 /> Compare with…
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem @select="openLocalPath(image.path)">
                <FolderOpen /> Show in Explorer
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
      </div>
    </div>
  </PageLayout>

  <OutputImageInspector ref="imageInspector" :images="filteredImages" />
</template>
