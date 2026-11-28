<script setup lang="ts">
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import EditableNumberBadge from '../common/EditableNumberBadge.vue';
import SearchableSelect from '../common/SearchableSelect.vue';
import WorkflowField from './WorkflowField.vue';
import { useComfyStore } from '../../stores/comfyStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { MossSettings } from '../../types/workflow';

const EDIT_FORMATS: MossSettings['editFormat'][] = [
  'Moss-Image-Edit',
  'ai-toolkit',
  'ai-toolkit (kv_cache off)'
];

const comfyStore = useComfyStore();
const workflowStore = useWorkflowStore();

function updateImageStrength(value?: number[]) {
  if (value?.[0] !== undefined) {
    workflowStore.moss.editImageStrength = Number(value[0].toFixed(2));
  }
}
</script>

<template>
  <div class="border-border flex flex-col gap-3 border-t pt-3">
    <WorkflowField label="Edit LoRA">
      <SearchableSelect
        v-model="workflowStore.moss.editLora"
        :options="comfyStore.availableLoras"
        placeholder="Select edit LoRA..."
        preview-category="loras"
        grid-title="Select MOSS Edit LoRA"
      />
    </WorkflowField>

    <WorkflowField label="Edit Format">
      <Select v-model="workflowStore.moss.editFormat">
        <SelectTrigger class="w-full font-mono text-xs">
          <SelectValue placeholder="Select format..." />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup class="max-h-40 overflow-y-auto">
            <SelectItem
              v-for="format in EDIT_FORMATS"
              :key="format"
              :value="format"
              class="font-mono text-xs"
            >
              {{ format }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </WorkflowField>

    <WorkflowField label="Image Strength">
      <template #action>
        <EditableNumberBadge
          v-model="workflowStore.moss.editImageStrength"
          :min="0"
          :max="2"
          :step="0.05"
          :decimals="2"
          badge-class="text-primary font-mono"
        />
      </template>
      <Slider
        :model-value="[workflowStore.moss.editImageStrength]"
        :min="0"
        :max="2"
        :step="0.05"
        @update:model-value="updateImageStrength"
      />
    </WorkflowField>
  </div>
</template>
