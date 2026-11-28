<script setup lang="ts">
import { computed } from 'vue';
import type { RankedCount } from '@/utils/generationStats';

const props = defineProps<{
  items: RankedCount[];
  totalImages: number;
}>();

const maxCount = computed(() =>
  Math.max(1, ...props.items.map((item) => item.count))
);

function tagShare(count: number) {
  if (props.totalImages <= 0) return 0;
  return Math.round((count / props.totalImages) * 100);
}
</script>

<template>
  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
    <div
      v-for="(tag, index) in items"
      :key="tag.name"
      class="border-border/70 bg-secondary/35 relative overflow-hidden rounded-lg border px-3 py-2 text-xs"
    >
      <div
        class="bg-primary/12 pointer-events-none absolute inset-y-0 left-0 transition-all duration-300"
        :style="{ width: `${Math.max(4, (tag.count / maxCount) * 100)}%` }"
      />
      <div class="relative flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="text-muted-foreground font-mono text-xs tabular-nums">
            #{{ index + 1 }}
          </span>
          <span class="text-foreground truncate font-medium" :title="tag.name">
            {{ tag.name }}
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-1.5 tabular-nums">
          <span class="text-foreground font-semibold">
            {{ tag.count.toLocaleString() }}
          </span>
          <span class="text-muted-foreground"
            >({{ tagShare(tag.count) }}%)</span
          >
        </div>
      </div>
    </div>
  </div>
</template>
