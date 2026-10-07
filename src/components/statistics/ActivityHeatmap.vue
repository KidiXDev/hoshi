<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import { useAnchoredTooltip } from '@/composables/useAnchoredTooltip';
import type { HeatmapDay } from '@/utils/generationStats';
import StatTooltip from './StatTooltip.vue';

const props = defineProps<{ weeks: (HeatmapDay | null)[][] }>();

const LEVEL_COLORS = [
  'var(--muted)',
  'color-mix(in oklab, var(--primary) 52%, var(--card))',
  'color-mix(in oklab, var(--primary) 68%, var(--card))',
  'color-mix(in oklab, var(--primary) 84%, var(--card))',
  'var(--primary)'
];
const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' });
const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

const root = useTemplateRef<HTMLElement>('root');
const { tooltip, show, hide } = useAnchoredTooltip(root);

const monthLabels = computed(() =>
  props.weeks.map((week, index) => {
    const sunday = week[0];
    if (!sunday) return '';
    const previous = props.weeks[index - 1]?.[0];
    const startsMonth = previous
      ? previous.date.getMonth() !== sunday.date.getMonth()
      : sunday.date.getDate() <= 21;
    return startsMonth ? monthFormat.format(sunday.date) : '';
  })
);

const summaryLabel = computed(() => {
  const days = props.weeks.flat().filter((day) => day && day.count > 0);
  const total = days.reduce((sum, day) => sum + (day?.count ?? 0), 0);
  return `${total.toLocaleString()} images on ${days.length} days in the last year`;
});

function showDay(event: PointerEvent, day: HeatmapDay) {
  show(
    event.currentTarget as Element,
    `${day.count.toLocaleString()} ${day.count === 1 ? 'image' : 'images'}`,
    dateFormat.format(day.date)
  );
}
</script>

<template>
  <div ref="root" class="relative">
    <div
      class="grid auto-cols-fr grid-flow-col grid-rows-8 gap-0.5"
      :style="{ gridTemplateColumns: 'auto' }"
      role="img"
      :aria-label="summaryLabel"
    >
      <span />
      <span
        v-for="(label, weekday) in WEEKDAY_LABELS"
        :key="`weekday-${weekday}`"
        class="text-muted-foreground flex items-center pr-1.5 text-xs leading-none"
      >
        {{ label }}
      </span>
      <template v-for="(week, index) in weeks" :key="week[0]?.key ?? index">
        <span
          class="text-muted-foreground w-0 text-xs leading-none whitespace-nowrap"
        >
          {{ monthLabels[index] }}
        </span>
        <template v-for="(day, weekday) in week" :key="weekday">
          <div
            v-if="day"
            class="aspect-square rounded-xs transition-[filter] hover:brightness-125"
            :style="{ backgroundColor: LEVEL_COLORS[day.level] }"
            @pointerenter="showDay($event, day)"
            @pointerleave="hide"
          />
          <div v-else />
        </template>
      </template>
    </div>

    <div
      class="text-muted-foreground mt-3 flex items-center justify-end gap-1 text-xs"
    >
      <span class="mr-1">Less</span>
      <span
        v-for="color in LEVEL_COLORS"
        :key="color"
        class="size-2.5 rounded-xs"
        :style="{ backgroundColor: color }"
      />
      <span class="ml-1">More</span>
    </div>

    <StatTooltip :tooltip="tooltip" />
  </div>
</template>
