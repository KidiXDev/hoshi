<script setup lang="ts">
import SearchableSelect from '@/components/common/SearchableSelect.vue';
import StudioToolbar from '@/components/layout/StudioToolbar.vue';
import { useImageClipboard } from '@/composables/useImageClipboard';
import ImageComparisonModes from '@/components/common/ImageComparisonModes.vue';
import StudioLayout from '@/components/layout/StudioLayout.vue';
import { resolveDynamicPromptWithSeed } from '@/utils/dynamicPrompt';
import ImageBatchQueue from '@/components/common/ImageBatchQueue.vue';
import ImageComparison from '@/components/common/ImageComparison.vue';
import { useImageBatch, extractDimensions } from '@/composables/useImageBatch';
import type { ImageBatchItem, ImageComparisonMode } from '@/types/imageBatch';
import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  watch
} from 'vue';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  Download,
  Folder,
  Loader2,
  Maximize2,
  RefreshCw,
  Scaling,
  SlidersHorizontal,
  Sparkles
} from '@lucide/vue';
import { invoke } from '@tauri-apps/api/core';
import ImageLightboxModal from '@/components/common/ImageLightboxModal.vue';
import ImageDropOverlay from '@/components/common/ImageDropOverlay.vue';
import ImageDropzone from '@/components/common/ImageDropzone.vue';
import ImageMetadataBar from '@/components/common/ImageMetadataBar.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import StatusDot from '@/components/layout/StatusDot.vue';
import { useImageTransferStore } from '@/stores/imageTransferStore';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import ModelSection from '@/components/template/ModelSection.vue';
import LoraChainSection from '@/components/template/LoraChainSection.vue';
import SeedControl from '@/components/common/SeedControl.vue';
import UltimateUpscaleSection from '@/components/template/UltimateUpscaleSection.vue';
import WorkflowField from '@/components/template/WorkflowField.vue';
import { useUltimateUpscaleStore } from '@/stores/ultimateUpscaleStore';
import {
  buildUltimateUpscalePrompt,
  ULTIMATE_UPSCALE_MAX_SCALE
} from '../services/ultimateUpscaleWorkflow';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { ComfyApi } from '../services/comfyApi';
import { loadAppData, saveAppData } from '../services/appStorage';
import { useComfyStore } from '../stores/comfyStore';
import { useLauncherStore } from '../stores/launcherStore';
import type { ComfyHistoryEntry } from '../types/comfy';

const { copySuccess, copyImageToClipboard } = useImageClipboard();

type UpscaleMode = 'normal' | 'ultimate';
interface UpscalerPreferences {
  model: string;
  scale: number;
  filenamePrefix: string;
  mode: UpscaleMode;
}
const QUICK_SCALES = [1.5, 2.0, 3.0, 4.0, 8.0];

const {
  fileInput,
  items,
  selectedItemId,
  isDragging,
  isDraggingQueue,
  activeItem,
  readyItems,
  processingItems,
  completedItems,
  overallProgress,
  addFiles,
  handleFileInput,
  handleDrop,
  handleDragEnterViewport,
  handleDragLeaveViewport,
  removeItem,
  clearItems
} = useImageBatch();
const comfyStore = useComfyStore();
const launcherStore = useLauncherStore();
const ultimateStore = useUltimateUpscaleStore();
const upscaleMode = ref<UpscaleMode>('normal');
const isUltimate = computed(() => upscaleMode.value === 'ultimate');
const maxScale = computed(() =>
  isUltimate.value ? ULTIMATE_UPSCALE_MAX_SCALE : 10
);
const upscaleModel = ref('');
const upscaleBy = ref(2);
const filenamePrefix = ref('ComfyGUI_Upscale');
const isSubmitting = ref(false);

// Viewport and Inspector controls
const viewMode = ref<ImageComparisonMode>('split');
const isLightboxOpen = ref(false);

let disposed = false;
let preferencesLoaded = false;
let savePreferencesTimer: ReturnType<typeof setTimeout> | undefined;

async function loadPreferences() {
  const saved = await loadAppData<Partial<UpscalerPreferences>>(
    'upscaler_preferences'
  );
  if (typeof saved?.model === 'string') upscaleModel.value = saved.model;
  if (typeof saved?.scale === 'number') {
    upscaleBy.value = Math.min(10, Math.max(0.1, saved.scale));
  }
  if (typeof saved?.filenamePrefix === 'string') {
    filenamePrefix.value = saved.filenamePrefix;
  }
  if (saved?.mode === 'normal' || saved?.mode === 'ultimate') {
    upscaleMode.value = saved.mode;
  }
  preferencesLoaded = true;
}

function persistPreferences() {
  if (!preferencesLoaded) return;
  void saveAppData('upscaler_preferences', {
    model: upscaleModel.value,
    scale: upscaleBy.value,
    filenamePrefix: filenamePrefix.value,
    mode: upscaleMode.value
  } satisfies UpscalerPreferences);
}

function schedulePreferencesSave() {
  if (!preferencesLoaded) return;
  clearTimeout(savePreferencesTimer);
  savePreferencesTimer = setTimeout(persistPreferences, 300);
}

// Auto-select first available upscale model
watch(
  () => comfyStore.availableUpscaleModels,
  (models) => {
    if (!models.includes(upscaleModel.value)) {
      upscaleModel.value = models[0] ?? '';
    }
  },
  { immediate: true }
);

watch(
  [upscaleModel, upscaleBy, filenamePrefix, upscaleMode],
  schedulePreferencesSave
);
watch(maxScale, (max) => {
  if (upscaleBy.value > max) upscaleBy.value = max;
});

const ultimateReady = computed(
  () =>
    !isUltimate.value ||
    (ultimateStore.loaded &&
      comfyStore.isUltimateUpscaleAvailable &&
      Boolean(
        ultimateStore.state.models.unetName &&
        ultimateStore.state.models.clipName &&
        ultimateStore.state.models.vaeName
      ))
);

const canQueue = computed(
  () =>
    comfyStore.isConnected &&
    Boolean(upscaleModel.value) &&
    ultimateReady.value &&
    readyItems.value.length > 0 &&
    !isSubmitting.value
);

const upscaleByModel = computed({
  get: () => [upscaleBy.value],
  set: (value: number[]) => {
    if (value[0] !== undefined) upscaleBy.value = Number(value[0].toFixed(1));
  }
});

// Projected resolution for the selected image
const targetDimensions = computed(() => {
  const item = activeItem.value;
  if (!item?.width || !item?.height) return null;
  const targetW = Math.round(item.width * upscaleBy.value);
  const targetH = Math.round(item.height * upscaleBy.value);
  const originalMegapixels = (item.width * item.height) / 1_000_000;
  const targetMegapixels = (targetW * targetH) / 1_000_000;
  const pixelIncrease = Math.round(
    ((targetMegapixels - originalMegapixels) / originalMegapixels) * 100
  );
  return {
    width: targetW,
    height: targetH,
    originalMegapixels: originalMegapixels.toFixed(2),
    targetMegapixels: targetMegapixels.toFixed(2),
    pixelIncrease
  };
});

function retryItem(item: ImageBatchItem) {
  item.status = 'ready';
  item.error = undefined;
  void queueSingleItem(item);
}

async function monitorResult(
  item: ImageBatchItem,
  promptId: string,
  startTime: number
) {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (disposed) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });
    let entry: ComfyHistoryEntry | undefined;
    try {
      entry = (
        await ComfyApi.fetchHistory(launcherStore.config.serverUrl, promptId)
      )[promptId];
    } catch {
      continue;
    }
    const image = Object.values(entry?.outputs ?? {}).find(
      (output) => output.images?.length
    )?.images?.[0];
    if (image) {
      item.savedFilename = image.filename;
      item.subfolder = image.subfolder;
      item.type = image.type;
      item.resultUrl = ComfyApi.getViewImageUrl(
        launcherStore.config.serverUrl,
        image.filename,
        image.subfolder,
        image.type
      );
      item.status = 'done';
      item.durationMs = Date.now() - startTime;

      // Extract result dimensions
      void extractDimensions(item.resultUrl).then(({ width, height }) => {
        if (width > 0 && height > 0) {
          item.resultWidth = width;
          item.resultHeight = height;
        }
      });
      return;
    }
    if (entry?.status?.status_str === 'error') {
      item.status = 'error';
      item.error = 'Upscale execution failed.';
      return;
    }
  }
  if (!disposed) {
    item.status = 'error';
    item.error = 'Timed out waiting for the upscale result.';
  }
}

function buildPrompt(imageName: string, seed: number) {
  const prefix = filenamePrefix.value.trim() || 'ComfyGUI_Upscale';
  if (isUltimate.value) {
    const state = structuredClone(ultimateStore.state);
    return buildUltimateUpscalePrompt({
      imageName,
      settings: state.settings,
      models: state.models,
      loras: state.loras,
      positivePrompt: resolveDynamicPromptWithSeed(
        state.positivePrompt,
        seed,
        'positive'
      ),
      negativePrompt: resolveDynamicPromptWithSeed(
        state.negativePrompt,
        seed,
        'negative'
      ),
      upscaleModel: upscaleModel.value,
      upscaleBy: upscaleBy.value,
      seed,
      filenamePrefix: prefix
    });
  }
  return {
    '1': {
      inputs: { image: imageName },
      class_type: 'LoadImage'
    },
    '2': {
      inputs: {
        image: ['1', 0],
        upscale_model: upscaleModel.value,
        upscale_by: upscaleBy.value
      },
      class_type: 'YEImageUpscale'
    },
    '3': {
      inputs: { images: ['2', 0], filename_prefix: prefix },
      class_type: 'SaveImage'
    }
  };
}

async function queueSingleItem(item: ImageBatchItem) {
  if (!comfyStore.isConnected || !upscaleModel.value) return;
  const seed =
    ultimateStore.state.seed < 0
      ? Math.floor(Math.random() * 10_000_000_000)
      : ultimateStore.state.seed;
  item.status = 'uploading';
  item.error = undefined;
  const startTime = Date.now();
  try {
    const extension = item.file.name.match(/\.[^.]+$/u)?.[0] || '.png';
    const uploaded = await ComfyApi.uploadImage(
      launcherStore.config.serverUrl,
      item.file,
      `comfy-gui-upscale-${item.id}${extension}`
    );
    const queued = await ComfyApi.queuePrompt(
      launcherStore.config.serverUrl,
      buildPrompt(uploaded.name, seed),
      `comfy-gui-upscale-${crypto.randomUUID()}`
    );
    item.status = 'queued';
    void monitorResult(item, queued.prompt_id, startTime);
  } catch (error) {
    item.status = 'error';
    item.error = error instanceof Error ? error.message : String(error);
  }
}

async function queueBatch() {
  if (!canQueue.value) return;
  isSubmitting.value = true;
  upscaleBy.value = Math.min(
    maxScale.value,
    Math.max(0.1, Number(upscaleBy.value) || 2)
  );

  for (const item of readyItems.value) {
    await queueSingleItem(item);
  }
  isSubmitting.value = false;
}

// Clipboard Copy
// Output Folder Open
async function openOutputFolder() {
  const workingDir = launcherStore.config.workingDir.replace(/[\\/]+$/u, '');
  if (!workingDir) return;
  const path = /[\\/]comfyui$/iu.test(workingDir)
    ? `${workingDir}\\output`
    : `${workingDir}\\ComfyUI\\output`;
  try {
    await invoke('show_in_folder', { path });
  } catch (error) {
    console.error('Failed to open output folder:', error);
  }
}

const transferStore = useImageTransferStore();

function checkPendingTransfers() {
  const pending = transferStore.consumeUpscaler();
  if (pending.length > 0) {
    const files = pending
      .map((p) => p.file)
      .filter((f): f is File => Boolean(f));
    if (files.length > 0) {
      addFiles(files);
    }
  }
}

onMounted(() => {
  void loadPreferences();
  checkPendingTransfers();
});

onActivated(() => {
  checkPendingTransfers();
});

onDeactivated(() => {
  clearTimeout(savePreferencesTimer);
  persistPreferences();
});

onUnmounted(() => {
  disposed = true;
  clearTimeout(savePreferencesTimer);
  persistPreferences();
});
</script>

<template>
  <div
    class="bg-background flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden select-none"
  >
    <!-- Top Studio Toolbar -->
    <StudioToolbar
      :total="items.length"
      :completed="completedItems.length"
      :processing="processingItems.length"
      :is-submitting="isSubmitting"
      @clear="clearItems"
      ><template #identity>
        <div
          class="border-primary/30 bg-primary/10 text-primary inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold shadow-xs"
        >
          <Scaling class="h-3.5 w-3.5" />
          <span>AI Upscaler Studio</span>
        </div>

        <StatusDot
          v-if="!comfyStore.isConnected"
          tone="amber"
          label="ComfyUI Offline"
        />

        <!-- Output Folder Quick Button -->
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
          title="Open ComfyUI Output Directory"
          @click="openOutputFolder"
        >
          <Folder class="h-3.5 w-3.5" />
          <span>Outputs</span>
        </Button> </template
      ><template #action
        ><Button
          size="sm"
          class="h-7 gap-1.5 text-xs font-semibold shadow-xs"
          :disabled="!canQueue"
          @click="queueBatch"
        >
          <Loader2 v-if="isSubmitting" class="h-3.5 w-3.5 animate-spin" />
          <Sparkles v-else class="h-3.5 w-3.5" />
          <span
            >Upscale
            {{ readyItems.length ? `(${readyItems.length})` : '' }}</span
          >
        </Button></template
      ></StudioToolbar
    >

    <!-- Main Workspace with Resizable Splitter Panels -->
    <StudioLayout>
      <template #sidebar>
        <div
          class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1.5 pb-4"
        >
          <!-- 1. Model & Scale Parameters Section -->
          <section
            class="border-border bg-card flex shrink-0 flex-col gap-3.5 rounded-xl border p-4 shadow-2xs"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <SlidersHorizontal class="text-primary h-4 w-4" />
                <h2 class="text-xs font-bold tracking-wider uppercase">
                  Upscale Parameters
                </h2>
              </div>
              <Badge variant="secondary" class="font-mono text-xs">
                {{ upscaleBy.toFixed(1) }}× Scale
              </Badge>
            </div>

            <!-- Mode Toggle -->
            <ToggleGroup
              type="single"
              :model-value="upscaleMode"
              class="grid w-full grid-cols-2 gap-1"
              @update:model-value="
                (val: any) => {
                  if (val) upscaleMode = val as UpscaleMode;
                }
              "
            >
              <ToggleGroupItem
                value="normal"
                size="sm"
                class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-7 text-xs"
                :disabled="isSubmitting"
              >
                Normal Upscale
              </ToggleGroupItem>
              <ToggleGroupItem
                value="ultimate"
                size="sm"
                class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-7 text-xs"
                :disabled="isSubmitting"
              >
                Ultimate SD Upscale
              </ToggleGroupItem>
            </ToggleGroup>

            <!-- Model Selector -->
            <Field class="gap-1.5">
              <div class="flex items-center justify-between">
                <FieldLabel class="text-xs font-semibold"
                  >Upscale Model</FieldLabel
                >
                <span class="text-muted-foreground font-mono text-xs">
                  {{ comfyStore.availableUpscaleModels.length }} models
                </span>
              </div>
              <SearchableSelect
                v-model="upscaleModel"
                :options="comfyStore.availableUpscaleModels"
                placeholder="Select upscale model"
                :disabled="!comfyStore.isConnected || isSubmitting"
              />
              <FieldDescription class="text-xs">
                Model algorithm applied via yet_essential super-resolution.
              </FieldDescription>
            </Field>

            <!-- Upscale Factor & Preset Badges -->
            <Field class="gap-2">
              <div class="flex items-center justify-between">
                <FieldLabel class="text-xs font-semibold"
                  >Scale Multiplier</FieldLabel
                >
                <div class="flex items-center gap-1">
                  <button
                    v-for="factor in QUICK_SCALES.filter((f) => f <= maxScale)"
                    :key="factor"
                    type="button"
                    class="border-border hover:bg-primary/20 hover:text-primary rounded-md border px-1.5 py-0.5 font-mono text-xs font-medium transition-colors"
                    :class="
                      upscaleBy === factor
                        ? 'border-primary/50 bg-primary/20 text-primary font-bold'
                        : 'bg-secondary text-muted-foreground'
                    "
                    @click="upscaleBy = factor"
                  >
                    {{ factor }}×
                  </button>
                </div>
              </div>

              <Slider
                v-model="upscaleByModel"
                :min="0.1"
                :max="maxScale"
                :step="0.1"
                :disabled="isSubmitting"
                aria-label="Upscale factor"
                class="py-1"
              />

              <div
                class="text-muted-foreground flex items-center justify-between font-mono text-xs"
              >
                <span>0.1×</span>
                <span>{{ (maxScale / 2).toFixed(1) }}×</span>
                <span>{{ maxScale.toFixed(1) }}×</span>
              </div>
            </Field>

            <!-- Target Resolution Preview Card -->
            <div
              v-if="targetDimensions"
              class="border-border bg-secondary/50 flex flex-col gap-1.5 rounded-lg border p-2.5 font-mono text-xs"
            >
              <div
                class="text-muted-foreground flex items-center justify-between"
              >
                <span>Input Canvas:</span>
                <span class="text-foreground"
                  >{{ activeItem?.width }} × {{ activeItem?.height }} px</span
                >
              </div>
              <div
                class="text-muted-foreground flex items-center justify-between"
              >
                <span>Output Canvas:</span>
                <span class="text-primary font-bold"
                  >{{ targetDimensions.width }} ×
                  {{ targetDimensions.height }} px</span
                >
              </div>
              <div
                class="border-border/60 text-muted-foreground flex items-center justify-between border-t pt-1 text-xs"
              >
                <span>Pixel Count:</span>
                <span class="font-semibold text-emerald-400">
                  {{ targetDimensions.originalMegapixels }} MP ➔
                  {{ targetDimensions.targetMegapixels }} MP (+{{
                    targetDimensions.pixelIncrease
                  }}%)
                </span>
              </div>
            </div>

            <!-- Ultimate SD Upscale Settings -->
            <div
              v-if="isUltimate"
              class="border-border flex flex-col gap-3 border-t pt-3"
            >
              <ModelSection :models="ultimateStore.state.models" />
              <LoraChainSection
                v-model:loras="ultimateStore.state.loras"
                v-model:positive-prompt="ultimateStore.state.positivePrompt"
              />
              <WorkflowField label="Positive prompt (optional)">
                <Textarea
                  v-model="ultimateStore.state.positivePrompt"
                  placeholder="Enter prompt"
                  class="min-h-16 text-xs"
                  aria-label="Ultimate SD Upscale positive prompt"
                />
              </WorkflowField>
              <WorkflowField label="Negative prompt (optional)">
                <Textarea
                  v-model="ultimateStore.state.negativePrompt"
                  placeholder="Enter prompt"
                  class="min-h-16 text-xs"
                  aria-label="Ultimate SD Upscale negative prompt"
                />
              </WorkflowField>
              <SeedControl v-model="ultimateStore.state.seed" />
              <UltimateUpscaleSection
                :settings="ultimateStore.state.settings"
              />
            </div>

            <!-- Output Prefix Field -->
            <Field class="gap-1.5">
              <FieldLabel class="text-xs font-semibold"
                >Filename Prefix</FieldLabel
              >
              <Input
                v-model="filenamePrefix"
                placeholder="ComfyGUI_Upscale"
                class="h-8 font-mono text-xs"
                :disabled="isSubmitting"
              />
            </Field>

            <!-- Batch Queue Action Button -->
            <Button
              class="w-full gap-2 font-semibold shadow-xs"
              :disabled="!canQueue"
              @click="queueBatch"
            >
              <Loader2 v-if="isSubmitting" class="h-4 w-4 animate-spin" />
              <Sparkles v-else class="h-4 w-4" />
              <span>
                {{
                  readyItems.length > 0
                    ? `Start Upscale (${readyItems.length} Images)`
                    : 'Queue Upscale'
                }}
              </span>
            </Button>

            <!-- Progress Bar if batch is active -->
            <div
              v-if="processingItems.length > 0"
              class="flex flex-col gap-1.5"
            >
              <div
                class="flex items-center justify-between text-xs font-medium"
              >
                <span class="text-primary flex items-center gap-1.5">
                  <Loader2 class="h-3 w-3 animate-spin" />
                  Processing batch...
                </span>
                <span class="font-mono text-xs">{{ overallProgress }}%</span>
              </div>
              <Progress :model-value="overallProgress" class="h-1.5" />
            </div>
          </section>

          <!-- 2. Batch Queue Management Section -->
          <ImageBatchQueue
            :fill="!isUltimate"
            :items="items"
            :selected-id="selectedItemId"
            :dragging="isDraggingQueue"
            @select="selectedItemId = $event"
            @select-files="fileInput?.click()"
            @retry="retryItem"
            @remove="removeItem"
            @drop="handleDrop"
            @dragging="isDraggingQueue = $event"
          />
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            multiple
            class="sr-only"
            @change="handleFileInput"
          />
        </div>
      </template>
      <div
        class="border-border bg-card/80 flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl border backdrop-blur-xs"
      >
        <!-- Viewport Toolbar -->
        <div
          class="border-border bg-card/90 flex h-10 shrink-0 items-center justify-between border-b px-3 backdrop-blur-xs"
        >
          <!-- Left: Active Item Details & Comparison Mode Toggles -->
          <div class="flex items-center gap-2">
            <div v-if="activeItem" class="flex items-center gap-2">
              <span class="max-w-44 truncate text-xs font-semibold">
                {{ activeItem.file.name }}
              </span>
              <Badge
                v-if="activeItem.status === 'done'"
                variant="outline"
                class="border-emerald-500/30 bg-emerald-500/10 font-mono text-xs text-emerald-400"
              >
                {{ upscaleBy }}× Completed
              </Badge>
            </div>

            <div v-if="activeItem?.resultUrl" class="bg-border h-3.5 w-px" />

            <!-- View Mode Buttons (Only active when result is available) -->
            <ImageComparisonModes
              v-if="activeItem?.resultUrl"
              v-model="viewMode"
            />
          </div>

          <!-- Right: Viewport Action Buttons (Zoom, Copy, Download, Lightbox) -->
          <div class="flex items-center gap-1">
            <template v-if="activeItem">
              <Tooltip v-if="activeItem.resultUrl">
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    class="h-7 w-7"
                    @click="copyImageToClipboard(activeItem.resultUrl)"
                  >
                    <Check
                      v-if="copySuccess"
                      class="h-3.5 w-3.5 text-emerald-400"
                    />
                    <Copy v-else class="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  >Copy Upscaled Image to Clipboard</TooltipContent
                >
              </Tooltip>

              <Tooltip v-if="activeItem.resultUrl">
                <TooltipTrigger as-child>
                  <a
                    :href="activeItem.resultUrl"
                    :download="activeItem.savedFilename || 'upscaled_image.png'"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-muted-foreground hover:text-foreground hover:bg-secondary inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                  >
                    <Download class="h-3.5 w-3.5" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>Download Upscaled Image</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    class="h-7 w-7"
                    @click="isLightboxOpen = true"
                  >
                    <Maximize2 class="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Fullscreen Lightbox Inspector</TooltipContent>
              </Tooltip>
            </template>
          </div>
        </div>

        <!-- Viewport Stage Area -->
        <div
          class="bg-muted/10 relative flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-hidden p-3"
          @dragenter="handleDragEnterViewport"
          @dragover.prevent="isDragging = true"
          @dragleave="handleDragLeaveViewport"
          @drop.prevent="handleDrop"
        >
          <ImageDropOverlay v-if="isDragging && activeItem" />

          <ImageDropzone
            v-if="!activeItem"
            :dragging="isDragging"
            @select="fileInput?.click()"
          />

          <!-- Active Item Display Stage -->
          <template v-else>
            <ImageComparison
              :preview-url="activeItem.previewUrl"
              :result-url="activeItem.resultUrl"
              :alt="activeItem.file.name"
              :mode="viewMode"
              result-label="Upscaled"
            >
              <template #original-label>
                Original ({{ activeItem.width }}×{{ activeItem.height }})
              </template>
              <template #result-label>
                Upscaled ({{
                  activeItem.resultWidth ||
                  (activeItem.width
                    ? Math.round(activeItem.width * upscaleBy)
                    : '?')
                }}×{{
                  activeItem.resultHeight ||
                  (activeItem.height
                    ? Math.round(activeItem.height * upscaleBy)
                    : '?')
                }})
              </template>
              <!-- Processing Overlay Animation -->
              <div
                v-if="
                  activeItem.status === 'uploading' ||
                  activeItem.status === 'queued'
                "
                class="bg-background/70 absolute inset-0 flex flex-col items-center justify-center gap-3 backdrop-blur-xs"
              >
                <div
                  class="border-primary/30 bg-primary/10 flex h-14 w-14 items-center justify-center rounded-2xl border shadow-lg"
                >
                  <Loader2 class="text-primary h-7 w-7 animate-spin" />
                </div>
                <div class="text-center">
                  <p class="text-sm font-bold">
                    {{
                      activeItem.status === 'uploading'
                        ? 'Uploading image...'
                        : 'Enhancing with AI Super-Resolution...'
                    }}
                  </p>
                  <p class="text-muted-foreground font-mono text-xs">
                    Model: {{ upscaleModel || 'Selected Model' }}
                  </p>
                </div>
              </div>

              <!-- Error Notification Banner -->
              <div
                v-if="activeItem.status === 'error'"
                class="border-destructive/40 bg-destructive/10 text-destructive absolute right-4 bottom-4 left-4 flex items-center justify-between rounded-lg border p-3 text-xs"
              >
                <div class="flex items-center gap-2">
                  <AlertCircle class="h-4 w-4 shrink-0" />
                  <span>{{ activeItem.error || 'Upscale failed.' }}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  class="border-destructive/40 h-7 text-xs"
                  @click="retryItem(activeItem)"
                >
                  <RefreshCw class="mr-1 h-3 w-3" />
                  Retry
                </Button>
              </div>
            </ImageComparison>
          </template>
        </div>

        <ImageMetadataBar
          v-if="activeItem"
          :width="activeItem.width"
          :height="activeItem.height"
          :file-size="activeItem.file.size"
          :duration-ms="activeItem.durationMs"
          :status="activeItem.status"
        >
          <template #dimensions-extra>
            <template v-if="activeItem.resultUrl">
              <ArrowRight class="text-primary mx-1 inline-block h-3 w-3" />
              <strong class="text-primary font-bold">
                {{
                  activeItem.resultWidth ||
                  (activeItem.width
                    ? Math.round(activeItem.width * upscaleBy)
                    : '?')
                }}×{{
                  activeItem.resultHeight ||
                  (activeItem.height
                    ? Math.round(activeItem.height * upscaleBy)
                    : '?')
                }}
              </strong>
            </template>
          </template>
        </ImageMetadataBar>
      </div>
    </StudioLayout>

    <!-- Offline Connection Warning Toast -->
    <NoticeBanner v-if="!comfyStore.isConnected" class="mx-3 mb-2 shadow-sm">
      <span>
        ComfyUI server is offline. Start the server from the launcher or
        titlebar to run upscaling jobs.
      </span>
      <template #actions>
        <Button
          size="sm"
          variant="outline"
          class="h-6.5 border-amber-500/40 text-xs text-amber-300 hover:bg-amber-500/20"
          @click="comfyStore.fetchDiscovery()"
        >
          <RefreshCw class="mr-1 h-3 w-3" />
          Reconnect
        </Button>
      </template>
    </NoticeBanner>

    <!-- Fullscreen Lightbox Inspector Modal -->
    <ImageLightboxModal
      v-model:open="isLightboxOpen"
      :src="activeItem?.resultUrl || activeItem?.previewUrl"
      :title="activeItem?.file.name"
    >
      <template #actions>
        <Button
          v-if="activeItem?.resultUrl"
          size="iconSm"
          variant="ghost"
          class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
          title="Copy Image"
          @click="copyImageToClipboard(activeItem.resultUrl)"
        >
          <Check v-if="copySuccess" class="h-4 w-4 text-emerald-400" />
          <Copy v-else class="h-4 w-4" />
        </Button>
        <a
          v-if="activeItem?.resultUrl"
          :href="activeItem.resultUrl"
          :download="activeItem.savedFilename || 'upscaled_image.png'"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          title="Download PNG"
        >
          <Download class="h-4 w-4" />
        </a>
      </template>
    </ImageLightboxModal>
  </div>
</template>
