<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import {
  Award,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  ChartPie,
  Clock,
  Cpu,
  Flame,
  Hash,
  Images,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Trophy
} from '@lucide/vue';
import PageLayout from '@/components/layout/PageLayout.vue';
import SettingsSection from '@/components/layout/SettingsSection.vue';
import ActivityHeatmap from '@/components/statistics/ActivityHeatmap.vue';
import ChartViewSwitch, {
  type SwitchOption
} from '@/components/statistics/ChartViewSwitch.vue';
import ColumnChart, {
  type ColumnDatum
} from '@/components/statistics/ColumnChart.vue';
import DonutChart, {
  type DonutDatum
} from '@/components/statistics/DonutChart.vue';
import PromptTagList from '@/components/statistics/PromptTagList.vue';
import RankedBars from '@/components/statistics/RankedBars.vue';
import StatTile from '@/components/statistics/StatTile.vue';
import { Button } from '@/components/ui/button';
import {
  useGenerationStats,
  type DailyWindow
} from '@/composables/useGenerationStats';
import { useLauncherStore } from '@/stores/launcherStore';
import { formatFileSize } from '@/utils/formatters';
import { dayKey } from '@/utils/generationStats';

type ChartStyleMode = 'donut' | 'pie' | 'bars';
type BreakdownDimension = 'folders' | 'formats' | 'periods';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_FULL_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];

const chartStyleOptions: SwitchOption<ChartStyleMode>[] = [
  { value: 'donut', label: 'Donut' },
  { value: 'pie', label: 'Pie' },
  { value: 'bars', label: 'Bars' }
];

const dailyWindowOptions: SwitchOption<DailyWindow>[] = [
  { value: 14, label: '14D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' }
];

const breakdownOptions: SwitchOption<BreakdownDimension>[] = [
  { value: 'folders', label: 'Folders' },
  { value: 'periods', label: 'Periods' },
  { value: 'formats', label: 'Formats' }
];

const router = useRouter();
const launcherStore = useLauncherStore();
const {
  isLoading,
  errorMessage,
  load,
  dailyWindow,
  heatmap,
  dailyWindowSeries,
  hourly,
  weekdays,
  timePeriods,
  models,
  subfolders,
  formats,
  promptTags,
  summary
} = useGenerationStats();

const modelChartMode = shallowRef<ChartStyleMode>('donut');
const breakdownDimension = shallowRef<BreakdownDimension>('folders');

const shortDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric'
});
const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});
const hourFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1
  }).format(value);
}

function formatDays(value: number) {
  return `${value} ${value === 1 ? 'day' : 'days'}`;
}

function formatHourRange(hour: number) {
  const start = new Date(2000, 0, 1, hour);
  const end = new Date(2000, 0, 1, hour + 1);
  return `${hourFormat.format(start)} – ${hourFormat.format(end)}`;
}

const weekDeltaBadge = computed(() => {
  const { lastWeek, previousWeek } = summary.value;
  if (previousWeek <= 0) {
    return lastWeek > 0 ? `+${formatCount(lastWeek)} this wk` : undefined;
  }
  const delta = Math.round(((lastWeek - previousWeek) / previousWeek) * 100);
  if (delta === 0) return 'Same as prev 7d';
  return `${delta > 0 ? '+' : ''}${delta}% vs prev 7d`;
});

const tiles = computed(() => {
  const stats = summary.value;
  return [
    {
      label: 'Total images',
      value: formatCount(stats.total),
      hint: `${formatFileSize(stats.diskBytes)} on disk`,
      badge:
        stats.avgFileSize > 0
          ? `~${formatFileSize(stats.avgFileSize)}/img`
          : undefined,
      badgeTone: 'neutral' as const,
      icon: Images
    },
    {
      label: 'Today',
      value: formatCount(stats.today),
      hint: `${formatCount(stats.lastWeek)} in the last 7 days`,
      badge: weekDeltaBadge.value,
      badgeTone:
        stats.lastWeek >= stats.previousWeek
          ? ('positive' as const)
          : ('neutral' as const),
      icon: Sparkles
    },
    {
      label: 'Daily average',
      value: formatCount(stats.dailyAverage),
      hint: `Over ${stats.activeDays.toLocaleString()} active days`,
      badge:
        stats.uniqueModels > 0
          ? `${stats.uniqueModels} ${stats.uniqueModels === 1 ? 'model' : 'models'}`
          : undefined,
      badgeTone: 'neutral' as const,
      icon: TrendingUp
    },
    {
      label: 'Best day',
      value: formatCount(stats.bestDay?.count ?? 0),
      hint: stats.bestDay
        ? longDate.format(stats.bestDay.date)
        : 'No activity yet',
      icon: Trophy
    },
    {
      label: 'Current streak',
      value: formatDays(stats.current),
      hint: 'Days in a row',
      badge: stats.current > 0 ? 'Active' : undefined,
      badgeTone: 'positive' as const,
      icon: Flame
    },
    {
      label: 'Longest streak',
      value: formatDays(stats.longest),
      hint: 'Your best run so far',
      icon: Award
    }
  ];
});

const dailyColumns = computed<ColumnDatum[]>(() =>
  dailyWindowSeries.value.map(({ date, count }) => ({
    key: dayKey(date),
    axisLabel: shortDate.format(date),
    detail: longDate.format(date),
    value: count
  }))
);

const dailyLabelEvery = computed(() => {
  if (dailyWindow.value === 14) return 2;
  if (dailyWindow.value === 90) return 15;
  return 7;
});

const dailyWindowTotal = computed(() =>
  dailyWindowSeries.value.reduce((sum, item) => sum + item.count, 0)
);

const hourlyColumns = computed<ColumnDatum[]>(() =>
  hourly.value.map((count, hour) => {
    const start = new Date(2000, 0, 1, hour);
    return {
      key: String(hour),
      axisLabel: hourFormat.format(start),
      detail: formatHourRange(hour),
      value: count
    };
  })
);

const weekdayColumns = computed<ColumnDatum[]>(() =>
  weekdays.value.map((count, index) => ({
    key: String(index),
    axisLabel: WEEKDAY_NAMES[index] ?? '',
    detail: WEEKDAY_FULL_NAMES[index] ?? '',
    value: count
  }))
);

const weekendShare = computed(() => {
  const total = summary.value.total;
  if (total <= 0) return 0;
  const weekendCount = (weekdays.value[0] ?? 0) + (weekdays.value[6] ?? 0);
  return Math.round((weekendCount / total) * 100);
});

const modelDonutItems = computed<DonutDatum[]>(() =>
  models.value.map((item) => ({
    key: item.name,
    label: item.name,
    value: item.count
  }))
);

const breakdownDonutItems = computed<DonutDatum[]>(() => {
  if (breakdownDimension.value === 'periods') {
    return timePeriods.value.map((period) => ({
      key: period.key,
      label: period.name,
      sublabel: period.detail,
      value: period.count
    }));
  }
  if (breakdownDimension.value === 'formats') {
    return formats.value.map((item) => ({
      key: item.name,
      label: item.name,
      sublabel:
        item.bytes === undefined ? undefined : formatFileSize(item.bytes),
      value: item.count
    }));
  }
  return subfolders.value.map((item) => ({
    key: item.name,
    label: item.name,
    sublabel: item.bytes === undefined ? undefined : formatFileSize(item.bytes),
    value: item.count
  }));
});

const timePeriodShares = computed(() => {
  const total = Math.max(1, summary.value.total);
  return timePeriods.value.map((period) => ({
    ...period,
    percent:
      summary.value.total > 0 ? Math.round((period.count / total) * 100) : 0
  }));
});
</script>

<template>
  <PageLayout
    title="Statistics"
    subtitle="Image generation activity, model distribution, and studio habits"
  >
    <template #icon>
      <ChartColumn class="h-4 w-4" />
    </template>
    <template #actions>
      <Button
        variant="outline"
        size="sm"
        class="h-8 text-xs"
        :disabled="isLoading || !launcherStore.hasComfyDirectory"
        @click="load(true)"
      >
        <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': isLoading }" />
        <span>Rescan</span>
      </Button>
    </template>

    <div
      v-if="launcherStore.localSetupMessage"
      class="bg-muted text-muted-foreground mb-5 flex items-center justify-between gap-3 rounded-lg p-3 text-xs"
      role="status"
    >
      <span>{{ launcherStore.localSetupMessage }}</span>
      <Button variant="outline" size="sm" @click="router.push('/settings')">
        Open Settings
      </Button>
    </div>
    <p v-if="errorMessage" class="text-destructive mb-5 text-xs" role="alert">
      {{ errorMessage }}
    </p>

    <div
      class="flex flex-col gap-5 transition-opacity"
      :class="{ 'opacity-60': isLoading }"
    >
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          v-for="tile in tiles"
          :key="tile.label"
          :label="tile.label"
          :value="tile.value"
          :hint="tile.hint"
          :badge="tile.badge"
          :badge-tone="tile.badgeTone"
        >
          <template #icon>
            <component :is="tile.icon" class="size-3.5" />
          </template>
        </StatTile>
      </div>

      <div class="grid gap-5 xl:grid-cols-3">
        <SettingsSection
          class="xl:col-span-2"
          title="Activity"
          description="Images per day over the last year. Brighter squares mean more images."
        >
          <template #icon>
            <Flame class="h-3.5 w-3.5" />
          </template>
          <ActivityHeatmap :weeks="heatmap" />
        </SettingsSection>

        <SettingsSection
          title="Top models"
          description="Checkpoint share recorded in PNG metadata"
        >
          <template #icon>
            <Cpu class="h-3.5 w-3.5" />
          </template>
          <template #actions>
            <ChartViewSwitch
              v-model="modelChartMode"
              :options="chartStyleOptions"
            />
          </template>

          <template v-if="models.length">
            <DonutChart
              v-if="modelChartMode !== 'bars'"
              :items="modelDonutItems"
              :variant="modelChartMode"
              center-label="Models"
            />
            <RankedBars v-else :items="models" show-rank />
          </template>
          <p v-else class="text-muted-foreground text-xs">
            No model metadata found in your generated PNGs yet.
          </p>
        </SettingsSection>
      </div>

      <div class="grid gap-5 lg:grid-cols-2">
        <SettingsSection
          :title="`Last ${dailyWindow} days`"
          :description="`${dailyWindowTotal.toLocaleString()} images generated in this window`"
        >
          <template #icon>
            <CalendarDays class="h-3.5 w-3.5" />
          </template>
          <template #actions>
            <ChartViewSwitch
              v-model="dailyWindow"
              :options="dailyWindowOptions"
            />
          </template>
          <ColumnChart
            :items="dailyColumns"
            :label-every="dailyLabelEvery"
            show-average
          />
        </SettingsSection>

        <SettingsSection
          title="Time of day"
          description="Hourly rhythm across all generated images"
        >
          <template #icon>
            <Clock class="h-3.5 w-3.5" />
          </template>
          <template #actions>
            <span
              v-if="summary.peakHour !== null"
              class="bg-secondary text-muted-foreground rounded-md px-2 py-1 text-xs"
            >
              Peak:
              <strong class="text-foreground font-medium">{{
                formatHourRange(summary.peakHour)
              }}</strong>
            </span>
          </template>
          <ColumnChart :items="hourlyColumns" :label-every="6" />
          <div class="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
            <div
              v-for="period in timePeriodShares"
              :key="period.key"
              class="border-border/60 bg-secondary/35 flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-xs"
            >
              <div class="flex items-center justify-between gap-1">
                <span class="text-foreground font-medium">{{
                  period.name
                }}</span>
                <span class="text-primary font-semibold tabular-nums">
                  {{ period.percent }}%
                </span>
              </div>
              <span class="text-muted-foreground text-xs">
                {{ period.count.toLocaleString() }} · {{ period.detail }}
              </span>
            </div>
          </div>
        </SettingsSection>
      </div>

      <div class="grid gap-5 lg:grid-cols-2">
        <SettingsSection
          title="Day of week"
          description="Generation volume by weekday"
        >
          <template #icon>
            <CalendarRange class="h-3.5 w-3.5" />
          </template>
          <template #actions>
            <span
              v-if="summary.peakWeekday !== null"
              class="bg-secondary text-muted-foreground rounded-md px-2 py-1 text-xs"
            >
              Busiest:
              <strong class="text-foreground font-medium">{{
                WEEKDAY_FULL_NAMES[summary.peakWeekday]
              }}</strong>
              · {{ weekendShare }}% weekend
            </span>
          </template>
          <ColumnChart :items="weekdayColumns" :label-every="1" show-average />
        </SettingsSection>

        <SettingsSection
          title="Output breakdown"
          description="Distribution by folder, time period, or file format"
        >
          <template #icon>
            <ChartPie class="h-3.5 w-3.5" />
          </template>
          <template #actions>
            <ChartViewSwitch
              v-model="breakdownDimension"
              :options="breakdownOptions"
            />
          </template>
          <DonutChart
            v-if="breakdownDonutItems.some((item) => item.value > 0)"
            :items="breakdownDonutItems"
            variant="pie"
            center-label="Share"
          />
          <p v-else class="text-muted-foreground text-xs">
            No output files found to break down yet.
          </p>
        </SettingsSection>
      </div>

      <SettingsSection
        v-if="promptTags.length"
        title="Top prompt tags"
        description="Most frequent tags recorded across your generated PNG prompts"
      >
        <template #icon>
          <Hash class="h-3.5 w-3.5" />
        </template>
        <PromptTagList :items="promptTags" :total-images="summary.total" />
      </SettingsSection>
    </div>
  </PageLayout>
</template>
