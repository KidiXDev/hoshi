<script setup lang="ts">
import SearchableSelect from '../common/SearchableSelect.vue';
import { computed, watch } from 'vue';
import { ArrowLeftRight, HelpCircle } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import SeedControl from '../common/SeedControl.vue';
import EditableNumberBadge from '../common/EditableNumberBadge.vue';
import WorkflowField from './WorkflowField.vue';
import { useComfyStore } from '../../stores/comfyStore';
import { useWorkflowStore } from '../../stores/workflowStore';

const comfyStore = useComfyStore();
const workflowStore = useWorkflowStore();
const usesInputImage = computed(
  () => workflowStore.imageInput.mode !== 'text2img'
);
const usesInpaintSampler = computed(
  () => workflowStore.imageInput.mode === 'inpaint'
);

const samplerOptions = computed(() => {
  if (comfyStore.availableSamplers.length > 0) {
    return comfyStore.availableSamplers;
  }
  return [
    'er_sde',
    'euler',
    'euler_ancestral',
    'dpmpp_2m',
    'dpmpp_sde',
    'uni_pc'
  ];
});

const schedulerOptions = computed(() => {
  if (comfyStore.availableSchedulers.length > 0) {
    return comfyStore.availableSchedulers;
  }
  return ['simple', 'normal', 'karras', 'exponential', 'sgm_uniform', 'beta'];
});

const resolutionPresets = [
  '832 x 1216 (13:19 Portrait)',
  '1024 x 1024 (1:1 Square)',
  '1216 x 832 (19:13 Landscape)',
  '768 x 1344 (9:16 Mobile Portrait)',
  '1344 x 768 (16:9 Widescreen)',
  '512 x 512 (Standard SD)',
  'Custom'
];

watch(
  () => workflowStore.resolution.preset,
  (preset) => {
    if (preset === 'Custom') {
      workflowStore.resolution.isCustom = true;
      if (!workflowStore.resolution.width)
        workflowStore.resolution.width = 1024;
      if (!workflowStore.resolution.height)
        workflowStore.resolution.height = 1024;
    } else {
      const match = preset.match(/^(\d+)\s*x\s*(\d+)/iu);
      if (match && match[1] && match[2]) {
        workflowStore.resolution.width = Math.trunc(Number(match[1]));
        workflowStore.resolution.height = Math.trunc(Number(match[2]));
        workflowStore.resolution.isCustom = false;
      }
    }
  },
  { immediate: true }
);

function swapCustomDimensions() {
  const temp = workflowStore.resolution.width || 1024;
  workflowStore.resolution.width = workflowStore.resolution.height || 1024;
  workflowStore.resolution.height = temp;
}

const stepsModel = computed({
  get: () => [workflowStore.sampler.steps],
  set: (val: number[]) => {
    if (val && val[0] !== undefined) {
      workflowStore.sampler.steps = val[0];
    }
  }
});

const cfgModel = computed({
  get: () => [workflowStore.sampler.cfg],
  set: (val: number[]) => {
    if (val && val[0] !== undefined) {
      workflowStore.sampler.cfg = Number(val[0].toFixed(1));
    }
  }
});

const batchModel = computed({
  get: () => [workflowStore.resolution.batchSize],
  set: (val: number[]) => {
    if (val && val[0] !== undefined) {
      workflowStore.resolution.batchSize = val[0];
    }
  }
});

const variationStrengthModel = computed({
  get: () => [workflowStore.sampler.variationStrength],
  set: (value: number[]) => {
    if (value && value[0] !== undefined) {
      workflowStore.sampler.variationStrength = Number(value[0].toFixed(2));
    }
  }
});

function setSeedValue(value: string | number) {
  const seed = Number(value);
  if (!Number.isFinite(seed)) return;
  workflowStore.sampler.seed = seed;
  workflowStore.sampler.randomizeSeed = seed === -1;
}
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <!-- Header & Subtitle -->
    <div class="flex flex-col gap-0.5">
      <span
        class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
      >
        Sampling & Canvas
      </span>
      <p class="text-muted-foreground/80 text-xs">
        Tune quality, guidance, output resolution, and seed variation.
      </p>
    </div>

    <!-- Row 1: Steps & CFG Scale Sliders with Badges -->
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <!-- Steps -->
      <WorkflowField label="Steps">
        <template #label-extra>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                class="text-muted-foreground/70 hover:text-foreground"
              >
                <HelpCircle class="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p class="text-xs">Number of denoising iterations</p>
            </TooltipContent>
          </Tooltip>
        </template>
        <template #action>
          <EditableNumberBadge
            v-model="workflowStore.sampler.steps"
            :min="1"
            :max="100"
            :step="1"
            :decimals="0"
            :disabled="usesInpaintSampler"
          />
        </template>
        <div class="flex items-center gap-3 pt-1">
          <Slider
            v-model="stepsModel"
            :min="1"
            :max="60"
            :step="1"
            class="w-full"
            :disabled="usesInpaintSampler"
          />
        </div>
      </WorkflowField>

      <!-- CFG Scale -->
      <WorkflowField label="CFG Scale">
        <template #label-extra>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                class="text-muted-foreground/70 hover:text-foreground"
              >
                <HelpCircle class="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p class="text-xs">Classifier Free Guidance strength</p>
            </TooltipContent>
          </Tooltip>
        </template>
        <template #action>
          <EditableNumberBadge
            v-model="workflowStore.sampler.cfg"
            :min="0.1"
            :max="30.0"
            :step="0.1"
            :decimals="1"
            :disabled="usesInpaintSampler"
          />
        </template>
        <div class="flex items-center gap-3 pt-1">
          <Slider
            v-model="cfgModel"
            :min="0.5"
            :max="15.0"
            :step="0.1"
            class="w-full"
            :disabled="usesInpaintSampler"
          />
        </div>
      </WorkflowField>
    </div>

    <!-- Row 2: Batch Size -->
    <WorkflowField label="Batch Size">
      <template #label-extra>
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              class="text-muted-foreground/70 hover:text-foreground"
            >
              <HelpCircle class="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p class="text-xs">
              Number of parallel images to generate per batch
            </p>
          </TooltipContent>
        </Tooltip>
      </template>
      <template #action>
        <EditableNumberBadge
          v-model="workflowStore.resolution.batchSize"
          :min="1"
          :max="16"
          :step="1"
          :decimals="0"
          :disabled="usesInputImage"
        />
      </template>
      <div class="flex items-center gap-3 pt-1">
        <Slider
          v-model="batchModel"
          :min="1"
          :max="4"
          :step="1"
          class="w-full"
          :disabled="usesInputImage"
        />
      </div>
    </WorkflowField>

    <!-- Row 3: Sampler, Scheduler & Resolution -->
    <div
      class="border-border grid grid-cols-1 gap-3 border-t pt-2.5 sm:grid-cols-3"
    >
      <!-- Sampler Name -->
      <WorkflowField label="Sampler">
        <SearchableSelect
          v-model="workflowStore.sampler.samplerName"
          :options="samplerOptions"
          placeholder="Select sampler..."
          :disabled="!comfyStore.isConnected || usesInpaintSampler"
        />
      </WorkflowField>

      <!-- Scheduler -->
      <WorkflowField label="Scheduler">
        <SearchableSelect
          v-model="workflowStore.sampler.scheduler"
          :options="schedulerOptions"
          placeholder="Select scheduler..."
          :disabled="!comfyStore.isConnected || usesInpaintSampler"
        />
      </WorkflowField>

      <!-- Resolution Preset -->
      <WorkflowField label="Resolution Preset">
        <Select
          v-model="workflowStore.resolution.preset"
          :disabled="usesInputImage"
        >
          <SelectTrigger
            class="w-full font-mono text-xs"
            :disabled="usesInputImage"
          >
            <SelectValue placeholder="Select resolution..." />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup class="max-h-40 overflow-y-auto">
              <SelectItem
                v-for="opt in resolutionPresets"
                :key="opt"
                :value="opt"
                class="font-mono text-xs"
              >
                {{ opt }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </WorkflowField>
    </div>

    <div
      v-if="workflowStore.resolution.preset === 'Custom'"
      class="border-border bg-card/60 flex flex-col gap-2 rounded-lg border p-2.5"
    >
      <div class="flex items-center justify-between">
        <span
          class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
        >
          Custom Canvas Dimensions
        </span>
        <span class="text-primary font-mono text-xs font-semibold">
          {{ workflowStore.resolution.width || 1024 }} ×
          {{ workflowStore.resolution.height || 1024 }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <!-- Width -->
        <div class="flex flex-1 items-center gap-1.5">
          <span class="text-muted-foreground font-mono text-xs font-bold"
            >W</span
          >
          <Input
            v-model.number="workflowStore.resolution.width"
            type="number"
            :min="64"
            :max="4096"
            :step="64"
            class="font-mono text-xs"
            placeholder="Width"
            :disabled="usesInputImage"
          />
        </div>

        <!-- Swap Dimensions Button -->
        <Button
          type="button"
          size="iconSm"
          variant="outline"
          title="Swap Width & Height"
          class="text-muted-foreground hover:text-foreground shrink-0"
          :disabled="usesInputImage"
          @click="swapCustomDimensions"
        >
          <ArrowLeftRight class="h-3.5 w-3.5" />
        </Button>

        <!-- Height -->
        <div class="flex flex-1 items-center gap-1.5">
          <span class="text-muted-foreground font-mono text-xs font-bold"
            >H</span
          >
          <Input
            v-model.number="workflowStore.resolution.height"
            type="number"
            :min="64"
            :max="4096"
            :step="64"
            class="font-mono text-xs"
            placeholder="Height"
            :disabled="usesInputImage"
          />
        </div>
      </div>
    </div>

    <!-- Row 4: Seed & Variation Section -->
    <div class="border-border flex flex-col gap-3 border-t pt-3">
      <!-- Generation Seed -->
      <SeedControl
        :model-value="workflowStore.sampler.seed"
        @update:model-value="setSeedValue"
      />

      <!-- Variation Seed Sub-card -->
      <div
        class="border-border bg-card/60 flex flex-col gap-2.5 rounded-lg border p-2.5"
      >
        <div class="flex items-center justify-between">
          <div>
            <Label
              for="variation-seed-checkbox"
              class="cursor-pointer text-xs font-semibold"
            >
              Variation Seed
            </Label>
          </div>
          <Checkbox
            id="variation-seed-checkbox"
            v-model="workflowStore.sampler.variationEnabled"
          />
        </div>

        <div
          v-if="workflowStore.sampler.variationEnabled"
          class="border-border flex flex-col gap-2.5 border-t pt-2"
        >
          <SeedControl
            v-model="workflowStore.sampler.variationSeed"
            label="Variation Seed"
            :disabled="!workflowStore.sampler.variationEnabled"
          />

          <WorkflowField label="Variation Strength">
            <template #action>
              <EditableNumberBadge
                v-model="workflowStore.sampler.variationStrength"
                :min="0.0"
                :max="1.0"
                :step="0.01"
                :decimals="2"
                badge-class="text-primary"
              />
            </template>
            <div class="flex items-center gap-3 pt-1">
              <Slider
                v-model="variationStrengthModel"
                :min="0"
                :max="1"
                :step="0.01"
                aria-label="Variation strength"
                class="w-full"
              />
            </div>
          </WorkflowField>
        </div>
      </div>
    </div>
  </div>
</template>
