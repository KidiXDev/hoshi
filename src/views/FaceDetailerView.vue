<script setup lang="ts">
import StudioToolbar from '@/components/layout/StudioToolbar.vue';
import { useImageClipboard } from '@/composables/useImageClipboard';
import ImageComparisonModes from '@/components/common/ImageComparisonModes.vue';
import StudioLayout from '@/components/layout/StudioLayout.vue';
import { resolveDynamicPromptWithSeed } from '@/utils/dynamicPrompt';
import ImageBatchQueue from '@/components/common/ImageBatchQueue.vue';
import ImageComparison from '@/components/common/ImageComparison.vue';
import { useBatchRunner } from '@/composables/useBatchRunner';
import { useImageBatch } from '@/composables/useImageBatch';
import { useImageDropZone } from '@/composables/useImageDropZone';
import { saveImage } from '@/composables/useSaveImage';
import type { ImageComparisonMode } from '@/types/imageBatch';
import { resolveSeed } from '@/utils/seed';
import { computed, ref, useTemplateRef } from 'vue';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Folder,
  Loader2,
  Maximize2,
  RefreshCw,
  ScanFace,
  WandSparkles
} from '@lucide/vue';
import ImageLightboxModal from '@/components/common/ImageLightboxModal.vue';
import ImageDropOverlay from '@/components/common/ImageDropOverlay.vue';
import ImageDropzone from '@/components/common/ImageDropzone.vue';
import ImageMetadataBar from '@/components/common/ImageMetadataBar.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import StatusDot from '@/components/layout/StatusDot.vue';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import FaceDetailerSection from '@/components/template/FaceDetailerSection.vue';
import { buildFaceDetailerPrompt } from '../services/faceDetailerWorkflow';
import { useComfyStore } from '../stores/comfyStore';
import { useLauncherStore } from '../stores/launcherStore';
import { useFaceDetailerStore } from '../stores/faceDetailerStore';
import FaceDetailerModels from '@/components/template/FaceDetailerModels.vue';
import type { FaceDetailerSettings } from '../types/workflow';

const { copySuccess, copyImageToClipboard } = useImageClipboard();

const batch = useImageBatch();
const {
  fileInput,
  items,
  selectedItemId,
  activeItem,
  readyItems,
  processingItems,
  completedItems,
  overallProgress,
  addFiles,
  handleFileInput,
  removeItem,
  clearItems
} = batch;
const isDragging = useImageDropZone(
  useTemplateRef<HTMLElement>('viewport'),
  addFiles
);
const comfyStore = useComfyStore();
const launcherStore = useLauncherStore();
const detailerStore = useFaceDetailerStore();

const viewMode = ref<ImageComparisonMode>('split');
const isLightboxOpen = ref(false);

const { isSubmitting, queueBatch, retryItem } = useBatchRunner(batch, {
  target: 'face-detailer',
  uploadPrefix: 'koharu-face-detailer',
  outputNode: '20',
  createBuilder: () => {
    const state = JSON.parse(
      JSON.stringify(detailerStore.state)
    ) as typeof detailerStore.state;
    const seed = resolveSeed(state.seed);
    const settings: FaceDetailerSettings = {
      ...state.settings,
      positivePrompt: resolveDynamicPromptWithSeed(
        state.settings.positivePrompt ?? '',
        seed,
        'fd-positive'
      ),
      negativePrompt: resolveDynamicPromptWithSeed(
        state.settings.negativePrompt ?? '',
        seed,
        'fd-negative'
      )
    };
    return (imageName) =>
      buildFaceDetailerPrompt(
        imageName,
        settings,
        state.models,
        state.loras,
        seed
      );
  }
});

function downloadResult() {
  void saveImage(
    activeItem.value?.resultUrl,
    activeItem.value?.savedFilename || 'face_detailed.png'
  );
}

const canRun = computed(
  () =>
    detailerStore.loaded &&
    comfyStore.isConnected &&
    comfyStore.isFaceDetailerAvailable &&
    Boolean(detailerStore.state.settings.bboxModel) &&
    Boolean(
      detailerStore.state.models.unetName &&
      detailerStore.state.models.clipName &&
      detailerStore.state.models.vaeName
    ) &&
    readyItems.value.length > 0 &&
    !isSubmitting.value
);
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
          <ScanFace class="h-3.5 w-3.5" />
          <span>Face Detailer Studio</span>
        </div>

        <StatusDot
          v-if="!comfyStore.isConnected || !comfyStore.isFaceDetailerAvailable"
          tone="amber"
          :label="
            !comfyStore.isConnected ? 'ComfyUI Offline' : 'Impact Unavailable'
          "
        />

        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
          title="Open ComfyUI Output Directory"
          @click="launcherStore.openOutputFolder()"
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
            >Detail Faces
            {{ readyItems.length ? `(${readyItems.length})` : '' }}</span
          >
        </Button></template
      ></StudioToolbar
    >

    <!-- Main Workspace with Resizable Splitter Panels -->
    <StudioLayout
      :sidebar-size="38"
      :sidebar-min-size="28"
      :sidebar-max-size="52"
      :preview-min-size="45"
    >
      <template #sidebar>
        <div
          class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1.5 pb-4"
        >
          <!-- 1. Parameters Section -->
          <section
            class="border-border bg-card flex shrink-0 flex-col gap-3.5 rounded-xl border p-4 shadow-2xs"
          >
            <FaceDetailerModels />
            <FaceDetailerSection
              :show-enabled="false"
              :settings="detailerStore.state.settings"
            />

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
                  Detailing batch...
                </span>
                <span class="font-mono text-xs">{{ overallProgress }}%</span>
              </div>
              <Progress :model-value="overallProgress" class="h-1.5" />
            </div>
          </section>

          <!-- 2. Image Queue Section -->
          <ImageBatchQueue
            :items="items"
            :selected-id="selectedItemId"
            @select="selectedItemId = $event"
            @select-files="fileInput?.click()"
            @retry="retryItem"
            @remove="removeItem"
            @files="addFiles"
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

            <!-- Comparison Mode Buttons -->
            <ImageComparisonModes
              v-if="activeItem?.resultUrl"
              v-model="viewMode"
            />
          </div>

          <!-- Right: Action Icons -->
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
                  >Copy Detailed Image to Clipboard</TooltipContent
                >
              </Tooltip>

              <Tooltip v-if="activeItem.resultUrl">
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    class="h-7 w-7"
                    @click="downloadResult"
                  >
                    <Download class="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Download Detailed PNG</TooltipContent>
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
          ref="viewport"
          class="relative flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-hidden p-3"
          :class="!activeItem ? 'bg-card/20' : 'bg-muted/40'"
        >
          <ImageDropOverlay v-if="isDragging && activeItem" />

          <ImageDropzone
            v-if="!activeItem"
            :dragging="isDragging"
            @select="fileInput?.click()"
          >
            <template #icon>
              <ScanFace class="text-primary h-8 w-8" />
            </template>
          </ImageDropzone>

          <!-- Active Item Display Stage -->
          <template v-else>
            <ImageComparison
              :preview-url="activeItem.previewUrl"
              :result-url="activeItem.resultUrl"
              :alt="activeItem.file.name"
              :mode="viewMode"
              result-label="Detailed Result"
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
                        : 'Refining face details...'
                    }}
                  </p>
                  <p class="text-muted-foreground font-mono text-xs">
                    Detector:
                    {{
                      detailerStore.state.settings.bboxModel || 'Standard BBox'
                    }}
                  </p>
                </div>
              </div>

              <!-- Error Banner -->
              <div
                v-if="activeItem.status === 'error'"
                class="border-destructive/40 bg-destructive/10 text-destructive absolute right-4 bottom-4 left-4 flex items-center justify-between rounded-lg border p-3 text-xs"
              >
                <div class="flex items-center gap-2">
                  <AlertCircle class="h-4 w-4 shrink-0" />
                  <span>{{
                    activeItem.error || 'Face detailing failed.'
                  }}</span>
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
    <NoticeBanner v-if="!comfyStore.isConnected" class="mx-3 mb-2 shadow-xs">
      <span>
        ComfyUI server is offline. Start the server from the launcher or
        titlebar to run face detailer jobs.
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
        <Button
          v-if="activeItem?.resultUrl"
          size="iconSm"
          variant="ghost"
          class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
          title="Download PNG"
          @click="downloadResult"
        >
          <Download class="h-4 w-4" />
        </Button>
      </template>
    </ImageLightboxModal>
  </div>
</template>
