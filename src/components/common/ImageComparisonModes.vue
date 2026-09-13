<script setup lang="ts">
import { computed } from 'vue';
import { Columns2, Eye, Layers, SplitSquareVertical } from '@lucide/vue';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import type { ImageComparisonMode } from '@/types/imageBatch';

const mode = defineModel<ImageComparisonMode>({ required: true });
const props = withDefaults(
  defineProps<{
    /** Restrict the available modes (defaults to all four). */
    modes?: ImageComparisonMode[];
  }>(),
  { modes: () => ['split', 'side-by-side', 'result', 'original'] }
);
const allModes = [
  {
    value: 'split',
    label: 'Split Compare',
    description: 'Interactive Before / After Split Slider',
    icon: SplitSquareVertical
  },
  {
    value: 'side-by-side',
    label: 'Side-by-Side',
    description: 'View Original and Result side-by-side',
    icon: Columns2
  },
  {
    value: 'result',
    label: 'Result',
    description: 'View Result Image',
    icon: Eye
  },
  {
    value: 'original',
    label: 'Original',
    description: 'View Original Image',
    icon: Layers
  }
] as const;
const modes = computed(() =>
  allModes.filter((option) => props.modes.includes(option.value))
);
</script>

<template>
  <div class="bg-secondary/60 flex items-center rounded-lg p-0.5">
    <Tooltip v-for="option in modes" :key="option.value">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs font-medium transition-colors"
          :class="
            mode === option.value
              ? 'bg-background text-primary font-semibold shadow-2xs'
              : 'text-muted-foreground hover:text-foreground'
          "
          :aria-label="option.label"
          :aria-pressed="mode === option.value"
          @click="mode = option.value"
        >
          <component :is="option.icon" class="inline-block h-3.5 w-3.5" />
          <span class="ml-1 hidden sm:inline">{{ option.label }}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ option.description }}</TooltipContent>
    </Tooltip>
  </div>
</template>
