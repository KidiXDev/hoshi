<script lang="ts">
export interface DonutDatum {
  key: string;
  label: string;
  value: number;
  sublabel?: string;
  color?: string;
}

export const CHART_PALETTE = [
  '#3b82f6',
  '#8b5cf6',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#6366f1',
  '#64748b'
] as const;
</script>

<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue';
import { useAnchoredTooltip } from '@/composables/useAnchoredTooltip';
import StatTooltip from './StatTooltip.vue';

const props = withDefaults(
  defineProps<{
    items: DonutDatum[];
    variant?: 'donut' | 'pie';
    centerLabel?: string;
    centerValue?: string;
    unit?: string;
  }>(),
  {
    variant: 'donut',
    centerLabel: 'Total',
    centerValue: undefined,
    unit: 'image'
  }
);

const root = useTemplateRef<HTMLElement>('root');
const { tooltip, show, hide } = useAnchoredTooltip(root);
const hoveredKey = shallowRef('');

const SIZE = 160;
const CENTER = SIZE / 2;
const OUTER_RADIUS = 68;
const INNER_RADIUS = computed(() => (props.variant === 'pie' ? 0 : 44));

const positiveItems = computed(() =>
  props.items.filter((item) => item.value > 0)
);

const total = computed(() =>
  positiveItems.value.reduce((sum, item) => sum + item.value, 0)
);

function polarToCartesian(radius: number, angleInRadians: number) {
  return {
    x: CENTER + radius * Math.cos(angleInRadians),
    y: CENTER + radius * Math.sin(angleInRadians)
  };
}

function buildSlicePath(
  startAngle: number,
  endAngle: number,
  outerRadius: number,
  innerRadius: number
) {
  const sweep = endAngle - startAngle;
  if (sweep >= Math.PI * 2 - 0.0001) {
    const outerTop = `${CENTER} ${CENTER - outerRadius}`;
    const outerBottom = `${CENTER} ${CENTER + outerRadius}`;
    const outerRing = `M ${outerTop} A ${outerRadius} ${outerRadius} 0 1 1 ${outerBottom} A ${outerRadius} ${outerRadius} 0 1 1 ${outerTop} Z`;
    if (innerRadius <= 0) return outerRing;
    const innerTop = `${CENTER} ${CENTER - innerRadius}`;
    const innerBottom = `${CENTER} ${CENTER + innerRadius}`;
    return `${outerRing} M ${innerTop} A ${innerRadius} ${innerRadius} 0 1 0 ${innerBottom} A ${innerRadius} ${innerRadius} 0 1 0 ${innerTop} Z`;
  }

  const largeArc = sweep > Math.PI ? 1 : 0;
  const outerStart = polarToCartesian(outerRadius, startAngle);
  const outerEnd = polarToCartesian(outerRadius, endAngle);

  if (innerRadius <= 0) {
    return [
      `M ${CENTER} ${CENTER}`,
      `L ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      'Z'
    ].join(' ');
  }

  const innerStart = polarToCartesian(innerRadius, endAngle);
  const innerEnd = polarToCartesian(innerRadius, startAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
    'Z'
  ].join(' ');
}

const slices = computed(() => {
  if (total.value <= 0) return [];
  let cursor = -Math.PI / 2;
  const gap = positiveItems.value.length > 1 ? 0.02 : 0;
  return positiveItems.value.map((item, index) => {
    const fraction = item.value / total.value;
    const rawSweep = fraction * Math.PI * 2;
    const startAngle = cursor + gap / 2;
    const endAngle = Math.max(startAngle + 0.01, cursor + rawSweep - gap / 2);
    cursor += rawSweep;
    const midAngle = (startAngle + endAngle) / 2;
    const color = item.color ?? CHART_PALETTE[index % CHART_PALETTE.length];
    const percentage = Math.round(fraction * 1000) / 10;
    return {
      ...item,
      color,
      percentage,
      midAngle,
      path: buildSlicePath(
        startAngle,
        endAngle,
        OUTER_RADIUS,
        INNER_RADIUS.value
      )
    };
  });
});

const activeSlice = computed(() =>
  slices.value.find((slice) => slice.key === hoveredKey.value)
);

const displayedCenterValue = computed(() => {
  if (activeSlice.value) return `${activeSlice.value.percentage}%`;
  return props.centerValue ?? total.value.toLocaleString();
});

const displayedCenterLabel = computed(() => {
  if (activeSlice.value) return activeSlice.value.label;
  return props.centerLabel;
});

function sliceTransform(slice: (typeof slices.value)[number]) {
  if (hoveredKey.value !== slice.key || slices.value.length <= 1) {
    return 'translate(0, 0)';
  }
  const offset = 3.5;
  const dx = Math.cos(slice.midAngle) * offset;
  const dy = Math.sin(slice.midAngle) * offset;
  return `translate(${dx}px, ${dy}px)`;
}

function formatUnit(count: number) {
  return count === 1 ? props.unit : `${props.unit}s`;
}

function showSlice(event: PointerEvent, slice: (typeof slices.value)[number]) {
  hoveredKey.value = slice.key;
  const sub = slice.sublabel ? ` · ${slice.sublabel}` : '';
  show(
    event.currentTarget as Element,
    `${slice.value.toLocaleString()} ${formatUnit(slice.value)} (${slice.percentage}%)`,
    `${slice.label}${sub}`
  );
}

function hideSlice() {
  hoveredKey.value = '';
  hide();
}
</script>

<template>
  <div
    ref="root"
    class="relative flex flex-col gap-4 sm:flex-row sm:items-center"
  >
    <div class="relative mx-auto flex shrink-0 items-center justify-center">
      <svg
        :width="SIZE"
        :height="SIZE"
        :viewBox="`0 0 ${SIZE} ${SIZE}`"
        role="img"
        :aria-label="`${centerLabel}: ${total.toLocaleString()}`"
        class="overflow-visible"
      >
        <circle
          v-if="slices.length === 0"
          :cx="CENTER"
          :cy="CENTER"
          :r="(OUTER_RADIUS + INNER_RADIUS) / 2"
          fill="none"
          stroke="var(--muted)"
          :stroke-width="OUTER_RADIUS - INNER_RADIUS"
        />
        <path
          v-for="slice in slices"
          :key="slice.key"
          :d="slice.path"
          :fill="slice.color"
          fill-rule="evenodd"
          class="cursor-pointer transition-all duration-150"
          :class="{
            'opacity-45': hoveredKey && hoveredKey !== slice.key,
            'brightness-110': hoveredKey === slice.key
          }"
          :style="{ transform: sliceTransform(slice) }"
          @pointerenter="showSlice($event, slice)"
          @pointerleave="hideSlice"
        />
      </svg>

      <div
        v-if="variant === 'donut'"
        class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-7 text-center"
      >
        <span
          class="text-foreground text-lg leading-tight font-bold tabular-nums"
        >
          {{ displayedCenterValue }}
        </span>
        <span
          class="text-muted-foreground max-w-20 truncate text-xs leading-tight"
        >
          {{ displayedCenterLabel }}
        </span>
      </div>
    </div>

    <ul class="flex min-w-0 flex-1 flex-col gap-1.5" role="list">
      <li
        v-for="slice in slices"
        :key="slice.key"
        class="hover:bg-muted/60 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors"
        :class="{ 'bg-muted/70': hoveredKey === slice.key }"
        @pointerenter="hoveredKey = slice.key"
        @pointerleave="hoveredKey = ''"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span
            class="size-2.5 shrink-0 rounded-full"
            :style="{ backgroundColor: slice.color }"
          />
          <span
            class="text-foreground truncate font-medium"
            :title="slice.label"
          >
            {{ slice.label }}
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-2 tabular-nums">
          <span
            v-if="slice.sublabel"
            class="text-muted-foreground hidden sm:inline"
          >
            {{ slice.sublabel }}
          </span>
          <span class="text-foreground font-medium">
            {{ slice.value.toLocaleString() }}
          </span>
          <span class="text-muted-foreground w-11 text-right">
            {{ slice.percentage }}%
          </span>
        </div>
      </li>
    </ul>

    <StatTooltip :tooltip="tooltip" />
  </div>
</template>
