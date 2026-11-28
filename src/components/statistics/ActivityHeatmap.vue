<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import { useAnchoredTooltip } from '@/composables/useAnchoredTooltip';
import type { HeatmapDay } from '@/utils/generationStats';
import StatTooltip from './StatTooltip.vue';

const props = defineProps<{ weeks: (HeatmapDay | null)[][] }>();

const LEVEL_COLORS = [
  'var(--muted)',
  'color-mix(in oklab, var(--primary) 42%, var(--card))',
  'color-mix(in oklab, var(--primary) 62%, var(--card))',
  'color-mix(in oklab, var(--primary) 82%, var(--card))',
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

const yearStats = computed(() => {
  const allDays = props.weeks
    .flat()
    .filter((day): day is HeatmapDay => day !== null);
  const activeDays = allDays.filter((day) => day.count > 0);
  const total = activeDays.reduce((sum, day) => sum + day.count, 0);
  const consistency =
    allDays.length > 0
      ? Math.round((activeDays.length / allDays.length) * 100)
      : 0;
  return {
    total,
    activeCount: activeDays.length,
    consistency
  };
});

const summaryLabel = computed(
  () =>
    `${yearStats.value.total.toLocaleString()} images on ${yearStats.value.activeCount} days in the last year`
);

function showDay(event: PointerEvent, day: HeatmapDay) {
  show(
    event.currentTarget as Element,
    `${day.count.toLocaleString()} ${day.count === 1 ? 'image' : 'images'}`,
    dateFormat.format(day.date)
  );
}
</script>

<template>
  <div ref="root" class="relative flex flex-col gap-3">
    <div
      class="grid auto-cols-fr grid-flow-col grid-rows-8 gap-1"
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
            class="aspect-square rounded-xs transition-all hover:scale-110 hover:brightness-125"
            :style="{ backgroundColor: LEVEL_COLORS[day.level] }"
            @pointerenter="showDay($event, day)"
            @pointerleave="hide"
          />
          <div v-else />
        </template>
      </template>
    </div>

    <div
      class="text-muted-foreground flex flex-wrap items-center justify-between gap-2 pt-1 text-xs"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span>
          <strong class="text-foreground font-medium tabular-nums">{{
            yearStats.total.toLocaleString()
          }}</strong>
          images in the last year
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <strong class="text-foreground font-medium tabular-nums">{{
            yearStats.activeCount
          }}</strong>
          active days ({{ yearStats.consistency }}%)
        </span>
      </div>

      <div class="flex items-center gap-1">
        <span class="mr-1">Less</span>
        <span
          v-for="color in LEVEL_COLORS"
          :key="color"
          class="size-2.5 rounded-xs"
          :style="{ backgroundColor: color }"
        />
        <span class="ml-1">More</span>
      </div>
    </div>

    <StatTooltip :tooltip="tooltip" />
  </div>
</template>
