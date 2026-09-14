<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  AlertCircle,
  Check,
  Copy,
  ImagePlus,
  Loader2,
  Plus,
  Replace,
  Sparkles,
  Tags,
  Trash2,
  Upload
} from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import EditableNumberBadge from '../common/EditableNumberBadge.vue';
import { ComfyApi } from '../../services/comfyApi';
import { useComfyStore } from '../../stores/comfyStore';
import { useLauncherStore } from '../../stores/launcherStore';
import { useWorkflowStore } from '../../stores/workflowStore';

const TAGGER_MODELS = [
  'wd-eva02-large-tagger-v3',
  'wd-vit-large-tagger-v3',
  'wd-vit-tagger-v3',
  'wd-swinv2-tagger-v3',
  'wd-convnext-tagger-v3',
  'pixai-tagger-v0.9-timm',
  'OppaiOracle-V1.1-timm'
];
const IMAGE_FILE_NAME = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/iu;

const comfyStore = useComfyStore();
const launcherStore = useLauncherStore();
const workflowStore = useWorkflowStore();

const isAvailable = ref(false);
const isUploading = ref(false);
const isTagging = ref(false);
const imageName = ref('');
const modelName = ref(TAGGER_MODELS[0]);
const generalThreshold = ref(0.35);
const characterThreshold = ref(0.75);
const addRating = ref(false);
const excludeTags = ref('');
const output = ref('');
const errorMessage = ref('');
const isCopied = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

const imageUrl = computed(() =>
  imageName.value
    ? ComfyApi.getViewImageUrl(
        launcherStore.config.serverUrl,
        imageName.value,
        '',
        'input'
      )
    : ''
);

const tagCount = computed(() => {
  if (!output.value.trim()) return 0;
  return output.value.split(',').filter((t) => t.trim().length > 0).length;
});

const generalThresholdModel = computed({
  get: () => [generalThreshold.value],
  set: (val: number[]) => {
    if (val && val[0] !== undefined) {
      generalThreshold.value = Number(val[0].toFixed(2));
    }
  }
});

const characterThresholdModel = computed({
  get: () => [characterThreshold.value],
  set: (val: number[]) => {
    if (val && val[0] !== undefined) {
      characterThreshold.value = Number(val[0].toFixed(2));
    }
  }
});

onMounted(checkAvailability);
watch(
  () => comfyStore.isConnected,
  (connected) => connected && checkAvailability()
);

async function checkAvailability() {
  isAvailable.value =
    (await ComfyApi.fetchNodeInfo(
      launcherStore.config.serverUrl,
      'WDTimmTagger'
    )) !== null;
}

function triggerFilePicker() {
  fileInputRef.value?.click();
}

async function uploadImage(file?: File) {
  if (
    !file ||
    (!file.type.startsWith('image/') && !IMAGE_FILE_NAME.test(file.name))
  ) {
    errorMessage.value = 'Please drop an image file.';
    return;
  }
  isUploading.value = true;
  errorMessage.value = '';
  output.value = '';
  try {
    const extension = file.name.match(/\.[^.]+$/u)?.[0] || '.png';
    const uploaded = await ComfyApi.uploadImage(
      launcherStore.config.serverUrl,
      file,
      `koharu-tagger-${crypto.randomUUID()}${extension}`
    );
    imageName.value = uploaded.name;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    isUploading.value = false;
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

async function handleDrop(event: DragEvent) {
  const transfer = event.dataTransfer;
  const file =
    transfer?.files[0] ??
    Array.from(transfer?.items ?? [])
      .find((item) => item.kind === 'file')
      ?.getAsFile();

  if (file) {
    await uploadImage(file);
    return;
  }

  const droppedUrl = transfer
    ?.getData('text/uri-list')
    .split(/\r?\n/u)
    .find((url) => url && !url.startsWith('#'));
  if (!droppedUrl) return;

  try {
    const response = await fetch(droppedUrl);
    if (!response.ok)
      throw new Error(`Could not read dropped image (${response.status}).`);
    const image = await response.blob();
    const filename =
      droppedUrl.split('/').pop()?.split('?')[0] || 'dropped-image.png';
    await uploadImage(new File([image], filename, { type: image.type }));
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function clearImage() {
  imageName.value = '';
  output.value = '';
  errorMessage.value = '';
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
}

async function analyzeImage() {
  if (!imageName.value) return;
  isTagging.value = true;
  errorMessage.value = '';
  try {
    output.value = await ComfyApi.runWdTagger(
      launcherStore.config.serverUrl,
      imageName.value,
      {
        modelName: modelName.value,
        generalThreshold: generalThreshold.value,
        characterThreshold: characterThreshold.value,
        addRating: addRating.value,
        excludeTags: excludeTags.value
      }
    );
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    isTagging.value = false;
  }
}

function applyTags(append: boolean) {
  if (!output.value) return;
  workflowStore.positivePrompt =
    append && workflowStore.positivePrompt.trim()
      ? `${workflowStore.positivePrompt.trimEnd()}, ${output.value}`
      : output.value;
}

async function copyTags() {
  if (!output.value) return;
  try {
    await navigator.clipboard.writeText(output.value);
    isCopied.value = true;
    setTimeout(() => {
      isCopied.value = false;
    }, 1500);
  } catch (err) {
    console.error('Failed to copy tags to clipboard', err);
  }
}
</script>

<template>
  <Accordion type="single" collapsible class="w-full">
    <AccordionItem value="wd-tagger" class="border-none">
      <AccordionTrigger
        class="hover:bg-accent rounded-lg px-3 py-2.5 hover:no-underline"
      >
        <!-- Header: Title, Description & Status Badge -->
        <div class="flex w-full items-center justify-between pr-3">
          <div class="flex items-center gap-2">
            <div
              class="bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-lg"
            >
              <Tags class="h-4 w-4" />
            </div>
            <div>
              <h3 class="text-xs font-bold tracking-wider uppercase">
                WD Tagger
              </h3>
              <p class="text-muted-foreground text-xs">
                Reverse an image into prompt tags
              </p>
            </div>
          </div>

          <Badge
            v-if="!isAvailable"
            variant="outline"
            class="border-border bg-muted text-muted-foreground font-mono text-xs"
          >
            <span
              class="bg-muted-foreground/60 mr-1.5 h-1.5 w-1.5 rounded-full"
            />
            UNAVAILABLE
          </Badge>
        </div>
      </AccordionTrigger>

      <AccordionContent class="px-1 pt-2">
        <div class="flex flex-col gap-3">
          <!-- Image Upload Area & Dropzone -->
          <div
            class="flex flex-col gap-2"
            @dragover="handleDragOver"
            @drop.prevent="handleDrop"
          >
            <input
              ref="fileInputRef"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="sr-only"
              @change="
                uploadImage(($event.target as HTMLInputElement).files?.[0])
              "
            />

            <!-- Image Preview State -->
            <div
              v-if="imageUrl"
              class="border-border bg-muted/20 relative flex min-h-48 flex-col items-center justify-center overflow-hidden rounded-xl border p-2"
            >
              <img
                :src="imageUrl"
                alt="WD Tagger input preview"
                class="max-h-52 w-full rounded-lg object-contain"
              />

              <!-- Action Overlay Buttons -->
              <div
                class="bg-background/80 absolute top-3 right-3 flex items-center gap-1.5 rounded-lg border p-1 shadow-sm backdrop-blur-xs"
              >
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
                  @click="clearImage"
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
              <div
                v-else
                class="flex flex-col items-center justify-center gap-2.5"
              >
                <div
                  class="bg-muted text-muted-foreground flex h-10 w-10 items-center justify-center rounded-full"
                >
                  <ImagePlus class="h-5 w-5" />
                </div>
                <div class="flex flex-col gap-0.5">
                  <span class="text-xs font-semibold">
                    Drop an image here or click to browse
                  </span>
                  <span class="text-muted-foreground text-xs">
                    Supports PNG, JPEG, and WebP
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Model Selector -->
          <div class="flex flex-col gap-1.5">
            <Label
              class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
            >
              Tagger Model
            </Label>
            <Select v-model="modelName">
              <SelectTrigger class="w-full font-mono text-xs">
                <SelectValue placeholder="Select tagger model...">
                  {{ modelName }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup class="max-h-40 overflow-y-auto">
                  <SelectItem
                    v-for="model in TAGGER_MODELS"
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

          <!-- Threshold Controls: General & Character -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <!-- General Threshold -->
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <Label
                  class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                >
                  General Threshold
                </Label>
                <EditableNumberBadge
                  v-model="generalThreshold"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  :decimals="2"
                  badge-class="text-primary font-mono"
                />
              </div>
              <div class="flex items-center gap-2 pt-1">
                <Slider
                  v-model="generalThresholdModel"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  class="w-full"
                />
              </div>
            </div>

            <!-- Character Threshold -->
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <Label
                  class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                >
                  Character Threshold
                </Label>
                <EditableNumberBadge
                  v-model="characterThreshold"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  :decimals="2"
                  badge-class="text-primary font-mono"
                />
              </div>
              <div class="flex items-center gap-2 pt-1">
                <Slider
                  v-model="characterThresholdModel"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  class="w-full"
                />
              </div>
            </div>
          </div>

          <!-- Exclude Tags -->
          <div class="flex flex-col gap-1.5">
            <Label
              class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
            >
              Exclude Tags
            </Label>
            <Input
              v-model="excludeTags"
              placeholder="e.g. rating:explicit, watermark, text"
              class="font-mono text-xs"
            />
          </div>

          <!-- Include Rating Tag Option -->
          <div class="flex items-center gap-2">
            <Checkbox
              id="wd-tagger-rating"
              :checked="addRating"
              @update:checked="(val: boolean) => (addRating = val)"
            />
            <Label
              for="wd-tagger-rating"
              class="hover:text-foreground text-muted-foreground cursor-pointer text-xs transition-colors"
            >
              Include rating tag (e.g. rating:general, rating:sensitive)
            </Label>
          </div>

          <!-- Analyze Button -->
          <Button
            type="button"
            :disabled="!isAvailable || !imageUrl || isTagging"
            class="w-full font-semibold shadow-xs"
            @click="analyzeImage"
          >
            <Loader2 v-if="isTagging" class="mr-2 h-4 w-4 animate-spin" />
            <Sparkles v-else class="mr-2 h-4 w-4" />
            {{ isTagging ? 'Analyzing Image...' : 'Analyze Image' }}
          </Button>

          <!-- Results Section -->
          <div
            v-if="output"
            class="border-border bg-card/60 flex flex-col gap-2 rounded-xl border p-3"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Label
                  class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                >
                  Detected Tags
                </Label>
                <Badge variant="secondary" class="font-mono text-xs">
                  {{ tagCount }} tags
                </Badge>
              </div>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                class="h-7 px-2 text-xs"
                @click="copyTags"
              >
                <Check
                  v-if="isCopied"
                  class="mr-1 h-3.5 w-3.5 text-emerald-400"
                />
                <Copy v-else class="mr-1 h-3.5 w-3.5" />
                {{ isCopied ? 'Copied' : 'Copy' }}
              </Button>
            </div>

            <Textarea
              v-model="output"
              rows="4"
              class="bg-background/50 font-mono text-xs leading-relaxed"
              placeholder="Extracted tags will appear here..."
            />

            <div class="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="text-xs"
                @click="applyTags(true)"
              >
                <Plus class="mr-1.5 h-3.5 w-3.5" />
                Append to Prompt
              </Button>
              <Button
                type="button"
                size="sm"
                class="text-xs"
                @click="applyTags(false)"
              >
                <Replace class="mr-1.5 h-3.5 w-3.5" />
                Replace Prompt
              </Button>
            </div>
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
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</template>
