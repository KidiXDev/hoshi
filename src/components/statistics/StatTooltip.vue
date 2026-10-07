<script setup lang="ts">
import type { AnchoredTooltip } from '@/composables/useAnchoredTooltip';

defineProps<{ tooltip: AnchoredTooltip | null }>();
</script>

<template>
  <div
    v-if="tooltip"
    role="tooltip"
    class="border-border/50 bg-background pointer-events-none absolute z-20 -translate-y-full rounded-lg border px-2.5 py-1.5 text-xs whitespace-nowrap shadow-xl"
    :class="{
      '-translate-x-1/2': tooltip.align === 'center',
      '-translate-x-full': tooltip.align === 'end'
    }"
    :style="{ left: `${tooltip.x}px`, top: `${tooltip.y - 6}px` }"
  >
    <div class="text-foreground font-semibold">{{ tooltip.value }}</div>
    <div class="text-muted-foreground">{{ tooltip.label }}</div>
  </div>
</template>
