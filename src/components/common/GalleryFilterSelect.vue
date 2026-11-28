<script setup lang="ts">
import { ChevronsUpDown } from '@lucide/vue';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxAnchor,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger
} from '@/components/ui/combobox';
import { cn } from '@/lib/utils';

const props = defineProps<{
  label: string;
  placeholder: string;
  options: readonly { value: string; label: string; count?: number }[];
  showCounts?: boolean;
  triggerClass?: string;
}>();
const value = defineModel<string>({ required: true });

const selectedLabel = computed(() =>
  value.value === 'all'
    ? props.placeholder
    : (props.options.find((option) => option.value === value.value)?.label ??
      value.value)
);
</script>

<template>
  <div class="flex items-center gap-1.5">
    <span class="text-muted-foreground text-xs whitespace-nowrap"
      >{{ label }}:</span
    >
    <Combobox v-model="value">
      <ComboboxAnchor :class="cn('w-full', triggerClass)">
        <ComboboxTrigger as-child>
          <Button
            variant="outline"
            class="bg-background/80 border-border/60 h-8 w-full justify-between px-3 text-xs font-normal"
            :aria-label="label"
          >
            <span class="truncate">{{ selectedLabel }}</span>
            <ChevronsUpDown class="size-3.5 shrink-0 opacity-50" />
          </Button>
        </ComboboxTrigger>
      </ComboboxAnchor>
      <ComboboxList class="w-(--reka-combobox-trigger-width) min-w-56">
        <ComboboxInput
          :placeholder="`Search ${label.toLowerCase()}...`"
          :display-value="() => ''"
        />
        <ComboboxEmpty class="p-2 text-xs">No matches</ComboboxEmpty>
        <ComboboxGroup class="max-h-60 overflow-y-auto">
          <ComboboxItem value="all" :text-value="placeholder" class="text-xs">
            {{ placeholder }}
          </ComboboxItem>
          <ComboboxItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            :text-value="option.label"
            class="text-xs"
          >
            {{ option.label
            }}<template v-if="showCounts && option.count !== undefined">
              ({{ option.count }})</template
            >
          </ComboboxItem>
        </ComboboxGroup>
      </ComboboxList>
    </Combobox>
  </div>
</template>
