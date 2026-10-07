<script lang="ts">
export interface ColumnDatum {
  key: string;
  axisLabel: string;
  detail: string;
  value: number;
}
</script>

<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue';
import { useAnchoredTooltip } from '@/composables/useAnchoredTooltip';
import { niceCeiling } from '@/utils/generationStats';
import StatTooltip from './StatTooltip.vue';

const props = withDefaults(
  defineProps<{ items: ColumnDatum[]; labelEvery?: number }>(),
  { labelEvery: 1 }
);

const root = useTemplateRef<HTMLElement>('root');
const { tooltip, show, hide } = useAnchoredTooltip(root);
const hoveredKey = shallowRef('');

const maxValue = computed(() =>
  niceCeiling(Math.max(0, ...props.items.map((item) => item.value)))
);
const ticks = computed(() =>
  [maxValue.value, maxValue.value / 2, 0].filter((tick) =>
    Number.isInteger(tick)
  )
);

function tickOffset(tick: number) {
  return `${100 - (tick / maxValue.value) * 100}%`;
}

function showItem(event: PointerEvent, item: ColumnDatum) {
  const slot = event.currentTarget as Element;
  hoveredKey.value = item.key;
  show(
    slot.firstElementChild ?? slot,
    `${item.value.toLocaleString()} ${item.value === 1 ? 'image' : 'images'}`,
    item.detail
  );
}

function hideItem() {
  hoveredKey.value = '';
  hide();
}
</script>

<template>
  <div ref="root" class="relative">
    <div class="flex gap-2">
      <div class="relative h-40 w-8 shrink-0">
        <span
          v-for="tick in ticks"
          :key="tick"
          class="text-muted-foreground absolute right-0 -translate-y-1/2 text-xs leading-none tabular-nums"
          :style="{ top: tickOffset(tick) }"
        >
          {{ tick.toLocaleString() }}
        </span>
      </div>
      <div class="relative h-40 flex-1">
        <div
          v-for="tick in ticks"
          :key="tick"
          class="border-border/60 absolute inset-x-0 border-t"
          :style="{ top: tickOffset(tick) }"
        />
        <div class="absolute inset-0 flex items-end gap-0.5" role="list">
          <div
            v-for="item in items"
            :key="item.key"
            role="listitem"
            :aria-label="`${item.detail}: ${item.value} images`"
            class="flex h-full min-w-0 flex-1 items-end justify-center"
            @pointerenter="showItem($event, item)"
            @pointerleave="hideItem"
          >
            <div
              class="bg-primary w-full max-w-6 rounded-t-sm transition-[filter]"
              :class="{ 'brightness-125': hoveredKey === item.key }"
              :style="{ height: `${(item.value / maxValue) * 100}%` }"
            />
          </div>
        </div>
      </div>
    </div>
    <div class="mt-1.5 flex gap-0.5 pl-10">
      <span
        v-for="(item, index) in items"
        :key="item.key"
        class="text-muted-foreground min-w-0 flex-1 text-center text-xs whitespace-nowrap"
      >
        {{ index % labelEvery === 0 ? item.axisLabel : '' }}
      </span>
    </div>
    <StatTooltip :tooltip="tooltip" />
  </div>
</template>
