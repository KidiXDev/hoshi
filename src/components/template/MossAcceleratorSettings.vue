<script setup lang="ts">
import { computed } from 'vue';
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
import { Switch } from '@/components/ui/switch';
import AdvancedToggleCard from './AdvancedToggleCard.vue';
import WorkflowField from './WorkflowField.vue';
import { useComfyStore } from '../../stores/comfyStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { MossSettings } from '../../types/workflow';

interface NumberField {
  key:
    | 'mgCacheAlpha'
    | 'mgCacheBeta'
    | 'mgCacheImportanceStride'
    | 'guidanceIntervalStart'
    | 'guidanceIntervalEnd'
    | 'progressiveScale'
    | 'progressiveFraction';
  label: string;
  min: number;
  max: number;
  step: number;
}

const NO_CALIBRATION = 'none';

const MG_CACHE_MODES: Array<{
  value: MossSettings['mgCacheMode'];
  label: string;
}> = [
  { value: 'cache', label: 'Cache' },
  { value: 'calibrate', label: 'Calibrate' }
];

const MG_CACHE_BUDGET_FIELDS: NumberField[] = [
  { key: 'mgCacheAlpha', label: 'Alpha', min: 0, max: 10, step: 0.01 },
  { key: 'mgCacheBeta', label: 'Beta', min: 0, max: 10, step: 0.01 }
];

const MG_CACHE_STRIDE_FIELD: NumberField = {
  key: 'mgCacheImportanceStride',
  label: 'Importance Stride',
  min: 0,
  max: 1000,
  step: 1
};

const GUIDANCE_INTERVAL_FIELDS: NumberField[] = [
  {
    key: 'guidanceIntervalStart',
    label: 'Start Percent',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'guidanceIntervalEnd',
    label: 'End Percent',
    min: 0,
    max: 1,
    step: 0.01
  }
];

const PROGRESSIVE_FIELDS: NumberField[] = [
  { key: 'progressiveScale', label: 'Scale', min: 0.1, max: 1, step: 0.05 },
  {
    key: 'progressiveFraction',
    label: 'Low Resolution Fraction',
    min: 0,
    max: 1,
    step: 0.05
  }
];

const BOOSTER_TOGGLES: Array<{
  key: 'boosterBakeLora' | 'boosterInt8Attention';
  id: string;
  label: string;
  description: string;
}> = [
  {
    key: 'boosterBakeLora',
    id: 'moss-booster-bake-lora',
    label: 'Bake LoRAs',
    description: 'Merge the LoRAs into the weights once'
  },
  {
    key: 'boosterInt8Attention',
    id: 'moss-booster-int8-attention',
    label: 'INT8 Attention',
    description: 'About 2.5x faster attention on the diffusion model'
  }
];

const comfyStore = useComfyStore();
const workflowStore = useWorkflowStore();

const isCalibrating = computed(
  () => workflowStore.moss.mgCacheMode === 'calibrate'
);
const mgCacheFields = computed(() =>
  isCalibrating.value ? [MG_CACHE_STRIDE_FIELD] : MG_CACHE_BUDGET_FIELDS
);
const calibrationOptions = computed(() => [
  ...new Set([
    NO_CALIBRATION,
    workflowStore.moss.mgCacheCalibration,
    ...comfyStore.mgCacheCalibrations
  ])
]);
</script>

<template>
  <!-- MOSS Booster -->
  <AdvancedToggleCard
    id="moss-booster-enabled"
    v-model="workflowStore.moss.boosterEnabled"
    label="MOSS Booster"
    description="Bakes LoRAs once and runs INT8 attention"
    help="Baking merges the LoRAs into the weights once per change, so each step skips the per-layer patch; the image is identical and the merged copy uses about 5 GB of system RAM. INT8 attention needs an RTX 20-series or newer and moves small details slightly. Stacks with Spectrum."
    :disabled="!comfyStore.isConnected"
  >
    <div
      v-for="toggle in BOOSTER_TOGGLES"
      :key="toggle.key"
      class="border-border bg-muted/30 flex items-center justify-between rounded-lg border p-2.5 sm:col-span-2"
    >
      <div class="flex flex-col gap-0.5">
        <Label
          :for="toggle.id"
          class="text-foreground cursor-pointer text-xs font-medium"
        >
          {{ toggle.label }}
        </Label>
        <p class="text-muted-foreground text-xs">{{ toggle.description }}</p>
      </div>
      <Switch :id="toggle.id" v-model="workflowStore.moss[toggle.key]" />
    </div>

    <WorkflowField
      v-if="workflowStore.moss.boosterInt8Attention"
      label="INT8 Start Percent"
    >
      <Input
        v-model.number="workflowStore.moss.boosterInt8StartPercent"
        type="number"
        :min="0"
        :max="1"
        :step="0.01"
        class="font-mono text-xs"
      />
    </WorkflowField>
  </AdvancedToggleCard>

  <!-- MG-Cache -->
  <AdvancedToggleCard
    id="moss-mg-cache-enabled"
    v-model="workflowStore.moss.mgCacheEnabled"
    label="MG-Cache"
    description="Roughly 1.5x faster sampling"
    help="Alpha skips whole model calls while the output barely drifts; 0.05 to 0.1 keeps the picture. Beta reuses transformer blocks and degrades MOSS-Image without a layer-importance calibration, so leave it at 0."
    :disabled="!comfyStore.isConnected"
  >
    <WorkflowField label="Mode">
      <Select v-model="workflowStore.moss.mgCacheMode">
        <SelectTrigger class="w-full font-mono text-xs">
          <SelectValue placeholder="Select mode..." />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup class="max-h-40 overflow-y-auto">
            <SelectItem
              v-for="mode in MG_CACHE_MODES"
              :key="mode.value"
              :value="mode.value"
              class="font-mono text-xs"
            >
              {{ mode.label }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </WorkflowField>

    <WorkflowField v-if="isCalibrating" label="Calibration Name">
      <Input
        v-model="workflowStore.moss.mgCacheCalibrationName"
        placeholder="moss_image"
        class="font-mono text-xs"
      />
    </WorkflowField>

    <WorkflowField v-else label="Calibration">
      <Select v-model="workflowStore.moss.mgCacheCalibration">
        <SelectTrigger class="w-full font-mono text-xs">
          <SelectValue placeholder="Select calibration..." />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup class="max-h-40 overflow-y-auto">
            <SelectItem
              v-for="calibration in calibrationOptions"
              :key="calibration"
              :value="calibration"
              class="font-mono text-xs"
            >
              {{ calibration }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </WorkflowField>

    <WorkflowField
      v-for="field in mgCacheFields"
      :key="field.key"
      :label="field.label"
    >
      <Input
        v-model.number="workflowStore.moss[field.key]"
        type="number"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        class="font-mono text-xs"
      />
    </WorkflowField>

    <p v-if="isCalibrating" class="text-muted-foreground text-xs sm:col-span-2">
      The next generation runs uncached and records this calibration. A stride
      above 0 also profiles layer importance, one extra model call per block on
      every profiled step. Switch back to Cache to use the file.
    </p>

    <div
      v-else
      class="border-border bg-muted/30 flex items-center justify-between rounded-lg border p-2.5 sm:col-span-2"
    >
      <div class="flex flex-col gap-0.5">
        <Label
          for="moss-mg-cache-forecast"
          class="text-foreground cursor-pointer text-xs font-medium"
        >
          Forecast
        </Label>
        <p class="text-muted-foreground text-xs">
          Extrapolate skipped calls from the last two computed ones
        </p>
      </div>
      <Switch
        id="moss-mg-cache-forecast"
        v-model="workflowStore.moss.mgCacheForecast"
      />
    </div>
  </AdvancedToggleCard>

  <!-- Text Embedder Cache -->
  <AdvancedToggleCard
    id="moss-text-embedder-cache-enabled"
    v-model="workflowStore.moss.textEmbedderCacheEnabled"
    label="Text Embedder Cache"
    description="Encodes each prompt once per run, identical image"
    :disabled="!comfyStore.isConnected"
  />

  <!-- Guidance Interval -->
  <AdvancedToggleCard
    id="moss-guidance-interval-enabled"
    v-model="workflowStore.moss.guidanceIntervalEnabled"
    label="Guidance Interval"
    description="Skips the negative prompt outside the interval"
    help="CFG only runs between start and end of the schedule; the other steps cost half. An end of 1 keeps CFG on every step. Applies to the main sampling pass."
    :disabled="!comfyStore.isConnected"
  >
    <WorkflowField
      v-for="field in GUIDANCE_INTERVAL_FIELDS"
      :key="field.key"
      :label="field.label"
    >
      <Input
        v-model.number="workflowStore.moss[field.key]"
        type="number"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        class="font-mono text-xs"
      />
    </WorkflowField>
  </AdvancedToggleCard>

  <!-- Progressive Resolution -->
  <AdvancedToggleCard
    id="moss-progressive-enabled"
    v-model="workflowStore.moss.progressiveEnabled"
    label="Progressive Resolution"
    description="Runs the first steps on a smaller latent"
    help="The low resolution stage draws its own noise, so a seed gives a different composition than it does with this off."
    :disabled="!comfyStore.isConnected"
  >
    <WorkflowField
      v-for="field in PROGRESSIVE_FIELDS"
      :key="field.key"
      :label="field.label"
    >
      <Input
        v-model.number="workflowStore.moss[field.key]"
        type="number"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        class="font-mono text-xs"
      />
    </WorkflowField>
  </AdvancedToggleCard>
</template>
