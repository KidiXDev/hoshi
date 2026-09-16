<script setup lang="ts">
import CivitaiRichText from './CivitaiRichText.vue';
import CivitaiSampleMetadata from './CivitaiSampleMetadata.vue';
import ModelDetailShell from '@/components/models/ModelDetailShell.vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FolderOpen,
  ImageOff,
  Layers,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Share2,
  ShieldCheck,
  Sparkles,
  Tag,
  ThumbsUp,
  Video,
  Wand2,
  X
} from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi
} from '@/components/ui/carousel';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import ImageLightboxModal from '@/components/common/ImageLightboxModal.vue';
import {
  getComfyTargetFolder,
  isVideoMedia,
  type CivitaiFile,
  type CivitaiImage,
  type CivitaiModel,
  type CivitaiVersion
} from '@/services/civitai';
import type { DownloadRecord } from '@/services/downloadManager';
import { useWorkflowStore } from '@/stores/workflowStore';
import { appendPromptTerms } from '@/utils/promptTools';

interface Props {
  model: CivitaiModel;
  selectedVersionId?: string;
  isInstalled?: boolean;
  installedVersionIds?: number[];
  isDownloading?: boolean;
  isQueueing?: boolean;
  progressRecord?: DownloadRecord;
  downloadedRecord?: DownloadRecord;
  downloadDisabled?: boolean;
  downloadMessage?: string;
  errorMessage?: string;
  /** Label of the back button in the header (host decides where it leads). */
  backLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  selectedVersionId: '',
  isInstalled: false,
  installedVersionIds: () => [],
  isDownloading: false,
  isQueueing: false,
  progressRecord: undefined,
  downloadedRecord: undefined,
  backLabel: 'Back to Browser'
});

const emit = defineEmits<{
  (e: 'update:selectedVersionId', value: string): void;
  (e: 'close'): void;
  (e: 'download', model: CivitaiModel, version?: CivitaiVersion): void;
  (e: 'pause', versionId: number): void;
  (e: 'resume', versionId: number): void;
  (e: 'cancel', versionId: number): void;
  (e: 'show-in-folder', path: string): void;
  (e: 'tag-click', tag: string): void;
}>();

const router = useRouter();
const workflowStore = useWorkflowStore();

// Carousel and preview state
const activeImageIndex = ref(0);
const carouselApi = ref<CarouselApi>();
const isLightboxOpen = ref(false);
const showAllFiles = ref(false);

// Copy & feedback states
const copiedKey = ref<string | null>(null);
let copyFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
const appliedToWorkflow = ref(false);
let applyFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;

function setCopyFeedback(key: string) {
  copiedKey.value = key;
  if (copyFeedbackTimeout) clearTimeout(copyFeedbackTimeout);
  copyFeedbackTimeout = setTimeout(() => {
    copiedKey.value = null;
  }, 1600);
}

const currentVersion = computed<CivitaiVersion | undefined>(() => {
  const versionId = Number(props.selectedVersionId);
  return (
    props.model.modelVersions.find((v) => v.id === versionId) ??
    props.model.modelVersions[0]
  );
});

const currentImages = computed<CivitaiImage[]>(() => {
  return currentVersion.value?.images ?? [];
});

const activeImage = computed<CivitaiImage | undefined>(() => {
  return currentImages.value[activeImageIndex.value] ?? currentImages.value[0];
});

const primaryModelFile = computed<CivitaiFile | undefined>(() => {
  return (
    currentVersion.value?.files.find((f) => f.primary) ??
    currentVersion.value?.files[0]
  );
});

const targetDirectory = computed(() => {
  return getComfyTargetFolder(
    props.model.type,
    currentVersion.value?.baseModel ?? '',
    primaryModelFile.value?.type ?? ''
  );
});

const downloadPercent = computed(() => {
  const record = props.progressRecord;
  return record?.totalLength
    ? Math.min(
        100,
        Math.round((record.completedLength / record.totalLength) * 100)
      )
    : null;
});

const downloadStatusLabel = computed(() => {
  const status = props.progressRecord?.status;
  if (status === 'paused') return 'Download Paused';
  if (status === 'waiting') return 'Download Queued';
  return 'Downloading Model...';
});

function onCarouselInit(api: CarouselApi) {
  if (!api) return;
  carouselApi.value = api;
  api.on('select', () => {
    activeImageIndex.value = api.selectedScrollSnap();
  });
  if (activeImageIndex.value !== api.selectedScrollSnap()) {
    api.scrollTo(activeImageIndex.value, true);
  }
}

function selectImage(index: number) {
  activeImageIndex.value = index;
  carouselApi.value?.scrollTo(index);
}

function previewUrl(url: string, width = 1024) {
  if (!url) return '';
  if (url.includes('/original=true/')) {
    return url.replace('/original=true/', `/width=${width}/`);
  }
  return url;
}

function formatCount(value = 0) {
  return new Intl.NumberFormat('en', { notation: 'compact' }).format(value);
}

function formatSize(sizeKB = 0) {
  return sizeKB >= 1024 * 1024
    ? `${(sizeKB / 1024 / 1024).toFixed(1)} GB`
    : `${(sizeKB / 1024).toFixed(0)} MB`;
}

async function copyText(text: string, key: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setCopyFeedback(key);
  } catch (error) {
    console.error('Failed to copy to clipboard', error);
  }
}

async function copyCivitaiUrl() {
  const url = `https://civitai.com/models/${props.model.id}`;
  await copyText(url, 'civitai-url');
}

function applyParametersToWorkflow() {
  const meta = activeImage.value?.meta as Record<string, unknown> | undefined;
  if (!meta) return;

  if (meta.prompt && typeof meta.prompt === 'string') {
    workflowStore.positivePrompt = meta.prompt;
  }
  if (meta.negativePrompt && typeof meta.negativePrompt === 'string') {
    workflowStore.negativePrompt = meta.negativePrompt;
  }
  if (meta.steps && typeof meta.steps === 'number') {
    workflowStore.sampler.steps = meta.steps;
  }
  if (meta.cfgScale && typeof meta.cfgScale === 'number') {
    workflowStore.sampler.cfg = meta.cfgScale;
  }
  if (meta.seed && typeof meta.seed === 'number') {
    workflowStore.sampler.seed = meta.seed;
    workflowStore.sampler.randomizeSeed = false;
  }
  if (meta.sampler && typeof meta.sampler === 'string') {
    workflowStore.sampler.samplerName = meta.sampler.toLowerCase();
  }

  appliedToWorkflow.value = true;
  if (applyFeedbackTimeout) clearTimeout(applyFeedbackTimeout);
  applyFeedbackTimeout = setTimeout(() => {
    appliedToWorkflow.value = false;
  }, 2200);

  void router.push({ name: 'workflow' });
}

function appendTriggerWordToPrompt(word: string) {
  workflowStore.positivePrompt = appendPromptTerms(
    workflowStore.positivePrompt,
    [word]
  );
  setCopyFeedback(`append-${word}`);
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !isLightboxOpen.value) {
    emit('close');
  } else if (event.key === 'ArrowLeft' && !isLightboxOpen.value) {
    carouselApi.value?.scrollPrev();
  } else if (event.key === 'ArrowRight' && !isLightboxOpen.value) {
    carouselApi.value?.scrollNext();
  }
}

watch(
  () => props.selectedVersionId,
  () => {
    activeImageIndex.value = 0;
    nextTick(() => {
      carouselApi.value?.scrollTo(0, true);
    });
  }
);

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  if (copyFeedbackTimeout) clearTimeout(copyFeedbackTimeout);
  if (applyFeedbackTimeout) clearTimeout(applyFeedbackTimeout);
});
</script>

<template>
  <ModelDetailShell :back-label="backLabel" @close="emit('close')">
    <template #breadcrumb>
      <span class="text-muted-foreground shrink-0">Civitai</span>
      <span class="text-muted-foreground">/</span>
      <Badge variant="outline" class="shrink-0 py-0 text-xs">
        {{ model.type }}
      </Badge>
      <span class="text-muted-foreground">/</span>
      <span class="text-foreground truncate font-semibold">
        {{ model.name }}
      </span>
    </template>

    <template #actions>
      <slot name="header-actions" />
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="sm"
            class="h-8 cursor-pointer gap-1.5 text-xs"
            @click="copyCivitaiUrl"
          >
            <Check
              v-if="copiedKey === 'civitai-url'"
              class="h-3.5 w-3.5 text-emerald-500"
            />
            <Share2 v-else class="h-3.5 w-3.5" />
            <span>{{ copiedKey === 'civitai-url' ? 'Copied' : 'Share' }}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy Civitai web page link</TooltipContent>
      </Tooltip>

      <Button
        variant="outline"
        size="sm"
        class="h-8 cursor-pointer gap-1.5 text-xs"
        @click="openUrl(`https://civitai.com/models/${model.id}`)"
      >
        <ExternalLink class="h-3.5 w-3.5" />
        <span>View on Civitai</span>
      </Button>
    </template>

    <template #stage>
      <!-- Large Image / Video Preview Stage -->
      <div
        class="border-border/60 group relative aspect-3/4 max-h-150 w-full overflow-hidden rounded-2xl border bg-black/40 shadow-md"
      >
        <Carousel
          class="h-full w-full select-none"
          :opts="{ loop: currentImages.length > 1 }"
          @init-api="onCarouselInit"
        >
          <CarouselContent class="ml-0 h-full">
            <CarouselItem
              v-for="(img, idx) in currentImages"
              :key="idx"
              class="relative flex h-full items-center justify-center pl-0"
            >
              <video
                v-if="isVideoMedia(img)"
                :key="img.url"
                :src="previewUrl(img.url, 1280)"
                autoplay
                loop
                muted
                controls
                playsinline
                class="h-full w-full object-contain"
              />
              <img
                v-else
                :src="previewUrl(img.url, 1280)"
                :alt="`${model.name} preview ${idx + 1}`"
                class="h-full w-full object-contain select-none"
                draggable="false"
              />
            </CarouselItem>

            <div
              v-if="currentImages.length === 0"
              class="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2"
            >
              <ImageOff class="h-12 w-12 opacity-50" />
              <span class="text-xs">No sample previews available</span>
            </div>
          </CarouselContent>

          <!-- Carousel Previous/Next Buttons -->
          <template v-if="currentImages.length > 1">
            <CarouselPrevious
              class="top-1/2 left-3 -translate-y-1/2 border-white/20 bg-black/70 text-white shadow-md backdrop-blur-xs transition-colors hover:bg-black/90 hover:text-white"
            >
              <ChevronLeft class="h-4 w-4" />
            </CarouselPrevious>
            <CarouselNext
              class="top-1/2 right-3 -translate-y-1/2 border-white/20 bg-black/70 text-white shadow-md backdrop-blur-xs transition-colors hover:bg-black/90 hover:text-white"
            >
              <ChevronRight class="h-4 w-4" />
            </CarouselNext>
          </template>
        </Carousel>

        <div
          v-if="currentImages.length > 0"
          class="absolute top-3 right-3 z-20 flex items-center gap-1.5 opacity-80 transition-opacity group-hover:opacity-100"
        >
          <Button
            variant="outline"
            size="iconSm"
            class="h-7 w-7 border-white/20 bg-black/60 text-white backdrop-blur-xs hover:bg-black/80 hover:text-white"
            title="Open fullscreen lightbox"
            @click="isLightboxOpen = true"
          >
            <Maximize2 class="h-3.5 w-3.5" />
          </Button>
        </div>

        <!-- Bottom Left Specs (Resolution & NSFW level) -->
        <div
          v-if="activeImage"
          class="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-1.5"
        >
          <span
            v-if="activeImage.width && activeImage.height"
            class="rounded-md bg-black/70 px-2 py-0.5 font-mono text-xs text-white backdrop-blur-xs"
          >
            {{ activeImage.width }} × {{ activeImage.height }}
          </span>
          <span
            v-if="activeImage.nsfwLevel && activeImage.nsfwLevel > 1"
            class="rounded-md bg-rose-950/80 px-2 py-0.5 font-mono text-xs font-semibold text-rose-300 backdrop-blur-xs"
          >
            NSFW Lv{{ activeImage.nsfwLevel }}
          </span>
        </div>

        <!-- Bottom Right Image Counter -->
        <div
          v-if="currentImages.length > 1"
          class="pointer-events-none absolute right-3 bottom-3 z-10 rounded-full bg-black/70 px-2.5 py-0.5 font-mono text-xs text-white backdrop-blur-xs"
        >
          {{ activeImageIndex + 1 }} / {{ currentImages.length }}
        </div>
      </div>

      <!-- Thumbnail Strip -->
      <div
        v-if="currentImages.length > 1"
        class="flex items-center gap-2.5 overflow-x-auto pb-1"
      >
        <button
          v-for="(img, idx) in currentImages"
          :key="idx"
          type="button"
          class="relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 transition-all"
          :class="
            activeImageIndex === idx
              ? 'border-primary ring-primary/30 shadow-xs ring-2'
              : 'border-transparent opacity-60 hover:opacity-100'
          "
          @click="selectImage(idx)"
        >
          <video
            v-if="isVideoMedia(img)"
            :src="previewUrl(img.url, 180)"
            muted
            loop
            autoplay
            playsinline
            class="pointer-events-none h-full w-full object-cover"
          />
          <img
            v-else
            :src="previewUrl(img.url, 180)"
            alt="thumbnail"
            class="h-full w-full object-cover"
            loading="lazy"
          />
          <div
            v-if="isVideoMedia(img)"
            class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30"
          >
            <Video class="h-3.5 w-3.5 text-white drop-shadow-xs" />
          </div>
        </button>
      </div>

      <!-- Generation Parameters Metadata Card -->
      <CivitaiSampleMetadata
        :active-image="activeImage"
        :applied-to-workflow="appliedToWorkflow"
        :copied-key="copiedKey"
        @apply="applyParametersToWorkflow"
        @copy="copyText"
      />
      <div class="border-border/60 flex flex-col gap-3.5 border-t pt-6">
        <h2 class="text-foreground text-xl font-bold tracking-tight">
          About this Model
        </h2>

        <CivitaiRichText
          :html="model.description"
          class="w-full leading-relaxed"
        >
          <p class="text-muted-foreground text-xs italic">
            No description provided.
          </p>
        </CivitaiRichText>
      </div>
    </template>

    <template #sidebar>
      <!-- Main Title & Creator Header Card -->
      <div class="flex flex-col gap-2.5">
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="outline" class="text-xs">
            {{ model.type }}
          </Badge>
          <Badge
            v-if="currentVersion?.baseModel"
            variant="secondary"
            class="text-xs"
          >
            {{ currentVersion.baseModel }}
          </Badge>
          <Badge v-if="model.nsfw" variant="destructive" class="text-xs">
            NSFW
          </Badge>
        </div>

        <h1 class="text-foreground text-xl font-bold tracking-tight">
          {{ model.name }}
        </h1>

        <div
          class="text-muted-foreground flex flex-wrap items-center gap-3 text-xs"
        >
          <span>
            Created by
            <strong class="text-foreground">{{
              model.creator?.username || 'Unknown'
            }}</strong>
          </span>
          <span>·</span>
          <span class="flex items-center gap-1">
            <Download class="h-3 w-3" />
            {{ formatCount(model.stats?.downloadCount) }} downloads
          </span>
          <span>·</span>
          <span class="flex items-center gap-1">
            <ThumbsUp class="h-3 w-3" />
            {{ formatCount(model.stats?.thumbsUpCount) }} likes
          </span>
        </div>

        <div
          v-if="model.tags?.length"
          class="flex flex-wrap items-center gap-1.5 pt-1"
        >
          <span
            class="text-muted-foreground flex items-center gap-1 text-xs font-medium"
          >
            <Tag class="h-3 w-3" />
            Tags:
          </span>
          <button
            v-for="tag in model.tags"
            :key="tag"
            type="button"
            class="border-border/60 bg-muted/60 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary cursor-pointer rounded-md border px-2 py-0.5 text-xs font-medium transition-colors"
            title="Filter by tag"
            @click="emit('tag-click', tag)"
          >
            {{ tag }}
          </button>
        </div>
      </div>

      <!-- Version Selector Card -->
      <div
        class="border-border/70 bg-card/70 flex flex-col gap-3 rounded-xl border p-4 shadow-xs"
      >
        <div>
          <div class="mb-1.5 flex items-center justify-between">
            <label class="text-muted-foreground text-xs font-medium">
              Model Version
            </label>
            <span class="text-muted-foreground font-mono text-xs">
              {{ model.modelVersions.length }} version{{
                model.modelVersions.length > 1 ? 's' : ''
              }}
            </span>
          </div>

          <Select
            :model-value="props.selectedVersionId || String(currentVersion?.id)"
            @update:model-value="
              (val) => emit('update:selectedVersionId', String(val))
            "
          >
            <SelectTrigger class="w-full text-xs">
              <SelectValue placeholder="Select version" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup class="max-h-40 overflow-y-auto">
                <SelectItem
                  v-for="version in model.modelVersions"
                  :key="version.id"
                  :value="String(version.id)"
                >
                  <CheckCircle2
                    v-if="props.installedVersionIds.includes(version.id)"
                    class="size-3.5 text-emerald-500"
                    aria-label="Installed"
                  />
                  {{ version.name }} ({{ version.baseModel || 'Unknown base' }})
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <!-- Destination Target Folder -->
        <div
          class="border-border/50 bg-muted/30 flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
        >
          <div class="flex items-center gap-2">
            <Layers class="text-primary h-3.5 w-3.5" />
            <span class="text-muted-foreground">ComfyUI Target:</span>
          </div>
          <span class="text-foreground font-mono text-xs font-medium">
            {{ targetDirectory }}
          </span>
        </div>

        <!-- Technical File Specs -->
        <div class="grid grid-cols-2 gap-2.5 pt-1 text-xs">
          <div class="bg-muted/40 border-border/40 rounded-lg border p-2.5">
            <span class="text-muted-foreground block text-xs"
              >Base Architecture</span
            >
            <span class="text-xs font-semibold">{{
              currentVersion?.baseModel || '—'
            }}</span>
          </div>
          <div class="bg-muted/40 border-border/40 rounded-lg border p-2.5">
            <span class="text-muted-foreground block text-xs">File Size</span>
            <span class="text-xs font-semibold">{{
              formatSize(primaryModelFile?.sizeKB)
            }}</span>
          </div>
          <div class="bg-muted/40 border-border/40 rounded-lg border p-2.5">
            <span class="text-muted-foreground block text-xs">Format</span>
            <span class="text-xs font-semibold">{{
              primaryModelFile?.metadata?.format || 'SafeTensor'
            }}</span>
          </div>
          <div class="bg-muted/40 border-border/40 rounded-lg border p-2.5">
            <span class="text-muted-foreground block text-xs">Virus Scan</span>
            <span
              class="flex items-center gap-1 text-xs font-semibold text-emerald-500"
            >
              <ShieldCheck class="h-3.5 w-3.5" />
              {{ primaryModelFile?.virusScanResult || 'Clean' }}
            </span>
          </div>
        </div>

        <!-- Primary Download Action Section -->
        <div class="flex flex-col gap-2.5 pt-2">
          <!-- Download Progress Bar (If Downloading) -->
          <div v-if="props.isDownloading" class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground">
                {{ downloadStatusLabel }}
              </span>
              <span class="font-mono font-medium">
                {{ downloadPercent !== null ? `${downloadPercent}%` : '...' }}
              </span>
            </div>
            <Progress :model-value="downloadPercent ?? 0" class="h-2" />
            <div class="mt-1 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                class="h-8 flex-1 cursor-pointer text-xs"
                @click="
                  props.progressRecord?.status === 'paused'
                    ? emit('resume', currentVersion?.id || 0)
                    : emit('pause', currentVersion?.id || 0)
                "
              >
                <Play
                  v-if="props.progressRecord?.status === 'paused'"
                  class="mr-1.5 h-3.5 w-3.5"
                />
                <Pause v-else class="mr-1.5 h-3.5 w-3.5" />
                {{
                  props.progressRecord?.status === 'paused' ? 'Resume' : 'Pause'
                }}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                class="h-8 flex-1 cursor-pointer text-xs"
                @click="emit('cancel', currentVersion?.id || 0)"
              >
                <X class="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          </div>

          <div v-if="!props.isDownloading" class="flex items-center gap-2">
            <Button
              class="h-10 min-w-0 flex-1 cursor-pointer text-xs font-semibold shadow-sm"
              size="default"
              :variant="props.isInstalled ? 'secondary' : 'default'"
              :disabled="
                !primaryModelFile ||
                props.isQueueing ||
                props.isInstalled ||
                props.downloadDisabled
              "
              @click="emit('download', model, currentVersion)"
            >
              <template v-if="props.isQueueing">
                <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                <span>Processing...</span>
              </template>
              <template v-else-if="props.isInstalled">
                <CheckCircle2 class="mr-2 h-4 w-4 text-emerald-500" />
                <span>Installed in ComfyUI</span>
              </template>
              <template v-else-if="!primaryModelFile"
                >No downloadable file</template
              >
              <template v-else>
                <Download class="mr-2 h-4 w-4" />
                <span
                  >Download to ComfyUI ({{
                    formatSize(primaryModelFile?.sizeKB)
                  }})</span
                >
              </template>
            </Button>
            <slot v-if="props.isInstalled" name="installed-actions" />
          </div>

          <div
            v-if="props.downloadMessage"
            class="text-muted-foreground space-y-2 text-xs"
            role="status"
          >
            <p>{{ props.downloadMessage }}</p>
            <Button as-child variant="outline" size="sm">
              <RouterLink to="/settings">Open Settings</RouterLink>
            </Button>
          </div>
          <p
            v-if="props.errorMessage"
            class="text-destructive text-xs"
            role="alert"
          >
            {{ props.errorMessage }}
          </p>

          <Button
            v-if="
              props.downloadedRecord?.modelPath && !$slots['installed-actions']
            "
            variant="outline"
            size="sm"
            class="h-9 w-full cursor-pointer gap-1.5 text-xs"
            @click="emit('show-in-folder', props.downloadedRecord!.modelPath)"
          >
            <FolderOpen class="h-3.5 w-3.5" />
            <span>Show File in Folder</span>
          </Button>
        </div>
      </div>

      <!-- Trigger Words / Trained Words Card -->
      <div
        v-if="currentVersion?.trainedWords?.length"
        class="border-border/70 bg-card/70 flex flex-col gap-2.5 rounded-xl border p-4 shadow-xs"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 text-xs font-semibold">
            <Sparkles class="text-primary h-3.5 w-3.5" />
            <span>Trigger Words</span>
          </div>
          <button
            type="button"
            class="hover:text-primary flex cursor-pointer items-center gap-1 text-xs font-medium transition-colors"
            @click="
              copyText(currentVersion!.trainedWords!.join(', '), 'trigger-all')
            "
          >
            <Check
              v-if="copiedKey === 'trigger-all'"
              class="h-3 w-3 text-emerald-500"
            />
            <Copy v-else class="h-3 w-3" />
            <span>{{
              copiedKey === 'trigger-all' ? 'Copied!' : 'Copy All'
            }}</span>
          </button>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="(word, wIdx) in currentVersion.trainedWords"
            :key="wIdx"
            type="button"
            class="hover:border-primary/50 hover:bg-muted/90 bg-muted/70 border-border/70 group flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-xs transition-colors"
            title="Click to copy, or click '+' to append to prompt"
            @click="copyText(word, `word-${wIdx}`)"
          >
            <span>{{ word }}</span>
            <Check
              v-if="copiedKey === `word-${wIdx}`"
              class="h-3 w-3 text-emerald-500"
            />
            <span
              v-else
              class="text-muted-foreground group-hover:text-primary transition-colors"
              title="Append to workflow generator"
              @click.stop="appendTriggerWordToPrompt(word)"
            >
              +
            </span>
          </button>
        </div>
      </div>

      <!-- Version Release Notes / Changelog -->
      <div
        v-if="currentVersion?.description"
        class="border-border/70 bg-card/70 flex flex-col gap-2 rounded-xl border p-4 shadow-xs"
      >
        <label class="text-foreground text-xs font-semibold">
          Version Notes: {{ currentVersion.name }}
        </label>
        <ScrollArea
          class="border-border/40 bg-muted/20 max-h-48 rounded-lg border p-3 text-xs"
        >
          <CivitaiRichText
            :html="currentVersion.description"
            class="text-muted-foreground"
          />
        </ScrollArea>
      </div>

      <div
        v-if="currentVersion?.files?.length && currentVersion.files.length > 1"
        class="border-border/70 bg-card/70 flex flex-col gap-2.5 rounded-xl border p-4 shadow-xs"
      >
        <button
          type="button"
          class="flex cursor-pointer items-center justify-between text-xs font-semibold"
          @click="showAllFiles = !showAllFiles"
        >
          <div class="flex items-center gap-1.5">
            <FileCode class="text-primary h-3.5 w-3.5" />
            <span
              >Files in this Version ({{ currentVersion.files.length }})</span
            >
          </div>
          <ChevronUp
            v-if="showAllFiles"
            class="text-muted-foreground h-3.5 w-3.5"
          />
          <ChevronDown v-else class="text-muted-foreground h-3.5 w-3.5" />
        </button>

        <div v-if="showAllFiles" class="flex flex-col gap-2 pt-1">
          <div
            v-for="file in currentVersion.files"
            :key="file.id"
            class="border-border/50 bg-muted/30 flex items-center justify-between rounded-lg border p-2.5 text-xs"
          >
            <div class="flex min-w-0 flex-col gap-0.5">
              <div class="flex items-center gap-1.5">
                <span class="text-foreground truncate font-mono font-medium">
                  {{ file.name }}
                </span>
                <Badge
                  v-if="file.primary"
                  variant="secondary"
                  class="py-0 text-xs"
                >
                  Primary
                </Badge>
              </div>
              <span class="text-muted-foreground text-xs">
                {{ file.metadata?.format || file.type }} ·
                {{ formatSize(file.sizeKB) }} ·
                {{ file.metadata?.fp || 'fp16' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <slot name="sidebar-bottom" />
    </template>

    <ImageLightboxModal
      v-model:open="isLightboxOpen"
      :src="activeImage ? previewUrl(activeImage.url, 2048) : ''"
      :alt="`${model.name} - Full Preview`"
      :title="`${model.name} (${activeImage?.width || 0} × ${activeImage?.height || 0})`"
    >
      <template #actions>
        <Button
          v-if="activeImage?.meta"
          size="sm"
          variant="ghost"
          class="h-8 gap-1 text-xs text-white/80 hover:bg-white/10 hover:text-white"
          @click="applyParametersToWorkflow"
        >
          <Wand2 class="h-3.5 w-3.5" />
          <span>Apply to Workflow</span>
        </Button>
      </template>
    </ImageLightboxModal>
  </ModelDetailShell>
</template>
