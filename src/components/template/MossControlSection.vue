<script setup lang="ts">
import { AlertCircle, Layers } from '@lucide/vue';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import EditableNumberBadge from '../common/EditableNumberBadge.vue';
import SearchableSelect from '../common/SearchableSelect.vue';
import ControlMapInput from './ControlMapInput.vue';
import WorkflowField from './WorkflowField.vue';
import { useComfyStore } from '../../stores/comfyStore';
import { useWorkflowStore } from '../../stores/workflowStore';

type ControlSliderKey =
  'controlStrength' | 'controlStartPercent' | 'controlEndPercent';

const CONTROL_SLIDERS: { key: ControlSliderKey; label: string; max: number }[] =
  [
    { key: 'controlStrength', label: 'Strength', max: 2 },
    { key: 'controlStartPercent', label: 'Start Percent', max: 1 },
    { key: 'controlEndPercent', label: 'End Percent', max: 1 }
  ];

const comfyStore = useComfyStore();
const workflowStore = useWorkflowStore();

function updateSlider(key: ControlSliderKey, value?: number[]) {
  if (value?.[0] !== undefined) {
    workflowStore.moss[key] = Number(value[0].toFixed(2));
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div
          class="bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-lg"
        >
          <Layers class="h-4 w-4" />
        </div>
        <div>
          <h3 class="text-xs font-bold tracking-wider uppercase">
            Color / Depth Control
          </h3>
          <p class="text-muted-foreground text-xs">
            Guide the layout with a color region map, a depth map, or both
          </p>
        </div>
      </div>
      <Switch
        v-model="workflowStore.moss.controlEnabled"
        aria-label="Enable color and depth control"
      />
    </div>

    <div
      v-if="workflowStore.moss.controlEnabled"
      class="border-border bg-card/40 flex flex-col gap-3 rounded-xl border p-3"
    >
      <WorkflowField label="Control Adapter">
        <SearchableSelect
          v-model="workflowStore.moss.controlAdapter"
          :options="comfyStore.availableLoras"
          placeholder="Select adapter..."
          preview-category="loras"
          grid-title="Select MOSS Control Adapter"
        />
      </WorkflowField>

      <div class="grid grid-cols-2 gap-3">
        <ControlMapInput
          v-model="workflowStore.moss.controlColorMap"
          label="Color Map"
          hint="One flat color per region, black is unspecified"
        />
        <ControlMapInput
          v-model="workflowStore.moss.controlDepthMap"
          label="Depth Map"
          hint="Grayscale, near is white"
        />
      </div>

      <div
        v-if="
          !workflowStore.moss.controlColorMap &&
          !workflowStore.moss.controlDepthMap
        "
        class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-400"
      >
        <AlertCircle class="h-4 w-4 shrink-0" />
        <span>No maps yet. Without maps the control is skipped.</span>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <WorkflowField
          v-for="slider in CONTROL_SLIDERS"
          :key="slider.key"
          :label="slider.label"
          class="first:col-span-2"
        >
          <template #action>
            <EditableNumberBadge
              v-model="workflowStore.moss[slider.key]"
              :min="0"
              :max="slider.max"
              :step="0.05"
              :decimals="2"
              badge-class="text-primary font-mono"
            />
          </template>
          <Slider
            :model-value="[workflowStore.moss[slider.key]]"
            :min="0"
            :max="slider.max"
            :step="0.05"
            @update:model-value="updateSlider(slider.key, $event)"
          />
        </WorkflowField>
      </div>

      <p class="text-muted-foreground text-xs">
        Use maps with the output's aspect ratio. End around 0.5 for mannequin or
        painted maps so their surface does not show through.
      </p>
    </div>
  </div>
</template>
