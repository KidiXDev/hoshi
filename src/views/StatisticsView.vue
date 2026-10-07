<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  CalendarDays,
  ChartColumn,
  Clock,
  Cpu,
  Flame,
  RefreshCw
} from '@lucide/vue';
import PageLayout from '@/components/layout/PageLayout.vue';
import SettingsSection from '@/components/layout/SettingsSection.vue';
import ActivityHeatmap from '@/components/statistics/ActivityHeatmap.vue';
import ColumnChart, {
  type ColumnDatum
} from '@/components/statistics/ColumnChart.vue';
import RankedBars from '@/components/statistics/RankedBars.vue';
import StatTile from '@/components/statistics/StatTile.vue';
import { Button } from '@/components/ui/button';
import { useGenerationStats } from '@/composables/useGenerationStats';
import { useLauncherStore } from '@/stores/launcherStore';
import { formatFileSize } from '@/utils/formatters';
import { dayKey } from '@/utils/generationStats';

const router = useRouter();
const launcherStore = useLauncherStore();
const {
  isLoading,
  errorMessage,
  load,
  heatmap,
  last30Days,
  hourly,
  models,
  summary
} = useGenerationStats();

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

const tiles = computed(() => {
  const stats = summary.value;
  return [
    {
      label: 'Total images',
      value: formatCount(stats.total),
      hint: `${formatFileSize(stats.diskBytes)} on disk`
    },
    {
      label: 'Today',
      value: formatCount(stats.today),
      hint: `${formatCount(stats.lastWeek)} in the last 7 days`
    },
    {
      label: 'Daily average',
      value: formatCount(stats.dailyAverage),
      hint: `Over ${stats.activeDays.toLocaleString()} active days`
    },
    {
      label: 'Best day',
      value: formatCount(stats.bestDay?.count ?? 0),
      hint: stats.bestDay
        ? longDate.format(stats.bestDay.date)
        : 'No activity yet'
    },
    {
      label: 'Current streak',
      value: formatDays(stats.current),
      hint: 'Days in a row'
    },
    {
      label: 'Longest streak',
      value: formatDays(stats.longest),
      hint: 'Your best run so far'
    }
  ];
});

const dailyColumns = computed<ColumnDatum[]>(() =>
  last30Days.value.map(({ date, count }) => ({
    key: dayKey(date),
    axisLabel: shortDate.format(date),
    detail: longDate.format(date),
    value: count
  }))
);

const hourlyColumns = computed<ColumnDatum[]>(() =>
  hourly.value.map((count, hour) => {
    const start = new Date(2000, 0, 1, hour);
    const end = new Date(2000, 0, 1, hour + 1);
    return {
      key: String(hour),
      axisLabel: hourFormat.format(start),
      detail: `${hourFormat.format(start)} – ${hourFormat.format(end)}`,
      value: count
    };
  })
);
</script>

<template>
  <PageLayout
    title="Statistics"
    subtitle="Image generation activity from your ComfyUI output folder"
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
        />
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
          description="Checkpoint recorded in each PNG's metadata"
        >
          <template #icon>
            <Cpu class="h-3.5 w-3.5" />
          </template>
          <RankedBars v-if="models.length" :items="models" />
          <p v-else class="text-muted-foreground text-xs">
            No model metadata found in your generated PNGs yet.
          </p>
        </SettingsSection>
      </div>

      <div class="grid gap-5 lg:grid-cols-2">
        <SettingsSection
          title="Last 30 days"
          description="Images generated each day"
        >
          <template #icon>
            <CalendarDays class="h-3.5 w-3.5" />
          </template>
          <ColumnChart :items="dailyColumns" :label-every="7" />
        </SettingsSection>

        <SettingsSection
          title="Time of day"
          description="When your images were generated, all time"
        >
          <template #icon>
            <Clock class="h-3.5 w-3.5" />
          </template>
          <ColumnChart :items="hourlyColumns" :label-every="6" />
        </SettingsSection>
      </div>
    </div>
  </PageLayout>
</template>
