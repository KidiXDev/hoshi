<script setup lang="ts">
import { computed } from 'vue';
import { AlertCircle } from '@lucide/vue';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
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
import { Switch } from '@/components/ui/switch';
import EditableNumberBadge from '../common/EditableNumberBadge.vue';
import WorkflowField from './WorkflowField.vue';
import { useComfyStore } from '../../stores/comfyStore';
import { useWorkflowStore } from '../../stores/workflowStore';

const comfyStore = useComfyStore();
const workflowStore = useWorkflowStore();
const isAnima = computed(() => workflowStore.profile === 'anima');
const cacheModelTypes = [
  'Auto',
  'Anima',
  'Z-Image',
  'Z-Image-Turbo',
  'Qwen-Image',
  'Flux',
  'MiniMax-H3',
  'Custom'
];
const cacheStrategies = ['preset', 'adaptive', 'static', 'dynamic'] as const;

const shiftModel = computed({
  get: () => [workflowStore.models.shift],
  set: (value: number[]) => {
    if (value[0] !== undefined) {
      workflowStore.models.shift = Number(value[0].toFixed(1));
    }
  }
});

const cfgTruncModel = computed({
  get: () => [workflowStore.advanced.renormCfg.cfgTrunc],
  set: (value: number[]) => {
    if (value[0] !== undefined) {
      workflowStore.advanced.renormCfg.cfgTrunc = Number(value[0].toFixed(2));
    }
  }
});

const renormCfgModel = computed({
  get: () => [workflowStore.advanced.renormCfg.renormCfg],
  set: (value: number[]) => {
    if (value[0] !== undefined) {
      workflowStore.advanced.renormCfg.renormCfg = Number(value[0].toFixed(2));
    }
  }
});
</script>

<template>
  <Accordion type="single" collapsible class="w-full">
    <AccordionItem value="advanced" class="border-none">
      <AccordionTrigger
        class="hover:bg-accent rounded-lg px-3 py-2.5 hover:no-underline"
      >
        <div class="flex w-full items-center justify-between pr-3">
          <div class="flex items-center gap-2">
            <span
              class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
            >
              Advanced Settings
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <span
              v-if="!comfyStore.isConnected"
              class="border-border bg-muted text-muted-foreground/80 rounded border px-1.5 py-0.5 font-mono text-xs font-semibold"
            >
              LOCKED
            </span>
            <template v-else>
              <span
                v-if="isAnima && workflowStore.advanced.auraFlowEnabled"
                class="border-primary/30 bg-primary/10 text-primary rounded border px-2 py-0.5 font-mono text-xs font-bold"
              >
                Shift ON
              </span>
              <span
                v-if="!isAnima && workflowStore.moss.skipLayerGuidance"
                class="border-primary/30 bg-primary/10 text-primary rounded border px-2 py-0.5 font-mono text-xs font-bold"
              >
                SLG ON
              </span>
              <span
                v-if="
                  isAnima &&
                  workflowStore.advanced.cacheDiT.enabled &&
                  comfyStore.isCacheDiTAvailable
                "
                class="border-primary/30 bg-primary/10 text-primary rounded border px-2 py-0.5 font-mono text-xs font-bold"
              >
                CacheDiT ON
              </span>
              <span
                v-if="isAnima && workflowStore.advanced.renormCfg.enabled"
                class="border-primary/30 bg-primary/10 text-primary rounded border px-2 py-0.5 font-mono text-xs font-bold"
              >
                Renorm ON
              </span>
            </template>
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent class="px-1 pt-2">
        <div class="flex flex-col gap-3">
          <!-- MOSS Skip Layer Guidance -->
          <div
            v-if="!isAnima"
            class="border-border bg-card flex flex-col gap-3 rounded-lg border p-3"
          >
            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <Label
                  for="moss-slg-enabled"
                  class="text-foreground text-xs font-medium"
                  :class="{ 'cursor-pointer': comfyStore.isConnected }"
                >
                  Skip Layer Guidance
                </Label>
                <p class="text-muted-foreground text-xs">
                  Official MOSS-Image default is layer 22 from 0 to 0.5. Turn
                  off for a more photographic look at the cost of fine detail.
                </p>
              </div>
              <Switch
                id="moss-slg-enabled"
                v-model="workflowStore.moss.skipLayerGuidance"
                :disabled="!comfyStore.isConnected"
              />
            </div>

            <div
              v-if="workflowStore.moss.skipLayerGuidance"
              class="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-3"
            >
              <WorkflowField label="Single Layers">
                <Input
                  v-model="workflowStore.moss.slgSingleLayers"
                  placeholder="22"
                  class="font-mono text-xs"
                  :disabled="!comfyStore.isConnected"
                />
              </WorkflowField>

              <WorkflowField label="Start Percent">
                <Input
                  v-model.number="workflowStore.moss.slgStartPercent"
                  type="number"
                  min="0"
                  max="1"
                  step="0.001"
                  class="font-mono text-xs"
                  :disabled="!comfyStore.isConnected"
                />
              </WorkflowField>

              <WorkflowField label="End Percent">
                <Input
                  v-model.number="workflowStore.moss.slgEndPercent"
                  type="number"
                  min="0"
                  max="1"
                  step="0.001"
                  class="font-mono text-xs"
                  :disabled="!comfyStore.isConnected"
                />
              </WorkflowField>
            </div>
          </div>

          <!-- 1. AuraFlow Shift Group -->
          <div
            v-if="isAnima"
            class="border-border bg-card flex flex-col gap-3 rounded-lg border p-3"
          >
            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <Label
                  for="auraflow-enabled"
                  class="text-foreground text-xs font-medium"
                  :class="{ 'cursor-pointer': comfyStore.isConnected }"
                >
                  AuraFlow Shift
                </Label>
                <p class="text-muted-foreground text-xs">
                  Model sampling shift for AuraFlow / DiT models
                </p>
              </div>
              <Switch
                id="auraflow-enabled"
                v-model="workflowStore.advanced.auraFlowEnabled"
                :disabled="!comfyStore.isConnected"
              />
            </div>

            <div
              v-if="workflowStore.advanced.auraFlowEnabled"
              class="flex flex-col gap-1.5 pt-1"
            >
              <WorkflowField label="Shift Value">
                <template #action>
                  <EditableNumberBadge
                    v-model="workflowStore.models.shift"
                    :min="0"
                    :max="100"
                    :step="0.1"
                    :decimals="1"
                    badge-class="text-primary"
                    :disabled="!comfyStore.isConnected"
                  />
                </template>
                <div class="flex items-center gap-3 pt-1">
                  <Slider
                    v-model="shiftModel"
                    :min="0"
                    :max="100"
                    :step="0.1"
                    class="w-full"
                    :disabled="!comfyStore.isConnected"
                  />
                </div>
              </WorkflowField>
            </div>
          </div>

          <!-- 2. CacheDiT Accelerator Group -->
          <div
            v-if="isAnima"
            class="border-border bg-card flex flex-col gap-3 rounded-lg border p-3"
          >
            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <div class="flex items-center gap-2">
                  <Label
                    for="cache-dit-enabled"
                    class="text-foreground text-xs font-medium"
                    :class="{
                      'cursor-pointer':
                        comfyStore.isConnected && comfyStore.isCacheDiTAvailable
                    }"
                  >
                    CacheDiT Accelerator
                  </Label>
                  <span
                    v-if="
                      comfyStore.isConnected && !comfyStore.isCacheDiTAvailable
                    "
                    class="py-0.2 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 font-mono text-xs font-semibold text-amber-400"
                  >
                    UNAVAILABLE
                  </span>
                </div>
                <p class="text-muted-foreground text-xs">
                  Speed up DiT diffusion steps with layer caching
                </p>
              </div>
              <Switch
                id="cache-dit-enabled"
                v-model="workflowStore.advanced.cacheDiT.enabled"
                :disabled="
                  !comfyStore.isConnected || !comfyStore.isCacheDiTAvailable
                "
              />
            </div>

            <!-- Custom node missing warning banner -->
            <div
              v-if="comfyStore.isConnected && !comfyStore.isCacheDiTAvailable"
              class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-400"
            >
              <AlertCircle class="h-4 w-4 shrink-0" />
              <span>
                CacheDiT custom node (<code>CacheDiT_Model_Optimizer</code>) is
                not installed in ComfyUI.
              </span>
            </div>

            <div
              v-if="
                workflowStore.advanced.cacheDiT.enabled &&
                comfyStore.isCacheDiTAvailable
              "
              class="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2"
            >
              <WorkflowField label="Model Type">
                <Select
                  v-model="workflowStore.advanced.cacheDiT.modelType"
                  :disabled="
                    !comfyStore.isConnected || !comfyStore.isCacheDiTAvailable
                  "
                >
                  <SelectTrigger class="w-full font-mono text-xs">
                    <SelectValue placeholder="Select model type..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup class="max-h-40 overflow-y-auto">
                      <SelectItem
                        v-for="modelType in cacheModelTypes"
                        :key="modelType"
                        :value="modelType"
                        class="font-mono text-xs"
                      >
                        {{ modelType }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </WorkflowField>

              <WorkflowField label="Strategy">
                <Select
                  v-model="workflowStore.advanced.cacheDiT.strategy"
                  :disabled="
                    !comfyStore.isConnected || !comfyStore.isCacheDiTAvailable
                  "
                >
                  <SelectTrigger class="w-full font-mono text-xs">
                    <SelectValue placeholder="Select strategy..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup class="max-h-40 overflow-y-auto">
                      <SelectItem
                        v-for="strategy in cacheStrategies"
                        :key="strategy"
                        :value="strategy"
                        class="font-mono text-xs"
                      >
                        {{ strategy }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </WorkflowField>

              <WorkflowField label="Warmup Steps">
                <Input
                  v-model.number="workflowStore.advanced.cacheDiT.warmupSteps"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  class="font-mono text-xs"
                  :disabled="
                    !comfyStore.isConnected || !comfyStore.isCacheDiTAvailable
                  "
                />
              </WorkflowField>

              <WorkflowField label="Skip Interval">
                <Input
                  v-model.number="workflowStore.advanced.cacheDiT.skipInterval"
                  type="number"
                  min="0"
                  max="10"
                  step="1"
                  class="font-mono text-xs"
                  :disabled="
                    !comfyStore.isConnected || !comfyStore.isCacheDiTAvailable
                  "
                />
              </WorkflowField>

              <WorkflowField label="Threshold">
                <Input
                  v-model.number="workflowStore.advanced.cacheDiT.threshold"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  class="font-mono text-xs"
                  :disabled="
                    !comfyStore.isConnected || !comfyStore.isCacheDiTAvailable
                  "
                />
              </WorkflowField>

              <WorkflowField label="Noise Scale">
                <Input
                  v-model.number="workflowStore.advanced.cacheDiT.noiseScale"
                  type="number"
                  min="-1"
                  max="0.1"
                  step="0.0001"
                  class="font-mono text-xs"
                  :disabled="
                    !comfyStore.isConnected || !comfyStore.isCacheDiTAvailable
                  "
                />
              </WorkflowField>

              <div
                class="border-border bg-muted/30 flex items-center justify-between rounded-lg border p-2.5 sm:col-span-2"
              >
                <div class="flex flex-col gap-0.5">
                  <Label
                    for="cache-summary"
                    class="text-foreground text-xs font-medium"
                    :class="{
                      'cursor-pointer':
                        comfyStore.isConnected && comfyStore.isCacheDiTAvailable
                    }"
                  >
                    Print Performance Summary
                  </Label>
                  <p class="text-muted-foreground text-xs">
                    Output timing and cache metrics to ComfyUI terminal
                  </p>
                </div>
                <Switch
                  id="cache-summary"
                  v-model="workflowStore.advanced.cacheDiT.printSummary"
                  :disabled="
                    !comfyStore.isConnected || !comfyStore.isCacheDiTAvailable
                  "
                />
              </div>
            </div>
          </div>

          <!-- 3. RenormCFG Group -->
          <div
            v-if="isAnima"
            class="border-border bg-card flex flex-col gap-3 rounded-lg border p-3"
          >
            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <Label
                  for="renorm-enabled"
                  class="text-foreground text-xs font-medium"
                  :class="{ 'cursor-pointer': comfyStore.isConnected }"
                >
                  RenormCFG
                </Label>
                <p class="text-muted-foreground text-xs">
                  Apply conditional scaling and normalization to control CFG
                  guidance
                </p>
              </div>
              <Switch
                id="renorm-enabled"
                v-model="workflowStore.advanced.renormCfg.enabled"
                :disabled="!comfyStore.isConnected"
              />
            </div>

            <div
              v-if="workflowStore.advanced.renormCfg.enabled"
              class="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2"
            >
              <WorkflowField label="CFG Trunc">
                <template #action>
                  <EditableNumberBadge
                    v-model="workflowStore.advanced.renormCfg.cfgTrunc"
                    :min="0"
                    :max="100"
                    :step="0.1"
                    :decimals="2"
                    badge-class="text-primary"
                    :disabled="!comfyStore.isConnected"
                  />
                </template>
                <div class="flex items-center gap-3 pt-1">
                  <Slider
                    v-model="cfgTruncModel"
                    :min="0"
                    :max="100"
                    :step="0.1"
                    class="w-full"
                    :disabled="!comfyStore.isConnected"
                  />
                </div>
              </WorkflowField>

              <WorkflowField label="Renorm CFG">
                <template #action>
                  <EditableNumberBadge
                    v-model="workflowStore.advanced.renormCfg.renormCfg"
                    :min="0"
                    :max="100"
                    :step="0.1"
                    :decimals="2"
                    badge-class="text-primary"
                    :disabled="!comfyStore.isConnected"
                  />
                </template>
                <div class="flex items-center gap-3 pt-1">
                  <Slider
                    v-model="renormCfgModel"
                    :min="0"
                    :max="100"
                    :step="0.1"
                    class="w-full"
                    :disabled="!comfyStore.isConnected"
                  />
                </div>
              </WorkflowField>
            </div>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</template>
