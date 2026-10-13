<script setup lang="ts">
import { Sparkles } from '@lucide/vue';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu';
import type { FormatOptions } from '@/utils/promptTools';

defineProps<{ disabled: boolean }>();
const options = defineModel<Required<FormatOptions>>({ required: true });
const emit = defineEmits<{ format: [] }>();
const choices: { key: keyof FormatOptions; label: string }[] = [
  { key: 'escapeParentheses', label: 'Escape parentheses' },
  { key: 'replaceUnderscores', label: 'Replace underscores with spaces' },
  { key: 'keepNewlines', label: 'Keep newlines' },
  { key: 'collapseWhitespace', label: 'Collapse extra spaces' },
  { key: 'deduplicate', label: 'Remove duplicate tags' }
];
</script>

<template>
  <DropdownMenuSub>
    <DropdownMenuSubTrigger
      ><Sparkles /><span>Format prompt</span></DropdownMenuSubTrigger
    >
    <DropdownMenuSubContent class="w-72">
      <DropdownMenuCheckboxItem
        v-for="choice in choices"
        :key="choice.key"
        :model-value="options[choice.key]"
        @update:model-value="
          options = { ...options, [choice.key]: $event === true }
        "
        @select.prevent
        >{{ choice.label }}</DropdownMenuCheckboxItem
      >
      <DropdownMenuSeparator />
      <DropdownMenuItem :disabled="disabled" @click="emit('format')"
        ><Sparkles />Apply formatting</DropdownMenuItem
      >
    </DropdownMenuSubContent>
  </DropdownMenuSub>
</template>
