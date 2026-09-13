<script setup lang="ts">
import { ref, onDeactivated, onUnmounted, type StyleValue } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import type { ImageComparisonMode } from '@/types/imageBatch';

withDefaults(
  defineProps<{
    previewUrl: string;
    resultUrl?: string;
    alt: string;
    mode: ImageComparisonMode;
    resultLabel: string;
    /** Label for the left/original side in split mode. */
    originalLabel?: string;
    /**
     * Style applied to both side-by-side images (e.g. a shared zoom/pan
     * transform) so they stay in sync.
     */
    sideBySideImageStyle?: StyleValue;
    sideBySideImageClass?: string;
  }>(),
  {
    originalLabel: 'BEFORE (ORIGINAL)',
    sideBySideImageStyle: undefined,
    sideBySideImageClass: ''
  }
);
/** Split divider position in percent; bindable via `v-model:position`. */
const splitSliderPos = defineModel<number>('position', { default: 50 });
const isDraggingSplit = ref(false);
let stopDragging = () => {};
function updateSplitFromEvent(clientX: number, targetElem: HTMLElement) {
  const rect = targetElem.getBoundingClientRect();
  const rawPos = ((clientX - rect.left) / rect.width) * 100;
  splitSliderPos.value = Math.max(0, Math.min(100, rawPos));
}
function handleSplitPointerDown(event: PointerEvent) {
  stopDragging();
  isDraggingSplit.value = true;
  const container = (event.currentTarget as HTMLElement).closest(
    '.split-container'
  ) as HTMLElement;
  if (container) {
    updateSplitFromEvent(event.clientX, container);
  }

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDraggingSplit.value || !container) return;
    updateSplitFromEvent(e.clientX, container);
  };

  const handlePointerUp = () => {
    isDraggingSplit.value = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  };

  stopDragging = handlePointerUp;
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
}
onDeactivated(() => stopDragging());
onUnmounted(() => stopDragging());
</script>
<template>
  <!-- 1. SPLIT SLIDER VIEW -->
  <div
    v-if="resultUrl && mode === 'split'"
    class="split-container relative flex h-full w-full items-center justify-center overflow-hidden select-none"
  >
    <div
      class="relative flex h-full max-h-full w-full max-w-full items-center justify-center overflow-hidden"
    >
      <!-- Background Layer: Result (Detailed Image) -->
      <img
        :src="resultUrl"
        :alt="alt"
        class="pointer-events-none max-h-full max-w-full object-contain drop-shadow-md"
        draggable="false"
      />

      <!-- Foreground Layer: Original (Before Image with Clip) -->
      <div
        class="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
        :style="{
          clipPath: `inset(0 calc(100% - ${splitSliderPos}%) 0 0)`
        }"
      >
        <img
          :src="previewUrl"
          :alt="alt"
          class="pointer-events-none max-h-full max-w-full object-contain"
          draggable="false"
        />
      </div>

      <!-- Split Handle & Divider Line -->
      <div
        class="absolute top-0 bottom-0 z-20 flex w-1 cursor-ew-resize items-center justify-center bg-white shadow-lg"
        :style="{ left: `${splitSliderPos}%` }"
        role="slider"
        tabindex="0"
        aria-label="Image comparison position"
        :aria-valuenow="Math.round(splitSliderPos)"
        :aria-valuemin="0"
        :aria-valuemax="100"
        @keydown.left.prevent="splitSliderPos = Math.max(0, splitSliderPos - 5)"
        @keydown.right.prevent="
          splitSliderPos = Math.min(100, splitSliderPos + 5)
        "
        @pointerdown.stop="handleSplitPointerDown"
      >
        <div
          class="border-border bg-background/90 text-primary flex h-8 w-8 items-center justify-center rounded-full border shadow-md backdrop-blur-xs transition-transform active:scale-110"
        >
          <ChevronLeft class="-mr-1 h-3 w-3" />
          <ChevronRight class="-ml-1 h-3 w-3" />
        </div>
      </div>

      <!-- Floating Labels -->
      <div
        class="bg-background/80 text-muted-foreground pointer-events-none absolute top-3 left-3 z-10 max-w-[45%] truncate rounded-md px-2 py-1 font-mono text-xs font-semibold shadow-xs backdrop-blur-xs"
      >
        <slot name="split-original-label">{{ originalLabel }}</slot>
      </div>
      <div
        class="border-primary/40 bg-primary/20 text-primary pointer-events-none absolute top-3 right-3 z-10 max-w-[45%] truncate rounded-md border px-2 py-1 font-mono text-xs font-bold shadow-xs backdrop-blur-xs"
      >
        {{ resultLabel }}
      </div>
    </div>
  </div>

  <!-- 2. SIDE-BY-SIDE VIEW -->
  <div
    v-else-if="resultUrl && mode === 'side-by-side'"
    class="grid h-full w-full grid-cols-2 gap-3 overflow-hidden"
  >
    <div
      class="relative flex h-full min-w-0 flex-col items-center justify-center overflow-hidden"
    >
      <img
        :src="previewUrl"
        :alt="alt"
        class="max-h-full max-w-full object-contain"
        :class="sideBySideImageClass"
        :style="sideBySideImageStyle"
        draggable="false"
      />
      <span
        class="bg-background/80 text-muted-foreground pointer-events-none absolute top-2 left-2 z-10 max-w-[90%] truncate rounded-md px-2 py-0.5 font-mono text-xs font-semibold backdrop-blur-xs"
      >
        <slot name="original-label">Original</slot>
      </span>
    </div>

    <div
      class="relative flex h-full min-w-0 flex-col items-center justify-center overflow-hidden"
    >
      <img
        :src="resultUrl"
        :alt="alt"
        class="max-h-full max-w-full object-contain drop-shadow-md"
        :class="sideBySideImageClass"
        :style="sideBySideImageStyle"
        draggable="false"
      />
      <span
        class="border-primary/40 bg-primary/20 text-primary pointer-events-none absolute top-2 left-2 z-10 max-w-[90%] truncate rounded-md border px-2 py-0.5 font-mono text-xs font-bold backdrop-blur-xs"
      >
        <slot name="result-label">{{ resultLabel }}</slot>
      </span>
    </div>
  </div>

  <!-- 3. ORIGINAL ONLY VIEW -->
  <div
    v-else-if="resultUrl && mode === 'original'"
    class="relative flex h-full w-full items-center justify-center overflow-hidden"
  >
    <img
      :src="previewUrl"
      :alt="alt"
      class="max-h-full max-w-full object-contain"
    />
    <div
      class="bg-background/80 text-muted-foreground absolute top-3 left-3 rounded-md px-2 py-1 font-mono text-xs font-semibold"
    >
      ORIGINAL
    </div>
  </div>

  <!-- 4. DEFAULT RESULT VIEW -->
  <div
    v-else
    class="relative flex h-full w-full items-center justify-center overflow-hidden"
  >
    <img
      :src="resultUrl || previewUrl"
      :alt="alt"
      class="max-h-full max-w-full object-contain drop-shadow-md"
    />

    <slot />
  </div>
</template>
