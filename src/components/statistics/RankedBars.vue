<script setup lang="ts">
import { computed } from 'vue';
import { formatFileSize } from '@/utils/formatters';
import type { RankedCount } from '@/utils/generationStats';
import { CHART_PALETTE } from './DonutChart.vue';

const props = withDefaults(
  defineProps<{
    items: RankedCount[];
    showRank?: boolean;
  }>(),
  {
    showRank: false
  }
);

const maxCount = computed(() =>
  Math.max(1, ...props.items.map((item) => item.count))
);

const totalCount = computed(() =>
  Math.max(
    1,
    props.items.reduce((sum, item) => sum + item.count, 0)
  )
);

function itemColor(index: number) {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}

function itemPercent(count: number) {
  return Math.round((count / totalCount.value) * 1000) / 10;
}
</script>

<template>
  <ul class="flex flex-col gap-3">
    <li
      v-for="(item, index) in items"
      :key="item.name"
      class="flex flex-col gap-1 text-xs"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <span
            v-if="showRank"
            class="text-muted-foreground w-4 shrink-0 font-mono text-xs tabular-nums"
          >
            {{ index + 1 }}.
          </span>
          <span
            v-else
            class="size-2 shrink-0 rounded-full"
            :style="{ backgroundColor: itemColor(index) }"
          />
          <span class="text-foreground truncate font-medium" :title="item.name">
            {{ item.name }}
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-2 tabular-nums">
          <span v-if="item.bytes !== undefined" class="text-muted-foreground">
            {{ formatFileSize(item.bytes) }}
          </span>
          <span class="text-foreground font-medium">
            {{ item.count.toLocaleString() }}
          </span>
          <span class="text-muted-foreground w-11 text-right">
            {{ itemPercent(item.count) }}%
          </span>
        </div>
      </div>
      <div class="bg-muted/70 h-2 w-full overflow-hidden rounded-full">
        <div
          class="h-full rounded-full transition-all duration-300"
          :style="{
            width: `${Math.max(2, (item.count / maxCount) * 100)}%`,
            backgroundColor: itemColor(index)
          }"
        />
      </div>
    </li>
  </ul>
</template>
