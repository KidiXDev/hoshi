<script setup lang="ts">
import SearchableSelect from '../common/SearchableSelect.vue';
import { computed, reactive } from 'vue';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
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
import type {
  UltimateSeamFixMode,
  UltimateUpscaleMode,
  UltimateUpscaleSettings
} from '@/types/workflow';
import { AlertCircle, FastForwardIcon } from '@lucide/vue';
import EditableNumberBadge from '../common/EditableNumberBadge.vue';
import WorkflowField from './WorkflowField.vue';
import { useComfyStore } from '../../stores/comfyStore';
import { useWorkflowStore } from '../../stores/workflowStore';

const props = defineProps<{ settings?: UltimateUpscaleSettings }>();

const comfyStore = useComfyStore();
const workflowStore = useWorkflowStore();
const settings = computed(
  () => props.settings ?? workflowStore.postfx.upscale.ultimate
);

const MODE_OPTIONS: UltimateUpscaleMode[] = ['Linear', 'Chess', 'None'];
const SEAM_FIX_OPTIONS: UltimateSeamFixMode[] = [
  'None',
  'Band Pass',
  'Half Tile',
  'Half Tile + Intersections'
];

const samplerOptions = computed(() =>
  comfyStore.availableSamplers.length > 0
    ? comfyStore.availableSamplers
    : ['er_sde', 'euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_sde']
);

const schedulerOptions = computed(() =>
  comfyStore.availableSchedulers.length > 0
    ? comfyStore.availableSchedulers
    : ['simple', 'normal', 'karras', 'exponential', 'sgm_uniform']
);

function sliderBinding(
  getter: () => number,
  setter: (value: number) => void,
  decimals = 2
) {
  return computed({
    get: () => [getter()],
    set: (value: number[]) => {
      if (value[0] !== undefined) setter(Number(value[0].toFixed(decimals)));
    }
  });
}

const turboLoraOptions = computed(() =>
  Array.from(
    new Set(
      [settings.value.turboLora, ...comfyStore.availableLoras].filter(Boolean)
    )
  )
);

const controlledSteps = computed({
  get: () =>
    settings.value.turboEnabled
      ? settings.value.turboSteps
      : settings.value.steps,
  set: (value: number) => {
    if (settings.value.turboEnabled) settings.value.turboSteps = value;
    else settings.value.steps = value;
  }
});

const stepsSlider = sliderBinding(
  () => controlledSteps.value,
  (v) => (controlledSteps.value = v),
  0
);
const cfgSlider = sliderBinding(
  () => settings.value.cfg,
  (v) => (settings.value.cfg = v),
  1
);
const denoiseSlider = sliderBinding(
  () => settings.value.denoise,
  (v) => (settings.value.denoise = v)
);
const seamFixDenoiseSlider = sliderBinding(
  () => settings.value.seamFixDenoise,
  (v) => (settings.value.seamFixDenoise = v)
);

type NumberKey = {
  [
    K in keyof UltimateUpscaleSettings
  ]: UltimateUpscaleSettings[K] extends number ? K : never;
}[keyof UltimateUpscaleSettings];

const TILE_SIZES = [512, 640, 768, 896, 1024, 1152, 1280, 1536, 2048];
const BLUR_SIZES = [0, 4, 8, 12, 16, 24, 32, 48, 64];
const PADDING_SIZES = [0, 8, 16, 32, 48, 64, 96, 128];
const SEAM_WIDTHS = [16, 32, 64, 96, 128, 192, 256];
const BATCH_SIZES = [1, 2, 4, 8, 16];

// reka Select works on strings; bridge to the numeric setting and keep a
// saved value that is not in the preset list selectable.
function numberSelect(key: NumberKey, presets: number[]) {
  const model = computed({
    get: () => String(settings.value[key]),
    set: (value: string) => (settings.value[key] = Number(value))
  });
  const options = computed(() => {
    const values = Array.from(new Set([...presets, settings.value[key]]));
    values.sort((a, b) => a - b);
    return values.map(String);
  });
  return reactive({ model, options });
}

const tileWidth = numberSelect('tileWidth', TILE_SIZES);
const tileHeight = numberSelect('tileHeight', TILE_SIZES);
const maskBlur = numberSelect('maskBlur', BLUR_SIZES);
const tilePadding = numberSelect('tilePadding', PADDING_SIZES);
const seamFixWidth = numberSelect('seamFixWidth', SEAM_WIDTHS);
const seamFixMaskBlur = numberSelect('seamFixMaskBlur', BLUR_SIZES);
const seamFixPadding = numberSelect('seamFixPadding', PADDING_SIZES);
const batchSize = numberSelect('batchSize', BATCH_SIZES);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-if="comfyStore.isConnected && !comfyStore.isUltimateUpscaleAvailable"
      class="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300"
    >
      <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      <span>
        ComfyUI_UltimateSDUpscale custom node is required. Restart ComfyUI after
        installing it.
      </span>
    </div>

    <div
      class="border-border bg-card/60 flex flex-col gap-3 rounded-lg border p-3"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <FastForwardIcon class="h-4 w-4 text-blue-400" />
          <div>
            <p class="text-xs font-semibold">Turbo LoRA</p>
          </div>
        </div>
        <Switch
          v-model="settings.turboEnabled"
          aria-label="Enable Ultimate SD Upscale Turbo LoRA"
        />
      </div>
      <div v-if="settings.turboEnabled" class="border-border border-t pt-2.5">
        <WorkflowField label="Turbo LoRA Model">
          <SearchableSelect
            v-model="settings.turboLora"
            :options="turboLoraOptions"
            placeholder="Select Turbo LoRA"
            preview-category="loras"
            grid-title="Select Turbo LoRA"
            :disabled="!comfyStore.isConnected"
          />
        </WorkflowField>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <WorkflowField label="Steps">
        <template #action>
          <EditableNumberBadge
            v-model="controlledSteps"
            :min="1"
            :max="settings.turboEnabled ? 12 : 100"
            :step="1"
            :decimals="0"
            badge-class="text-primary"
          />
        </template>
        <div class="flex items-center gap-3 pt-1">
          <Slider
            v-model="stepsSlider"
            :min="1"
            :max="settings.turboEnabled ? 12 : 60"
            :step="1"
            class="w-full"
          />
        </div>
      </WorkflowField>

      <WorkflowField label="CFG Scale">
        <template #action>
          <EditableNumberBadge
            :model-value="settings.turboEnabled ? 1 : settings.cfg"
            :min="0"
            :max="30"
            :step="0.1"
            :decimals="1"
            :disabled="settings.turboEnabled"
            badge-class="text-primary"
            @update:model-value="settings.cfg = $event"
          />
        </template>
        <div class="flex items-center gap-3 pt-1">
          <Slider
            v-model="cfgSlider"
            :min="0.5"
            :max="15"
            :step="0.1"
            :disabled="settings.turboEnabled"
            class="w-full"
          />
        </div>
      </WorkflowField>

      <WorkflowField label="Sampler">
        <SearchableSelect
          v-model="settings.samplerName"
          :options="samplerOptions"
          placeholder="Select sampler"
          :disabled="!comfyStore.isConnected"
        />
      </WorkflowField>

      <WorkflowField label="Scheduler">
        <SearchableSelect
          v-model="settings.scheduler"
          :options="schedulerOptions"
          placeholder="Select scheduler"
          :disabled="!comfyStore.isConnected"
        />
      </WorkflowField>

      <WorkflowField label="Denoise" class="sm:col-span-2">
        <template #action>
          <EditableNumberBadge
            v-model="settings.denoise"
            :min="0"
            :max="1"
            :step="0.01"
            :decimals="2"
            badge-class="text-primary"
          />
        </template>
        <div class="flex items-center gap-3 pt-1">
          <Slider
            v-model="denoiseSlider"
            :min="0"
            :max="1"
            :step="0.01"
            class="w-full"
          />
        </div>
      </WorkflowField>

      <WorkflowField label="Tile Width">
        <Select v-model="tileWidth.model">
          <SelectTrigger class="w-full font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup class="max-h-40 overflow-y-auto">
              <SelectItem
                v-for="opt in tileWidth.options"
                :key="opt"
                :value="opt"
                class="font-mono text-xs"
              >
                {{ opt }} px
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </WorkflowField>
      <WorkflowField label="Tile Height">
        <Select v-model="tileHeight.model">
          <SelectTrigger class="w-full font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup class="max-h-40 overflow-y-auto">
              <SelectItem
                v-for="opt in tileHeight.options"
                :key="opt"
                :value="opt"
                class="font-mono text-xs"
              >
                {{ opt }} px
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </WorkflowField>
    </div>

    <Accordion type="single" collapsible class="w-full">
      <AccordionItem value="advanced" class="border-none">
        <AccordionTrigger
          class="hover:bg-accent rounded-lg px-2 py-2 hover:no-underline"
        >
          <span
            class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
          >
            Advanced Tiling & Seam Fix
          </span>
        </AccordionTrigger>
        <AccordionContent class="px-1 pt-2">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <WorkflowField label="Redraw Mode">
              <Select v-model="settings.modeType">
                <SelectTrigger class="w-full font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup class="max-h-40 overflow-y-auto">
                    <SelectItem
                      v-for="mode in MODE_OPTIONS"
                      :key="mode"
                      :value="mode"
                      class="font-mono text-xs"
                    >
                      {{ mode }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </WorkflowField>

            <WorkflowField label="Seam Fix Mode">
              <Select v-model="settings.seamFixMode">
                <SelectTrigger class="w-full font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup class="max-h-40 overflow-y-auto">
                    <SelectItem
                      v-for="mode in SEAM_FIX_OPTIONS"
                      :key="mode"
                      :value="mode"
                      class="font-mono text-xs"
                    >
                      {{ mode }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </WorkflowField>

            <WorkflowField label="Mask Blur">
              <Select v-model="maskBlur.model">
                <SelectTrigger class="w-full font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup class="max-h-40 overflow-y-auto">
                    <SelectItem
                      v-for="opt in maskBlur.options"
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
            <WorkflowField label="Tile Padding">
              <Select v-model="tilePadding.model">
                <SelectTrigger class="w-full font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup class="max-h-40 overflow-y-auto">
                    <SelectItem
                      v-for="opt in tilePadding.options"
                      :key="opt"
                      :value="opt"
                      class="font-mono text-xs"
                    >
                      {{ opt }} px
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </WorkflowField>

            <template v-if="settings.seamFixMode !== 'None'">
              <WorkflowField label="Seam Fix Denoise" class="sm:col-span-2">
                <template #action>
                  <EditableNumberBadge
                    v-model="settings.seamFixDenoise"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :decimals="2"
                    badge-class="text-primary"
                  />
                </template>
                <div class="flex items-center gap-3 pt-1">
                  <Slider
                    v-model="seamFixDenoiseSlider"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    class="w-full"
                  />
                </div>
              </WorkflowField>
              <WorkflowField label="Seam Fix Width">
                <Select v-model="seamFixWidth.model">
                  <SelectTrigger class="w-full font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup class="max-h-40 overflow-y-auto">
                      <SelectItem
                        v-for="opt in seamFixWidth.options"
                        :key="opt"
                        :value="opt"
                        class="font-mono text-xs"
                      >
                        {{ opt }} px
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </WorkflowField>
              <WorkflowField label="Seam Fix Mask Blur">
                <Select v-model="seamFixMaskBlur.model">
                  <SelectTrigger class="w-full font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup class="max-h-40 overflow-y-auto">
                      <SelectItem
                        v-for="opt in seamFixMaskBlur.options"
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
              <WorkflowField label="Seam Fix Padding">
                <Select v-model="seamFixPadding.model">
                  <SelectTrigger class="w-full font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup class="max-h-40 overflow-y-auto">
                      <SelectItem
                        v-for="opt in seamFixPadding.options"
                        :key="opt"
                        :value="opt"
                        class="font-mono text-xs"
                      >
                        {{ opt }} px
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </WorkflowField>
            </template>

            <WorkflowField label="Tile Batch Size">
              <Select v-model="batchSize.model">
                <SelectTrigger class="w-full font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup class="max-h-40 overflow-y-auto">
                    <SelectItem
                      v-for="opt in batchSize.options"
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

            <div class="flex flex-col gap-2 sm:col-span-2">
              <Label
                class="text-foreground flex cursor-pointer items-center gap-2 text-xs font-medium"
              >
                <Checkbox v-model="settings.forceUniformTiles" />
                Force uniform tiles
              </Label>
              <Label
                class="text-foreground flex cursor-pointer items-center gap-2 text-xs font-medium"
              >
                <Checkbox v-model="settings.tiledDecode" />
                Tiled VAE decode
              </Label>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </div>
</template>
