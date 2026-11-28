<script setup lang="ts">
import { computed } from 'vue';
import { Image as ImageIcon } from '@lucide/vue';
import {
  computeBooruGridLayout,
  resolveColumnCount,
  type BooruGridDensity,
  type BooruLayoutMode,
  type SizablePost
} from '@/utils/booruGridLayout';

const props = defineProps<{
  containerWidth: number;
  mode: BooruLayoutMode;
  density: BooruGridDensity;
  gap: number;
}>();

const SAMPLE_DIMENSIONS: [number, number][] = [
  [900, 1280],
  [1400, 1000],
  [1000, 1000],
  [850, 1300],
  [1280, 960],
  [960, 1440],
  [1600, 1000],
  [1024, 1365],
  [1200, 1200],
  [900, 1400],
  [1500, 1050],
  [1000, 1350]
];

const skeletonItems = computed<SizablePost[]>(() => {
  const cols = resolveColumnCount(props.containerWidth, props.density);
  const count = Math.max(12, cols * 3);
  return Array.from({ length: count }, (_, index) => {
    const pair = SAMPLE_DIMENSIONS[index % SAMPLE_DIMENSIONS.length] ?? [
      900, 1200
    ];
    return {
      key: `skeleton-${index}`,
      width: pair[0],
      height: pair[1]
    };
  });
});

const layout = computed(() =>
  computeBooruGridLayout({
    items: skeletonItems.value,
    containerWidth: props.containerWidth,
    mode: props.mode,
    density: props.density,
    gap: props.gap
  })
);
</script>

<template>
  <div
    class="relative w-full overflow-hidden"
    :style="{ height: `${layout.totalHeight}px` }"
    aria-busy="true"
    aria-label="Loading gallery posts"
  >
    <div
      v-for="box in layout.boxes"
      :key="box.key"
      class="border-border/60 bg-card/70 absolute overflow-hidden rounded-xl border shadow-xs"
      :style="{
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`
      }"
    >
      <!-- Ambient Shimmer Gradient -->
      <div
        class="via-primary/6 absolute inset-0 animate-pulse bg-linear-to-br from-white/3 to-transparent"
        :style="{ animationDelay: `${(box.index % 7) * 90}ms` }"
      />

      <!-- Top Skeleton Badges -->
      <div
        class="absolute inset-x-2.5 top-2.5 flex items-center justify-between"
      >
        <span class="bg-muted/80 h-4 w-12 animate-pulse rounded-md" />
        <span class="bg-muted/90 h-4 w-6 animate-pulse rounded-md" />
      </div>

      <!-- Center Framed Icon -->
      <div class="absolute inset-0 flex items-center justify-center">
        <div
          class="border-border/50 bg-secondary/50 flex size-10 animate-pulse items-center justify-center rounded-xl border"
          :style="{ animationDelay: `${(box.index % 5) * 110}ms` }"
        >
          <ImageIcon class="text-muted-foreground/35 size-4" />
        </div>
      </div>

      <!-- Bottom Skeleton Metadata Bar -->
      <div
        class="absolute inset-x-2.5 bottom-2.5 flex items-center justify-between gap-2"
      >
        <div class="flex items-center gap-1.5">
          <span class="bg-muted/80 h-3.5 w-10 animate-pulse rounded-full" />
          <span class="bg-muted/60 h-3.5 w-8 animate-pulse rounded-full" />
        </div>
        <div class="flex items-center gap-1">
          <span class="bg-muted/80 size-6 animate-pulse rounded-lg" />
          <span class="bg-muted/80 size-6 animate-pulse rounded-lg" />
        </div>
      </div>
    </div>
  </div>
</template>
