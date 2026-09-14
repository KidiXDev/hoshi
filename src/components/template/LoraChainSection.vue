<script setup lang="ts">
import SearchableSelect from '../common/SearchableSelect.vue';
import { computed, ref } from 'vue';
import type { LoraItem } from '@/types/workflow';
import {
  ChevronDown,
  ChevronUp,
  FolderOpen,
  LayoutGrid,
  Plus,
  Trash2,
  X,
  Zap
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import EditableNumberBadge from '../common/EditableNumberBadge.vue';
import LoraPresetDialog from '../common/LoraPresetDialog.vue';
import ModelGridSelectorDialog from '../common/ModelGridSelectorDialog.vue';
import LoraTriggerWords from './LoraTriggerWords.vue';
import { ComfyApi } from '../../services/comfyApi';
import { appendPromptTerms, removePromptTerm } from '../../utils/promptTools';
import { useComfyStore } from '../../stores/comfyStore';
import { useLauncherStore } from '../../stores/launcherStore';
import { useWorkflowStore } from '../../stores/workflowStore';

const comfyStore = useComfyStore();
const launcherStore = useLauncherStore();
const workflowStore = useWorkflowStore();
const stack = defineModel<LoraItem[]>('loras');
const loras = computed({
  get: () => stack.value ?? workflowStore.loras,
  set: (value) => {
    if (stack.value === undefined) workflowStore.loras = value;
    else stack.value = value;
  }
});
// Prompt that trigger words are inserted into. Consumers with their own prompt
// (Upscaler, Face Detailer) bind it; the generator falls back to the store.
const promptModel = defineModel<string>('positivePrompt');
const positivePrompt = computed({
  get: () => promptModel.value ?? workflowStore.positivePrompt,
  set: (value) => {
    if (promptModel.value === undefined) workflowStore.positivePrompt = value;
    else promptModel.value = value;
  }
});

function insertTriggerWords(words: string[]) {
  positivePrompt.value = appendPromptTerms(positivePrompt.value, words);
}

function removeTriggerWord(word: string) {
  positivePrompt.value = removePromptTerm(positivePrompt.value, word);
}

const isLoraPresetManagerOpen = ref(false);
const isLoraGridOpen = ref(false);
const editingLoraIndex = ref<number | null>(null);
const failedImageSet = ref(new Set<string>());

const loraOptions = computed(() => {
  if (comfyStore.availableLoras.length > 0) {
    return comfyStore.availableLoras;
  }
  return loras.value.map((lora) => lora.name).filter(Boolean);
});

function openLoraGrid(index?: number) {
  hovered.value = null;
  editingLoraIndex.value = index === undefined ? null : index;
  isLoraGridOpen.value = true;
}

function handleLoraSelect(model: string) {
  if (editingLoraIndex.value !== null && loras.value[editingLoraIndex.value]) {
    loras.value[editingLoraIndex.value].name = model;
  } else {
    workflowStore.addLora(model, 0.8, loras.value);
  }
}

function getLoraPreviewUrl(name: string, res = 200): string {
  return ComfyApi.getModelPreviewUrl(
    launcherStore.config.serverUrl,
    'loras',
    name,
    res
  );
}

// Floating preview on thumbnail hover — same geometry as SearchableSelect
const PREVIEW_W = 180;
const PREVIEW_H = 240;
const hovered = ref<{ name: string; x: number; y: number } | null>(null);

function showPreview(name: string, event: PointerEvent) {
  if (failedImageSet.value.has(name)) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const fitsRight = rect.right + 8 + PREVIEW_W <= window.innerWidth;
  hovered.value = {
    name,
    x: fitsRight ? rect.right + 8 : rect.left - 8 - PREVIEW_W,
    y: Math.min(rect.top, window.innerHeight - PREVIEW_H - 8)
  };
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Header Controls -->
    <div
      class="border-border flex flex-wrap items-center justify-between gap-2 border-b pb-2"
    >
      <div class="flex items-center gap-2">
        <span
          class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
        >
          LoRA Stack
        </span>
        <span
          v-if="comfyStore.isConnected"
          class="border-border bg-muted text-foreground rounded-md border px-2 py-0.5 font-mono text-xs font-bold"
        >
          {{ loras.filter((l) => l.enabled).length }} /
          {{ loras.length }}
        </span>
        <span
          v-else
          class="border-border bg-muted text-muted-foreground/80 rounded border px-2 py-0.5 font-mono text-xs font-semibold"
        >
          LOCKED
        </span>
      </div>

      <div class="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          :disabled="!comfyStore.isConnected"
          class="border-border bg-secondary text-foreground hover:bg-accent px-2 py-1 text-xs"
          title="Browse LoRAs in Grid View"
          @click="openLoraGrid()"
        >
          <LayoutGrid class="h-3 w-3" />
          <span>Browse</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          :disabled="!comfyStore.isConnected"
          class="border-border bg-secondary text-foreground hover:bg-accent px-2 py-1 text-xs"
          title="Manage LoRA Presets"
          @click="isLoraPresetManagerOpen = true"
        >
          <FolderOpen class="h-3 w-3" />
          <span>Presets</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          :disabled="!comfyStore.isConnected"
          class="border-border bg-secondary text-foreground hover:bg-accent px-2 py-1 text-xs"
          @click="workflowStore.addLora('', 0.8, loras)"
        >
          <Plus class="h-3 w-3" />
          <span>Add LoRA</span>
        </Button>
      </div>
    </div>

    <!-- Custom Presets Bar if available -->
    <div
      v-if="workflowStore.customPresets.length > 0"
      class="flex flex-wrap items-center gap-1.5"
    >
      <span class="text-muted-foreground text-xs font-medium">Presets:</span>
      <div
        v-for="preset in workflowStore.customPresets"
        :key="preset.id"
        class="border-border bg-muted text-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs"
      >
        <button
          type="button"
          :disabled="!comfyStore.isConnected"
          class="hover:text-primary cursor-pointer font-medium hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          @click="workflowStore.loadCustomPreset(preset.id, loras)"
        >
          {{ preset.name }}
        </button>
        <button
          type="button"
          :disabled="!comfyStore.isConnected"
          class="text-muted-foreground hover:text-destructive ml-0.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          @click="workflowStore.deleteCustomPreset(preset.id)"
        >
          <X class="h-2.5 w-2.5" />
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="loras.length === 0"
      class="border-border bg-muted/20 flex flex-col items-center justify-center rounded-xl border border-dashed py-8 text-center"
    >
      <div
        class="bg-muted text-muted-foreground mb-2 flex h-10 w-10 items-center justify-center rounded-full"
      >
        <Zap class="h-5 w-5 opacity-40" />
      </div>
      <span class="text-muted-foreground text-xs font-semibold">
        No LoRAs Loaded
      </span>
      <p class="text-muted-foreground/70 mt-0.5 text-xs">
        {{
          comfyStore.isConnected
            ? 'Add a LoRA or load one of your saved presets.'
            : 'Connect ComfyUI server to load and manage LoRAs.'
        }}
      </p>
      <div class="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          :disabled="!comfyStore.isConnected"
          class="border-border text-xs"
          @click="openLoraGrid()"
        >
          <LayoutGrid class="mr-1.5 h-3.5 w-3.5" />
          Browse Library
        </Button>
      </div>
    </div>

    <!-- LoRA Items List -->
    <div v-else class="flex flex-col gap-2">
      <div
        v-for="(lora, index) in loras"
        :key="lora.id"
        class="border-border bg-card/60 relative flex flex-col gap-2 rounded-xl border p-2.5 transition-all"
        :class="{ 'opacity-50': !lora.enabled || !comfyStore.isConnected }"
      >
        <!-- Top Row: Order, Checkbox, Select, Actions -->
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span
              class="text-muted-foreground w-4 text-center font-mono text-xs font-bold"
            >
              #{{ index + 1 }}
            </span>
            <Checkbox
              v-model="lora.enabled"
              :disabled="!comfyStore.isConnected"
            />
            <!-- LoRA Thumbnail Avatar -->
            <div
              v-if="lora.name"
              class="border-border bg-muted relative h-7 w-7 shrink-0 overflow-hidden rounded-md border"
              :class="
                comfyStore.isConnected
                  ? 'cursor-pointer'
                  : 'cursor-not-allowed opacity-60'
              "
              :title="
                comfyStore.isConnected
                  ? 'Click to browse in grid'
                  : 'Connect ComfyUI server to browse'
              "
              @click="comfyStore.isConnected && openLoraGrid(index)"
              @pointerenter="showPreview(lora.name, $event)"
              @pointerleave="hovered = null"
            >
              <img
                v-if="!failedImageSet.has(lora.name)"
                :src="getLoraPreviewUrl(lora.name, 200)"
                :alt="lora.name"
                loading="lazy"
                decoding="async"
                class="h-full w-full object-cover"
                @error="failedImageSet.add(lora.name)"
              />
              <div
                v-else
                class="text-muted-foreground flex h-full w-full items-center justify-center text-xs"
              >
                <Zap class="text-primary h-3 w-3 opacity-60" />
              </div>
            </div>

            <!-- LoRA Selector -->
            <SearchableSelect
              v-model="lora.name"
              :options="loraOptions"
              placeholder="Choose LoRA model..."
              preview-category="loras"
              grid-title="Select LoRA Model"
              :disabled="!comfyStore.isConnected"
            />
          </div>

          <!-- Reorder & Delete -->
          <div class="flex shrink-0 items-center gap-0.5">
            <Button
              size="iconSm"
              variant="ghost"
              :disabled="!comfyStore.isConnected || index === 0"
              class="text-muted-foreground hover:text-foreground"
              @click="workflowStore.moveLora(index, 'up', loras)"
            >
              <ChevronUp class="h-3.5 w-3.5" />
            </Button>
            <Button
              size="iconSm"
              variant="ghost"
              :disabled="!comfyStore.isConnected || index === loras.length - 1"
              class="text-muted-foreground hover:text-foreground"
              @click="workflowStore.moveLora(index, 'down', loras)"
            >
              <ChevronDown class="h-3.5 w-3.5" />
            </Button>
            <Button
              size="iconSm"
              variant="ghost"
              :disabled="!comfyStore.isConnected"
              class="text-muted-foreground hover:text-destructive"
              @click="workflowStore.removeLora(lora.id, loras)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <!-- Weight Slider Row -->
        <div
          class="border-border/60 flex items-center gap-3 border-t px-1 pt-1.5"
        >
          <span class="text-muted-foreground shrink-0 text-xs font-medium"
            >Weight:</span
          >
          <Slider
            :model-value="[lora.strength]"
            :min="-1.5"
            :max="2.0"
            :step="0.05"
            :disabled="!comfyStore.isConnected"
            class="flex-1"
            @update:model-value="
              (val: number[] | undefined) => {
                if (val && val[0] !== undefined)
                  lora.strength = Number(val[0].toFixed(2));
              }
            "
          />
          <EditableNumberBadge
            v-model="lora.strength"
            :min="-3.0"
            :max="3.0"
            :step="0.05"
            :decimals="2"
            :disabled="!comfyStore.isConnected"
            badge-class="text-primary min-w-11 text-right"
          />
        </div>

        <!-- Trigger Words (from Civitai sidecar / safetensors header) -->
        <LoraTriggerWords
          :lora-name="lora.name"
          :prompt="positivePrompt"
          :disabled="!lora.enabled"
          @insert="insertTriggerWords"
          @remove="removeTriggerWord"
        />
      </div>
    </div>

    <!-- LoRA Stack Preset Manager Dialog -->
    <LoraPresetDialog
      v-model:open="isLoraPresetManagerOpen"
      v-model:loras="loras"
    />

    <!-- Grid View LoRA Selector Dialog -->
    <ModelGridSelectorDialog
      v-model:open="isLoraGridOpen"
      title="Select LoRA Model"
      category="loras"
      :models="loraOptions"
      :selected-model="
        editingLoraIndex !== null ? loras[editingLoraIndex]?.name || '' : ''
      "
      @select="handleLoraSelect"
    />

    <!-- Floating hover preview -->
    <Teleport defer to="#app-content">
      <div
        v-if="hovered"
        class="border-border bg-popover pointer-events-none fixed z-60 overflow-hidden rounded-md border shadow-lg"
        :style="{
          left: `${hovered.x}px`,
          top: `${hovered.y}px`,
          width: `${PREVIEW_W}px`,
          height: `${PREVIEW_H}px`
        }"
      >
        <img
          :key="hovered.name"
          :src="getLoraPreviewUrl(hovered.name, 300)"
          :alt="hovered.name"
          decoding="async"
          class="h-full w-full object-cover"
        />
      </div>
    </Teleport>
  </div>
</template>
