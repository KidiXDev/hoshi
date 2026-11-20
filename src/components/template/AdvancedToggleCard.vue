<script setup lang="ts">
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import HelpTooltip from '../common/HelpTooltip.vue';

defineProps<{
  id: string;
  label: string;
  description: string;
  help?: string;
  disabled?: boolean;
}>();

const enabled = defineModel<boolean>({ required: true });
</script>

<template>
  <div class="border-border bg-card flex flex-col gap-3 rounded-lg border p-3">
    <div class="flex items-center justify-between">
      <div class="flex flex-col gap-0.5">
        <div class="flex items-center gap-2">
          <Label
            :for="id"
            class="text-foreground text-xs font-medium"
            :class="{ 'cursor-pointer': !disabled }"
          >
            {{ label }}
          </Label>
          <HelpTooltip v-if="help" :text="help" />
        </div>
        <p class="text-muted-foreground text-xs">{{ description }}</p>
      </div>
      <Switch :id="id" v-model="enabled" :disabled="disabled" />
    </div>

    <div
      v-if="enabled && $slots.default"
      class="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2"
    >
      <slot />
    </div>
  </div>
</template>
