<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  History,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Scaling,
  ScanFace,
  Sparkles,
  Square,
  WandSparkles,
  X
} from '@lucide/vue';
import { useRouter } from 'vue-router';
import ImageLightboxModal from '@/components/common/ImageLightboxModal.vue';
import { Button } from '@/components/ui/button';
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { useComfyStore } from '../../stores/comfyStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useImageTransferStore } from '../../stores/imageTransferStore';
import { useWorkflowStore } from '../../stores/workflowStore';

const router = useRouter();
const comfyStore = useComfyStore();
const workflowStore = useWorkflowStore();
const historyStore = useHistoryStore();
const transferStore = useImageTransferStore();

const isZoomModalOpen = ref(false);
const isTransferMenuOpen = ref(false);
const copySuccess = ref(false);
const liveElapsedMs = ref(0);
let timerInterval: ReturnType<typeof setInterval> | null = null;

async function handleSendToUpscaler() {
  if (!comfyStore.lastGeneratedImage?.url) return;
  await transferStore.sendToUpscaler(
    comfyStore.lastGeneratedImage.url,
    comfyStore.lastGeneratedImage.filename
  );
  void router.push('/upscaler');
}

async function handleSendToRmbg() {
  if (!comfyStore.lastGeneratedImage?.url) return;
  await transferStore.sendToRmbg(
    comfyStore.lastGeneratedImage.url,
    comfyStore.lastGeneratedImage.filename
  );
  void router.push('/remove-bg');
}

async function handleSendToFaceDetailer() {
  if (!comfyStore.lastGeneratedImage?.url) return;
  await transferStore.sendToFaceDetailer(
    comfyStore.lastGeneratedImage.url,
    comfyStore.lastGeneratedImage.filename
  );
  void router.push('/face-detailer');
}

watch(
  () => [comfyStore.isGenerating, comfyStore.generationStartTime] as const,
  ([generating]) => {
    if (generating) {
      liveElapsedMs.value = 0;
      if (timerInterval) clearInterval(timerInterval);
      const start = comfyStore.generationStartTime || Date.now();
      timerInterval = setInterval(() => {
        liveElapsedMs.value = Date.now() - start;
      }, 50);
    } else if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  window.removeEventListener('keydown', handleGenerateShortcut);
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
});

function handleGenerate() {
  if (!comfyStore.isConnected || comfyStore.isQueueing) return;
  comfyStore.generateImage(workflowStore.getFullWorkflowState());
}

function handleGenerateShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    handleGenerate();
  }
}

onMounted(() => window.addEventListener('keydown', handleGenerateShortcut));

async function copyImageToClipboard() {
  const url = comfyStore.lastGeneratedImage?.url;
  if (!url) return;

  try {
    const res = await fetch(url);
    const blob = await res.blob();
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ]);
    copySuccess.value = true;
    setTimeout(() => {
      copySuccess.value = false;
    }, 2000);
  } catch {}
}

function downloadImage() {
  const url = comfyStore.lastGeneratedImage?.url;
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = comfyStore.lastGeneratedImage?.filename || 'comfyui-image.png';
  document.body.append(a);
  a.click();
  a.remove();
}

const resolutionText = computed(() => {
  if (
    workflowStore.imageInput.mode !== 'text2img' &&
    workflowStore.imageInput.imageWidth &&
    workflowStore.imageInput.imageHeight
  ) {
    return `${workflowStore.imageInput.imageWidth}X${workflowStore.imageInput.imageHeight}`;
  }
  if (
    workflowStore.resolution.preset === 'Custom' ||
    workflowStore.resolution.preset.toLowerCase().startsWith('custom') ||
    workflowStore.resolution.isCustom
  ) {
    return `${workflowStore.resolution.width || 1024}X${workflowStore.resolution.height || 1024}`;
  }
  const match = workflowStore.resolution.preset.match(/^(\d+\s*x\s*\d+)/iu);
  return match ? match[1].toUpperCase().replaceAll(/\s+/gu, '') : '832X1216';
});
const stepsText = computed(() =>
  workflowStore.imageInput.mode === 'inpaint'
    ? workflowStore.imageInput.turboEnabled
      ? workflowStore.imageInput.turboSteps
      : workflowStore.imageInput.inpaintSteps
    : workflowStore.sampler.steps
);
const cfgText = computed(() =>
  workflowStore.imageInput.mode === 'inpaint'
    ? workflowStore.imageInput.turboEnabled
      ? workflowStore.imageInput.turboCfg
      : workflowStore.imageInput.inpaintCfg
    : workflowStore.sampler.cfg
);

const seedText = computed(() => {
  if (workflowStore.sampler.randomizeSeed) {
    return 'RANDOM';
  }
  return String(workflowStore.sampler.seed);
});

const durationText = computed(() => {
  if (comfyStore.isGenerating) {
    const seconds = (liveElapsedMs.value / 1000).toFixed(2);
    return `TIME ${seconds}s`;
  }
  if (historyStore.items.length > 0 && historyStore.items[0]?.durationMs) {
    const ms = historyStore.items[0].durationMs;
    const seconds = (ms / 1000).toFixed(2);
    return `TIME ${seconds}s`;
  }
  return 'TIME 00.00s';
});
</script>

<template>
  <div class="flex h-full flex-col gap-3">
    <!-- Top Action Header Row -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <h2 class="text-foreground text-sm font-bold tracking-tight">
          Preview Output
        </h2>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center gap-2">
        <!-- Session History Panel Toggle -->
        <Button
          :variant="historyStore.isPanelOpen ? 'secondary' : 'outline'"
          size="sm"
          class="h-8 cursor-pointer gap-1.5 px-3 text-xs font-medium"
          :class="
            historyStore.isPanelOpen ? 'border-primary/30 text-primary' : ''
          "
          title="Toggle Generation History Panel"
          @click="historyStore.isPanelOpen = !historyStore.isPanelOpen"
        >
          <History class="h-3.5 w-3.5" />
          <span>History</span>
          <span
            v-if="historyStore.items.length > 0"
            class="bg-primary/20 text-primary rounded px-1.5 py-0.5 font-mono text-xs font-bold"
          >
            {{ historyStore.items.length }}
          </span>
        </Button>

        <!-- Unified Generate & Interrupt Button Group -->
        <div
          class="inline-flex h-8 items-stretch overflow-hidden rounded-md shadow-xs ring-1 ring-white/10 transition-all"
          :class="!comfyStore.isConnected ? 'opacity-60' : ''"
        >
          <button
            type="button"
            :disabled="!comfyStore.isConnected || comfyStore.isQueueing"
            class="bg-primary text-primary-foreground hover:bg-primary/90 flex h-full cursor-pointer items-center justify-center gap-1.5 px-3.5 text-xs font-semibold transition-colors active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            :title="
              comfyStore.isConnected
                ? 'Queue image with the current settings (Ctrl+Enter)'
                : 'Connect ComfyUI server to generate'
            "
            @click="handleGenerate"
          >
            <Loader2
              v-if="comfyStore.isQueueing"
              class="h-3.5 w-3.5 animate-spin"
            />
            <Sparkles v-else class="h-3.5 w-3.5" />
            <span>Generate</span>
            <span
              v-if="comfyStore.queuedGenerationCount > 0"
              class="bg-primary-foreground/20 rounded px-1.5 py-0.5 font-mono text-xs font-bold"
            >
              {{ comfyStore.queuedGenerationCount }}
            </span>
          </button>

          <button
            v-if="comfyStore.isGenerating"
            type="button"
            title="Interrupt current generation"
            class="flex h-full cursor-pointer items-center justify-center border-l border-white/20 bg-rose-600 px-2.5 text-white transition-colors hover:bg-rose-500 active:bg-rose-700"
            @click="comfyStore.interrupt"
          >
            <Square class="h-3.5 w-3.5 fill-current" />
            <span class="sr-only">Interrupt current generation</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Main Viewport Canvas -->
    <div
      class="group border-border bg-background relative flex min-h-95 flex-1 items-center justify-center overflow-hidden rounded-xl border shadow-inner"
    >
      <!-- Idle Empty Canvas Placeholder -->
      <div
        v-if="
          !comfyStore.lastGeneratedImage &&
          !comfyStore.currentPreviewUrl &&
          !comfyStore.isGenerating
        "
        class="z-10 flex flex-col items-center gap-2.5 p-6 text-center select-none"
      >
        <div
          class="border-border bg-secondary text-muted-foreground flex h-14 w-14 items-center justify-center rounded-2xl border shadow-sm backdrop-blur-xs"
        >
          <ImageIcon class="text-muted-foreground h-7 w-7" />
        </div>
        <div class="flex flex-col items-center">
          <h3 class="text-foreground text-xs font-bold">Empty Canvas</h3>
          <p class="text-muted-foreground mt-0.5 text-xs">
            Generate an image to view result
          </p>
        </div>
      </div>

      <!-- Live Preview / Rendered Output Image Container -->
      <ContextMenu
        v-if="
          (comfyStore.isGenerating && comfyStore.currentPreviewUrl) ||
          comfyStore.lastGeneratedImage?.url ||
          comfyStore.currentPreviewUrl
        "
      >
        <ContextMenuTrigger as-child @click="isZoomModalOpen = true">
          <div
            class="relative flex h-full min-h-0 w-full min-w-0 cursor-pointer items-center justify-center overflow-hidden p-3 pb-12"
          >
            <img
              :src="
                comfyStore.isGenerating
                  ? comfyStore.currentPreviewUrl ||
                    comfyStore.lastGeneratedImage?.url ||
                    ''
                  : comfyStore.lastGeneratedImage?.url ||
                    comfyStore.currentPreviewUrl ||
                    ''
              "
              alt="Generation Output"
              draggable="true"
              class="z-10 h-full w-full object-contain drop-shadow-md transition-all duration-150 select-none"
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent class="w-48">
          <ContextMenuItem
            :disabled="!comfyStore.lastGeneratedImage?.url"
            @select="isZoomModalOpen = true"
          >
            <Maximize2 /> View Fullscreen
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            :disabled="!comfyStore.lastGeneratedImage?.url"
            @select="copyImageToClipboard"
          >
            <Copy /> Copy Image
          </ContextMenuItem>
          <ContextMenuItem
            :disabled="!comfyStore.lastGeneratedImage?.url"
            @select="downloadImage"
          >
            <Download /> Download Image
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <div
        v-if="comfyStore.isGenerating && !comfyStore.currentPreviewUrl"
        class="bg-background/85 absolute inset-0 z-20 flex flex-col items-center justify-center gap-3.5 p-6 backdrop-blur-xs select-none"
      >
        <Loader2 class="text-primary h-6 w-6 animate-spin" />

        <!-- Stage Title & Status Subtitle -->
        <div class="flex max-w-sm flex-col items-center gap-1 text-center">
          <span
            class="text-primary font-mono text-xs font-bold tracking-wider uppercase"
          >
            {{ comfyStore.currentNodeTitle || 'Initializing Pipeline' }}
          </span>

          <p class="text-foreground font-mono text-xs font-medium">
            {{
              comfyStore.currentStep > 0
                ? `Step ${comfyStore.currentStep} of ${comfyStore.maxSteps} (${comfyStore.progressPercent}%)`
                : 'Preparing model tensors & latent space...'
            }}
          </p>

          <!-- Elapsed Stopwatch Tag -->
          <div
            class="text-muted-foreground mt-0.5 flex items-center gap-1.5 font-mono text-xs"
          >
            <span>Elapsed: {{ (liveElapsedMs / 1000).toFixed(1) }}s</span>
            <span
              v-if="workflowStore.models.unetName"
              class="text-muted-foreground/60"
              >•</span
            >
            <span
              v-if="workflowStore.models.unetName"
              class="max-w-48 truncate"
            >
              {{ workflowStore.models.unetName }}
            </span>
          </div>
        </div>

        <!-- Clean Progress Bar -->
        <div class="w-full max-w-xs">
          <Progress
            :model-value="
              comfyStore.currentStep > 0 ? comfyStore.progressPercent : 15
            "
            class="bg-secondary/80 h-1 w-full"
          />
        </div>
      </div>

      <div
        v-if="comfyStore.isGenerating && comfyStore.currentPreviewUrl"
        class="border-border bg-card/90 text-foreground absolute top-3 left-3 z-30 flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-lg backdrop-blur-md"
      >
        <Loader2 class="text-primary h-3.5 w-3.5 animate-spin" />
        <span class="font-mono text-xs font-semibold">
          {{
            comfyStore.currentStep > 0
              ? `Step ${comfyStore.currentStep} / ${comfyStore.maxSteps} (${comfyStore.progressPercent}%) • ${comfyStore.currentNodeTitle}`
              : comfyStore.currentNodeTitle || 'Sampling & Denoising...'
          }}
        </span>
      </div>

      <!-- Hover / Active Action Toolbar -->
      <div
        v-if="comfyStore.lastGeneratedImage?.url && !comfyStore.isGenerating"
        class="border-border bg-card/90 absolute top-3 right-3 z-30 flex items-center gap-1 rounded-lg border p-1 shadow-lg backdrop-blur-md transition-opacity duration-150"
        :class="[
          isTransferMenuOpen
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100'
        ]"
      >
        <Button
          size="iconSm"
          variant="ghost"
          title="Zoom Fullscreen"
          class="text-muted-foreground hover:text-foreground"
          @click="isZoomModalOpen = true"
        >
          <Maximize2 class="h-3.5 w-3.5" />
        </Button>

        <!-- Quick Shortcut Transfer Menu (3-dots) -->
        <DropdownMenu v-model:open="isTransferMenuOpen">
          <DropdownMenuTrigger as-child>
            <Button
              size="iconSm"
              variant="ghost"
              title="Transfer Image"
              class="text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal class="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
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
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="iconSm"
          variant="ghost"
          :title="copySuccess ? 'Copied!' : 'Copy to Clipboard'"
          class="text-muted-foreground hover:text-foreground"
          @click="copyImageToClipboard"
        >
          <Check v-if="copySuccess" class="h-3.5 w-3.5 text-emerald-400" />
          <Copy v-else class="h-3.5 w-3.5" />
        </Button>

        <Button
          size="iconSm"
          variant="ghost"
          title="Download Image"
          class="text-muted-foreground hover:text-foreground"
          @click="downloadImage"
        >
          <Download class="h-3.5 w-3.5" />
        </Button>
      </div>

      <!-- Execution Error Alert -->
      <div
        v-if="comfyStore.executionError"
        class="border-destructive/80 bg-destructive/20 text-destructive-foreground absolute right-3 bottom-12 left-3 z-30 flex items-center gap-2 rounded-xl border p-3 text-xs shadow-lg backdrop-blur-md"
      >
        <AlertTriangle class="text-destructive h-4 w-4 shrink-0" />
        <span class="flex-1 truncate font-mono">{{
          comfyStore.executionError
        }}</span>
        <Button
          size="iconSm"
          variant="ghost"
          class="text-destructive hover:bg-destructive/20"
          @click="comfyStore.executionError = null"
        >
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>

      <!-- Bottom Info / Monospace Stats Overlay Bar -->
      <div
        class="border-border/40 bg-card/80 text-muted-foreground absolute right-0 bottom-0 left-0 z-20 flex items-center justify-between border-t px-3 py-2 font-mono text-xs backdrop-blur-xs select-none"
      >
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-1">
            <span class="text-muted-foreground/70">RES</span>
            <span class="text-foreground font-bold">{{ resolutionText }}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="text-muted-foreground/70">STEPS</span>
            <span class="text-foreground font-bold">{{ stepsText }}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="text-muted-foreground/70">CFG</span>
            <span class="text-foreground font-bold">{{ cfgText }}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="text-muted-foreground/70">SEED</span>
            <span class="text-foreground font-bold">{{ seedText }}</span>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <span class="text-muted-foreground">{{ durationText }}</span>
        </div>
      </div>
    </div>

    <!-- Live Progress Bar when generating -->
    <div v-if="comfyStore.isGenerating" class="flex flex-col gap-1 px-0.5">
      <div class="text-muted-foreground flex justify-between font-mono text-xs">
        <span>{{ comfyStore.currentNodeTitle }}</span>
        <span class="text-primary font-semibold"
          >{{ comfyStore.progressPercent }}%</span
        >
      </div>
      <Progress :model-value="comfyStore.progressPercent" class="h-1" />
    </div>

    <!-- Zoom Fullscreen Lightbox Overlay -->
    <ImageLightboxModal
      v-model:open="isZoomModalOpen"
      :src="comfyStore.lastGeneratedImage?.url"
      :title="comfyStore.lastGeneratedImage?.filename"
      :workflow-state="comfyStore.lastGeneratedImage?.workflowState"
    />
  </div>
</template>
