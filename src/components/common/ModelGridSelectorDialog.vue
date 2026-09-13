<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useElementSize } from '@vueuse/core';
import { useVirtualizer } from '@tanstack/vue-virtual';
import {
  Check,
  Folder,
  Grid,
  Image as ImageIcon,
  Layers,
  List,
  RotateCw,
  Search,
  Sparkles,
  X
} from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ComfyApi } from '../../services/comfyApi';
import { useComfyStore } from '../../stores/comfyStore';
import { useLauncherStore } from '../../stores/launcherStore';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    category:
      'checkpoints' | 'unet' | 'diffusion_models' | 'loras' | 'vae' | 'clip';
    models: string[];
    selectedModel?: string;
  }>(),
  {
    title: 'Select Model',
    selectedModel: ''
  }
);

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
  (e: 'select', model: string): void;
}>();

const comfyStore = useComfyStore();
const launcherStore = useLauncherStore();

const searchQuery = ref('');
const activeFolderTab = ref('All');
const activeModelType = ref('All');
const modelTypeByName = ref(new Map<string, string>());
const viewMode = ref<'grid' | 'list'>('grid');
// Plain Set on purpose: a reactive one re-rendered the whole (unvirtualized)
// grid on every img load/error, which stalled the dialog's open animation.
const failedImageSet = new Set<string>();

// Reset filters when opened
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      searchQuery.value = '';
      activeFolderTab.value = 'All';
      activeModelType.value = 'All';
      void loadModelMetadata();
    }
  }
);

async function loadModelMetadata() {
  const categories =
    props.category === 'unet'
      ? ['unet', 'diffusion_models']
      : props.category === 'clip'
        ? ['clip', 'text_encoders']
        : [props.category];
  const rows = (
    await Promise.all(
      categories.map((category) =>
        ComfyApi.fetchModelMetadata(launcherStore.config.serverUrl, category)
      )
    )
  ).flat();
  const metadata = new Map<string, string>();
  for (const row of rows) {
    if (row.base_model) metadata.set(row.name, row.base_model);
  }
  modelTypeByName.value = metadata;
}

function handleImageError(modelName: string, event: Event) {
  failedImageSet.add(modelName);
  (event.target as HTMLImageElement).hidden = true;
}

function cleanModelTitle(name: string): string {
  const base = name.split('/').pop()?.split('\\').pop() || name;
  return base.replace(/\.(safetensors|ckpt|pt|bin|pth)$/iu, '');
}

function getModelFolder(name: string): string {
  const normalized = name.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.length > 1) {
    return parts.slice(0, -1).join('/');
  }
  return '';
}

// Extracted folder tabs
const folderTabs = computed(() => {
  const folders = new Set<string>();
  for (const m of props.models) {
    const f = getModelFolder(m);
    if (f) {
      folders.add(f);
    }
  }
  const list = [...folders].sort((a, b) => a.localeCompare(b));
  return ['All', ...list];
});

const modelTypes = computed(() => [
  'All',
  ...new Set(modelTypeByName.value.values())
]);

// Filtered models
const filteredModels = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return props.models.filter((m) => {
    // Folder filter
    if (activeFolderTab.value !== 'All') {
      const folder = getModelFolder(m);
      if (folder !== activeFolderTab.value) return false;
    }
    if (
      activeModelType.value !== 'All' &&
      modelTypeByName.value.get(m) !== activeModelType.value
    ) {
      return false;
    }
    // Search query filter
    if (query) {
      return m.toLowerCase().includes(query);
    }
    return true;
  });
});

// Virtualized grid: same card geometry as CivitaiBrowserView (3:4 thumb + footer).
const GRID_GAP = 14;
const CARD_ASPECT_RATIO = 4 / 3;
const CARD_FOOTER_HEIGHT = 53;
const scrollViewport = ref<HTMLElement | null>(null);
const gridEl = ref<HTMLElement | null>(null);
const { width: gridWidth } = useElementSize(gridEl);
const columns = computed(() => {
  if (gridWidth.value < 640) return 2;
  if (gridWidth.value < 768) return 3;
  if (gridWidth.value < 1024) return 4;
  return 5;
});
const rowHeight = computed(() => {
  const cardWidth =
    (gridWidth.value - GRID_GAP * (columns.value - 1)) / columns.value;
  return cardWidth * CARD_ASPECT_RATIO + CARD_FOOTER_HEIGHT + GRID_GAP;
});
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: Math.ceil(filteredModels.value.length / columns.value),
    getScrollElement: () => scrollViewport.value,
    estimateSize: () => rowHeight.value,
    overscan: 2
  }))
);
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());
const totalVirtualHeight = computed(() => rowVirtualizer.value.getTotalSize());
// estimateSize changes don't invalidate cached row sizes; remeasure on resize.
watch(rowHeight, () => rowVirtualizer.value.measure());
// Filter changes shrink the list; jump back to the top so rows stay in view.
watch(filteredModels, () => scrollViewport.value?.scrollTo({ top: 0 }));

function selectModel(model: string) {
  emit('select', model);
  emit('update:open', false);
}

function getPreviewUrl(model: string, res = 300): string {
  return ComfyApi.getModelPreviewUrl(
    launcherStore.config.serverUrl,
    props.category,
    model,
    res
  );
}
</script>

<template>
  <Dialog :open="open" @update:open="(val) => emit('update:open', val)">
    <DialogContent
      class="border-border bg-card flex h-[88vh] w-full max-w-6xl min-w-[75vw] flex-col gap-0 overflow-hidden p-0 shadow-2xl"
    >
      <!-- Dialog Header -->
      <DialogHeader
        class="border-border bg-background/50 flex shrink-0 flex-row items-center justify-between border-b px-5 py-3.5"
      >
        <div class="flex items-center gap-2.5">
          <div
            class="bg-primary/10 text-primary border-primary/20 flex h-8 w-8 items-center justify-center rounded-lg border"
          >
            <Layers class="h-4 w-4" />
          </div>
          <div>
            <DialogTitle
              class="text-foreground text-sm font-bold tracking-tight"
            >
              {{ title }}
            </DialogTitle>
            <DialogDescription class="text-muted-foreground text-xs">
              {{ filteredModels.length }} of {{ models.length }} models
              available
            </DialogDescription>
          </div>
        </div>

        <!-- Header Actions: Refresh & Layout Toggle -->
        <div class="flex items-center gap-2 pr-6">
          <Button
            size="iconSm"
            variant="outline"
            :disabled="comfyStore.isChecking"
            title="Refresh models"
            class="border-border bg-secondary hover:bg-accent h-7 w-7"
            @click="comfyStore.refreshModels"
          >
            <RotateCw
              class="h-3.5 w-3.5"
              :class="{ 'animate-spin': comfyStore.isChecking }"
            />
          </Button>

          <!-- shadcn ToggleGroup for View Mode Layout -->
          <ToggleGroup
            :model-value="viewMode"
            type="single"
            variant="outline"
            class="border-border bg-muted/60 h-7 rounded-md border p-0.5"
            @update:model-value="
              (val) => {
                if (val) viewMode = val as 'grid' | 'list';
              }
            "
          >
            <ToggleGroupItem
              value="grid"
              aria-label="Grid View"
              class="data-[state=on]:bg-background data-[state=on]:text-foreground h-6 w-6 cursor-pointer p-0 data-[state=on]:shadow-xs"
            >
              <Grid class="h-3.5 w-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="list"
              aria-label="List View"
              class="data-[state=on]:bg-background data-[state=on]:text-foreground h-6 w-6 cursor-pointer p-0 data-[state=on]:shadow-xs"
            >
              <List class="h-3.5 w-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </DialogHeader>

      <!-- Filter Controls Toolbar -->
      <div
        class="border-border bg-card/40 flex shrink-0 flex-col gap-2.5 border-b px-5 py-3"
      >
        <!-- Search Input + Model Type filter -->
        <div class="flex items-center gap-2">
          <div class="relative min-w-0 flex-1">
            <Search
              class="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
            />
            <Input
              v-model="searchQuery"
              placeholder="Search by model name or keyword..."
              class="bg-background/80 focus:ring-primary/30 h-8.5 w-full pr-8 pl-8.5 text-xs"
            />
            <Button
              v-if="searchQuery"
              type="button"
              variant="ghost"
              size="iconXs"
              class="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer"
              @click="searchQuery = ''"
            >
              <X class="h-3.5 w-3.5" />
              <span class="sr-only">Clear search</span>
            </Button>
          </div>

          <Select v-if="modelTypes.length > 1" v-model="activeModelType">
            <SelectTrigger
              class="bg-background/80 h-8.5 w-40 shrink-0 font-mono text-xs font-medium"
              aria-label="Model type"
            >
              <SelectValue placeholder="Model type">
                {{ activeModelType === 'All' ? 'All types' : activeModelType }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup class="max-h-40 overflow-y-auto">
                <SelectItem
                  v-for="type in modelTypes"
                  :key="type"
                  :value="type"
                  class="font-mono text-xs"
                >
                  {{ type === 'All' ? 'All types' : type }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <!-- Folder Tabs (shadcn Badge) -->
        <div
          v-if="folderTabs.length > 2"
          class="flex flex-wrap items-center gap-1.5 pt-0.5"
        >
          <span class="text-muted-foreground text-xs font-medium">Folder:</span>
          <Badge
            v-for="tab in folderTabs"
            :key="tab"
            :variant="activeFolderTab === tab ? 'default' : 'outline'"
            class="hover:bg-accent hover:text-foreground cursor-pointer font-mono text-xs font-semibold transition-colors"
            :class="
              activeFolderTab === tab
                ? 'shadow-xs'
                : 'border-border bg-muted/60 text-muted-foreground'
            "
            @click="activeFolderTab = tab"
          >
            {{ tab }}
          </Badge>
        </div>
      </div>

      <!-- Main Models Scroll Area -->
      <div
        ref="scrollViewport"
        class="min-h-0 flex-1 overflow-y-auto px-5 py-4"
      >
        <!-- Empty State -->
        <div
          v-if="filteredModels.length === 0"
          class="flex h-64 flex-col items-center justify-center gap-2 text-center"
        >
          <div
            class="bg-muted text-muted-foreground flex h-12 w-12 items-center justify-center rounded-full"
          >
            <ImageIcon class="h-6 w-6 opacity-40" />
          </div>
          <span class="text-foreground text-xs font-semibold"
            >No models found</span
          >
          <p class="text-muted-foreground max-w-xs text-xs">
            No files matched your search "{{ searchQuery }}". Try adjusting your
            query or refresh discovery.
          </p>
        </div>

        <!-- 1. Grid View Mode (virtualized by row) -->
        <div
          v-else-if="viewMode === 'grid'"
          ref="gridEl"
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
            <div
              v-for="model in filteredModels.slice(
                virtualRow.index * columns,
                (virtualRow.index + 1) * columns
              )"
              :key="model"
              class="group/card border-border bg-card hover:border-primary/60 relative flex cursor-pointer flex-col overflow-hidden rounded-xl border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
              :class="{
                'border-primary ring-primary/30 shadow-md ring-2':
                  model === selectedModel
              }"
              @click="selectModel(model)"
            >
              <!-- Card Thumbnail / Preview Container (3:4 Portrait) -->
              <div
                class="bg-muted/40 relative aspect-3/4 w-full overflow-hidden select-none"
              >
                <!-- Stylized Fallback Placeholder (shown until the thumbnail covers it) -->
                <div
                  class="from-card via-muted to-secondary/80 flex h-full w-full flex-col items-center justify-center gap-2 bg-linear-to-b p-3 text-center"
                >
                  <div
                    class="bg-primary/10 text-primary border-primary/20 flex h-10 w-10 items-center justify-center rounded-xl border shadow-xs"
                  >
                    <Sparkles class="h-5 w-5 opacity-70" />
                  </div>
                  <span
                    class="text-muted-foreground/70 font-mono text-xs font-bold uppercase"
                  >
                    {{ category }}
                  </span>
                </div>

                <!-- Real Image Preview (transparent until loaded, hidden on 404) -->
                <img
                  v-if="!failedImageSet.has(model)"
                  :src="getPreviewUrl(model, 300)"
                  :alt="model"
                  loading="lazy"
                  decoding="async"
                  class="absolute inset-0 h-full w-full object-cover"
                  @error="handleImageError(model, $event)"
                />

                <!-- Top Floating Badges: Folder & Selected Checkmark (shadcn Badge) -->
                <div
                  class="absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-1"
                >
                  <Badge
                    v-if="getModelFolder(model)"
                    variant="secondary"
                    class="border-border/80 bg-background/80 text-foreground flex items-center gap-1 font-mono text-xs font-bold shadow-xs backdrop-blur-md"
                  >
                    <Folder class="h-2.5 w-2.5 text-sky-400" />
                    <span class="max-w-20 truncate">{{
                      getModelFolder(model)
                    }}</span>
                  </Badge>
                  <div v-else />

                  <!-- Selected Indicator Badge -->
                  <Badge
                    v-if="model === selectedModel"
                    class="flex items-center gap-1 bg-emerald-600 font-mono text-xs font-bold text-white shadow-md hover:bg-emerald-600"
                  >
                    <Check class="h-2.5 w-2.5 stroke-3" />
                    ACTIVE
                  </Badge>
                </div>

                <!-- Dark Gradient Bottom Shadow for text contrast -->
                <div
                  class="from-background/90 via-background/40 pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t to-transparent"
                />
              </div>

              <!-- Card Bottom Info -->
              <div class="flex flex-col gap-0.5 p-2.5">
                <h4
                  class="text-foreground group-hover/card:text-primary truncate text-xs font-bold transition-colors"
                  :title="model"
                >
                  {{ cleanModelTitle(model) }}
                </h4>
                <p
                  class="text-muted-foreground/70 truncate font-mono text-xs"
                  :title="model"
                >
                  {{ model }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. List View Mode -->
        <div v-else class="flex flex-col gap-1.5">
          <div
            v-for="model in filteredModels"
            :key="model"
            class="group/row border-border bg-card hover:border-primary/50 hover:bg-accent/40 flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-2 transition-all"
            :class="{
              'border-primary bg-primary/5 ring-primary/20 ring-1':
                model === selectedModel
            }"
            @click="selectModel(model)"
          >
            <div class="flex min-w-0 items-center gap-3">
              <!-- Small Avatar Thumbnail -->
              <div
                class="bg-muted border-border relative h-10 w-10 shrink-0 overflow-hidden rounded-md border"
              >
                <div
                  class="text-muted-foreground flex h-full w-full items-center justify-center"
                >
                  <Sparkles class="h-4 w-4 opacity-50" />
                </div>
                <img
                  v-if="!failedImageSet.has(model)"
                  :src="getPreviewUrl(model, 200)"
                  :alt="model"
                  loading="lazy"
                  decoding="async"
                  class="absolute inset-0 h-full w-full object-cover"
                  @error="handleImageError(model, $event)"
                />
              </div>

              <!-- Info -->
              <div class="flex min-w-0 flex-col">
                <div class="flex items-center gap-2">
                  <span
                    class="text-foreground group-hover/row:text-primary truncate text-xs font-bold"
                  >
                    {{ cleanModelTitle(model) }}
                  </span>
                  <Badge
                    v-if="getModelFolder(model)"
                    variant="outline"
                    class="border-border bg-muted/60 text-muted-foreground font-mono text-xs"
                  >
                    {{ getModelFolder(model) }}
                  </Badge>
                </div>
                <span class="text-muted-foreground truncate font-mono text-xs">
                  {{ model }}
                </span>
              </div>
            </div>

            <!-- Active / Select Button -->
            <div class="shrink-0 pr-1">
              <Badge
                v-if="model === selectedModel"
                variant="outline"
                class="flex items-center gap-1 border-emerald-500/30 bg-emerald-500/10 font-mono text-xs font-bold text-emerald-500"
              >
                <Check class="h-3 w-3 stroke-3" />
                Selected
              </Badge>
              <Button
                v-else
                size="sm"
                variant="ghost"
                class="text-muted-foreground hover:text-foreground text-xs"
              >
                Select
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer Details -->
      <div
        class="border-border bg-muted/40 mt-auto flex shrink-0 items-center justify-between border-t px-5 py-2.5"
      >
        <div class="flex items-center gap-2 truncate font-mono text-xs">
          <span class="text-muted-foreground">Selected:</span>
          <span class="text-foreground max-w-md truncate font-semibold">
            {{ selectedModel || 'None' }}
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          class="border-border text-xs"
          @click="emit('update:open', false)"
        >
          Close
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
