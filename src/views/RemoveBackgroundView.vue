<script setup lang="ts">
import MaskSettings from '@/components/remove-background/MaskSettings.vue';
import StudioToolbar from '@/components/layout/StudioToolbar.vue';
import { useImageClipboard } from '@/composables/useImageClipboard';
import ImageComparisonModes from '@/components/common/ImageComparisonModes.vue';
import StudioLayout from '@/components/layout/StudioLayout.vue';
import ImageBatchQueue from '@/components/common/ImageBatchQueue.vue';
import ImageComparison from '@/components/common/ImageComparison.vue';
import { useImageBatch } from '@/composables/useImageBatch';
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
  Check,
  Copy,
  Download,
  Eraser,
  Folder,
  Loader2,
  Maximize2,
  RefreshCw,
  Sparkles,
  WandSparkles
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import { BRAND_NAME } from '@/lib/brand';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { ComfyApi } from '../services/comfyApi';
import { loadAppData, saveAppData } from '../services/appStorage';
import { useComfyStore } from '../stores/comfyStore';
import { useLauncherStore } from '../stores/launcherStore';
import type { ComfyHistoryEntry, ComfyObjectInfoNode } from '../types/comfy';

const { copySuccess, copyImageToClipboard } = useImageClipboard();

type RemoveMode = 'RMBG' | 'BiRefNetRMBG';

interface RemoveBackgroundPreferences {
  mode: RemoveMode;
  model: string;
  sensitivity: number;
  processResolution: number;
  maskBlur: number;
  maskOffset: number;
  invertOutput: boolean;
  refineForeground: boolean;
  background: 'Alpha' | 'Color';
  backgroundColor: string;
}
const OUTPUT_TYPES = ['Alpha', 'Color'] as const;

const modeDetails: Record<RemoveMode, { title: string; description: string }> =
  {
    RMBG: {
      title: 'RMBG',
      description: 'Flexible removal with adjustable processing resolution.'
    },
    BiRefNetRMBG: {
      title: 'BiRefNet RMBG',
      description: 'Detailed edges for portraits, hair, and fine subjects.'
    }
  };

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

const workspaceElement = ref<HTMLElement>();
const isSubmitting = ref(false);
const isLoadingNodes = ref(false);

// Engine & Parameters Configuration
const mode = ref<RemoveMode>('RMBG');
const selectedModel = ref('');
const modelOptions = ref<Record<RemoveMode, string[]>>({
  RMBG: [],
  BiRefNetRMBG: []
});
const nodeAvailable = ref<Record<RemoveMode, boolean>>({
  RMBG: false,
  BiRefNetRMBG: false
});
const sensitivity = ref(1);
const processResolution = ref(1024);
const maskBlur = ref(0);
const maskOffset = ref(0);
const invertOutput = ref(false);
const refineForeground = ref(false);
const background = ref<'Alpha' | 'Color'>('Alpha');
const backgroundColor = ref('#222222');

// Viewport / Inspector Controls
const viewMode = ref<ImageComparisonMode>('split');
const isLightboxOpen = ref(false);

let disposed = false;
let preferencesLoaded = false;
let savePreferencesTimer: ReturnType<typeof setTimeout> | undefined;

async function loadPreferences() {
  const saved = await loadAppData<Partial<RemoveBackgroundPreferences>>(
    'remove_background_preferences'
  );
  if (saved?.mode === 'RMBG' || saved?.mode === 'BiRefNetRMBG') {
    mode.value = saved.mode;
  }
  if (typeof saved?.model === 'string') selectedModel.value = saved.model;
  if (typeof saved?.sensitivity === 'number') {
    sensitivity.value = Math.min(1, Math.max(0, saved.sensitivity));
  }
  if (typeof saved?.processResolution === 'number') {
    processResolution.value = Math.min(
      2048,
      Math.max(256, saved.processResolution)
    );
  }
  if (typeof saved?.maskBlur === 'number') {
    maskBlur.value = Math.min(64, Math.max(0, saved.maskBlur));
  }
  if (typeof saved?.maskOffset === 'number') {
    maskOffset.value = Math.min(64, Math.max(-64, saved.maskOffset));
  }
  if (typeof saved?.invertOutput === 'boolean') {
    invertOutput.value = saved.invertOutput;
  }
  if (typeof saved?.refineForeground === 'boolean') {
    refineForeground.value = saved.refineForeground;
  }
  if (saved?.background === 'Alpha' || saved?.background === 'Color') {
    background.value = saved.background;
  }
  if (
    typeof saved?.backgroundColor === 'string' &&
    /^#[\da-f]{6}$/iu.test(saved.backgroundColor)
  ) {
    backgroundColor.value = saved.backgroundColor;
  }
  preferencesLoaded = true;
}

function persistPreferences() {
  if (!preferencesLoaded) return;
  void saveAppData('remove_background_preferences', {
    mode: mode.value,
    model: selectedModel.value,
    sensitivity: sensitivity.value,
    processResolution: processResolution.value,
    maskBlur: maskBlur.value,
    maskOffset: maskOffset.value,
    invertOutput: invertOutput.value,
    refineForeground: refineForeground.value,
    background: background.value,
    backgroundColor: backgroundColor.value
  } satisfies RemoveBackgroundPreferences);
}

function schedulePreferencesSave() {
  if (!preferencesLoaded) return;
  clearTimeout(savePreferencesTimer);
  savePreferencesTimer = setTimeout(persistPreferences, 300);
}

function commitBackgroundColor(event: Event) {
  backgroundColor.value = (event.target as HTMLInputElement).value;
}

function previewBackgroundColor(event: Event) {
  workspaceElement.value?.style.setProperty(
    '--rmbg-background-color',
    (event.target as HTMLInputElement).value
  );
}

const canRun = computed(
  () =>
    comfyStore.isConnected &&
    nodeAvailable.value[mode.value] &&
    Boolean(selectedModel.value) &&
    readyItems.value.length > 0 &&
    !isSubmitting.value
);

function modelsFromNode(node: ComfyObjectInfoNode | null): string[] {
  const modelType = node?.input.required.model?.[0];
  return Array.isArray(modelType) ? modelType : [];
}

function selectAvailableModel() {
  const models = modelOptions.value[mode.value];
  if (!models.includes(selectedModel.value)) {
    selectedModel.value = models[0] ?? '';
  }
}

async function loadNodeInfo() {
  if (!comfyStore.isConnected) return;
  isLoadingNodes.value = true;
  const [rmbgNode, biRefNetNode] = await Promise.all([
    ComfyApi.fetchNodeInfo(launcherStore.config.serverUrl, 'RMBG'),
    ComfyApi.fetchNodeInfo(launcherStore.config.serverUrl, 'BiRefNetRMBG')
  ]);
  modelOptions.value = {
    RMBG: modelsFromNode(rmbgNode),
    BiRefNetRMBG: modelsFromNode(biRefNetNode)
  };
  nodeAvailable.value = {
    RMBG: Boolean(rmbgNode),
    BiRefNetRMBG: Boolean(biRefNetNode)
  };
  isLoadingNodes.value = false;
  selectAvailableModel();
}

function retryItem(item: ImageBatchItem) {
  item.status = 'ready';
  item.error = undefined;
  void queueSingleItem(item);
}

function buildWorkflow(uploadedName: string): Record<string, unknown> {
  const nodeInputs: Record<string, unknown> = {
    image: ['1', 0],
    model: selectedModel.value,
    sensitivity: sensitivity.value,
    mask_blur: maskBlur.value,
    mask_offset: maskOffset.value,
    invert_output: invertOutput.value,
    refine_foreground: refineForeground.value,
    background: background.value,
    background_color: backgroundColor.value
  };
  if (mode.value === 'RMBG') nodeInputs.process_res = processResolution.value;

  return {
    '1': { inputs: { image: uploadedName }, class_type: 'LoadImage' },
    '2': { inputs: nodeInputs, class_type: mode.value },
    '3': {
      inputs: {
        images: ['2', 0],
        filename_prefix: `${BRAND_NAME}_${mode.value}`
      },
      class_type: 'SaveImage'
    }
  };
}

async function monitorResult(
  item: ImageBatchItem,
  promptId: string,
  startTime: number
) {
  for (let attempt = 0; attempt < 600; attempt++) {
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
    const image = entry?.outputs['3']?.images?.[0];
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
      return;
    }
    if (entry?.status?.status_str === 'error') {
      item.status = 'error';
      item.error = 'Background removal failed in ComfyUI.';
      return;
    }
  }
  if (!disposed) {
    item.status = 'error';
    item.error = 'Timed out waiting for the background removal result.';
  }
}

async function queueSingleItem(item: ImageBatchItem) {
  if (!comfyStore.isConnected || !selectedModel.value) return;
  item.status = 'uploading';
  item.error = undefined;
  const startTime = Date.now();
  try {
    const extension = item.file.name.match(/\.[^.]+$/u)?.[0] || '.png';
    const uploaded = await ComfyApi.uploadImage(
      launcherStore.config.serverUrl,
      item.file,
      `koharu-rmbg-${item.id}${extension}`
    );
    const queued = await ComfyApi.queuePrompt(
      launcherStore.config.serverUrl,
      buildWorkflow(uploaded.name),
      `koharu-rmbg-${crypto.randomUUID()}`
    );
    item.status = 'queued';
    void monitorResult(item, queued.prompt_id, startTime);
  } catch (error) {
    item.status = 'error';
    item.error = error instanceof Error ? error.message : String(error);
  }
}

async function queueBatch() {
  if (!canRun.value) return;
  isSubmitting.value = true;
  for (const item of readyItems.value) {
    await queueSingleItem(item);
  }
  isSubmitting.value = false;
}

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

watch(mode, selectAvailableModel);

watch(
  [
    mode,
    selectedModel,
    sensitivity,
    processResolution,
    maskBlur,
    maskOffset,
    invertOutput,
    refineForeground,
    background,
    backgroundColor
  ],
  schedulePreferencesSave
);

watch(
  () => comfyStore.isConnected,
  (connected) => {
    if (connected) void loadNodeInfo();
  }
);

const transferStore = useImageTransferStore();

function checkPendingTransfers() {
  const pending = transferStore.consumeRmbg();
  if (pending.length > 0) {
    const files = pending
      .map((p) => p.file)
      .filter((f): f is File => Boolean(f));
    if (files.length > 0) {
      addFiles(files);
    }
  }
}

onMounted(async () => {
  await loadPreferences();
  await loadNodeInfo();
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
    ref="workspaceElement"
    class="bg-background flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden select-none"
    :style="{ '--rmbg-background-color': backgroundColor }"
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
          <Eraser class="h-3.5 w-3.5" />
          <span>Remove Background Studio</span>
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
          :disabled="!canRun"
          @click="queueBatch"
        >
          <Loader2 v-if="isSubmitting" class="h-3.5 w-3.5 animate-spin" />
          <WandSparkles v-else class="h-3.5 w-3.5" />
          <span
            >Remove Background
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
          <!-- 1. Engine & Model Section -->
          <section
            class="border-border bg-card flex shrink-0 flex-col gap-3.5 rounded-xl border p-4 shadow-2xs"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Layers class="text-primary h-4 w-4" />
                <h2 class="text-xs font-bold tracking-wider uppercase">
                  Removal Engine
                </h2>
              </div>
              <Badge variant="secondary" class="font-mono text-xs">
                {{ mode }}
              </Badge>
            </div>

            <!-- Engine Mode Toggles -->
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="(details, nodeType) in modeDetails"
                :key="nodeType"
                type="button"
                class="border-border bg-secondary/40 hover:border-primary/40 relative rounded-lg border p-3 text-left transition-colors"
                :class="
                  mode === nodeType
                    ? 'border-primary bg-primary/10 ring-primary/20 ring-1'
                    : ''
                "
                @click="mode = nodeType"
              >
                <p class="text-sm font-semibold">{{ details.title }}</p>
                <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {{ details.description }}
                </p>
              </button>
            </div>

            <div
              v-if="
                comfyStore.isConnected &&
                !nodeAvailable[mode] &&
                !isLoadingNodes
              "
              class="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300"
            >
              <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {{ mode }} is unavailable. Install or enable
                <strong>comfyui-rmbg</strong>, then restart ComfyUI.
              </span>
            </div>

            <!-- Model Selector -->
            <Field class="gap-1.5">
              <div class="flex items-center justify-between">
                <FieldLabel class="text-xs font-semibold">Model</FieldLabel>
                <span class="text-muted-foreground font-mono text-xs">
                  {{ modelOptions[mode].length }} available
                </span>
              </div>
              <Select
                v-model="selectedModel"
                :disabled="!nodeAvailable[mode] || isSubmitting"
              >
                <SelectTrigger class="w-full font-mono text-xs">
                  <SelectValue placeholder="Select removal model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup class="max-h-40 overflow-y-auto">
                    <SelectItem
                      v-for="modelName in modelOptions[mode]"
                      :key="modelName"
                      :value="modelName"
                      class="font-mono text-xs"
                    >
                      {{ modelName }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </section>

          <!-- 2. Edge & Mask Controls Section -->
          <MaskSettings
            :mode="mode"
            :is-submitting="isSubmitting"
            v-model:sensitivity="sensitivity"
            v-model:process-resolution="processResolution"
            v-model:mask-blur="maskBlur"
            v-model:mask-offset="maskOffset"
            v-model:refine-foreground="refineForeground"
            v-model:invert-output="invertOutput"
          />

          <!-- 3. Output Background Mode Section -->
          <section
            class="border-border bg-card flex shrink-0 flex-col gap-3.5 rounded-xl border p-4 shadow-2xs"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Sparkles class="text-primary h-4 w-4" />
                <h2 class="text-xs font-bold tracking-wider uppercase">
                  Background Output
                </h2>
              </div>
            </div>

            <div class="bg-secondary/50 grid grid-cols-2 rounded-lg p-1">
              <button
                v-for="outputType in OUTPUT_TYPES"
                :key="outputType"
                type="button"
                class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                :class="
                  background === outputType
                    ? 'bg-background text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="background = outputType"
              >
                {{
                  outputType === 'Alpha' ? 'Transparent (Alpha)' : 'Solid Color'
                }}
              </button>
            </div>

            <div
              v-if="background === 'Color'"
              class="border-border bg-secondary/30 flex items-center justify-between rounded-lg border p-2.5"
            >
              <div>
                <p class="text-xs font-semibold">Background Color</p>
                <p class="text-muted-foreground font-mono text-xs uppercase">
                  {{ backgroundColor }}
                </p>
              </div>
              <label
                class="border-border relative h-8 w-12 cursor-pointer overflow-hidden rounded-md border shadow-xs"
                :style="{ backgroundColor: 'var(--rmbg-background-color)' }"
              >
                <span class="sr-only">Choose background color</span>
                <input
                  :value="backgroundColor"
                  type="color"
                  class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  @input="previewBackgroundColor"
                  @change="commitBackgroundColor"
                />
              </label>
            </div>

            <!-- Batch Progress Bar if batch is active -->
            <div
              v-if="processingItems.length > 0"
              class="flex flex-col gap-1.5 pt-1"
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

          <!-- 4. Batch Queue Management Section -->
          <ImageBatchQueue
            checkered
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
                Completed
              </Badge>
            </div>

            <div v-if="activeItem?.resultUrl" class="bg-border h-3.5 w-px" />

            <ImageComparisonModes
              v-if="activeItem?.resultUrl"
              v-model="viewMode"
            />
          </div>

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
                <TooltipContent>Copy Cutout Image to Clipboard</TooltipContent>
              </Tooltip>

              <Tooltip v-if="activeItem.resultUrl">
                <TooltipTrigger as-child>
                  <a
                    :href="activeItem.resultUrl"
                    :download="
                      activeItem.savedFilename || 'background_removed.png'
                    "
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-muted-foreground hover:text-foreground hover:bg-secondary inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                  >
                    <Download class="h-3.5 w-3.5" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>Download Transparent PNG</TooltipContent>
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

        <div
          class="relative flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-hidden p-3"
          :class="!activeItem ? 'bg-card/20' : ''"
          :style="
            activeItem
              ? {
                  backgroundColor:
                    background === 'Color'
                      ? 'var(--rmbg-background-color)'
                      : 'var(--muted)',
                  backgroundImage:
                    background === 'Alpha'
                      ? 'linear-gradient(45deg, var(--border) 25%, transparent 25%), linear-gradient(-45deg, var(--border) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--border) 75%), linear-gradient(-45deg, transparent 75%, var(--border) 75%)'
                      : 'none',
                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                  backgroundSize: '16px 16px'
                }
              : {}
          "
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
          >
            <template #icon>
              <Eraser class="text-primary h-8 w-8" />
            </template>
          </ImageDropzone>

          <!-- Active Item Display Stage -->
          <template v-else>
            <ImageComparison
              :preview-url="activeItem.previewUrl"
              :result-url="activeItem.resultUrl"
              :alt="activeItem.file.name"
              :mode="viewMode"
              result-label="Cutout Result"
            >
              <!-- Processing Overlay Animation -->
              <div
                v-if="
                  activeItem.status === 'uploading' ||
                  activeItem.status === 'queued'
                "
                class="bg-background/75 absolute inset-0 flex flex-col items-center justify-center gap-3 backdrop-blur-xs"
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
                        : 'Removing background...'
                    }}
                  </p>
                  <p class="text-muted-foreground font-mono text-xs">
                    Engine: {{ mode }} ({{ selectedModel || 'Selected Model' }})
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
                  <span>{{ activeItem.error || 'Removal failed.' }}</span>
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
        />
      </div>
    </StudioLayout>

    <!-- Offline Connection Warning Toast -->
    <NoticeBanner v-if="!comfyStore.isConnected" class="mx-3 mb-2 shadow-sm">
      <span>
        ComfyUI server is offline. Start the server from the launcher or
        titlebar to remove backgrounds.
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
          :download="activeItem.savedFilename || 'background_removed.png'"
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
