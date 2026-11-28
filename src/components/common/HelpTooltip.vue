<script setup lang="ts">
import { HelpCircle } from '@lucide/vue';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

defineProps<{ text: string }>();
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        aria-label="More information"
        class="text-muted-foreground/70 hover:text-foreground"
      >
        <HelpCircle class="h-3 w-3" />
      </button>
    </TooltipTrigger>
    <TooltipContent class="max-w-xs">
      <p class="text-xs">{{ text }}</p>
    </TooltipContent>
  </Tooltip>
</template>
