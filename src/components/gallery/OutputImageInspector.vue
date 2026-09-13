<script setup lang="ts">
import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  watch
} from 'vue';
import { useRouter } from 'vue-router';
import { invoke } from '@tauri-apps/api/core';
import { formatFileSize } from '@/utils/formatters';
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Scaling,
  ScanFace,
  Sparkles,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut
} from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ImageComparison from '@/components/common/ImageComparison.vue';
import ImageComparisonModes from '@/components/common/ImageComparisonModes.vue';
import type { ImageComparisonMode } from '@/types/imageBatch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useImageTransferStore } from '@/stores/imageTransferStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  localImageUrl,
  readOutputImageMetadata,
  type OutputImage,
  type OutputImageMetadata
} from '@/services/imageGallery';
import { useLauncherStore } from '@/stores/launcherStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { toRef } from 'vue';
import { useOverlayLayer } from '@/composables/useOverlayLayer';

const props = defineProps<{ images: OutputImage[] }>();
const filteredImages = toRef(props, 'images');
const launcherStore = useLauncherStore();
let stopPanning = () => {};
const router = useRouter();
const workflowStore = useWorkflowStore();
const selectedImage = ref<OutputImage>();
const { style: overlayStyle } = useOverlayLayer(() =>
  Boolean(selectedImage.value)
);
// A/B comparison: `selectedImage` is A (left/original), `compareImage` is B.
const compareImage = ref<OutputImage>();
const compareMode = ref<ImageComparisonMode>('split');
const splitPosition = ref(50);
const isComparing = computed(() => Boolean(compareImage.value));
const metadata = ref<OutputImageMetadata>();
const metadataLoading = ref(false);
const showRaw = ref(false);
const showInspector = ref(true);
const zoom = ref(1);
const copiedState = ref<{
  prompt?: boolean;
  negPrompt?: boolean;
  seed?: boolean;
  workflow?: boolean;
}>({});
const appliedToWorkflow = ref(false);
const selectedIndex = computed(() =>
  selectedImage.value
    ? filteredImages.value.findIndex(
        (image) => image.path === selectedImage.value?.path
      )
    : -1
);
const promptTags = computed(() =>
  (metadata.value?.prompt ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
);
const panX = ref(0);
const panY = ref(0);
const isPanning = ref(false);
let startDragX = 0;
let startDragY = 0;
let startPanX = 0;
let startPanY = 0;
let hasDragged = false;
function resetPanAndZoom() {
  zoom.value = 1;
  panX.value = 0;
  panY.value = 0;
}
const transformStyle = computed(
  () =>
    `translate3d(${panX.value}px, ${panY.value}px, 0px) scale(${zoom.value})`
);
function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  stopPanning();
  isPanning.value = true;
  hasDragged = false;
  startDragX = event.clientX;
  startDragY = event.clientY;
  startPanX = panX.value;
  startPanY = panY.value;

  const onPointerMove = (e: PointerEvent) => {
    if (!isPanning.value) return;
    const dx = e.clientX - startDragX;
    const dy = e.clientY - startDragY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasDragged = true;
    }
    panX.value = startPanX + dx;
    panY.value = startPanY + dy;
  };

  const onPointerUp = () => {
    isPanning.value = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  stopPanning = onPointerUp;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}
function handleBackdropClick(event: MouseEvent) {
  if (hasDragged) {
    hasDragged = false;
    return;
  }
  if (event.target === event.currentTarget) {
    selectedImage.value = undefined;
  }
}
async function openImage(image: OutputImage) {
  selectedImage.value = image;
  metadata.value = undefined;
  metadataLoading.value = true;
  showRaw.value = false;
  showInspector.value = true;
  resetPanAndZoom();
  appliedToWorkflow.value = false;
  try {
    metadata.value = await readOutputImageMetadata(
      launcherStore.config.workingDir,
      image.path
    );
  } catch {
    metadata.value = undefined;
  } finally {
    metadataLoading.value = false;
  }
}
/** Opens A with B alongside in split-compare mode. */
async function openCompare(a: OutputImage, b: OutputImage) {
  if (a.localId === b.localId) {
    await openImage(a);
    return;
  }
  compareMode.value = 'split';
  splitPosition.value = 50;
  await openImage(a);
  compareImage.value = b;
}
function exitCompare() {
  compareImage.value = undefined;
  resetPanAndZoom();
}
function swapCompare() {
  const a = selectedImage.value;
  const b = compareImage.value;
  if (!a || !b) return;
  compareImage.value = a;
  void openImage(b);
  splitPosition.value = 100 - splitPosition.value;
}
function nudgeSplit(delta: number) {
  splitPosition.value = Math.max(0, Math.min(100, splitPosition.value + delta));
}
function navigateViewer(direction: number) {
  if (isComparing.value) return;
  const nextIndex = selectedIndex.value + direction;
  const image = filteredImages.value[nextIndex];
  if (image) {
    resetPanAndZoom();
    void openImage(image);
  }
}
function handleKeydown(event: KeyboardEvent) {
  if (!selectedImage.value) return;
  if (event.key === 'Escape') {
    if (isComparing.value) exitCompare();
    else selectedImage.value = undefined;
  } else if (isComparing.value && (event.key === 's' || event.key === 'S')) {
    swapCompare();
  } else if (isComparing.value && event.key === '[') nudgeSplit(-5);
  else if (isComparing.value && event.key === ']') nudgeSplit(5);
  else if (event.key === 'ArrowLeft') navigateViewer(-1);
  else if (event.key === 'ArrowRight') navigateViewer(1);
  else if (event.key === 'i' || event.key === 'I') {
    showInspector.value = !showInspector.value;
  } else if (event.key === '+' || event.key === '=') {
    zoom.value = Math.min(5, Number((zoom.value + 0.25).toFixed(2)));
  } else if (event.key === '-') {
    zoom.value = Math.max(1, Number((zoom.value - 0.25).toFixed(2)));
    if (zoom.value === 1) {
      panX.value = 0;
      panY.value = 0;
    }
  } else if (event.key === '0') {
    resetPanAndZoom();
  }
}
function handleZoom(event: WheelEvent) {
  event.preventDefault();
  const newZoom = Math.min(
    5,
    Math.max(1, Number((zoom.value - event.deltaY * 0.002).toFixed(2)))
  );
  if (newZoom === 1) {
    panX.value = 0;
    panY.value = 0;
  }
  zoom.value = newZoom;
}
async function copyWithFeedback(
  type: 'prompt' | 'negPrompt' | 'seed' | 'workflow',
  text?: string
) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copiedState.value = { ...copiedState.value, [type]: true };
    setTimeout(() => {
      copiedState.value = { ...copiedState.value, [type]: false };
    }, 2000);
  } catch {
    // clipboard failure fallback
  }
}
function applyToWorkflowGenerator() {
  if (!metadata.value) return;
  if (metadata.value.prompt) {
    workflowStore.positivePrompt = metadata.value.prompt;
  }
  if (metadata.value.negativePrompt) {
    workflowStore.negativePrompt = metadata.value.negativePrompt;
  }
  if (metadata.value.seed && !isNaN(Number(metadata.value.seed))) {
    workflowStore.sampler.seed = Number(metadata.value.seed);
    workflowStore.sampler.randomizeSeed = false;
  }
  if (metadata.value.steps && !isNaN(Number(metadata.value.steps))) {
    workflowStore.sampler.steps = Number(metadata.value.steps);
  }
  if (metadata.value.cfg && !isNaN(Number(metadata.value.cfg))) {
    workflowStore.sampler.cfg = Number(metadata.value.cfg);
  }
  if (metadata.value.sampler) {
    workflowStore.sampler.samplerName = metadata.value.sampler;
  }
  if (metadata.value.scheduler) {
    workflowStore.sampler.scheduler = metadata.value.scheduler;
  }

  appliedToWorkflow.value = true;
  setTimeout(() => {
    appliedToWorkflow.value = false;
  }, 2500);
}
const transferStore = useImageTransferStore();
function sendAndGoToWorkflow() {
  applyToWorkflowGenerator();
  void router.push('/workflow');
}
async function handleSendToUpscaler() {
  if (!selectedImage.value) return;
  await transferStore.sendToUpscaler(
    imageUrl(selectedImage.value, false),
    selectedImage.value.filename
  );
  void router.push('/upscaler');
}
async function handleSendToRmbg() {
  if (!selectedImage.value) return;
  await transferStore.sendToRmbg(
    imageUrl(selectedImage.value, false),
    selectedImage.value.filename
  );
  void router.push('/remove-bg');
}
async function handleSendToFaceDetailer() {
  if (!selectedImage.value) return;
  await transferStore.sendToFaceDetailer(
    imageUrl(selectedImage.value, false),
    selectedImage.value.filename
  );
  void router.push('/face-detailer');
}
function imageUrl(image: OutputImage, thumbnail = true) {
  return localImageUrl(image.localId, thumbnail);
}
async function openLocalPath(path?: string) {
  if (!path) return;
  try {
    await invoke('show_in_folder', { path });
  } catch (error) {
    console.error('Failed to open path in explorer:', error);
  }
}
onMounted(() => window.addEventListener('keydown', handleKeydown));
onActivated(() => window.addEventListener('keydown', handleKeydown));
function cleanup() {
  window.removeEventListener('keydown', handleKeydown);
  stopPanning();
}
onDeactivated(() => {
  cleanup();
  selectedImage.value = undefined;
});
onUnmounted(cleanup);
watch(
  () => launcherStore.config.workingDir,
  () => {
    selectedImage.value = undefined;
  }
);
watch(selectedImage, (image) => {
  if (!image) compareImage.value = undefined;
});
defineExpose({ open: openImage, openCompare });
</script>
<template>
  <Teleport defer to="#app-content">
    <!-- Pure Fade Transition for Backdrop / Modal -->
    <Transition
      enter-active-class="transition-opacity duration-250 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="selectedImage"
        class="absolute inset-0 z-50 flex overflow-hidden bg-black/70 backdrop-blur-md"
        :style="overlayStyle"
        @click.self="selectedImage = undefined"
      >
        <!-- Center Canvas Viewport -->
        <section
          class="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-transparent"
          @click="handleBackdropClick"
        >
          <!-- Top Canvas Header Overlay -->
          <div
            class="absolute top-0 right-0 left-0 z-20 flex items-center justify-between bg-linear-to-b from-black/80 via-black/40 to-transparent p-4"
            @click.stop
          >
            <div class="flex min-w-0 items-center gap-3">
              <template v-if="compareImage">
                <Badge
                  class="border-primary/40 bg-primary/25 font-mono text-xs text-white backdrop-blur-md"
                >
                  A / B Compare
                </Badge>
                <span
                  class="flex min-w-0 items-center gap-2 font-mono text-xs font-semibold text-white/90"
                >
                  <span
                    class="max-w-56 truncate"
                    :title="selectedImage.filename"
                  >
                    {{ selectedImage.filename }}
                  </span>
                  <ArrowLeftRight class="h-3 w-3 shrink-0 text-white/50" />
                  <span
                    class="text-primary max-w-56 truncate"
                    :title="compareImage.filename"
                  >
                    {{ compareImage.filename }}
                  </span>
                </span>
              </template>
              <template v-else>
                <Badge
                  variant="outline"
                  class="border-white/20 bg-black/50 font-mono text-xs text-white/90 backdrop-blur-md"
                >
                  {{ selectedIndex + 1 }} / {{ filteredImages.length }}
                </Badge>
                <span
                  class="max-w-md truncate font-mono text-xs font-semibold text-white/90"
                  :title="selectedImage.filename"
                >
                  {{ selectedImage.filename }}
                </span>
              </template>
            </div>

            <div class="flex items-center gap-2">
              <template v-if="compareImage">
                <ImageComparisonModes
                  v-model="compareMode"
                  :modes="['split', 'side-by-side']"
                />
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                      aria-label="Swap A and B"
                      @click="swapCompare"
                    >
                      <ArrowLeftRight class="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p class="text-xs">Swap A / B (S)</p>
                  </TooltipContent>
                </Tooltip>
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-8 text-xs text-white/80 hover:bg-white/10 hover:text-white"
                  title="Back to single view (Esc)"
                  @click="exitCompare"
                >
                  Exit compare
                </Button>
                <Separator orientation="vertical" class="h-4 bg-white/20" />
              </template>
              <Badge
                variant="secondary"
                class="border-white/10 bg-black/50 font-mono text-xs text-white/80 backdrop-blur-md"
              >
                Zoom: {{ Math.round(zoom * 100) }}%
              </Badge>
              <Button
                size="iconSm"
                variant="ghost"
                class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                title="Zoom Out (-)"
                @click="
                  zoom = Math.max(1, Number((zoom - 0.25).toFixed(2)));
                  if (zoom === 1) {
                    panX = 0;
                    panY = 0;
                  }
                "
              >
                <ZoomOut class="h-4 w-4" />
              </Button>
              <Button
                size="iconSm"
                variant="ghost"
                class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                title="Zoom In (+)"
                @click="zoom = Math.min(5, Number((zoom + 0.25).toFixed(2)))"
              >
                <ZoomIn class="h-4 w-4" />
              </Button>
              <Button
                v-if="zoom !== 1 || panX !== 0 || panY !== 0"
                size="iconSm"
                variant="ghost"
                class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                title="Reset Zoom & Pan (0)"
                @click="resetPanAndZoom"
              >
                <RotateCcw class="h-3.5 w-3.5" />
              </Button>

              <Separator orientation="vertical" class="h-4 bg-white/20" />

              <!-- Toggle Inspector Button -->
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                    @click="showInspector = !showInspector"
                  >
                    <PanelRightClose v-if="showInspector" class="h-4 w-4" />
                    <PanelRightOpen v-else class="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p class="text-xs">Toggle Generation Data (I)</p>
                </TooltipContent>
              </Tooltip>

              <!-- Quick Transfer Dropdown (3-dots) -->
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                    title="Quick Transfer & Actions"
                  >
                    <MoreHorizontal class="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-52">
                  <DropdownMenuLabel
                    class="text-muted-foreground text-xs font-semibold"
                  >
                    Transfer Image
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    class="cursor-pointer gap-2 text-xs"
                    @click="handleSendToUpscaler"
                  >
                    <Scaling class="h-3.5 w-3.5 text-blue-400" />
                    <span>Send to Upscaler</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    class="cursor-pointer gap-2 text-xs"
                    @click="handleSendToRmbg"
                  >
                    <WandSparkles class="h-3.5 w-3.5 text-pink-400" />
                    <span>Send to RMBG</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    class="cursor-pointer gap-2 text-xs"
                    @click="handleSendToFaceDetailer"
                  >
                    <ScanFace class="h-3.5 w-3.5 text-emerald-400" />
                    <span>Send to Face Detailer</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator v-if="metadata" />
                  <DropdownMenuItem
                    v-if="metadata"
                    class="cursor-pointer gap-2 text-xs"
                    @click="sendAndGoToWorkflow"
                  >
                    <Sparkles class="text-primary h-3.5 w-3.5" />
                    <span>Reuse All Settings</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <!-- Close Lightbox Button -->
              <Button
                size="iconSm"
                variant="ghost"
                class="hover:bg-destructive/80 h-8 w-8 text-white/80 hover:text-white"
                title="Close viewer (Esc)"
                @click="selectedImage = undefined"
              >
                <X class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <!-- Main Interactive Image Area -->
          <div
            class="relative flex flex-1 items-center justify-center overflow-hidden p-6"
            @wheel="handleZoom"
            @click="handleBackdropClick"
          >
            <!-- Previous Button -->
            <Button
              v-if="!compareImage"
              size="icon"
              variant="secondary"
              :disabled="selectedIndex <= 0"
              class="absolute left-4 z-20 h-10 w-10 rounded-full border border-white/20 bg-black/60 text-white shadow-xl backdrop-blur-md hover:bg-black/90 disabled:opacity-20"
              title="Previous image (Left Arrow)"
              @click.stop="navigateViewer(-1)"
            >
              <ChevronLeft class="h-6 w-6" />
            </Button>

            <!-- A/B Comparison: both layers share the same pan/zoom transform -->
            <div
              v-if="compareImage"
              class="h-full w-full select-none"
              :class="isPanning ? 'cursor-grabbing' : 'cursor-grab'"
              @pointerdown.stop="handlePointerDown"
              @dblclick.stop="zoom === 1 ? (zoom = 2) : resetPanAndZoom()"
            >
              <ImageComparison
                v-model:position="splitPosition"
                :preview-url="imageUrl(selectedImage, false)"
                :result-url="imageUrl(compareImage, false)"
                :alt="`${selectedImage.filename} vs ${compareImage.filename}`"
                :mode="compareMode"
                :original-label="selectedImage.filename"
                :result-label="compareImage.filename"
                :image-transform="transformStyle"
                :image-class="
                  isPanning
                    ? 'duration-0'
                    : 'transition-transform duration-100 ease-out'
                "
              >
                <template #original-label>{{
                  selectedImage.filename
                }}</template>
                <template #result-label>{{ compareImage.filename }}</template>
              </ImageComparison>
            </div>

            <!-- Full Rendered Image with Pan/Drag & Zoom -->
            <img
              v-else
              :src="imageUrl(selectedImage, false)"
              :alt="selectedImage.filename"
              draggable="false"
              class="max-h-full max-w-full rounded-lg object-contain shadow-2xl select-none"
              :class="[
                isPanning
                  ? 'cursor-grabbing duration-0'
                  : 'cursor-grab transition-transform duration-100 ease-out'
              ]"
              :style="{
                transform: `translate3d(${panX}px, ${panY}px, 0px) scale(${zoom})`
              }"
              @pointerdown.stop="handlePointerDown"
              @dblclick.stop="zoom === 1 ? (zoom = 2) : resetPanAndZoom()"
            />

            <!-- Next Button -->
            <Button
              v-if="!compareImage"
              size="icon"
              variant="secondary"
              :disabled="selectedIndex >= filteredImages.length - 1"
              class="absolute right-4 z-20 h-10 w-10 rounded-full border border-white/20 bg-black/60 text-white shadow-xl backdrop-blur-md hover:bg-black/90 disabled:opacity-20"
              title="Next image (Right Arrow)"
              @click.stop="navigateViewer(1)"
            >
              <ChevronRight class="h-6 w-6" />
            </Button>
          </div>
        </section>

        <!-- Right Inspector Sidebar: Smooth Slide In / Slide Out Transition -->
        <Transition
          appear
          enter-active-class="transition-transform duration-300 ease-out"
          enter-from-class="translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-200 ease-in"
          leave-from-class="translate-x-0"
          leave-to-class="translate-x-full"
        >
          <aside
            v-if="showInspector"
            class="border-border/80 bg-card/95 relative z-20 flex h-full w-105 max-w-[90vw] shrink-0 flex-col overflow-hidden border-l shadow-2xl backdrop-blur-xl"
            @click.stop
          >
            <!-- Inspector Header (shrink-0) -->
            <div
              class="border-border/80 flex h-13 shrink-0 items-center justify-between border-b px-4"
            >
              <div class="flex items-center gap-2.5">
                <div
                  class="border-primary/30 bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-lg border"
                >
                  <Info class="h-4 w-4" />
                </div>
                <div>
                  <h2
                    class="text-foreground text-xs font-bold tracking-wide uppercase"
                  >
                    Generation Data
                  </h2>
                  <p class="text-muted-foreground text-xs">
                    PNG embedded parameters
                  </p>
                </div>
              </div>

              <div class="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-foreground h-8 w-8"
                      @click="openLocalPath(selectedImage.path)"
                    >
                      <ExternalLink class="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p class="text-xs">Open image externally</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-destructive h-8 w-8"
                      @click="selectedImage = undefined"
                    >
                      <X class="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p class="text-xs">Close viewer (Esc)</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            <!-- Inspector Body (min-h-0 flex-1 with smooth scrolling) -->
            <ScrollArea class="min-h-0 flex-1 overflow-hidden">
              <div
                v-if="metadataLoading"
                class="flex flex-col items-center justify-center gap-2 py-12 text-center"
              >
                <Loader2 class="text-primary h-6 w-6 animate-spin" />
                <p class="text-muted-foreground font-mono text-xs">
                  Extracting ComfyUI workflow metadata...
                </p>
              </div>

              <div v-else class="flex flex-col gap-4 p-4 select-text">
                <!-- Quick Summary Cards -->
                <div class="grid grid-cols-2 gap-2 text-xs">
                  <div
                    class="border-border/80 bg-secondary/50 flex flex-col justify-between rounded-lg border p-2.5 shadow-2xs"
                  >
                    <span class="text-muted-foreground block text-xs"
                      >Dimensions</span
                    >
                    <strong class="text-foreground mt-0.5 font-mono text-xs">
                      {{ metadata?.width || '?' }} ×
                      {{ metadata?.height || '?' }}
                    </strong>
                  </div>
                  <div
                    class="border-border/80 bg-secondary/50 flex flex-col justify-between rounded-lg border p-2.5 shadow-2xs"
                  >
                    <span class="text-muted-foreground block text-xs"
                      >File Size</span
                    >
                    <strong class="text-foreground mt-0.5 font-mono text-xs">
                      {{ formatFileSize(selectedImage.fileSize) }}
                    </strong>
                  </div>
                </div>

                <!-- Generation Key-Value Grid -->
                <div
                  class="border-border/80 bg-secondary/30 rounded-xl border p-3 font-mono text-xs"
                >
                  <dl class="grid grid-cols-[80px_1fr] gap-x-2 gap-y-2.5">
                    <dt class="text-muted-foreground">Model</dt>
                    <dd class="text-foreground font-semibold break-all">
                      {{ metadata?.model || '—' }}
                    </dd>

                    <dt class="text-muted-foreground">Sampler</dt>
                    <dd class="text-foreground font-medium">
                      {{ metadata?.sampler || '—' }}
                    </dd>

                    <dt class="text-muted-foreground">Scheduler</dt>
                    <dd class="text-foreground font-medium">
                      {{ metadata?.scheduler || '—' }}
                    </dd>

                    <dt class="text-muted-foreground">Seed</dt>
                    <dd
                      class="flex items-center justify-between gap-1 break-all"
                    >
                      <span class="text-foreground font-semibold">{{
                        metadata?.seed || '—'
                      }}</span>
                      <Button
                        v-if="metadata?.seed"
                        size="iconSm"
                        variant="ghost"
                        class="h-6 w-6 shrink-0"
                        title="Copy Seed"
                        @click="copyWithFeedback('seed', metadata.seed)"
                      >
                        <Check
                          v-if="copiedState.seed"
                          class="h-3 w-3 text-emerald-400"
                        />
                        <Copy v-else class="h-3 w-3" />
                      </Button>
                    </dd>

                    <dt class="text-muted-foreground">Steps / CFG</dt>
                    <dd class="text-foreground font-medium">
                      {{ metadata?.steps || '—' }} /
                      {{ metadata?.cfg || '—' }}
                    </dd>

                    <dt class="text-muted-foreground">Modified</dt>
                    <dd class="text-muted-foreground text-xs">
                      {{ new Date(selectedImage.modifiedMs).toLocaleString() }}
                    </dd>
                  </dl>
                </div>

                <!-- Positive Prompt Section -->
                <section class="border-border/80 rounded-xl border p-3">
                  <div class="mb-2 flex items-center justify-between">
                    <h3
                      class="text-foreground text-xs font-bold tracking-wider uppercase"
                    >
                      Positive Prompt
                    </h3>
                    <Button
                      v-if="metadata?.prompt"
                      size="sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-primary h-6 gap-1 px-2 text-xs"
                      @click="copyWithFeedback('prompt', metadata.prompt)"
                    >
                      <Check
                        v-if="copiedState.prompt"
                        class="h-3 w-3 text-emerald-400"
                      />
                      <Copy v-else class="h-3 w-3" />
                      <span>{{ copiedState.prompt ? 'Copied!' : 'Copy' }}</span>
                    </Button>
                  </div>

                  <div v-if="promptTags.length" class="flex flex-wrap gap-1.5">
                    <span
                      v-for="tag in promptTags"
                      :key="tag"
                      class="border-border/80 bg-muted/60 text-foreground hover:border-primary/40 rounded-md border px-2 py-0.5 font-mono text-xs break-all transition-colors"
                    >
                      {{ tag }}
                    </span>
                  </div>
                  <p v-else class="text-muted-foreground text-xs italic">
                    No positive prompt metadata found.
                  </p>
                </section>

                <!-- Negative Prompt Section -->
                <section
                  v-if="metadata?.negativePrompt"
                  class="border-border/80 rounded-xl border p-3"
                >
                  <div class="mb-2 flex items-center justify-between">
                    <h3
                      class="text-foreground text-xs font-bold tracking-wider uppercase"
                    >
                      Negative Prompt
                    </h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-primary h-6 gap-1 px-2 text-xs"
                      @click="
                        copyWithFeedback('negPrompt', metadata?.negativePrompt)
                      "
                    >
                      <Check
                        v-if="copiedState.negPrompt"
                        class="h-3 w-3 text-emerald-400"
                      />
                      <Copy v-else class="h-3 w-3" />
                      <span>{{
                        copiedState.negPrompt ? 'Copied!' : 'Copy'
                      }}</span>
                    </Button>
                  </div>
                  <p
                    class="text-muted-foreground font-mono text-xs leading-relaxed whitespace-pre-wrap"
                  >
                    {{ metadata.negativePrompt }}
                  </p>
                </section>

                <!-- Raw Workflow JSON Section -->
                <section
                  v-if="metadata?.rawPrompt || metadata?.rawWorkflow"
                  class="border-border/80 rounded-xl border p-3"
                >
                  <div class="flex items-center justify-between">
                    <button
                      type="button"
                      class="text-primary text-xs font-semibold hover:underline"
                      @click="showRaw = !showRaw"
                    >
                      {{ showRaw ? 'Hide' : 'Show' }} Raw Workflow Graph
                    </button>
                    <Button
                      v-if="showRaw"
                      size="sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-primary h-6 gap-1 px-2 text-xs"
                      @click="
                        copyWithFeedback(
                          'workflow',
                          metadata?.rawWorkflow || metadata?.rawPrompt
                        )
                      "
                    >
                      <Check
                        v-if="copiedState.workflow"
                        class="h-3 w-3 text-emerald-400"
                      />
                      <Copy v-else class="h-3 w-3" />
                      <span>{{
                        copiedState.workflow ? 'Copied!' : 'Copy JSON'
                      }}</span>
                    </Button>
                  </div>
                  <pre
                    v-if="showRaw"
                    class="bg-background/90 border-border/80 mt-2 max-h-72 overflow-auto rounded-lg border p-2.5 font-mono text-xs break-all whitespace-pre-wrap text-zinc-300"
                    >{{ metadata.rawWorkflow || metadata.rawPrompt }}</pre>
                </section>
              </div>
            </ScrollArea>
          </aside>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
