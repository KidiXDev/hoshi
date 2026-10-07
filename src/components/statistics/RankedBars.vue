<script setup lang="ts">
import { computed } from 'vue';
import type { RankedCount } from '@/utils/generationStats';

const props = defineProps<{ items: RankedCount[] }>();

const maxCount = computed(() =>
  Math.max(1, ...props.items.map((item) => item.count))
);
</script>

<template>
  <ul class="flex flex-col gap-2.5">
    <li
      v-for="item in items"
      :key="item.name"
      class="flex items-center gap-3 text-xs"
    >
      <span class="text-foreground w-28 shrink-0 truncate" :title="item.name">
        {{ item.name }}
      </span>
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <div
          class="bg-primary h-3 rounded-r-sm"
          :style="{ width: `${(item.count / maxCount) * 85}%` }"
        />
        <span class="text-muted-foreground tabular-nums">
          {{ item.count.toLocaleString() }}
        </span>
      </div>
    </li>
  </ul>
</template>
