<script setup lang="ts">
import { useElementSize } from '@vueuse/core';
import { computed, ref } from 'vue';

const props = defineProps<{
  values: number[];
  capacity: number;
  label: string;
}>();

const HEIGHT = 56;
const PADDING = 6;

const container = ref<HTMLElement | null>(null);
const { width } = useElementSize(container);
const hoverIndex = ref<number | null>(null);

const step = computed(() => width.value / Math.max(1, props.capacity - 1));
const lastIndex = computed(() => props.values.length - 1);

function x(index: number) {
  return width.value - (lastIndex.value - index) * step.value;
}

function y(value: number) {
  const clamped = Math.min(100, Math.max(0, value));
  return PADDING + (1 - clamped / 100) * (HEIGHT - PADDING * 2);
}

const linePath = computed(() =>
  props.values
    .map((value, index) => `${index ? 'L' : 'M'}${x(index)},${y(value)}`)
    .join(' ')
);
const areaPath = computed(() =>
  props.values.length > 1
    ? `${linePath.value} L${x(lastIndex.value)},${HEIGHT} L${x(0)},${HEIGHT} Z`
    : ''
);
const hoverValue = computed(() =>
  hoverIndex.value === null ? null : props.values[hoverIndex.value]
);
const secondsAgo = computed(() =>
  hoverIndex.value === null ? 0 : lastIndex.value - hoverIndex.value
);

function onPointerMove(event: PointerEvent) {
  const bounds = container.value?.getBoundingClientRect();
  if (!bounds || props.values.length === 0 || step.value === 0) return;
  const fromRight = (bounds.right - event.clientX) / step.value;
  hoverIndex.value = Math.min(
    lastIndex.value,
    Math.max(0, Math.round(lastIndex.value - fromRight))
  );
}
</script>

<template>
  <div
    ref="container"
    class="relative w-full"
    :style="{ height: `${HEIGHT}px` }"
    role="img"
    :aria-label="`${label} over the last minute, now ${Math.round(values.at(-1) ?? 0)}%`"
    @pointermove="onPointerMove"
    @pointerleave="hoverIndex = null"
  >
    <svg
      v-if="width > 0"
      :width="width"
      :height="HEIGHT"
      class="block overflow-visible"
    >
      <line
        :x1="0"
        :x2="width"
        :y1="y(50)"
        :y2="y(50)"
        class="stroke-border"
        stroke-width="1"
      />
      <path :d="areaPath" class="fill-primary/10" />
      <path
        :d="linePath"
        class="stroke-primary"
        fill="none"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <line
        v-if="hoverIndex !== null"
        :x1="x(hoverIndex)"
        :x2="x(hoverIndex)"
        :y1="0"
        :y2="HEIGHT"
        class="stroke-muted-foreground/60"
        stroke-width="1"
      />
      <circle
        v-if="values.length > 0"
        :cx="x(hoverIndex ?? lastIndex)"
        :cy="y(values[hoverIndex ?? lastIndex] ?? 0)"
        r="4"
        class="fill-primary stroke-card"
        stroke-width="2"
      />
    </svg>

    <div
      v-if="hoverValue !== null && hoverValue !== undefined"
      class="border-border bg-popover pointer-events-none absolute -top-9 z-10 flex items-baseline gap-1.5 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-md"
      :style="{
        left: `${x(hoverIndex ?? 0)}px`,
        transform: `translateX(${x(hoverIndex ?? 0) > width / 2 ? '-100%' : '0'})`
      }"
    >
      <span class="text-foreground font-semibold">
        {{ Math.round(hoverValue) }}%
      </span>
      <span class="text-muted-foreground">
        {{ secondsAgo === 0 ? 'now' : `${secondsAgo}s ago` }}
      </span>
    </div>
  </div>
</template>
