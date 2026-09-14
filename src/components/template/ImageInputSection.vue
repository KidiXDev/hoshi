<script setup lang="ts">
import SearchableSelect from '../common/SearchableSelect.vue';
import { computed, onMounted, ref, watch } from 'vue';
import {
  AlertCircle,
  ArrowRight,
  ImagePlus,
  Loader2,
  Paintbrush,
  Trash2,
  Upload,
  X
} from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import EditableNumberBadge from '../common/EditableNumberBadge.vue';
import MaskPainterDialog from '../common/MaskPainterDialog.vue';
import { ComfyApi } from '../../services/comfyApi';
import { useComfyStore } from '../../stores/comfyStore';
import { useLauncherStore } from '../../stores/launcherStore';
import { useWorkflowStore } from '../../stores/workflowStore';

const comfyStore = useComfyStore();
const launcherStore = useLauncherStore();
const workflowStore = useWorkflowStore();

const isUploading = ref(false);
const isDragging = ref(false);
const isMaskPainterOpen = ref(false);
const errorMessage = ref('');
const modelPatches = ref<string[]>([]);
const hasAnimaLLLite = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const maskOpacity = ref(0.6);

const imageUrl = computed(() =>
  workflowStore.imageInput.imageName
    ? ComfyApi.getViewImageUrl(
        launcherStore.config.serverUrl,
        workflowStore.imageInput.imageName,
        '',
        'input'
      )
    : ''
);
const maskUrl = computed(() =>
  workflowStore.imageInput.maskName
    ? ComfyApi.getViewImageUrl(
        launcherStore.config.serverUrl,
        workflowStore.imageInput.maskName,
        '',
        'input'
      )
    : ''
);

const canInpaint = computed(
  () => hasAnimaLLLite.value && modelPatches.value.length > 0
);

const imageInputEnabled = computed({
  get: () => workflowStore.imageInput.mode !== 'text2img',
  set: (enabled: boolean) => {
    workflowStore.imageInput.mode = enabled ? 'img2img' : 'text2img';
  }
});

const inpaintingEnabled = computed({
  get: () => workflowStore.imageInput.mode === 'inpaint',
  set: (enabled: boolean) => {
    workflowStore.imageInput.mode = enabled ? 'inpaint' : 'img2img';
  }
});

const denoiseModel = computed({
  get: () => [workflowStore.sampler.denoise],
  set: (val: number[]) => {
    if (val && val[0] !== undefined) {
      workflowStore.sampler.denoise = Number(val[0].toFixed(2));
    }
  }
});

const llliteStrengthModel = computed({
  get: () => [workflowStore.imageInput.llliteStrength],
  set: (val: number[]) => {
    if (val && val[0] !== undefined) {
      workflowStore.imageInput.llliteStrength = Number(val[0].toFixed(2));
    }
  }
});

const llliteStartModel = computed({
  get: () => [workflowStore.imageInput.llliteStart],
  set: (val: number[]) => {
    if (val && val[0] !== undefined) {
      workflowStore.imageInput.llliteStart = Number(val[0].toFixed(2));
    }
  }
});

const llliteEndModel = computed({
  get: () => [workflowStore.imageInput.llliteEnd],
  set: (val: number[]) => {
    if (val && val[0] !== undefined) {
      workflowStore.imageInput.llliteEnd = Number(val[0].toFixed(2));
    }
  }
});

const inpaintStepsModel = computed({
  get: () =>
    workflowStore.imageInput.turboEnabled
      ? workflowStore.imageInput.turboSteps
      : workflowStore.imageInput.inpaintSteps,
  set: (value: number) => {
    if (workflowStore.imageInput.turboEnabled) {
      workflowStore.imageInput.turboSteps = value;
    } else {
      workflowStore.imageInput.inpaintSteps = value;
    }
  }
});

const inpaintCfgModel = computed({
  get: () =>
    workflowStore.imageInput.turboEnabled
      ? workflowStore.imageInput.turboCfg
      : workflowStore.imageInput.inpaintCfg,
  set: (value: number) => {
    if (workflowStore.imageInput.turboEnabled) {
      workflowStore.imageInput.turboCfg = value;
    } else {
      workflowStore.imageInput.inpaintCfg = value;
    }
  }
});
const inpaintStepsSliderModel = computed({
  get: () => [inpaintStepsModel.value],
  set: ([value]: number[]) => {
    if (value !== undefined) inpaintStepsModel.value = value;
  }
});
const inpaintCfgSliderModel = computed({
  get: () => [inpaintCfgModel.value],
  set: ([value]: number[]) => {
    if (value !== undefined) inpaintCfgModel.value = Number(value.toFixed(1));
  }
});

onMounted(loadCapabilities);
watch(
  () => comfyStore.isConnected,
  (connected) => connected && loadCapabilities()
);

async function loadCapabilities() {
  if (!comfyStore.isConnected) return;
  const [patch, animaLLLite] = await Promise.all([
    ComfyApi.fetchNodeInfo(launcherStore.config.serverUrl, 'ModelPatchLoader'),
    ComfyApi.fetchNodeInfo(launcherStore.config.serverUrl, 'AnimaLLLiteApply')
  ]);
  const patchChoices = patch?.input.required['name']?.[0];
  modelPatches.value = Array.isArray(patchChoices) ? patchChoices : [];
  hasAnimaLLLite.value = animaLLLite !== null;
  if (modelPatches.value.length > 0) {
    workflowStore.imageInput.modelPatch = modelPatches.value.includes(
      workflowStore.imageInput.modelPatch
    )
      ? workflowStore.imageInput.modelPatch
      : modelPatches.value[0];
  }
}

function triggerFilePicker() {
  fileInputRef.value?.click();
}

async function uploadSource(file?: File) {
  if (!file || !file.type.startsWith('image/')) return;
  isUploading.value = true;
  errorMessage.value = '';
  try {
    const extension = file.name.match(/\.[^.]+$/u)?.[0] || '.png';
    const uploaded = await ComfyApi.uploadImage(
      launcherStore.config.serverUrl,
      file,
      `koharu-${crypto.randomUUID()}${extension}`
    );
    workflowStore.imageInput.imageName = uploaded.name;
    workflowStore.imageInput.maskName = '';
    if (workflowStore.imageInput.mode === 'text2img') {
      workflowStore.imageInput.mode = 'img2img';
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    isUploading.value = false;
  }
}

async function handleDrop(event: DragEvent) {
  isDragging.value = false;
  const file = event.dataTransfer?.files[0];
  if (file) return uploadSource(file);
  const url = event.dataTransfer
    ?.getData('text/uri-list')
    .split(/\r?\n/u)
    .find((line) => line && !line.startsWith('#'));
  if (!url) return;
  try {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Could not read dropped image (${response.status}).`);
    const blob = await response.blob();
    await uploadSource(
      new File([blob], 'dropped-image.png', { type: blob.type })
    );
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function handleDragLeave(event: DragEvent) {
  const container = event.currentTarget as HTMLElement;
  if (
    !(event.relatedTarget instanceof Node) ||
    !container.contains(event.relatedTarget)
  ) {
    isDragging.value = false;
  }
}

function clearSourceImage() {
  workflowStore.imageInput.imageName = '';
  workflowStore.imageInput.imageWidth = 0;
  workflowStore.imageInput.imageHeight = 0;
  workflowStore.imageInput.maskName = '';
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
}

function rememberImageSize(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  workflowStore.imageInput.imageWidth = image.naturalWidth;
  workflowStore.imageInput.imageHeight = image.naturalHeight;
}

function clearMaskOnly() {
  workflowStore.imageInput.maskName = '';
}

async function saveMask(blob: Blob) {
  isUploading.value = true;
  errorMessage.value = '';
  try {
    const uploaded = await ComfyApi.uploadImage(
      launcherStore.config.serverUrl,
      blob,
      `koharu-mask-${crypto.randomUUID()}.png`
    );
    workflowStore.imageInput.maskName = uploaded.name;
    isMaskPainterOpen.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    isUploading.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Header: Title, Description & Master Switch -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div
          class="bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-lg"
        >
          <ImagePlus class="h-4 w-4" />
        </div>
        <div>
          <h3 class="text-xs font-bold tracking-wider uppercase">
            Image Input (Img2Img)
          </h3>
          <p class="text-muted-foreground text-xs">
            Enable image-to-image or inpainting generation
          </p>
        </div>
      </div>
      <Switch v-model="imageInputEnabled" aria-label="Enable image input" />
    </div>

    <!-- Active Settings Container -->
    <div
      v-if="imageInputEnabled"
      class="border-border bg-card/40 flex flex-col gap-3.5 rounded-xl border p-3"
    >
      <!-- Mode Subpanel: Inpainting Toggle -->
      <div
        class="border-border bg-muted/30 flex items-center justify-between rounded-lg border p-2.5 transition-colors"
      >
        <div class="flex items-center gap-2.5">
          <div
            class="bg-primary/10 text-primary flex h-6 w-6 items-center justify-center rounded-md"
          >
            <Paintbrush class="h-3.5 w-3.5" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold">Inpainting Mode</span>
              <Badge
                v-if="!canInpaint"
                variant="outline"
                class="border-amber-500/30 bg-amber-500/10 font-mono text-xs text-amber-400"
              >
                UNAVAILABLE
              </Badge>
            </div>
            <p class="text-muted-foreground text-xs">
              Mask specific areas to regenerate with Anima LLLite
            </p>
          </div>
        </div>
        <Switch
          v-model="inpaintingEnabled"
          :disabled="!canInpaint"
          aria-label="Enable inpainting"
        />
      </div>

      <!-- Image Upload Dropzone & Preview -->
      <div
        class="flex flex-col gap-2"
        @dragover.prevent="isDragging = true"
        @dragleave="handleDragLeave"
        @drop.prevent="handleDrop"
      >
        <input
          ref="fileInputRef"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          class="sr-only"
          @change="uploadSource(($event.target as HTMLInputElement).files?.[0])"
        />

        <!-- Image Preview State -->
        <div
          v-if="imageUrl"
          class="border-border bg-muted/20 relative flex h-96 flex-col items-center justify-center overflow-hidden rounded-xl border p-2"
          :class="
            isDragging && 'border-primary bg-primary/10 ring-primary/30 ring-2'
          "
        >
          <div
            v-if="maskUrl"
            class="grid h-full w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"
          >
            <div
              class="bg-background/40 relative flex h-full min-w-0 items-center justify-center overflow-hidden rounded-lg border"
            >
              <img
                :src="imageUrl"
                alt="Original input image"
                class="h-full w-full object-contain"
                @load="rememberImageSize"
              />
              <Badge class="absolute bottom-2 left-2" variant="secondary">
                Original
              </Badge>
            </div>
            <div
              class="bg-background text-muted-foreground z-10 flex h-8 w-8 items-center justify-center rounded-full border shadow-sm"
              aria-label="Original image to mask"
            >
              <ArrowRight class="h-4 w-4" />
            </div>
            <div
              class="bg-background/40 relative flex h-full min-w-0 items-center justify-center overflow-hidden rounded-lg border"
            >
              <img
                :src="maskUrl"
                alt="Inpaint mask"
                class="h-full w-full object-contain"
              />
              <Badge class="absolute bottom-2 left-2" variant="secondary">
                Mask
              </Badge>
            </div>
          </div>
          <div
            v-else
            class="relative flex h-full w-full items-center justify-center"
          >
            <img
              :src="imageUrl"
              alt="Input image preview"
              class="h-full w-full rounded-lg object-contain"
              @load="rememberImageSize"
            />
          </div>

          <!-- Top-Left Badges -->
          <div
            v-if="workflowStore.imageInput.maskName"
            class="absolute top-3 left-3"
          >
            <Badge
              variant="secondary"
              class="border-primary/30 bg-primary/20 text-primary flex items-center gap-1 text-xs"
            >
              <Paintbrush class="h-3 w-3" />
              Mask Applied
            </Badge>
          </div>

          <!-- Action Overlay Buttons -->
          <div
            class="bg-background/80 absolute top-3 right-3 flex items-center gap-1.5 rounded-lg border p-1 shadow-sm backdrop-blur-xs"
          >
            <Button
              v-if="inpaintingEnabled"
              type="button"
              size="sm"
              variant="ghost"
              class="h-7 px-2 text-xs"
              title="Paint Inpaint Mask"
              @click="isMaskPainterOpen = true"
            >
              <Paintbrush class="text-primary mr-1 h-3.5 w-3.5" />
              {{
                workflowStore.imageInput.maskName ? 'Edit Mask' : 'Paint Mask'
              }}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              class="h-7 px-2 text-xs"
              title="Replace Image"
              @click="triggerFilePicker"
            >
              <Upload class="mr-1 h-3.5 w-3.5" />
              Replace
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              class="hover:text-destructive hover:bg-destructive/10 h-7 px-2 text-xs"
              title="Remove Image"
              @click="clearSourceImage"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </div>

          <!-- Loading Overlay -->
          <div
            v-if="isUploading"
            class="bg-background/80 absolute inset-0 flex flex-col items-center justify-center gap-2 backdrop-blur-xs"
          >
            <Loader2 class="text-primary h-6 w-6 animate-spin" />
            <span class="text-xs font-medium">Uploading image...</span>
          </div>
        </div>

        <!-- Empty Dropzone State -->
        <div
          v-else
          class="border-border hover:border-primary/60 hover:bg-muted/30 bg-muted/10 relative flex h-96 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-all"
          :class="
            isDragging && 'border-primary bg-primary/10 ring-primary/30 ring-2'
          "
          @click="triggerFilePicker"
        >
          <div
            v-if="isUploading"
            class="flex flex-col items-center justify-center gap-2"
          >
            <Loader2 class="text-primary h-8 w-8 animate-spin" />
            <span class="text-muted-foreground text-xs font-medium">
              Uploading image...
            </span>
          </div>
          <div v-else class="flex flex-col items-center justify-center gap-2.5">
            <div
              class="bg-muted text-muted-foreground flex h-10 w-10 items-center justify-center rounded-full"
            >
              <ImagePlus class="h-5 w-5" />
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-xs font-semibold">
                Drop input image here or click to browse
              </span>
              <span class="text-muted-foreground text-xs">
                Supports PNG, JPEG, and WebP
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Denoise Control Slider -->
      <div v-if="!inpaintingEnabled" class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <Label
            class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
          >
            Denoise Strength
          </Label>
          <EditableNumberBadge
            v-model="workflowStore.sampler.denoise"
            :min="0"
            :max="1"
            :step="0.05"
            :decimals="2"
            badge-class="text-primary font-mono"
          />
        </div>
        <div class="flex items-center gap-2 pt-1">
          <Slider
            v-model="denoiseModel"
            :min="0"
            :max="1"
            :step="0.01"
            class="w-full"
          />
        </div>
        <p class="text-muted-foreground text-xs">
          Controls how much to transform the original image (0 = no change, 1 =
          complete redraw).
        </p>
      </div>

      <!-- Inpainting Extra Controls -->
      <template v-if="inpaintingEnabled">
        <div class="border-border flex flex-col gap-3 border-t pt-3">
          <!-- Model Patch Select -->
          <div class="flex flex-col gap-1.5">
            <Label
              class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
            >
              Anima LLLite Model Patch
            </Label>
            <Select v-model="workflowStore.imageInput.modelPatch">
              <SelectTrigger class="w-full font-mono text-xs">
                <SelectValue placeholder="Select model patch...">
                  {{ workflowStore.imageInput.modelPatch }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup class="max-h-40 overflow-y-auto">
                  <SelectItem
                    v-for="model in modelPatches"
                    :key="model"
                    :value="model"
                    class="font-mono text-xs"
                  >
                    {{ model }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div
            class="border-border bg-muted/30 flex items-center justify-between rounded-lg border p-2.5"
          >
            <div>
              <Label class="text-xs font-semibold">Enable Turbo</Label>
              <p class="text-muted-foreground text-xs">
                Uses the Anima Turbo LoRA with its own steps and CFG.
              </p>
            </div>
            <Switch
              v-model="workflowStore.imageInput.turboEnabled"
              aria-label="Enable inpainting turbo mode"
            />
          </div>

          <div
            v-if="workflowStore.imageInput.turboEnabled"
            class="flex flex-col gap-1.5"
          >
            <Label
              class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
            >
              Turbo LoRA
            </Label>
            <SearchableSelect
              v-model="workflowStore.imageInput.turboLora"
              :options="comfyStore.availableLoras"
              placeholder="Select turbo LoRA..."
              preview-category="loras"
              grid-title="Select Turbo LoRA"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <Label
                  class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                >
                  {{
                    workflowStore.imageInput.turboEnabled
                      ? 'Turbo Steps'
                      : 'Inpaint Steps'
                  }}
                </Label>
                <EditableNumberBadge
                  v-model="inpaintStepsModel"
                  :min="1"
                  :max="100"
                  :step="1"
                  :decimals="0"
                  badge-class="text-primary font-mono"
                />
              </div>
              <Slider
                v-model="inpaintStepsSliderModel"
                :min="1"
                :max="60"
                :step="1"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <Label
                  class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                >
                  {{
                    workflowStore.imageInput.turboEnabled
                      ? 'Turbo CFG'
                      : 'Inpaint CFG'
                  }}
                </Label>
                <EditableNumberBadge
                  v-model="inpaintCfgModel"
                  :min="0.1"
                  :max="30"
                  :step="0.1"
                  :decimals="1"
                  badge-class="text-primary font-mono"
                />
              </div>
              <Slider
                v-model="inpaintCfgSliderModel"
                :min="0.1"
                :max="10"
                :step="0.1"
              />
            </div>
          </div>

          <!-- LLLite Strength Slider -->
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <Label
                class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
              >
                LLLite Strength
              </Label>
              <EditableNumberBadge
                v-model="workflowStore.imageInput.llliteStrength"
                :min="-10"
                :max="10"
                :step="0.05"
                :decimals="2"
                badge-class="text-primary font-mono"
              />
            </div>
            <div class="flex items-center gap-2 pt-1">
              <Slider
                v-model="llliteStrengthModel"
                :min="-2"
                :max="2"
                :step="0.05"
                class="w-full"
              />
            </div>
          </div>

          <!-- LLLite Timing: Start & End Percent -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <!-- Start Percent -->
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <Label
                  class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                >
                  Start Percent
                </Label>
                <EditableNumberBadge
                  v-model="workflowStore.imageInput.llliteStart"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  :decimals="2"
                  badge-class="text-primary font-mono"
                />
              </div>
              <div class="flex items-center gap-2 pt-1">
                <Slider
                  v-model="llliteStartModel"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  class="w-full"
                />
              </div>
            </div>

            <!-- End Percent -->
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <Label
                  class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                >
                  End Percent
                </Label>
                <EditableNumberBadge
                  v-model="workflowStore.imageInput.llliteEnd"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  :decimals="2"
                  badge-class="text-primary font-mono"
                />
              </div>
              <div class="flex items-center gap-2 pt-1">
                <Slider
                  v-model="llliteEndModel"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  class="w-full"
                />
              </div>
            </div>
          </div>

          <!-- Paint Mask Button & Clear Mask Action -->
          <div class="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              class="flex-1 text-xs font-semibold"
              :disabled="!imageUrl"
              @click="isMaskPainterOpen = true"
            >
              <Paintbrush class="text-primary mr-1.5 h-3.5 w-3.5" />
              {{
                workflowStore.imageInput.maskName
                  ? 'Repaint / Edit Inpaint Mask'
                  : 'Paint Inpaint Mask'
              }}
            </Button>
            <Button
              v-if="workflowStore.imageInput.maskName"
              type="button"
              variant="ghost"
              size="icon"
              class="hover:text-destructive hover:bg-destructive/10 h-8 w-8 shrink-0"
              title="Clear Mask"
              @click="clearMaskOnly"
            >
              <X class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </template>

      <!-- Unavailable Note if inpainting node missing -->
      <div
        v-if="!canInpaint && inpaintingEnabled"
        class="border-border bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-lg border p-2.5 text-xs"
      >
        <AlertCircle class="h-4 w-4 shrink-0 text-amber-400" />
        <span>
          Anima LLLite inpainting nodes are unavailable in this ComfyUI
          installation.
        </span>
      </div>

      <!-- Error Message Banner -->
      <div
        v-if="errorMessage"
        class="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg border p-2.5 text-xs"
      >
        <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
        <span class="flex-1 leading-snug">{{ errorMessage }}</span>
      </div>
    </div>

    <!-- Mask Painter Modal Dialog -->
    <MaskPainterDialog
      v-model:open="isMaskPainterOpen"
      v-model:mask-opacity="maskOpacity"
      :image-url="imageUrl"
      :mask-url="maskUrl"
      @save="saveMask"
    />
  </div>
</template>
